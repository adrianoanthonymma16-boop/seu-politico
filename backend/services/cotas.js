/* ==========================================================================
   cotas.js — Despesas da Cota Parlamentar (fonte oficial)
   --------------------------------------------------------------------------
   A API REST da Câmara não expõe a cota parlamentar por deputado; a fonte
   oficial é o arquivo anual JSON disponível em:
       https://www.camara.leg.br/cotas/Ano-{ano}.json.zip

   Estratégia:
     1. Baixa e importa o arquivo (uma vez por ano, cache de 12h).
     2. Agrupa os registros por número do deputado no arquivo de cotas
        (numeroDeputadoID) e grava em PostgreSQL (despesas_parlamentares).
     3. Mantém um índice nome → numeroDeputadoID para vincular com o id
        usado na API REST de deputados (que é diferente).
   ========================================================================== */

const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');

const { pool, habilitado } = require('../db');
const cache = require('./cache');

const BASE_COTAS = 'https://www.camara.leg.br/cotas';

/* Normaliza nome para comparação (sem acentos, caixa alta). */
function normalizarNome(nome) {
    return String(nome || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .trim();
}

/* Converte um registro do arquivo de cotas para o formato usado pelo motor. */
function normalizarDespesaCota(r) {
    return {
        ano: Number(r.ano) || null,
        mes: Number(r.mes) || null,
        tipo: r.descricao || `Cota ${r.numeroSubCota}`,
        data: String(r.dataEmissao || '').slice(0, 10),
        valor: Number(r.valorLiquido ?? r.valorDocumento) || 0,
        fornecedor: r.fornecedor || 'Não informado',
        cnpjCpf: String(r.cnpjCPF || '').replace(/[.\-\/]/g, '').trim(),
        documento: r.idDocumento || '',
        restituicao: Number(r.restituicao) || 0,
        url: r.urlDocumento || '',
    };
}

/**
 * Baixa e retorna os registros crus do arquivo oficial de cotas do ano.
 * O array inteiro (~81MB) excede o limite de 10MB do Upstash, então é
 * armazenado em chunks de ~15k registros (~4MB). Reconstrução em ~7 GETs paralelos.
 * @param {number} ano
 * @returns {Promise<Array>} registros crus do arquivo
 */
async function obterRegistrosCota(ano) {
    const chaveMeta = `cotas:reg-meta:${ano}`;
    const meta = await cache.obter(chaveMeta);
    if (meta && meta.chunks) {
        const chaves = Array.from({ length: meta.chunks }, (_, i) => `cotas:reg-c:${ano}:${i}`);
        const partes = await Promise.all(chaves.map((chave) => cache.obter(chave)));
        const partesValidas = partes.filter((p) => p);
        if (partesValidas.length === meta.chunks) {
            return partesValidas.flat();
        }
    }

    const url = `${BASE_COTAS}/Ano-${ano}.json.zip`;
    const resposta = await fetch(url, { signal: AbortSignal.timeout(240000) });
    if (!resposta.ok) {
        throw new Error(`Falha ao baixar cotas de ${ano}: HTTP ${resposta.status}`);
    }

    const zipPath = path.join(os.tmpdir(), `seupolitico-cotas-${ano}.zip`);
    fs.writeFileSync(zipPath, Buffer.from(await resposta.arrayBuffer()));
    const zip = new AdmZip(zipPath);
    const entrada = zip.getEntries().find((e) => e.entryName.toLowerCase().endsWith('.json'));
    if (!entrada) {
        fs.rmSync(zipPath, { force: true });
        throw new Error(`Arquivo de cotas de ${ano} sem JSON interno.`);
    }

    const dados = JSON.parse(entrada.getData().toString('utf8'));
    fs.rmSync(zipPath, { force: true });
    const registros = Array.isArray(dados) ? dados : dados.dados || [];

    const TAMANHO_CHUNK = 8000;
    const chunks = [];
    for (let i = 0; i < registros.length; i += 8000) {
        chunks.push(registros.slice(i, i + 8000));
    }
    await Promise.all(chunks.map((chunk, i) =>
        cache.gravar(`cotas:reg-c:${ano}:${i}`, chunk, 12 * 3600)
    ));
    await cache.gravar(chaveMeta, { chunks: chunks.length }, 12 * 3600);
    return registros;
}

/**
 * Baixa o arquivo do ano, importa em PostgreSQL e monta o índice de nomes.
 * @returns {Promise<Object>} { ano, registros, deputados }
 */
async function sincronizarAno(ano) {
    if (!habilitado) {
        throw new Error(
            'A cota parlamentar real exige PostgreSQL (DATABASE_URL configurada). ' +
            'Use USE_MOCK=true para demonstração sem banco.'
        );
    }

    const flag = await cache.obter(`cotas:sincronizado:${ano}`);
    if (flag) return flag;

    console.log(`[cotas] baixando arquivo oficial de ${ano}...`);
    const registros = await obterRegistrosCota(ano);

    const porDeputado = {};
    const indiceNomes = {};
    for (const r of registros) {
        const id = Number(r.numeroDeputadoID);
        if (!id) continue;
        const nome = normalizarNome(r.nomeParlamentar);
        if (nome && !indiceNomes[nome]) indiceNomes[nome] = id;
        if (!porDeputado[id]) porDeputado[id] = [];
        porDeputado[id].push(normalizarDespesaCota(r));
    }

    console.log(`[cotas] ${registros.length} registros de ${Object.keys(porDeputado).length} deputados. Gravando no PostgreSQL...`);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const [id, despesas] of Object.entries(porDeputado)) {
            await client.query(
                `INSERT INTO despesas_parlamentares (deputado_id, ano, dados)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (deputado_id, ano)
                 DO UPDATE SET dados = $3, atualizado_em = now()`,
                [Number(id), Number(ano), JSON.stringify(despesas)]
            );
        }
        await client.query('COMMIT');
    } catch (erro) {
        await client.query('ROLLBACK');
        throw erro;
    } finally {
        client.release();
    }

    const resultado = { ano, registros: registros.length, deputados: Object.keys(porDeputado).length };
    await cache.gravar(`cotas:indice:${ano}`, indiceNomes, 24 * 3600);
    await cache.gravar(`cotas:sincronizado:${ano}`, resultado, 12 * 3600);
    console.log(`[cotas] ano ${ano} importado (${resultado.deputados} deputados).`);
    return resultado;
}

