/* ==========================================================================
   precompute.js — Script de pré-computação diária para JSONs estáticos
   --------------------------------------------------------------------------
   Executa via Vercel Cron (diário 03:00 UTC) ou manualmente (npm run precompute).
   Gera arquivos em /data/ (na raiz do projeto) servidos pelo CDN da Vercel instantaneamente.
   ATENÇÃO: não usar pasta public/ — a Vercel a trata como raiz web e deixa de servir os .html da raiz.
   - deputados.json: lista completa de 600 deputados (nome, id, partido, uf, foto)
   - analise-geral-2026.json: agregados para home/dashboard
   ========================================================================== */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const fetch = globalThis.fetch;

const CAMARA_BASE = 'https://dadosabertos.camara.leg.br/api/v2';
const ITENS = 100;
const ANO_PADRAO = 2026;
const PUBLIC_DIR = path.join(__dirname, '..', 'data');

const AGUARDAR = (ms) => new Promise((r) => setTimeout(r, ms));

/* Modo soft: usado no build da Vercel — não falha o deploy se a Câmara estiver fora. */
const SOFT = process.argv.includes('--soft');

/* Rate limiter simples para respeitar 120 RPM da Câmara. */
const INTERVALO = 60000 / 120; // 500ms
let ultimaChamada = 0;

async function requisitarCamara(caminho, params = {}) {
    const agora = Date.now();
    const espera = Math.max(0, ultimaChamada + INTERVALO - agora);
    if (espera > 0) await AGUARDAR(espera);
    ultimaChamada = Date.now();

    const url = new URL(`${CAMARA_BASE}/${caminho}`);
    Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    });

    const resp = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(60000),
    });
    if (!resp.ok) throw new Error(`Câmara HTTP ${resp.status}: ${url}`);
    return resp.json();
}

function normalizarDeputado(item) {
    const status = item.ultimoStatus || item;
    return {
        id: item.id,
        nome: status.nome || item.nomeCivil || item.nome || 'Sem nome',
        nomeCivil: item.nomeCivil || item.nome || status.nome || 'Sem nome',
        partido: status.siglaPartido || item.siglaPartido || item.partido || '—',
        uf: status.siglaUf || item.siglaUf || item.uf || '—',
        urlFoto: status.urlFoto || item.urlFoto || '',
        email: item.email || status.email || '',
        cargo: 'Deputado Federal',
    };
}

async function buscarTodosDeputados() {
    console.log('[precompute] buscando deputados página 1...');
    const primeira = await requisitarCamara('deputados', { pagina: 1, itens: ITENS });
    const dados = (primeira.dados || []).map(normalizarDeputado);
    const ultima = extrairUltimaPagina(primeira.links, 1);

    if (ultima <= 1) return dados;

    const paginas = [];
    for (let p = 2; p <= ultima; p++) paginas.push(p);

    let todos = [...dados];
    const TAMANHO_LOTE = 3;
    for (let i = 0; i < paginas.length; i += TAMANHO_LOTE) {
        const lote = paginas.slice(i, i + TAMANHO_LOTE);
        console.log(`[precompute] lote páginas ${lote[0]}-${lote[lote.length - 1]} de ${ultima}`);
        const resultados = await Promise.all(lote.map(p => requisitarCamara('deputados', { pagina: p, itens: ITENS })));
        for (const r of resultados) {
            todos.push(...(r.dados || []).map(normalizarDeputado));
        }
        await AGUARDAR(100);
    }
    return todos;
}

function extrairUltimaPagina(links, atual) {
    if (!Array.isArray(links)) return atual;
    const ultimo = links.find(l => l.rel === 'last');
    if (!ultimo || !ultimo.href) return atual;
    try {
        const url = new URL(ultimo.href);
        return Number(url.searchParams.get('pagina')) || atual;
    } catch { return atual; }
}

