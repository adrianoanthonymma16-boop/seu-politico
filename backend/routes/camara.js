/* ==========================================================================
   routes/camara.js — Endpoints da Câmara dos Deputados (proxy + cache)
   ========================================================================== */

const express = require('express');
const { buscarDeputados, obterDeputado, obterTodasDespesas, listarPartidos, normalizarDespesa } = require('../services/deputados');
const mock = require('../services/mockData');
const cotas = require('../services/cotas');

const rota = express.Router();

/** GET /api/camara/deputados?nome=&siglaPartido=&siglaUf=&pagina= */
rota.get('/deputados', async (req, res) => {
    try {
        const { nome, siglaPartido, siglaUf, pagina = 1 } = req.query;
        const resultado = await buscarDeputados({ nome, siglaPartido, siglaUf, pagina });
        res.json(resultado);
    } catch (erro) {
        console.error('[camara/deputados]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/camara/deputado/:id */
rota.get('/deputado/:id', async (req, res) => {
    try {
        const deputado = await obterDeputado(req.params.id);
        if (!deputado) return res.status(404).json({ erro: 'Parlamentar não encontrado.' });
        res.json({ dados: [deputado] });
    } catch (erro) {
        console.error('[camara/deputado]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/camara/cotas/sincronizar?ano= — baixa/importa a cota oficial */
rota.get('/cotas/sincronizar', async (req, res) => {
    try {
        const ano = Number(req.query.ano) || new Date().getFullYear();
        const resultado = await cotas.sincronizarAno(ano);
        res.json(resultado);
    } catch (erro) {
        console.error('[camara/cotas]', erro.message);
        res.status(erro.status || 500).json({ erro: erro.message });
    }
});

/** GET /api/camara/deputado/:id/despesas?ano=&mes=&pagina= */
rota.get('/deputado/:id/despesas', async (req, res) => {
    try {
        const { ano, mes, pagina = 1 } = req.query;

        const MOCK = process.env.USE_MOCK === 'true';
        const resposta = await (MOCK
            ? (() => {
                const r = mock.obterDespesas(req.params.id, { ano, mes, pagina });
                return { dados: (r.dados || []).map(normalizarDespesa), links: r.links || {} };
            })()
            : (async () => {
                const proxy = require('../services/proxy');
                const cache = require('../services/cache');
                const chave = `camara:despesas:${req.params.id}:${ano || ''}:${mes || ''}:${pagina}`;
                const cached = await cache.obter(chave);
                if (cached) return cached;

                const r = await proxy.requisitarCamara(`deputados/${req.params.id}/despesas`, {
                    ano, mes, itens: 100, pagina,
                });
                let dados = (r.dados || []).map(normalizarDespesa);

                // Fallback: arquivo oficial de cota parlamentar (fonte confiável).
                if (dados.length === 0 && ano && !mes) {
                    const deputado = await obterDeputado(req.params.id);
                    if (deputado) {
                        const viaCota = await cotas.obterDespesasDeCota(deputado.nome, Number(ano));
                        if (Array.isArray(viaCota)) dados = viaCota;
                    }
                }

                const resultado = { dados, links: r.links || {} };
                await cache.gravar(chave, resultado, 2 * 3600);
                return resultado;
            })());

        res.json(resposta);
    } catch (erro) {
        console.error('[camara/despesas]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/camara/partidos */
rota.get('/partidos', async (req, res) => {
    try {
        const dados = await listarPartidos();
        res.json({ dados });
    } catch (erro) {
        console.error('[camara/partidos]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

module.exports = rota;
