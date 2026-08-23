/* ==========================================================================
   poderes.js — Dashboard "Partidos e Poderes"
   --------------------------------------------------------------------------
   Agrega, para o ano (e opcionalmente mês):
     - Composição por partido (nº de deputados e senadores)
     - Gasto por partido (cota da Câmara + CEAPS do Senado)
     - Emendas por partido (execução/valor pago, partido do autor) — só ano
     - Gasto por poder: Câmara (cota), Senado (CEAPS), Executivo (contratos)
   Fontes: arquivos oficiais da Câmara/Senado e Portal da Transparência.
   Cache de 24h + guarda de computação em andamento (evita carga duplicada).
   ========================================================================== */

const { obterRegistrosCota } = require('./cotas');
const { obterRegistrosCeaps, listarSenadores } = require('./senado');
const { buscarDeputados } = require('./deputados');
const { requisitarPortal } = require('./proxy');
const { ORGAOS_PRINCIPAIS } = require('./orgaosPrincipais');
const cache = require('./cache');
const mock = require('./mockData');

const MOCK = process.env.USE_MOCK === 'true';

const LIMITE_PAGINAS_EMENDAS = 10;
const LIMITE_PAGINAS_CONTRATOS = 1;
const TAMANHO_PAGINA_CONTRATOS = 100;
const ORCAMENTO_PAGINAS_CONTRATOS = 12; // amostra representativa para caber no limite de 60s do serverless

let computando = null; // guarda de concorrência (promessa em andamento)

function normalizarNome(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .trim();
}

function extrairNomeAutor(nomeAutor) {
    const base = String(nomeAutor || '').split('(')[0].trim();
    return normalizarNome(base);
}

