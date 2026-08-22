/* ==========================================================================
   db.js — Conexão com PostgreSQL (pg)
   --------------------------------------------------------------------------
   Usa a variável DATABASE_URL. Se não estiver configurada, o cache cai para
   um armazenamento em memória (o site continua funcionando sem banco).
   ========================================================================== */

const { Pool } = require('pg');

const habilitado = Boolean(process.env.DATABASE_URL);

const pool = habilitado
    ? new Pool({ connectionString: process.env.DATABASE_URL, max: 5 })
    : null;

if (habilitado) {
    pool.on('error', (erro) => {
        console.error('[db] erro inesperado na conexão:', erro.message);
    });
}

module.exports = { pool, habilitado };
