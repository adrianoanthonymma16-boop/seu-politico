/* ==========================================================================
   cache.js — Cache de respostas da API
   --------------------------------------------------------------------------
   Estratégia (ordem de prioridade):
     1. PostgreSQL (tabela api_cache), quando habilitado (DATABASE_URL).
     2. Upstash Redis (REST API) — persistente entre lambdas, grátis no tier free.
     3. Map em memória — fallback local (morre na reciclagem da lambda).
   O cache evita estourar o limite de requisições/minuto das APIs.
   ========================================================================== */

const { pool, habilitado } = require('../db');

/* ---- Upstash Redis (opcional) ---- */
let redis = null;
try {
    const { Redis } = require('@upstash/redis');
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (url && token) {
        redis = new Redis({ url, token });
        console.log('[cache] Upstash Redis conectado.');
    }
} catch (e) {
    console.warn('[cache] @upstash/redis não disponível:', e.message);
}

/* ---- Cache em memória (fallback final) ---- */
const memoria = new Map();

/* Prefixa a chave com o modo (mock/real) para não misturar dados. */
const PREFIXO_MODO = () => (process.env.USE_MOCK === 'true' ? 'm:' : 'r:');

const ENCURTAR = (chave) => chave.length > 200 ? `${chave.slice(0, 200)}:${chave.length}` : chave;

const CHAVE_FINAL = (chave) => ENCURTAR(PREFIXO_MODO() + chave);

async function obter(chave) {
    chave = CHAVE_FINAL(chave);

    /* 1) PostgreSQL */
    if (habilitado) {
        try {
            const { rows } = await pool.query(
                `SELECT payload FROM api_cache
                 WHERE chave = $1 AND expira_em > now()`,
                [chave]
            );
            if (rows.length) {
                console.log(`[cache] HIT  ${chave} (postgres)`);
                return rows[0].payload;
            }
        } catch (erro) {
            console.error('[cache] erro ao ler do PostgreSQL:', erro.message);
        }
        return null;
    }

    /* 2) Upstash Redis */
    if (redis) {
        try {
            const valor = await redis.get(chave);
            if (valor !== null) {
                console.log(`[cache] HIT  ${chave} (upstash)`);
                return valor;
            }
        } catch (erro) {
            console.error('[cache] erro ao ler do Upstash:', erro.message);
        }
    }

    /* 3) Memória */
    const item = memoria.get(chave);
    if (item && item.expira > Date.now()) {
        console.log(`[cache] HIT  ${chave} (memória)`);
        return item.payload;
    }
    return null;
}

async function gravar(chave, payload, ttlSegundos = 3600) {
    chave = CHAVE_FINAL(chave);

    /* 1) PostgreSQL */
    if (habilitado) {
        try {
            await pool.query(
                `INSERT INTO api_cache (chave, payload, expira_em)
                 VALUES ($1, $2, now() + make_interval(secs => $3))
                 ON CONFLICT (chave)
                 DO UPDATE SET payload = $2, expira_em = now() + make_interval(secs => $3)`,
                [chave, JSON.stringify(payload), ttlSegundos]
            );
            console.log(`[cache] SET  ${chave} (postgres, ttl ${ttlSegundos}s)`);
        } catch (erro) {
            console.error('[cache] erro ao gravar no PostgreSQL:', erro.message);
        }
        return;
    }

    /* 2) Upstash Redis — limite de 10MB por request; ignora payloads grandes
          (array de cotas ~81MB) caindo para memória, sem poluir o log. */
    if (redis) {
        try {
            const bytes = Buffer.byteLength(JSON.stringify(payload));
            if (bytes > 8 * 1024 * 1024) {
                console.log(`[cache] SKIP ${chave} (upstash, payload ${(bytes / 1048576).toFixed(1)}MB > 8MB)`);
            } else {
                await redis.set(chave, payload, { ex: ttlSegundos });
                console.log(`[cache] SET  ${chave} (upstash, ttl ${ttlSegundos}s)`);
                return;
            }
        } catch (erro) {
            console.error('[cache] erro ao gravar no Upstash:', String(erro.message || erro).slice(0, 200));
        }
    }

    /* 3) Memória */
    memoria.set(chave, { payload, expira: Date.now() + ttlSegundos * 1000 });
    console.log(`[cache] SET  ${chave} (memória, ttl ${ttlSegundos}s)`);
}

module.exports = { obter, gravar };