/**
 * Índice de despesas por id do deputado (numeroDeputadoID) para um ano.
 * Grava cada deputado em uma chave Upstash pequena (`cotas:dep:{id}:{ano}`),
 * pois o índice completo (~29MB) excede o limite de 10MB do Upstash.
 * @param {number} ano
 * @returns {Promise<Object<string, Array>>} mapa { [numeroDeputadoID]: despesas[] }
 */
async function obterIndiceDespesasPorId(ano) {
    const chaveLista = `cotas:ids:${ano}`;
    const idsCacheados = await cache.obter(chaveLista);
    if (idsCacheados) {
        const indice = {};
        await Promise.all(idsCacheados.map(async (id) => {
            const desp = await cache.obter(`cotas:dep:${id}:${ano}`);
            if (desp) indice[id] = desp;
        }));
        if (Object.keys(indice).length > 0) return indice;
    }

    const registros = await obterRegistrosCota(ano);
    const indice = {};
    const ids = [];
    for (const r of registros) {
        const id = Number(r.numeroDeputadoID);
        if (!id) continue;
        if (!indice[id]) { indice[id] = []; ids.push(id); }
        indice[id].push(normalizarDespesaCota(r));
    }

    await Promise.all(ids.map((id) =>
        cache.gravar(`cotas:dep:${id}:${ano}`, indice[id], 7 * 24 * 3600)
    ));
    await cache.gravar(chaveLista, ids, 7 * 24 * 3600);
    return indice;
}

