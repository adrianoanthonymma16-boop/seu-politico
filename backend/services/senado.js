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

/* ---- Registros CEAPS crus de um ano (API adm) — reutilizado por outras análises ---- */
async function obterRegistrosCeaps(ano) {
    const chaveCache = `senado:ceaps:registros:${ano}`;
    const cached = await cache.obter(chaveCache);
    if (cached) return cached;

    const resposta = await requisitarSenadoAdm(`senadores/despesas_ceaps/${ano}`);
    const registros = Array.isArray(resposta) ? resposta : (resposta.data || []);
    await cache.gravar(chaveCache, registros, 12 * 3600);
    return registros;
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
    const registros = await obterRegistrosCeaps(ano);

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
    // 1) PostgreSQL (se disponível).
    if (habilitado) {
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

    // 2) Sem PostgreSQL: busca API e filtra por nome (cache integral em Upstash).
    const chaveRegistros = `senado:ceaps:registros:${ano}`;
    let registros = await cache.obter(chaveRegistros);
    if (!registros) {
        const resposta = await requisitarSenadoAdm(`senadores/despesas_ceaps/${ano}`);
        registros = Array.isArray(resposta) ? resposta : (resposta.data || []);
        // Cache por 12h (dados de um ano mudam pouco).
        await cache.gravar(chaveRegistros, registros, 12 * 3600);
    }

    const nomeNorm = normalizarNome(nomeParlamentar);
    const despesas = registros
        .filter((r) => normalizarNome(r.nomeSenador) === nomeNorm)
        .map(normalizarDespesaCeaps);
    return despesas;
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

/* ---- Frequência do senador em votações nominais ---- */
// Conjuntos normalizados (sem acento, maiúsculas) — comparar via normalizarSiglaVoto().
const SIGLA_PRESENCA = new Set([
    'VOTOU', 'VO', 'SIM', 'NAO', 'ABSTENCAO', 'P-NRV', 'P-OD', 'OB', 'SF', 'PSF', 'PR', 'PS',
    'SI', 'VS', 'VOTO DO PRESIDENTE', 'PRESIDENTE (ART. 51 RISF)',
]);
const SIGLA_FALTA_JUSTIFICADA = new Set([
    'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'LA', 'LAF', 'LAP', 'LC', 'LCS', 'LEG', 'LG',
    'LGA', 'LL', 'LN', 'LP', 'LPA', 'LS', 'LSP', 'AFO', 'AUS', 'AP', 'MIS', 'MER', 'REP',
    'DJ', 'GR', 'CAS', 'IL', 'EP', 'EPR', 'RET', 'REN', 'TER', 'PER', 'IMP', 'NA',
]);
const SIGLA_FALTA_INJUSTIFICADA = new Set(['NCOM', 'NR']);

function normalizarSiglaVoto(sigla) {
    return String(sigla || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .trim();
}

/**
 * Presenças e faltas de um senador em votações nominais de Plenário no ano.
 * O Senado não publica um resumo de frequência em API; usamos o webservice de
 * votações (filtrado por parlamentar) e classificamos o comparecimento pelas
 * siglas oficiais de voto (tiposComparecimento). Cache de 6h.
 */
async function obterFrequenciaVotacoes(senadorId, ano) {
    const chaveCache = `senado:frequencia:${senadorId}:${ano}`;
    const cached = await cache.obter(chaveCache);
    if (cached) return cached;

    if (MOCK) {
        const resultado = mock.obterFrequenciaSenador(senadorId, ano);
        await cache.gravar(chaveCache, resultado, 6 * 3600);
        return resultado;
    }

    const resposta = await requisitarSenadoLegis('votacao', {
        codigoParlamentar: senadorId,
        dataInicio: `${ano}-01-01`,
        dataFim: `${ano}-12-31`,
    });
    const registros = Array.isArray(resposta) ? resposta : (resposta.data || []);

    let presencas = 0;
    let faltasJustificadas = 0;
    let faltasInjustificadas = 0;
    let outras = 0;

    for (const rec of registros) {
        const voto = rec.votos && rec.votos[0] ? rec.votos[0].siglaVotoParlamentar : null;
        const sigla = normalizarSiglaVoto(voto);
        if (!sigla) { outras++; continue; }
        if (SIGLA_PRESENCA.has(sigla)) presencas++;
        else if (SIGLA_FALTA_JUSTIFICADA.has(sigla)) faltasJustificadas++;
        else if (SIGLA_FALTA_INJUSTIFICADA.has(sigla)) faltasInjustificadas++;
        else outras++;
    }

    const total = presencas + faltasJustificadas + faltasInjustificadas + outras;
    const resultado = {
        fonte: 'Comparecimento em votações nominais — Senado Federal',
        urlFonte: `https://legis.senado.leg.br/dadosabertos/votacao?codigoParlamentar=${senadorId}&dataInicio=${ano}-01-01&dataFim=${ano}-12-31`,
        ano: Number(ano),
        totalVotacoes: registros.length,
        presencas,
        faltasJustificadas,
        faltasInjustificadas,
        outras,
        taxaPresenca: total ? Math.round((presencas / total) * 10000) / 100 : null,
    };
    await cache.gravar(chaveCache, resultado, 6 * 3600);
    return resultado;
}

/* ---- Votações de um senador em Plenário (webservice /votacao) ---- */
async function obterVotacoesSenador(senadorId, ano) {
    const chaveCache = `senado:votacoes:${senadorId}:${ano}`;
    const cached = await cache.obter(chaveCache);
    if (cached) return cached;

    if (MOCK) {
        const resultado = mock.obterVotacoesSenador(senadorId, { ano });
        await cache.gravar(chaveCache, resultado, 6 * 3600);
        return resultado;
    }

    const resposta = await requisitarSenadoLegis('votacao', {
        codigoParlamentar: senadorId,
        dataInicio: `${ano}-01-01`,
        dataFim: `${ano}-12-31`,
    });
    const registros = Array.isArray(resposta) ? resposta : (resposta.data || []);

    const dados = registros.map((rec) => ({
        idVotacao: rec.codigoSessaoVotacao,
        sessao: rec.codigoSessao,
        data: rec.dataSessao || '',
        orgao: 'Plenário',
        titulo: rec.identificacao || 'Votação',
        ementa: rec.descricaoVotacao || rec.ementa || '',
        voto: rec.votos && rec.votos[0] ? (rec.votos[0].siglaVotoParlamentar || '—') : '—',
    })).sort((a, b) => String(b.data).localeCompare(String(a.data)));

    const resultado = { dados, links: { pagina: 1, ultima: 1 } };
    await cache.gravar(chaveCache, resultado, 6 * 3600);
    return resultado;
}

/* ---- Detalhe de uma votação do Senado (placar + votos de todos) ---- */
async function obterDetalheVotacaoSenado(codigoSessao, codigoSessaoVotacao) {
    const chaveCache = `senado:votacao:${codigoSessao}:${codigoSessaoVotacao}`;
    const cached = await cache.obter(chaveCache);
    if (cached) return cached;

    if (MOCK) {
        const resultado = mock.obterDetalheVotacaoSenado(codigoSessaoVotacao);
        await cache.gravar(chaveCache, resultado, 12 * 3600);
        return resultado;
    }

    const resposta = await requisitarSenadoLegis('votacao', { codigoSessao });
    const registros = Array.isArray(resposta) ? resposta : (resposta.data || []);
    const rec = registros.find((r) => String(r.codigoSessaoVotacao) === String(codigoSessaoVotacao));
    if (!rec) {
        throw Object.assign(new Error('Votação não encontrada.'), { status: 404 });
    }

    const n = (sigla) => String(sigla || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    const votos = (rec.votos || []).map((v) => ({
        senador: v.codigoParlamentar ? {
            id: v.codigoParlamentar,
            nome: v.nomeParlamentar || '—',
            partido: v.siglaPartidoParlamentar || '—',
            uf: v.siglaUFParlamentar || '—',
        } : null,
        voto: v.siglaVotoParlamentar || '—',
    }));

    const resultado = {
        idVotacao: rec.codigoSessaoVotacao,
        data: rec.dataSessao || '',
        orgao: 'Plenário',
        titulo: rec.identificacao || 'Votação',
        ementa: rec.descricaoVotacao || rec.ementa || '',
        resultado: {
            totalVotos: votos.length,
            sim: votos.filter((v) => n(v.voto) === 'SIM').length,
            nao: votos.filter((v) => n(v.voto) === 'NAO').length,
            abstencoes: votos.filter((v) => n(v.voto) === 'ABSTENCAO').length,
        },
        votos,
    };
    await cache.gravar(chaveCache, resultado, 12 * 3600);
    return resultado;
}

/* ---- Discursos do senador (best-effort; API do Senado pode devolver vazio) ---- */
async function obterDiscursosSenador(senadorId, ano) {
    const chaveCache = `senado:discursos:${senadorId}:${ano}`;
    const cached = await cache.obter(chaveCache);
    if (cached) return cached;

    if (MOCK) {
        const resultado = mock.obterDiscursosSenador(senadorId, ano);
        await cache.gravar(chaveCache, resultado, 6 * 3600);
        return resultado;
    }

    const resposta = await requisitarSenadoLegis(`senador/${senadorId}/discursos`, {
        dataInicio: `${ano}-01-01`,
        dataFim: `${ano}-12-31`,
    });

    const brutos = [];
    const raiz = resposta.DiscursosParlamentar || resposta || {};
    const diretos = raiz.Discursos?.Discurso;
    if (Array.isArray(diretos)) brutos.push(...diretos);
    else if (diretos) brutos.push(diretos);

    const pron = raiz.Parlamentar?.Pronunciamentos;
    if (Array.isArray(pron)) brutos.push(...pron);
    else if (pron?.Pronunciamento) {
        if (Array.isArray(pron.Pronunciamento)) brutos.push(...pron.Pronunciamento);
        else brutos.push(pron.Pronunciamento);
    }

    const dados = brutos
        .map((d) => ({
            dataHoraInicio: d.DataPronunciamento || d.Data || '',
            tipoDiscurso: d.TipoPronunciamento || d.Tipo || '',
            sumario: d.Sumario || d.Resumo || d.Indexacao || '',
            transcricao: d.Transcricao || d.Texto || '',
            urlTexto: d.UrlTexto || '',
            urlAudio: d.UrlAudio || '',
            urlVideo: d.UrlVideo || '',
        }))
        .filter((d) => d.dataHoraInicio || d.sumario || d.transcricao);

    const resultado = { dados, links: { pagina: 1, ultima: 1 } };
    await cache.gravar(chaveCache, resultado, 6 * 3600);
    return resultado;
}

module.exports = {
    listarSenadores,
    obterSenador,
    sincronizarCeaps,
    obterDespesasCeaps,
    obterRegistrosCeaps,
    obterFrequenciaVotacoes,
    obterVotacoesSenador,
    obterDetalheVotacaoSenado,
    obterDiscursosSenador,
    mockDespesasSenador,
    normalizarNome,
    normalizarDespesaCeaps,
};
