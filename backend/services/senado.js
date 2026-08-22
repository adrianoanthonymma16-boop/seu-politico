/* ==========================================================================
   senado.js — Serviço de acesso a dados oficiais do Senado Federal
   --------------------------------------------------------------------------
   Duas APIs públicas do Senado:
     - legis (dados abertos legislativos): senadores e perfil
         https://legis.senado.leg.br/dadosabertos/senador/lista/atual
     - adm (transparência): despesas CEAPS (cota parlamentar dos senadores)
         https://adm.senado.gov.br/adm-dadosabertos/api/v1/senadores/despesas_ceaps/{ano}

   O fluxo espelha o da Câmara:
     1. Baixa e importa as despesas CEAPS do ano em PostgreSQL
        (despesas_senadores) + índice nome → codSenador.
     2. Vincula senador (legis) às despesas pelo id (codSenador).
   ========================================================================== */

const { requisitarSenadoAdm, requisitarSenadoLegis } = require('./proxy');
const { pool, habilitado } = require('../db');
const cache = require('./cache');
const mock = require('./mockData');

const MOCK = process.env.USE_MOCK === 'true';

function normalizarNome(nome) {
    return String(nome || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .trim();
}

/* ---- Normalização de senador (estrutura da API legis) ---- */
function normalizarSenador(p) {
    const id = p.IdentificacaoParlamentar || p;
    const mandatos = p.Mandatos || p.mandatos || {};
    return {
        id: Number(id.CodigoParlamentar) || null,
        nome: id.NomeParlamentar || id.nome || 'Sem nome',
        nomeCivil: id.NomeCompletoParlamentar || id.NomeParlamentar || 'Sem nome',
        partido: id.SiglaPartidoParlamentar || id.partido || '—',
        uf: id.UfParlamentar || id.uf || '—',
        urlFoto: id.UrlFotoParlamentar || id.urlFoto || '',
        email: id.EmailParlamentar || id.email || '',
        cargo: 'Senador',
        telefone: id.Telefones && id.Telefones.Telefone
            ? (Array.isArray(id.Telefones.Telefone) ? id.Telefones.Telefone[0] : id.Telefones.Telefone).NumeroTelefone
            : '',
        mandato: mandatos.Mandato ? mandatos.Mandato.length : undefined,
    };
}

/* ---- Normalização de despesa CEAPS ---- */
function normalizarDespesaCeaps(r) {
    return {
        ano: Number(r.ano) || null,
        mes: Number(r.mes) || null,
        tipo: r.tipoDespesa || 'Despesa',
        data: r.data || '',
        valor: Number(r.valorReembolsado) || 0,
        fornecedor: r.fornecedor || 'Não informado',
        cnpjCpf: String(r.cpfCnpj || '').replace(/[.\-\/]/g, '').trim(),
        documento: String(r.documento || r.id || ''),
        url: '',
        tipoDocumento: r.tipoDocumento || '',
        detalhamento: r.detalhamento || '',
    };
}

/* ---- Lista de senadores em exercício (API legis) ---- */
async function listarSenadores({ nome, partido, uf } = {}) {
    const chave = `senado:senadores:${nome || ''}:${partido || ''}:${uf || ''}`;
    const cached = await cache.obter(chave);
    if (cached) return cached;

    if (MOCK) {
        const lista = mockSenadores();
        const dados = lista.filter((s) =>
            (!nome || s.nome.toLowerCase().includes(String(nome).toLowerCase())) &&
            (!partido || s.partido === partido) &&
            (!uf || s.uf === uf)
        );
        const resultado = { dados, total: dados.length };
        await cache.gravar(chave, resultado, 6 * 3600);
        return resultado;
    }

    const resposta = await requisitarSenadoLegis('senador/lista/atual');
    const parl = resposta.ListaParlamentarEmExercicio?.Parlamentares?.Parlamentar;
    const listaRaw = Array.isArray(parl) ? parl : (parl ? [parl] : []);

    let dados = listaRaw.map(normalizarSenador).filter((s) => s.id);
    if (nome) dados = dados.filter((s) => s.nome.toLowerCase().includes(String(nome).toLowerCase()));
    if (partido) dados = dados.filter((s) => s.partido === partido);
    if (uf) dados = dados.filter((s) => s.uf === uf);

    const resultado = { dados, total: dados.length };
    await cache.gravar(chave, resultado, 6 * 3600);
    return resultado;
}

/* ---- Detalhes de um senador ---- */
async function obterSenador(id) {
    const chave = `senado:senador:${id}`;
    const cached = await cache.obter(chave);
    if (cached) return cached;

    if (MOCK) {
        const sen = mockSenadores().find((s) => s.id === Number(id));
        await cache.gravar(chave, sen || null, 24 * 3600);
        return sen || null;
    }

    const resposta = await requisitarSenadoLegis(`senador/${id}`);
    const p = resposta.DetalheParlamentar?.Parlamentar;
    if (!p) return null;

    const senador = normalizarSenador(p);
    await cache.gravar(chave, senador, 24 * 3600);
    return senador;
}

/* ---- Importa as despesas CEAPS de um ano (API adm) ---- */
async function sincronizarCeaps(ano) {
    if (!habilitado) {
        throw new Error(
            'As despesas CEAPS reais exigem PostgreSQL (DATABASE_URL configurada). ' +
            'Use USE_MOCK=true para demonstração sem banco.'
        );
    }

    const flag = await cache.obter(`senado:ceaps:sincronizado:${ano}`);
    if (flag) return flag;

    console.log(`[senado] baixando CEAPS de ${ano}...`);
    const resposta = await requisitarSenadoAdm(`senadores/despesas_ceaps/${ano}`);
    const registros = Array.isArray(resposta) ? resposta : (resposta.data || []);

    const porSenador = {};
    const indiceNomes = {};
    for (const r of registros) {
        const id = Number(r.codSenador);
        if (!id) continue;
        const nome = normalizarNome(r.nomeSenador);
        if (nome && !indiceNomes[nome]) indiceNomes[nome] = id;
        if (!porSenador[id]) porSenador[id] = [];
        porSenador[id].push(normalizarDespesaCeaps(r));
    }

    console.log(`[senado] ${registros.length} registros de ${Object.keys(porSenador).length} senadores. Gravando...`);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const [id, despesas] of Object.entries(porSenador)) {
            await client.query(
                `INSERT INTO despesas_senadores (senador_id, ano, dados)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (senador_id, ano)
                 DO UPDATE SET dados = $3, atualizado_em = now()`,
                [Number(id), Number(ano), JSON.stringify(despesas)]
            );
        }
        await client.query('COMMIT');
    } catch (erro) {
        await client.query('ROLLBACK');
        throw erro;
    } finally {
        client.release();
    }

    const resultado = { ano, registros: registros.length, senadores: Object.keys(porSenador).length };
    await cache.gravar(`senado:ceaps:indice:${ano}`, indiceNomes, 24 * 3600);
    await cache.gravar(`senado:ceaps:sincronizado:${ano}`, resultado, 12 * 3600);
    console.log(`[senado] CEAPS ${ano} importado (${resultado.senadores} senadores).`);
    return resultado;
}

