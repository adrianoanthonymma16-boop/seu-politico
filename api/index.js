/* ==========================================================================
   api/index.js — Função serverless da Vercel
   --------------------------------------------------------------------------
   Exporta o app Express do backend. Aplica o schema do banco na primeira
   chamada (idempotente) e repassa cada requisição ao Express.
   ========================================================================== */

const { app, garantirSchema } = require('../backend/server');

let schemaPronto = garantirSchema().catch((erro) => {
    console.warn('[vercel] falha ao aplicar schema:', erro.message);
});

module.exports = async (req, res) => {
    await schemaPronto;
    return app(req, res);
};
