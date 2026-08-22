/* ==========================================================================
   deputados.js — Serviço unificado de acesso a dados da Câmara
   --------------------------------------------------------------------------
   Em USE_MOCK=true usa dados fictícios; caso contrário, chama a API aberta
   da Câmara dos Deputados com cache em PostgreSQL (ou memória) e rate limit.
   ========================================================================== */

const { requisitarCamara } = require('./proxy');
const cache = require('./cache');
const mock = require('./mockData');

const MOCK = process.env.USE_MOCK === 'true';

const ITENS = 100; // página da Câmara suporta até 100 itens

function normalizarDeputado(item) {
    const status = item.ultimoStatus || item;
    return {
        id: item.id,
        nome: status.nome || item.nomeCivil || item.nome || 'Sem nome',
        nomeCivil: item.nomeCivil || item.nome || status.nome || 'Sem nome',
        partido: status.siglaPartido || item.siglaPartido || item.partido || '—',
        uf: status.siglaUf || item.siglaUf || item.uf || '—',
        urlFoto: status.urlFoto || item.urlFoto || '',
        email: item.email || status.email || '',
        cargo: 'Deputado Federal',
        legislatura: item.idLegislatura || status.idLegislatura || null,
    };
}

function normalizarDespesa(item) {
    return {
        ano: Number(item.ano) || null,
        mes: Number(item.mes) || null,
        tipo: item.tipoDespesa || item.tipo || 'Despesa',
        data: item.dataDocumento || item.data || '',
        valor: Number(item.valorLiquido ?? item.valorDocumento ?? item.valor) || 0,
        fornecedor: item.nomeFornecedor || item.fornecedor || 'Não informado',
        cnpjCpf: item.cnpjCpfFornecedor || item.cnpjCpf || '',
        documento: item.codDocumento || item.documento || '',
        restituicao: Number(item.restituicao) || 0,
        url: item.urlDocumento || item.url || '',
    };
}

/* ---- Busca de deputados ---- */
async function buscarDeputados({ nome, siglaPartido, siglaUf, pagina = 1 }) {
    const chaveCache = `camara:deputados:${nome || ''}:${siglaPartido || ''}:${siglaUf || ''}:${pagina}`;

    const cached = await cache.obter(chaveCache);
    if (cached) return cached;

    if (MOCK) {
        const resultado = mock.listarDeputados({ nome, siglaPartido, siglaUf, pagina });
        await cache.gravar(chaveCache, resultado, 6 * 3600);
        return resultado;
    }

    const resposta = await requisitarCamara('deputados', {
        nome, siglaPartido, siglaUf, pagina, itens: ITENS,
    });

    const dados = (resposta.dados || []).map(normalizarDeputado);
    const ultima = extrairUltimaPagina(resposta.links, pagina);
    const resultado = { dados, links: { pagina: Number(pagina), ultima } };

    await cache.gravar(chaveCache, resultado, 6 * 3600);
    return resultado;
}

/* ---- Detalhes de um deputado ---- */
async function obterDeputado(id) {
    const chaveCache = `camara:deputado:${id}`;
    const cached = await cache.obter(chaveCache);
    if (cached) return cached;

    if (MOCK) {
        const resposta = mock.obterDeputado(id);
        if (!resposta) return null;
        const dep = normalizarDeputado(resposta.dados[0]);
        await cache.gravar(chaveCache, dep, 24 * 3600);
        return dep;
    }

    const resposta = await requisitarCamara(`deputados/${id}`);
    const dados = resposta.dados;
    const item = Array.isArray(dados) ? dados[0] : dados;
    if (!item) return null;

    const dep = normalizarDeputado(item);
    await cache.gravar(chaveCache, dep, 24 * 3600);
    return dep;
}

/* ---- Todas as despesas de um deputado em um ano (com paginação) ---- */
async function obterTodasDespesas(id, ano, limitePaginas = 15) {
    const chaveCache = `camara:despesas:${id}:${ano}`;
    const cached = await cache.obter(chaveCache);
    if (cached) return cached;

    if (MOCK) {
        const todas = [];
        for (let pagina = 1; pagina <= limitePaginas; pagina++) {
            const resposta = mock.obterDespesas(id, { ano, pagina });
            const dados = resposta.dados.map(normalizarDespesa);
            todas.push(...dados);
            if (resposta.links.ultima <= pagina || dados.length === 0) break;
        }
        await cache.gravar(chaveCache, todas, 2 * 3600);
        return todas;
    }

    // 1) Tenta a API REST da Câmara.
    const viaRest = [];
    for (let pagina = 1; pagina <= limitePaginas; pagina++) {
        const resposta = await requisitarCamara(`deputados/${id}/despesas`, {
            ano, itens: ITENS, pagina,
        });
        const dados = (resposta.dados || []).map(normalizarDespesa);
        viaRest.push(...dados);

        const ultima = extrairUltimaPagina(resposta.links, pagina);
        if (dados.length === 0 || pagina >= ultima) break;
    }

    // 2) Fallback para o arquivo oficial de cota parlamentar (fonte confiável).
    if (viaRest.length === 0) {
        try {
            const deputado = await obterDeputado(id);
            if (deputado) {
                const { obterDespesasDeCota } = require('./cotas');
                const viaCota = await obterDespesasDeCota(deputado.nome, ano);
                if (Array.isArray(viaCota)) {
                    await cache.gravar(chaveCache, viaCota, 2 * 3600);
                    return viaCota;
                }
            }
        } catch (erro) {
            console.warn('[deputados] cotas indisponíveis:', erro.message);
        }
    }

    await cache.gravar(chaveCache, viaRest, 2 * 3600);
    return viaRest;
}

/* ---- Partidos ---- */
async function listarPartidos() {
    const chaveCache = 'camara:partidos';
    const cached = await cache.obter(chaveCache);
    if (cached) return cached;

    if (MOCK) {
        const resposta = mock.listarPartidos();
        await cache.gravar(chaveCache, resposta.dados, 24 * 3600);
        return resposta.dados;
    }

    const resposta = await requisitarCamara('partidos', { itens: ITENS, ordenarPor: 'sigla' });
    const dados = (resposta.dados || []).map((p) => ({
        id: p.id,
        sigla: p.sigla,
        nome: p.nome,
    }));
    await cache.gravar(chaveCache, dados, 24 * 3600);
    return dados;
}

/* ---- Extrai a última página a partir dos links de paginação ---- */
function extrairUltimaPagina(links, paginaAtual) {
    if (!Array.isArray(links)) return paginaAtual;
    const ultimo = links.find((l) => l.rel === 'last');
    if (!ultimo || !ultimo.href) return paginaAtual;
    try {
        const url = new URL(ultimo.href);
        return Number(url.searchParams.get('pagina')) || paginaAtual;
    } catch (e) {
        return paginaAtual;
    }
}

module.exports = {
    buscarDeputados,
    obterDeputado,
    obterTodasDespesas,
    listarPartidos,
    normalizarDeputado,
    normalizarDespesa,
};
