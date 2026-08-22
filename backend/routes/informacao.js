/* ==========================================================================
   routes/informacao.js — Presidente e Candidatos à Presidência
   --------------------------------------------------------------------------
     GET /informacao/presidente   → perfil informativo do Presidente
     GET /informacao/candidatos   → candidatos à presidência (período eleitoral)
   ========================================================================== */

const express = require('express');
const { obterPresidente, obterCandidatos, obterGastosPresidente, obterContratosPresidencia } = require('../services/informacao');

const rota = express.Router();

/** GET /api/informacao/presidente */
rota.get('/presidente', async (req, res) => {
    try {
        res.json(await obterPresidente());
    } catch (erro) {
        console.error('[informacao/presidente]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/informacao/presidente/gastos?ano= */
rota.get('/presidente/gastos', async (req, res) => {
    try {
        const ano = Number(req.query.ano) || new Date().getFullYear();
        res.json(await obterGastosPresidente(ano));
    } catch (erro) {
        console.error('[informacao/presidente/gastos]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/informacao/presidente/contratos?ano= */
rota.get('/presidente/contratos', async (req, res) => {
    try {
        const ano = Number(req.query.ano) || new Date().getFullYear();
        res.json(await obterContratosPresidencia(ano));
    } catch (erro) {
        console.error('[informacao/presidente/contratos]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/informacao/candidatos */
rota.get('/candidatos', async (req, res) => {
    try {
        res.json(await obterCandidatos());
    } catch (erro) {
        console.error('[informacao/candidatos]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

module.exports = rota;
