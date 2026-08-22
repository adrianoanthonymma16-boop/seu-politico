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

/* ---- Requisição base com retry em 429 ---- */
async function requisitar(url, headers, limitador, tentativas = 2) {
    for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
        try {
            const resposta = await limitador.agendar(() =>
                fetch(url, { headers, signal: AbortSignal.timeout(30000) })
            );

            if (resposta.status === 429 && tentativa < tentativas) {
                const aguardar = Number(resposta.headers.get('retry-after')) || 5;
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
    return requisitar(url.toString(), { 'chave-api-dados': chave }, limitadorPortal);
}

/* ---- Câmara dos Deputados (sem chave) ---- */
function requisitarCamara(caminho, params = {}) {
    const url = new URL(`${CAMARA_BASE}/${caminho}`);
    Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    });
    console.log(`[proxy] Câmara GET ${url.pathname}${url.search}`);
    return requisitar(url.toString(), { Accept: 'application/json' }, limitadorCamara);
}

/* ---- Senado (API adm-dadosabertos, sem chave) ---- */
function requisitarSenadoAdm(caminho, params = {}) {
    const url = new URL(`${SENADO_ADM_BASE}/${caminho}`);
    Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    });
    if (!url.searchParams.has('formato')) url.searchParams.set('formato', 'json');
    console.log(`[proxy] Senado(adm) GET ${url.pathname}${url.search}`);
    return requisitar(url.toString(), { Accept: 'application/json' }, limitadorCamara);
}

/* ---- Senado (API legis dados abertos, sem chave) ---- */
function requisitarSenadoLegis(caminho, params = {}) {
    const url = new URL(`${SENADO_LEGIS_BASE}/${caminho}`);
    Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    });
    console.log(`[proxy] Senado(legis) GET ${url.pathname}${url.search}`);
    return requisitar(url.toString(), { Accept: 'application/json' }, limitadorCamara);
}

module.exports = { requisitarPortal, requisitarCamara, requisitarSenadoAdm, requisitarSenadoLegis, PORTAL_BASE, CAMARA_BASE };