/* ---- Despesas CEAPS de um senador (pelo nome) ---- */
async function obterDespesasCeaps(nomeParlamentar, ano) {
    if (!habilitado) return null;

    let indice = await cache.obter(`senado:ceaps:indice:${ano}`);
    if (!indice) {
        await sincronizarCeaps(ano);
        indice = await cache.obter(`senado:ceaps:indice:${ano}`);
    }
    if (!indice) return null;

    const senadorId = indice[normalizarNome(nomeParlamentar)];
    if (!senadorId) return null;

    const { rows } = await pool.query(
        'SELECT dados FROM despesas_senadores WHERE senador_id = $1 AND ano = $2',
        [senadorId, Number(ano)]
    );
    return rows.length ? rows[0].dados : [];
}

/* ---- Mock de senadores (demonstração) ---- */
function mockSenadores() {
    const nomes = [
        'Adriana Cardoso', 'Bruno Freitas', 'Camila Duarte', 'Daniel Rocha', 'Elisa Martins',
        'Fábio Silveira', 'Gabriela Prado', 'Heitor Lopes', 'Isadora Castro', 'Júlio Andrade',
        'Karen Monteiro', 'Leonardo Pinto', 'Marina Sales', 'Nicolas Ferreira', 'Olga Rezende',
        'Pedro Henrique', 'Rafaela Nogueira', 'Sérgio Barros', 'Talita Campos', 'Vinícius Braga',
        'Wanda Ferraz', 'Yuri Barbosa', 'Alice Gomes', 'Breno Tavares', 'Cecília Ramos',
    ];
    const partidos = ['PL', 'PT', 'PSDB', 'MDB', 'PSB', 'PSD', 'Podemos', 'Republicanos', 'PDT'];
    const ufs = ['SP', 'RJ', 'MG', 'BA', 'RS', 'PR', 'CE', 'AM', 'GO', 'DF', 'PA', 'PE'];

    let seed = 9000;
    return nomes.map((nome, i) => {
        seed = seed + i + 1;
        const r = Math.abs(Math.sin(seed)) ;
        return {
            id: 9000 + i + 1,
            nome,
            nomeCivil: nome,
            partido: partidos[Math.floor(r * partidos.length) % partidos.length],
            uf: ufs[Math.floor(r * ufs.length) % ufs.length],
            urlFoto: '',
            email: `${nome.split(' ')[0].toLowerCase()}.sen@senado.leg.br`,
            cargo: 'Senador',
            telefone: '(61) 3303-0000',
        };
    });
}

