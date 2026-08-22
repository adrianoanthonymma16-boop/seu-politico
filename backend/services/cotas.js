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
    const url = `${BASE_COTAS}/Ano-${ano}.json.zip`;
    const resposta = await fetch(url, { signal: AbortSignal.timeout(240000) });
    if (!resposta.ok) {
        throw new Error(`Falha ao baixar cotas de ${ano}: HTTP ${resposta.status}`);
    }

    const zipPath = path.join(os.tmpdir(), `seupolitico-cotas-${ano}.zip`);
    fs.writeFileSync(zipPath, Buffer.from(await resposta.arrayBuffer()));

    console.log(`[cotas] arquivo baixado (${(fs.statSync(zipPath).size / 1048576).toFixed(1)} MB). Extraindo...`);
    const zip = new AdmZip(zipPath);
    const entrada = zip.getEntries().find((e) => e.entryName.toLowerCase().endsWith('.json'));
    if (!entrada) {
        fs.rmSync(zipPath, { force: true });
        throw new Error(`Arquivo de cotas de ${ano} sem JSON interno.`);
    }

    const dados = JSON.parse(entrada.getData().toString('utf8'));
    const registros = Array.isArray(dados) ? dados : dados.dados || [];

    // Agrupa por numeroDeputadoID e constrói índice de nomes.
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
        fs.rmSync(zipPath, { force: true });
    }

    const resultado = { ano, registros: registros.length, deputados: Object.keys(porDeputado).length };
    await cache.gravar(`cotas:indice:${ano}`, indiceNomes, 24 * 3600);
    await cache.gravar(`cotas:sincronizado:${ano}`, resultado, 12 * 3600);
    console.log(`[cotas] ano ${ano} importado (${resultado.deputados} deputados).`);
    return resultado;
}

/**
 * Busca as despesas de cota de um parlamentar (pelo nome) em um ano.
 * @param {string} nomeParlamentar nome como na API REST de deputados
 * @param {number} ano
 * @returns {Promise<Array|null>} despesas normalizadas, ou null se não achou
 */
async function obterDespesasDeCota(nomeParlamentar, ano) {
    if (!habilitado) return null;

    let indice = await cache.obter(`cotas:indice:${ano}`);
    if (!indice) {
        await sincronizarAno(ano);
        indice = await cache.obter(`cotas:indice:${ano}`);
    }
    if (!indice) return null;

    const deputadoId = indice[normalizarNome(nomeParlamentar)];
    if (!deputadoId) return null;

    const { rows } = await pool.query(
        'SELECT dados FROM despesas_parlamentares WHERE deputado_id = $1 AND ano = $2',
        [deputadoId, Number(ano)]
    );
    return rows.length ? rows[0].dados : [];
}

module.exports = { sincronizarAno, obterDespesasDeCota, normalizarNome };