/**
 * Despesas de cota de um deputado por id (numeroDeputadoID) — lookup único.
 * @param {number} id
 * @param {number} ano
 * @returns {Promise<Array|null>}
 */
async function obterDespesasPorIdDeputado(id, ano) {
    const chave = `cotas:dep:${id}:${ano}`;
    const cached = await cache.obter(chave);
    if (cached) return cached;
    // Não reconstrói o índice inteiro (lento, ~574 leituras). Se a chave única
    // não existe, devolve vazio e deixa o fallback por nome agir.
    return [];
}

/**
 * Busca as despesas de cota de um parlamentar (pelo nome) em um ano.
 * @param {string} nomeParlamentar nome como na API REST de deputados
 * @param {number} ano
 * @returns {Promise<Array|null>} despesas normalizadas, ou null se não achou
 */
async function obterDespesasDeCota(nomeParlamentar, ano) {
    const alvo = normalizarNome(nomeParlamentar);
    const chaveCache = `cotas:despesas:nome:${alvo}:${ano}`;

    // 1) Tenta cache (resultados filtrados por nome, TTL 24h).
    const cached = await cache.obter(chaveCache);
    if (cached) return cached;

    // 2) Tenta via PostgreSQL (apenas se configurado).
    if (habilitado) {
        let indice = await cache.obter(`cotas:indice:${ano}`);
        if (!indice) {
            try {
                await sincronizarAno(ano);
                indice = await cache.obter(`cotas:indice:${ano}`);
            } catch (e) {
                console.warn('[cotas] sincronizarAno falhou, caindo para arquivo direto:', e.message);
            }
        }
        if (indice) {
            const deputadoId = indice[alvo];
            if (deputadoId) {
                try {
                    const { rows } = await pool.query(
                        'SELECT dados FROM despesas_parlamentares WHERE deputado_id = $1 AND ano = $2',
                        [deputadoId, Number(ano)]
                    );
                    if (rows.length) {
                        const resultado = rows[0].dados;
                        await cache.gravar(chaveCache, resultado, 24 * 3600);
                        return resultado;
                    }
                } catch (e) {
                    console.warn('[cotas] query PG falhou, caindo para arquivo direto:', e.message);
                }
            }
        }
    }

    // 3) Tenta mapa nome→id (populado no precompute) → chave individual por deputado.
    //    Evita ler os ~13 chunks brutos (~78MB) do Upstash a cada request.
    const indiceNomes = await cache.obter(`cotas:indice-nomes:${ano}`);
    if (indiceNomes) {
        const idPorNome = indiceNomes[alvo];
        if (idPorNome) {
            const viaId = await obterDespesasPorIdDeputado(idPorNome, ano);
            if (Array.isArray(viaId) && viaId.length) {
                await cache.gravar(chaveCache, viaId, 24 * 3600);
                return viaId;
            }
        }
    }

    // 4) Fallback: lê o arquivo oficial direto e filtra por nome.
    try {
        const registros = await obterRegistrosCota(ano);
        let filtrados = registros.filter((r) => normalizarNome(r.nomeParlamentar) === alvo);
        if (!filtrados.length) {
            filtrados = registros.filter((r) => {
                const nomeArquivo = normalizarNome(r.nomeParlamentar);
                return nomeArquivo.includes(alvo) || alvo.includes(nomeArquivo);
            });
        }
        if (!filtrados.length) {
            await cache.gravar(chaveCache, [], 24 * 3600);
            return [];
        }
        const resultado = filtrados.map(normalizarDespesaCota);
        await cache.gravar(chaveCache, resultado, 24 * 3600);
        return resultado;
    } catch (erro) {
        console.warn('[cotas] fallback arquivo direto falhou:', erro.message);
        return null;
    }
}

module.exports = { sincronizarAno, obterDespesasDeCota, obterRegistrosCota, obterIndiceDespesasPorId, obterDespesasPorIdDeputado, normalizarNome, normalizarDespesaCota };