/* Popula o cache da cota no Upstash (chunks + índice por deputado + mapa nome→despesas normalizadas). */
async function popularCacheCota(ano) {
    console.log(`[precompute] populando cache de cota para ${ano}...`);
    const { obterRegistrosCota, normalizarNome, normalizarDespesaCota } = require('../backend/services/cotas');
    const cache = require('../backend/services/cache');
    const inicio = Date.now();

    try {
        // Força a leitura do arquivo de cota e gravação dos chunks no Upstash
        console.log(`[precompute] baixando registros de cota...`);
        let registros;
        try {
            const registros = await obterRegistrosCota(ano);
            console.log(`[precompute] cota: ${registros.length} registros lidos`);
        } catch (e) {
            console.error('[precompute] ERRO em obterRegistrosCota:', e.message);
            console.error(e.stack);
            throw e;
        }

        // Constrói o índice por deputado (por numeroDeputadoID) e grava chaves individuais no Upstash
        console.log(`[precompute] construindo índice por deputado...`);
        try {
            const { obterIndiceDespesasPorId, obterRegistrosCota: obterReg, normalizarDespesaCota } = require('../backend/services/cotas');
            // Força reconstrução completa e grava TODAS as chaves individuais (não usa cache parcial).
            const todosRegistros = await obterReg(ano);
            const indice = {};
            for (const r of todosRegistros) {
                const id = Number(r.numeroDeputadoID);
                if (!id) continue;
                if (!indice[id]) indice[id] = [];
                indice[id].push(normalizarDespesaCota(r));
            }
            const ids = Object.keys(indice);
            await Promise.all(ids.map((id) =>
                cache.gravar(`cotas:dep:${id}:${ano}`, indice[id], 7 * 24 * 3600)
            ));
            await cache.gravar(`cotas:ids:${ano}`, ids, 7 * 24 * 3600);
            console.log(`[precompute] índice cota: ${ids.length} deputados gravados em ${((Date.now() - inicio) / 1000).toFixed(1)}s`);
        } catch (e) {
            console.error('[precompute] ERRO em obterIndiceDespesasPorId:', e.message);
            console.error(e.stack);
            throw e;
        }

        // Bônus: constrói mapa nome_normalizado → numeroDeputadoID (pequeno, <8MB)
        // para o runtime fazer lookup O(1) sem ler os 13 chunks brutos (~78MB).
        console.log(`[precompute] construindo mapa nome→id...`);
        let todosRegistros;
        try {
            todosRegistros = await obterRegistrosCota(ano);
        } catch (e) {
            console.error('[precompute] ERRO ao obter registros para mapa:', e.message);
            console.error(e.stack);
            throw e;
        }
        const indiceNomes = {};
        for (const r of todosRegistros) {
            const nomeNorm = normalizarNome(r.nomeParlamentar);
            const id = Number(r.numeroDeputadoID);
            if (!nomeNorm || !id) continue;
            if (!indiceNomes[nomeNorm]) indiceNomes[nomeNorm] = id;
        }

        // Grava o mapa nome→id como uma única chave no Upstash (TTL 24h).
        try {
            await cache.gravar(`cotas:indice-nomes:${ano}`, indiceNomes, 24 * 3600);
            console.log(`[precompute] mapa nome→id: ${Object.keys(indiceNomes).length} nomes cacheados em ${((Date.now() - inicio) / 1000).toFixed(1)}s`);
        } catch (e) {
            console.error('[precompute] ERRO ao gravar mapa nome→id:', e.message);
            console.error('[precompute] Stack:', e.stack);
        }
    } catch (e) {
        console.error('[precompute] ERRO em popularCacheCota:', e.message);
        console.error('[precompute] Stack:', e.stack);
        throw e;
    }
}

async function precomputarAnaliseGeral(ano) {
    console.log(`[precompute] analise/geral ${ano}...`);
    const resp = await fetch(`https://seu-politico.vercel.app/api/analise/geral?ano=${ano}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(120000),
    });
    if (!resp.ok) throw new Error(`analise/geral HTTP ${resp.status}`);
    return resp.json();
}

async function main() {
    console.log('=== PRÉ-COMPUTAÇÃO DIÁRIA ===');
    const inicio = Date.now();

    // Garante diretório
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });

    // 1) Lista completa de deputados
    try {
        const deputados = await buscarTodosDeputados();
        const saida = path.join(PUBLIC_DIR, 'deputados.json');
        fs.writeFileSync(saida, JSON.stringify({ atualizadoEm: new Date().toISOString(), total: deputados.length, dados: deputados }));
        console.log(`[precompute] deputados.json: ${deputados.length} deputados gravados em ${saida}`);
    } catch (e) {
        console.error('[precompute] ERRO deputados:', e.message);
        if (!SOFT) process.exitCode = 1;
    }

    // 2) Popula cache de cota no Upstash (chunks + índice por deputado + mapa nome→despesas normalizadas)
    try {
        await popularCacheCota(ANO_PADRAO);
    } catch (e) {
        console.error('[precompute] ERRO cache cota:', e.message);
        if (!SOFT) process.exitCode = 1;
    }

    // 3) Análise geral para o ano atual
    try {
        const analise = await precomputarAnaliseGeral(ANO_PADRAO);
        const saida = path.join(PUBLIC_DIR, `analise-geral-${ANO_PADRAO}.json`);
        fs.writeFileSync(saida, JSON.stringify(analise));
        console.log(`[precompute] analise-geral-${ANO_PADRAO}.json gravado`);
    } catch (e) {
        console.error('[precompute] ERRO analise/geral:', e.message);
        if (!SOFT) process.exitCode = 1;
    }

    console.log(`=== CONCLUÍDO em ${((Date.now() - inicio) / 1000).toFixed(1)}s ===`);
}

main();