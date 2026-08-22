/* ==========================================================================
   cache.js — Cache de respostas da API
   --------------------------------------------------------------------------
   Estratégia:
     1. Tenta o PostgreSQL (tabela api_cache), quando habilitado.
     2. Sem banco, usa um Map em memória.
   O cache evita estourar o limite de requisições/minuto das APIs.
   ========================================================================== */

const { pool, habilitado } = require('../db');

/* ---- Cache em memória (fallback) ---- */
const memoria = new Map();

/* Prefixa a chave com o modo (mock/real) para não misturar dados. */
const PREFIXO_MODO = () => (process.env.USE_MOCK === 'true' ? 'm:' : 'r:');

const ENCURTAR = (chave) => chave.length > 200 ? `${chave.slice(0, 200)}:${chave.length}` : chave;

const CHAVE_FINAL = (chave) => ENCURTAR(PREFIXO_MODO() + chave);

async function obter(chave) {
    chave = CHAVE_FINAL(chave);

    if (habilitado) {
        try {
            const { rows } = await pool.query(
                `SELECT payload FROM api_cache
                 WHERE chave = $1 AND expira_em > now()`,
                [chave]
            );
            if (rows.length) {
                console.log(`[cache] HIT  ${chave}`);
                return rows[0].payload;
            }
        } catch (erro) {
            console.error('[cache] erro ao ler do PostgreSQL:', erro.message);
        }
        return null;
    }

    const item = memoria.get(chave);
    if (item && item.expira > Date.now()) {
        console.log(`[cache] HIT  ${chave}`);
        return item.payload;
    }
    return null;
}

async function gravar(chave, payload, ttlSegundos = 3600) {
    chave = CHAVE_FINAL(chave);

    if (habilitado) {
        try {
            await pool.query(
                `INSERT INTO api_cache (chave, payload, expira_em)
                 VALUES ($1, $2, now() + make_interval(secs => $3))
                 ON CONFLICT (chave)
                 DO UPDATE SET payload = $2, expira_em = now() + make_interval(secs => $3)`,
                [chave, JSON.stringify(payload), ttlSegundos]
            );
            console.log(`[cache] SET  ${chave} (ttl ${ttlSegundos}s)`);
        } catch (erro) {
            console.error('[cache] erro ao gravar no PostgreSQL:', erro.message);
        }
        return;
    }

    memoria.set(chave, { payload, expira: Date.now() + ttlSegundos * 1000 });
    console.log(`[cache] SET  ${chave} (memória, ttl ${ttlSegundos}s)`);
}

module.exports = { obter, gravar };
