/* ==========================================================================
   rodarSchema.js — Aplica scripts/schema.sql no PostgreSQL
   --------------------------------------------------------------------------
   Uso: npm run schema   (exige DATABASE_URL no .env)
   ========================================================================== */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) {
        console.error('DATABASE_URL não configurada. Copie .env.example para .env e ajuste.');
        process.exit(1);
    }

    const pool = new Pool({ connectionString: url });
    const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'schema.sql'), 'utf8');

    try {
        await pool.query(sql);
        console.log('[schema] aplicado com sucesso.');
    } catch (erro) {
        console.error('[schema] erro ao aplicar:', erro.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();