/* ---- Despesas mock de um senador (demonstração) ---- */
function mockDespesasSenador(id, ano) {
    const categorias = [
        'Locomoção, hospedagem, alimentação, combustíveis e lubrificantes',
        'Contratação de consultorias e assessorias',
        'Serviço de segurança privada',
        'Passagens aéreas',
        'Locação de veículos',
        'Material de consumo',
        'Outros serviços',
    ];
    const fornecedores = [
        'Companhia Aérea Nacional', 'Hotéis do Brasil Ltda', 'Posto Central', 'Assessoria Júnior',
        'Vigilância Total', 'Locadora Nacional', 'Serviços Gerais Ltda',
    ];
    let s = (Number(id) * 31 + Number(ano) * 7) % 2147483647;
    const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };

    const despesas = [];
    const num = 40 + Math.floor(rng() * 40);
    const fornecedorForte = fornecedores[Math.floor(rng() * fornecedores.length)];
    const concentrado = rng() > 0.5;
    const mesPico = 3 + Math.floor(rng() * 6);

    for (let i = 0; i < num; i++) {
        const mes = 1 + Math.floor(rng() * 12);
        const tipo = categorias[Math.floor(rng() * categorias.length)];
        let fornecedor = fornecedores[Math.floor(rng() * fornecedores.length)];
        if (concentrado && rng() < 0.7) fornecedor = fornecedorForte;
        let valor = 100 + rng() * 8000;
        if (mes === mesPico && rng() < 0.4) valor *= 4 + rng() * 3;
        despesas.push({
            ano: Number(ano),
            mes,
            tipo,
            data: `${String(mes).padStart(2, '0')}/${ano}`,
            valor: Math.round(valor * 100) / 100,
            fornecedor,
            cnpjCpf: String(10000000000000 + Math.floor(rng() * 8999999999999)),
            documento: String(100000 + Math.floor(rng() * 899999)),
            url: '',
            tipoDocumento: 'Nota Fiscal',
            detalhamento: '',
        });
    }
    despesas.sort((a, b) => a.mes - b.mes);
    return despesas;
}

module.exports = {
    listarSenadores,
    obterSenador,
    sincronizarCeaps,
    obterDespesasCeaps,
    mockDespesasSenador,
    normalizarNome,
    normalizarDespesaCeaps,
};
