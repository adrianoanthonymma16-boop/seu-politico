/* ==========================================================================
   routes/admin.js — Aquecimento de cache (usado pelo Vercel Cron)
   --------------------------------------------------------------------------
   O cron da Vercel dispara estes endpoints diariamente; eles fazem fetch dos
   próprios endpoints públicos para popular o Upstash (cache persistente) e o
   cache de borda (CDN), de forma que os usuários quase nunca pagam o custo
   das APIs externas (Câmara 5s, Portal 240 chamadas, etc.).

   Proteção: aceita apenas o header "x-vercel-cron" (Vercel o injeta em crons)
   OU o query param "?secret=" com o valor de ADMIN_SECRET (para invocação manual).
   ========================================================================== */

const express = require('express');

const rota = express.Router();

const SITE = process.env.ADMIN_SITE_URL || 'https://seu-politico.vercel.app';
const ADMIN_SECRET = process.env.ADMIN_SECRET;

const AGUARDAR = (ms) => new Promise((r) => setTimeout(r, ms));

function autorizado(req) {
    if (req.headers['x-vercel-cron']) return true; // chamada legítima do cron da Vercel
    if (ADMIN_SECRET && req.query.secret === ADMIN_SECRET) return true; // manual
    return false;
}

/* Faz fetch de um endpoint próprio, aquecendo Upstash + edge cache. */
async function aquecerEndpoint(caminho, { segundos = 55 } = {}) {
    const controlador = new AbortController();
    const timer = setTimeout(() => controlador.abort(), segundos * 1000);
    const inicio = Date.now();
    try {
        const resp = await fetch(`${SITE}${caminho}`, {
            headers: { Accept: 'application/json' },
            signal: controlador.signal,
        });
        const ok = resp.ok;
        const duracao = Date.now() - inicio;
        console.log(`[admin/warmup] ${caminho} → HTTP ${resp.status} em ${duracao}ms`);
        return { caminho, status: resp.status, ok, duracao };
    } catch (e) {
        const duracao = Date.now() - inicio;
        console.warn(`[admin/warmup] ${caminho} → falhou em ${duracao}ms: ${e.message}`);
        return { caminho, status: 0, ok: false, duracao, erro: e.message };
    } finally {
        clearTimeout(timer);
    }
}

/* Core: analise/geral, deputados (todas as páginas), partidos, senadores,
   e um perfil de exemplo para aquecer o índice id->despesas da cota. */
rota.get('/warmup/core', async (req, res) => {
    if (!autorizado(req)) return res.status(403).json({ erro: 'Não autorizado.' });
    const ano = Number(req.query.ano) || new Date().getFullYear();

    const resultados = [];
    resultados.push(await aquecerEndpoint(`/api/analise/geral?ano=${ano}`));
    resultados.push(await aquecerEndpoint(`/api/camara/partidos`));
    resultados.push(await aquecerEndpoint(`/api/senado/senadores`));

    // Páginas de deputados 2..6 (a página 1 já é aquecida pelo analise/geral).
    for (let p = 2; p <= 6; p++) {
        resultados.push(await aquecerEndpoint(`/api/camara/deputados?pagina=${p}`));
    }

    res.json({ ok: true, ano, resultados });
});

/* Poderes: dashboard pesado (emendas + contratos do Executivo). */
rota.get('/warmup/poderes', async (req, res) => {
    if (!autorizado(req)) return res.status(403).json({ erro: 'Não autorizado.' });
    const ano = Number(req.query.ano) || new Date().getFullYear();
    const r = await aquecerEndpoint(`/api/analise/poderes?ano=${ano}`);
    res.json({ ok: r.ok, ...r });
});

/* Presidente: gastos (até 240 chamadas ao Portal), contratos e candidatos. */
rota.get('/warmup/presidente', async (req, res) => {
    if (!autorizado(req)) return res.status(403).json({ erro: 'Não autorizado.' });
    const ano = Number(req.query.ano) || new Date().getFullYear();
    const resultados = [];
    resultados.push(await aquecerEndpoint(`/api/informacao/presidente`));
    resultados.push(await aquecerEndpoint(`/api/informacao/presidente/gastos?ano=${ano}`));
    resultados.push(await aquecerEndpoint(`/api/informacao/presidente/contratos?ano=${ano}`));
    resultados.push(await aquecerEndpoint(`/api/informacao/candidatos`));
    res.json({ ok: true, ano, resultados });
});

module.exports = rota;