/* ==========================================================================
   proxy.js — Requisições às APIs externas com rate limit
   --------------------------------------------------------------------------
   Respeita o limite de requisições por minuto de cada API:
     - Portal da Transparência: 400/min (6h–23h59) e 700/min (0h–5h59).
       Por segurança usamos PORTAL_RPM (padrão 350).
     - Câmara dos Deputados: uso consciente, CAMARA_RPM (padrão 120).
   Em resposta 429, aguarda o intervalo e tenta novamente.
   ========================================================================== */

const PORTAL_BASE = 'https://api.portaldatransparencia.gov.br/api-de-dados';
const CAMARA_BASE = 'https://dadosabertos.camara.leg.br/api/v2';
const SENADO_ADM_BASE = 'https://adm.senado.gov.br/adm-dadosabertos/api/v1';
const SENADO_LEGIS_BASE = 'https://legis.senado.leg.br/dadosabertos';
const WIKIPEDIA_API = 'https://pt.wikipedia.org/w/api.php';

const AGUARDAR = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---- Fila de agendamento (simples rate limiter) ---- */
function criarLimitador(rpm) {
    const intervaloMinimo = (60 * 1000) / Math.max(rpm, 1);
    let ultimaChamada = 0;
    let fila = Promise.resolve();

    function agendar(tarefa) {
        const resultado = fila.then(async () => {
            const agora = Date.now();
            const espera = Math.max(0, ultimaChamada + intervaloMinimo - agora);
            if (espera > 0) await AGUARDAR(espera);
            ultimaChamada = Date.now();
            return tarefa();
        });
        fila = resultado.then(() => {}, () => {});
        return resultado;
    }

    return { agendar };
}

const limitadorPortal = criarLimitador(Number(process.env.PORTAL_RPM) || 350);
const limitadorCamara = criarLimitador(Number(process.env.CAMARA_RPM) || 120);
const limitadorWikipedia = criarLimitador(Number(process.env.WIKI_RPM) || 60);

/* Contadores de uso por API (para monitorar rate limit em produção). */
const contadores = {
    portal: { requisicoes: 0, retries429: 0 },
    camara: { requisicoes: 0, retries429: 0 },
    senado: { requisicoes: 0, retries429: 0 },
    wikipedia: { requisicoes: 0, retries429: 0 },
};

/* ---- Requisição base com retry em 429 ---- */
async function requisitar(url, headers, limitador, tentativas = 2, rotulo = 'camara', timeoutMs = 30000) {
    for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
        try {
            contadores[rotulo].requisicoes += 1;
            const resposta = await limitador.agendar(() =>
                fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
            );

            if (resposta.status === 429 && tentativa < tentativas) {
                contadores[rotulo].retries429 += 1;
                const aguardar = Math.min(Number(resposta.headers.get('retry-after')) || 5, 10);
                console.warn(`[proxy] 429 recebido, aguardando ${aguardar}s antes de tentar novamente.`);
                await AGUARDAR(aguardar * 1000);
                continue;
            }

            if (!resposta.ok) {
                const corpo = await resposta.text().catch(() => '');
                const erro = new Error(`API respondeu ${resposta.status}${corpo ? ` — ${corpo.slice(0, 200)}` : ''}`);
                erro.status = resposta.status;
                throw erro;
            }

            return await resposta.json();
        } catch (erro) {
            const isNetworkError = !erro.status || erro.name === 'AbortError' || String(erro.message).includes('fetch failed');
            if (tentativa < tentativas && (erro.status === 429 || isNetworkError || (erro.status && erro.status >= 500))) {
                console.warn(`[proxy] erro ${erro.status || erro.name || 'network'}, tentando novamente (${tentativa}/${tentativas}): ${erro.message}`);
                await AGUARDAR(1000 * tentativa);
                continue;
            }
            if (erro.status && erro.status !== 429 && tentativa < tentativas) {
                console.warn(`[proxy] erro ${erro.status}, tentando novamente (${tentativa}/${tentativas}).`);
                await AGUARDAR(1000);
                continue;
            }
            throw erro;
        }
    }
    throw new Error('Falha ao consultar a API externa.');
}

/* ---- Portal da Transparência (requer chave) ---- */
function requisitarPortal(caminho, params = {}) {
    const chave = process.env.CHAVE_API_PORTAL;
    if (!chave) {
        throw Object.assign(new Error('Chave do Portal da Transparência não configurada (CHAVE_API_PORTAL).'), { status: 500 });
    }
    const url = new URL(`${PORTAL_BASE}/${caminho}`);
    Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    });
    console.log(`[proxy] Portal GET ${url.pathname}${url.search}`);
    return requisitar(url.toString(), { 'chave-api-dados': chave }, limitadorPortal, 2, 'portal');
}

/* ---- Câmara dos Deputados (sem chave) ---- */
function requisitarCamara(caminho, params = {}) {
    const url = new URL(`${CAMARA_BASE}/${caminho}`);
    Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    });
    console.log(`[proxy] Câmara GET ${url.pathname}${url.search}`);
    return requisitar(url.toString(), { Accept: 'application/json' }, limitadorCamara, 2, 'camara');
}

/* ---- Senado (API adm-dadosabertos, sem chave) ---- */
function requisitarSenadoAdm(caminho, params = {}) {
    const url = new URL(`${SENADO_ADM_BASE}/${caminho}`);
    Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    });
    if (!url.searchParams.has('formato')) url.searchParams.set('formato', 'json');
    console.log(`[proxy] Senado(adm) GET ${url.pathname}${url.search}`);
    return requisitar(url.toString(), { Accept: 'application/json' }, limitadorCamara, 2, 'senado');
}

/* ---- Senado (API legis dados abertos, sem chave) ---- */
function requisitarSenadoLegis(caminho, params = {}) {
    const url = new URL(`${SENADO_LEGIS_BASE}/${caminho}`);
    Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    });
    console.log(`[proxy] Senado(legis) GET ${url.pathname}${url.search}`);
    return requisitar(url.toString(), { Accept: 'application/json' }, limitadorCamara, 2, 'senado');
}

/* ---- Wikipedia (pt.wikipedia.org, MediaWiki API) ---- */
function requisitarWikipedia(params = {}) {
    const url = new URL(WIKIPEDIA_API);
    Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    });
    url.searchParams.set('format', 'json');
    url.searchParams.set('origin', '*');
    console.log(`[proxy] Wikipedia GET ${url.search}`);
    // 3 tentativas (o 429 aguarda retry-after antes de repetir) + timeout 20s.
    // Dados estáticos e cache 7d: após a 1ª captura, o 429 deixa de ocorrer.
    return requisitar(url.toString(), { Accept: 'application/json' }, limitadorWikipedia, 3, 'wikipedia', 20000);
}

module.exports = { requisitarPortal, requisitarCamara, requisitarSenadoAdm, requisitarSenadoLegis, requisitarWikipedia, PORTAL_BASE, CAMARA_BASE, contadores };
