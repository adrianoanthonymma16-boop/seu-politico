/* ==========================================================================
   routes/senado.js — Endpoints do Senado Federal (dados oficiais)
   --------------------------------------------------------------------------
     GET /senado/senadores?nome=&partido=&uf=
     GET /senado/senador/:id
     GET /senado/ceaps/sincronizar?ano=
     GET /senado/despesas/:id?ano=&pagina=
     GET /senado/analise/:id?ano=          (motor de suspeita)
   ========================================================================== */

const express = require('express');
const { listarSenadores, obterSenador, sincronizarCeaps, obterDespesasCeaps, mockDespesasSenador } = require('../services/senado');
const { calcularResumo, gerarSinais } = require('../services/motorAlerta');
const cache = require('../services/cache');

const rota = express.Router();
const MOCK = process.env.USE_MOCK === 'true';
const ANO_PADRAO = () => new Date().getFullYear();

/* ---- Média de referência por UF (senadores) ---- */
async function calcularMediaUf(uf, ano) {
    if (!uf) return null;
    const chave = `senado:analise:media:${uf}:${ano}`;
    const cached = await cache.obter(chave);
    if (cached) return cached;

    const { dados } = await listarSenadores({ uf });
    const totais = [];
    for (const sen of dados.slice(0, 8)) {
        if (MOCK) {
            totais.push(mockDespesasSenador(sen.id, ano).reduce((a, d) => a + d.valor, 0));
        } else {
            const despesas = await obterDespesasCeaps(sen.nome, ano);
            totais.push((despesas || []).reduce((a, d) => a + d.valor, 0));
        }
    }
    const media = totais.length ? totais.reduce((a, b) => a + b, 0) / totais.length : 0;
    const resultado = { uf, ano, media, totalSenadores: totais.length };
    await cache.gravar(chave, resultado, 6 * 3600);
    return resultado;
}

async function obterDespesasDoSenador(id, ano) {
    if (MOCK) return mockDespesasSenador(id, ano);

    const senador = await obterSenador(id);
    if (!senador) return [];
    const despesas = await obterDespesasCeaps(senador.nome, ano);
    return Array.isArray(despesas) ? despesas : [];
}

/** GET /api/senado/senadores?nome=&partido=&uf= */
rota.get('/senadores', async (req, res) => {
    try {
        const { nome, partido, uf } = req.query;
        res.json(await listarSenadores({ nome, partido, uf }));
    } catch (erro) {
        console.error('[senado/senadores]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/senado/senador/:id */
rota.get('/senador/:id', async (req, res) => {
    try {
        const senador = await obterSenador(req.params.id);
        if (!senador) return res.status(404).json({ erro: 'Senador não encontrado.' });
        res.json({ dados: [senador] });
    } catch (erro) {
        console.error('[senado/senador]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/senado/ceaps/sincronizar?ano= */
rota.get('/ceaps/sincronizar', async (req, res) => {
    try {
        const ano = Number(req.query.ano) || ANO_PADRAO();
        res.json(await sincronizarCeaps(ano));
    } catch (erro) {
        console.error('[senado/ceaps]', erro.message);
        res.status(erro.status || 500).json({ erro: erro.message });
    }
});

/** GET /api/senado/despesas/:id?ano=&pagina= */
rota.get('/despesas/:id', async (req, res) => {
    try {
        const ano = Number(req.query.ano) || ANO_PADRAO();
        const pagina = Number(req.query.pagina) || 1;
        const itens = Number(req.query.itens) || 100;

        const todas = await obterDespesasDoSenador(req.params.id, ano);
        const inicio = (pagina - 1) * itens;
        const dados = todas.slice(inicio, inicio + itens);
        res.json({ dados, total: todas.length, links: { pagina, ultima: Math.max(1, Math.ceil(todas.length / itens)) } });
    } catch (erro) {
        console.error('[senado/despesas]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/senado/analise/:id?ano= */
rota.get('/analise/:id', async (req, res) => {
    const ano = Number(req.query.ano) || ANO_PADRAO();
    try {
        const senador = await obterSenador(req.params.id);
        if (!senador) return res.status(404).json({ erro: 'Senador não encontrado.' });

        const despesas = await obterDespesasDoSenador(req.params.id, ano);
        const resumo = calcularResumo(despesas);

        const referencia = await calcularMediaUf(senador.uf, ano);
        const mediaUf = referencia ? referencia.media : 0;

        const sinais = gerarSinais(despesas, resumo, {
            nomePolitico: senador.nome,
            mediaUf,
        });

        res.json({
            senador,
            ano,
            mediaUf,
            ...resumo,
            sinais,
            despesas,
        });
    } catch (erro) {
        console.error('[senado/analise]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

module.exports = rota;