function parseValorBR(valor) {
    const n = Number(String(valor || '').replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
}

function normalizarDataISO(valor) {
    const s = String(valor || '');
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
}

/* ---- Lista completa de deputados (todas as páginas, cacheado) ---- */
async function obterTodosDeputados() {
    const chave = 'poderes:deputados:lista';
    const cached = await cache.obter(chave);
    if (cached) return cached;

    const primeiro = await buscarDeputados({ pagina: 1 });
    const lista = primeiro.dados.slice();
    const ultima = primeiro.links.ultima || 1;
    for (let p = 2; p <= ultima; p++) {
        const r = await buscarDeputados({ pagina: p });
        lista.push(...(r.dados || []));
    }
    await cache.gravar(chave, lista, 12 * 3600);
    return lista;
}

/* ---- Emendas do Portal por partido (paginação completa, cache 24h) ---- */
async function agregarEmendasPorPartido(ano, mapaPartidoPorNome) {
    const chave = `poderes:emendas:${ano}`;
    const cached = await cache.obter(chave);
    if (cached) return cached;

    const porPartido = {};
    let semPartido = 0;
    let total = 0;
    let pagina = 1;

    for (; pagina <= LIMITE_PAGINAS_EMENDAS; pagina++) {
        const registros = await requisitarPortal('emendas', { ano, pagina });
        const arr = Array.isArray(registros) ? registros : [];
        if (!arr.length) break;

        for (const r of arr) {
            const valor = parseValorBR(r.valorPago);
            total += valor;
            const nome = extrairNomeAutor(r.nomeAutor);
            const partido = mapaPartidoPorNome[nome] || 'Sem partido identificado';
            porPartido[partido] = (porPartido[partido] || 0) + valor;
        }
        if (arr.length < 15) break; // última página (Portal usa ~15/página)
    }

    const resultado = { porPartido, total, semPartido };
    await cache.gravar(chave, resultado, 24 * 3600);
    return resultado;
}

/* ---- Contratos do Executivo (órgãos superiores) por ano/mês ---- */
async function agregarContratosExecutivo(ano, mes) {
    const chave = `poderes:contratos:${ano}:${mes || 0}`;
    const cached = await cache.obter(chave);
    if (cached) return cached;

    let total = 0;
    let contratos = 0;
    let paginasConsumidas = 0;
    for (const orgao of ORGAOS_PRINCIPAIS) {
        if (paginasConsumidas >= ORCAMENTO_PAGINAS_CONTRATOS) break;
        let pagina = 1;
        for (; pagina <= LIMITE_PAGINAS_CONTRATOS; pagina++) {
            if (paginasConsumidas >= ORCAMENTO_PAGINAS_CONTRATOS) break;
            paginasConsumidas += 1;
            const registros = await requisitarPortal('contratos', {
                codigoOrgao: orgao.codigo, ano, pagina, paginaTamanho: TAMANHO_PAGINA_CONTRATOS,
            });
            const arr = Array.isArray(registros) ? registros : [];
            if (!arr.length) break;

            for (const c of arr) {
                const data = normalizarDataISO(c.dataAssinatura);
                if (mes && Number(data.slice(5, 7)) !== Number(mes)) continue;
                total += Number(c.valorFinalCompra) || 0;
                contratos += 1;
            }
            if (arr.length < TAMANHO_PAGINA_CONTRATOS) break;
        }
    }

    const resultado = { total: Math.round(total * 100) / 100, contratos };
    await cache.gravar(chave, resultado, 24 * 3600);
    return resultado;
}

/**
 * Dashboard "Partidos e Poderes".
 * @param {number} ano
 * @param {number|null} mes  mês 1-12 ou null/0 para o ano todo
 */
async function listarPoderes(ano, mes) {
    if (MOCK) {
        return mock.listarPoderes(ano, mes);
    }

    const chave = `poderes:resumo:${ano}:${mes || 0}`;
    const cached = await cache.obter(chave);
    if (cached) return cached;

    // Guarda de concorrência: enquanto um cálculo roda, as demais chamadas aguardam o mesmo resultado.
    if (computando) {
        try { return await computando; } catch (e) { /* segue e tenta de novo */ }
    }

    computando = (async () => {
        // ---- Composição por partido + mapas de partido (nome/código) ----
        const deputados = await obterTodosDeputados();
        const senadores = (await listarSenadores({})).dados || [];

        const porPartido = {};
        const mapaPartidoPorNome = {};
        const mapaPartidoPorCodigoSenador = {};

        for (const d of deputados) {
            const partido = d.partido || '—';
            if (!porPartido[partido]) porPartido[partido] = { partido, deputados: 0, senadores: 0, gastoCota: 0, gastoCeaps: 0, emendasPago: 0 };
            porPartido[partido].deputados += 1;
            mapaPartidoPorNome[normalizarNome(d.nome)] = partido;
        }
        for (const s of senadores) {
            const partido = s.partido || '—';
            if (!porPartido[partido]) porPartido[partido] = { partido, deputados: 0, senadores: 0, gastoCota: 0, gastoCeaps: 0, emendasPago: 0 };
            porPartido[partido].senadores += 1;
            mapaPartidoPorNome[normalizarNome(s.nome)] = partido;
            mapaPartidoPorCodigoSenador[String(s.id)] = partido;
        }

        // ---- Gasto por partido: cota (Câmara) ----
        const registrosCota = await obterRegistrosCota(ano);
        let totalCota = 0;
        for (const r of registrosCota) {
            const partido = r.siglaPartido;
            if (!partido || r.siglaUF === 'NA') continue;
            if (mes && Number(r.mes) !== Number(mes)) continue;
            const valor = Number(r.valorLiquido ?? r.valorDocumento) || 0;
            totalCota += valor;
            if (!porPartido[partido]) porPartido[partido] = { partido, deputados: 0, senadores: 0, gastoCota: 0, gastoCeaps: 0, emendasPago: 0 };
            porPartido[partido].gastoCota += valor;
        }

        // ---- Gasto por partido: CEAPS (Senado) ----
        const registrosCeaps = await obterRegistrosCeaps(ano);
        let totalCeaps = 0;
        for (const r of registrosCeaps) {
            if (mes && Number(r.mes) !== Number(mes)) continue;
            const valor = Number(r.valorReembolsado) || 0;
            totalCeaps += valor;
            const partido = mapaPartidoPorCodigoSenador[String(r.codSenador)] || '—';
            if (!porPartido[partido]) porPartido[partido] = { partido, deputados: 0, senadores: 0, gastoCota: 0, gastoCeaps: 0, emendasPago: 0 };
            porPartido[partido].gastoCeaps += valor;
        }

        // ---- Emendas (execução/valor pago por partido; só ano) ----
        let emendasResumo = null;
        try {
            if (!mes) {
                emendasResumo = await agregarEmendasPorPartido(ano, mapaPartidoPorNome);
                for (const [partido, valor] of Object.entries(emendasResumo.porPartido)) {
                    if (!porPartido[partido]) porPartido[partido] = { partido, deputados: 0, senadores: 0, gastoCota: 0, gastoCeaps: 0, emendasPago: 0 };
                    porPartido[partido].emendasPago += valor;
                }
            }
        } catch (e) {
            console.warn('[poderes] emendas indisponíveis:', e.message);
        }

        // ---- Executivo (contratos) ----
        let executivo = { total: 0, contratos: 0 };
        try {
            executivo = await agregarContratosExecutivo(ano, mes);
        } catch (e) {
            console.warn('[poderes] contratos do Executivo indisponíveis:', e.message);
        }

        const porPoder = [
            { poder: 'Câmara (cota parlamentar)', total: Math.round(totalCota * 100) / 100 },
            { poder: 'Senado (CEAPS)', total: Math.round(totalCeaps * 100) / 100 },
            { poder: 'Executivo (contratos)', total: executivo.total, contratos: executivo.contratos },
        ];

        const listaPartidos = Object.values(porPartido)
            .map((p) => ({
                ...p,
                gastoCota: Math.round(p.gastoCota * 100) / 100,
                gastoCeaps: Math.round(p.gastoCeaps * 100) / 100,
                emendasPago: Math.round(p.emendasPago * 100) / 100,
                totalPoliticos: p.deputados + p.senadores,
                gastoTotal: Math.round((p.gastoCota + p.gastoCeaps) * 100) / 100,
            }))
            .sort((a, b) => b.gastoTotal - a.gastoTotal || b.totalPoliticos - a.totalPoliticos);

        const aviso = mes
            ? 'Emendas mostram a execução (valor pago) por partido apenas no total do ano — a fonte não tem mês. Executivo medido por contratos assinados dos órgãos superiores.'
            : 'Emendas = execução (valor pago) por partido, conforme o Portal — o "direito" por partido não é publicado. Executivo medido por contratos assinados (despesas do Portal bloqueadas). Padrões neutros para investigação.';

        const resultado = {
            ano: Number(ano),
            mes: mes ? Number(mes) : 0,
            porPoder,
            porPartido: listaPartidos,
            emendas: emendasResumo ? { total: Math.round(emendasResumo.total * 100) / 100, semPartido: Math.round((emendasResumo.semPartido || 0) * 100) / 100 } : null,
            aviso,
        };

        await cache.gravar(chave, resultado, 24 * 3600);
        return resultado;
    })();

    try {
        return await computando;
    } finally {
        computando = null;
    }
}

module.exports = { listarPoderes };
