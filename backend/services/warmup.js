/* ==========================================================================
   warmup.js — Pré-computação automática (mantém o cache quente)
   --------------------------------------------------------------------------
   No Render free o servidor é persistente, mas as tarefas pesadas (cotas,
   CEAPS, emendas, empresas) só devem rodar uma vez ao dia. Este agendador
   roda no boot e depois a cada 24h, populando o cache do PostgreSQL — assim
   os usuários sempre recebem resposta rápida.
   Executa em segundo plano e nunca bloqueia o boot.
   ========================================================================== */

const { habilitado } = require('../db');

const MOCK = process.env.USE_MOCK === 'true';

const INTERVALO_MS = 24 * 60 * 60 * 1000; // 24h

async function aquecer() {
    const ano = new Date().getFullYear();
    console.log(`[warmup] iniciando pré-computação de ${ano}...`);

    const tarefas = [];

    try {
        const cotas = require('./cotas');
        tarefas.push(cotas.sincronizarAno(ano).catch((e) => console.warn('[warmup] cotas:', e.message)));
    } catch (e) { console.warn('[warmup] cotas indisponíveis:', e.message); }

    try {
        const senado = require('./senado');
        tarefas.push(senado.sincronizarCeaps(ano).catch((e) => console.warn('[warmup] CEAPS:', e.message)));
    } catch (e) { console.warn('[warmup] CEAPS indisponíveis:', e.message); }

    try {
        const { listarPoderes } = require('./poderes');
        tarefas.push(listarPoderes(ano, 0).catch((e) => console.warn('[warmup] poderes:', e.message)));
    } catch (e) { console.warn('[warmup] poderes indisponíveis:', e.message); }

    try {
        const { listarEmpresasRecorrentes } = require('./empresas');
        tarefas.push(listarEmpresasRecorrentes(ano).catch((e) => console.warn('[warmup] empresas:', e.message)));
    } catch (e) { console.warn('[warmup] empresas indisponíveis:', e.message); }

    await Promise.all(tarefas);
    console.log('[warmup] pré-computação concluída.');
}

function iniciarWarmup() {
    if (MOCK || !habilitado) {
        console.log('[warmup] desativado (modo mock ou sem DATABASE_URL).');
        return;
    }

    // Roda no boot, em segundo plano (não bloqueia o servidor).
    setTimeout(() => { aquecer().catch((e) => console.warn('[warmup] erro:', e.message)); }, 5000);

    // E repete a cada 24h.
    setInterval(() => { aquecer().catch((e) => console.warn('[warmup] erro:', e.message)); }, INTERVALO_MS);

    console.log(`[warmup] agendado a cada ${INTERVALO_MS / (60 * 60 * 1000)}h.`);
}

module.exports = { iniciarWarmup, aquecer };
