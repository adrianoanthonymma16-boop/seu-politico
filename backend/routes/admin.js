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

function autorizado(req) {
    if (req.headers['x-vercel-cron']) return true;
    if (ADMIN_SECRET && req.query.secret === ADMIN_SECRET) return true;
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
        const duracao = Date.now() - inicio;
        console.log(`[admin/warmup] ${caminho} → HTTP ${resp.status} em ${duracao}ms`);
        return { caminho, status: resp.status, ok: resp.ok, duracao };
    } catch (e) {
        const duracao = Date.now() - inicio;
        console.warn(`[admin/warmup] ${caminho} → falhou em ${duracao}ms: ${e.message}`);
        return { caminho, status: 0, ok: false, duracao, erro: e.message };
    } finally {
        clearTimeout(timer);
    }
}

/* Core: analise/geral, deputados (todas as páginas), partidos, senadores. */
rota.get('/warmup/core', async (req, res) => {
    if (!autorizado(req)) return res.status(403).json({ erro: 'Não autorizado.' });
    const ano = Number(req.query.ano) || new Date().getFullYear();

    const resultados = [];
    resultados.push(await aquecerEndpoint(`/api/analise/geral?ano=${ano}`));
    resultados.push(await aquecerEndpoint(`/api/camara/partidos`));
    resultados.push(await aquecerEndpoint(`/api/senado/senadores`));

    for (let p = 2; p <= 6; p++) {
        resultados.push(await aquecerEndpoint(`/api/camara/deputados?pagina=${p}`));
    }

    resultados.push(await aquecerEndpoint(`/api/analise/deputado/204379?ano=${ano}`, { segundos: 90 }));

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

/* Debug: testa a busca por nome no arquivo de cota. */
rota.get('/debug/cota/:nome', async (req, res) => {
    if (!autorizado(req)) return res.status(403).json({ erro: 'Não autorizado.' });
    const nome = decodeURIComponent(req.params.nome);
    const ano = Number(req.query.ano) || new Date().getFullYear();
    try {
        const { obterDespesasDeCota } = require('../services/cotas');
        const inicio = Date.now();
        const despesas = await obterDespesasDeCota(nome, ano);
        res.json({ ok: true, nome, ano, qtd: despesas.length, duracao: Date.now() - inicio });
    } catch (e) {
        res.status(500).json({ ok: false, erro: e.message });
    }
});

/* Debug: testa a leitura do arquivo de cota completo. */
rota.get('/debug/cota-registros', async (req, res) => {
    if (!autorizado(req)) return res.status(403).json({ erro: 'Não autorizado.' });
    const ano = Number(req.query.ano) || new Date().getFullYear();
    try {
        const { obterRegistrosCota } = require('../services/cotas');
        const inicio = Date.now();
        const registros = await obterRegistrosCota(ano);
        const helios = registros.filter((r) => String(r.nomeParlamentar || '').toUpperCase().includes('HELIO')).length;
        res.json({ ok: true, ano, total: registros.length, helios, duracao: Date.now() - inicio });
    } catch (e) {
        res.status(500).json({ ok: false, erro: e.message });
    }
});

module.exports = rota;