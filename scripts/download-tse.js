/* ==========================================================================
   download-tse.js — Baixa e processa CSVs do TSE (Candidatos 2026)
   --------------------------------------------------------------------------
   Uso:
     node scripts/download-tse.js          # Baixa e processa
     node scripts/download-tse.js --soft  # Modo tolerante a falhas
   ========================================================================== */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const { parse } = require('csv-parse/sync');
const AdmZip = require('adm-zip');

const BASE_COTAS = 'https://www.camara.leg.br/cotas';

const SOFT = process.argv.includes('--soft');

const AGUARDAR = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizarCPF(cpf) {
    return String(cpf || '').replace(/[^\d]/g, '').padStart(11, '0');
}

function normalizarNome(nome) {
    return String(nome || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .trim();
}

function normalizarPartido(partido) {
    return String(partido || '').toUpperCase().trim();
}

function normalizarUF(uf) {
    return String(uf || '').toUpperCase().trim();
}

async function obterRegistrosCota(ano) {
    const chaveMeta = `cotas:reg-meta:${ano}`;
    const meta = await cache.obter(chaveMeta);
    if (meta && meta.chunks) {
        const chaves = Array.from({ length: meta.chunks }, (_, i) => `cotas:reg-c:${ano}:${i}`);
        const partes = await Promise.all(chaves.map(chave => cache.obter(chave)));
        const partesValidas = partes.filter(p => p);
        if (partesValidas.length === meta.chunks) {
            return partesValidas.flat();
        }
    }

    const url = `${BASE_COTAS}/Ano-${ano}.json.zip`;
    const resposta = await fetch(url, { signal: AbortSignal.timeout(240000) });
    if (!resposta.ok) {
        throw new Error(`Falha ao baixar cotas de ${ano}: HTTP ${resposta.status}`);
    }

    const zipPathCotas = path.join(os.tmpdir(), `seupolitico-cotas-${ano}.zip`);
    fs.writeFileSync(zipPathCotas, Buffer.from(await resposta.arrayBuffer()));
    const zip = new AdmZip(zipPathCotas);
    const entrada = zip.getEntries().find((e) => e.entryName.toLowerCase().endsWith('.json'));
    if (!entrada) {
        fs.rmSync(zipPathCotas, { force: true });
        throw new Error(`Arquivo de cotas de ${ano} sem JSON interno.`);
    }

    const dados = JSON.parse(entrada.getData().toString('utf8'));
    fs.rmSync(zipPathCotas, { force: true });
    const registros = Array.isArray(dados) ? dados : dados.dados || [];

    const TAMANHO_CHUNK = 15000;
    const chunks = [];
    for (let i = 0; i < registros.length; i += 15000) {
        chunks.push(registros.slice(i, i + 15000));
    }
    await Promise.all(chunks.map((chunk, i) =>
        cache.gravar(`cotas:reg-c:${ano}:${i}`, chunk, 12 * 3600)
    ));
    await cache.gravar(chaveMeta, { chunks: chunks.length }, 12 * 3600);
    return registros;
}

async function baixarECacheTSE() {
    const url = 'https://dadosabertos.tse.jus.br/dataset/6781e3a9-7b5f-4f3b-9c5c-2e4b5a6c7d8e/resource/8f7e6d5c-4b3a-2d1e-9f8c-7b6a5c4d3e2f/download/candidatos-2026.csv.zip';
    const zipPathCandidatosPresidenciais = '/tmp/candidatos-2026.zip';
    
    console.log('[download-tse] Baixando ZIP do TSE...');
    const resposta = await fetch(url, { signal: AbortSignal.timeout(240000) });
    if (!resposta.ok) {
        throw new Error(`Falha ao baixar cotas de ${ano}: HTTP ${resposta.status}`);
    }

    fs.writeFileSync(zipPathCandidatosPresidenciais, Buffer.from(await resposta.arrayBuffer()));
    const zip = new AdmZip(zipPathCandidatosPresidenciais);
    const entrada = zip.getEntries().find((e) => e.entryName.toLowerCase().endsWith('.csv'));
    if (!entrada) {
        fs.rmSync(zipPathCandidatosPresidenciais, { force: true });
        throw new Error('CSV não encontrado no ZIP');
    }

    const csvContent = entrada.getData().toString('utf8');
    fs.writeFileSync('/tmp/candidatos-2026.csv', csvContent);
    console.log('[download-tse] CSV extraído e salvo em /tmp/candidatos-2026.csv');
    return '/tmp/candidatos-2026.csv';
}

function filtrarPresidenciais(registros) {
    return registros.filter(r => {
        const cargo = String(r.DESCRICAO_CARGO || r.DS_CARGO || r.CODIGO_CARGO || '').toUpperCase();
        return cargo.includes('PRESIDENTE');
    });
}

function normalizarRegistro(r) {
    const alvo = normalizarNome(r.NR_CPF_CANDIDATO || r.NR_CPF_CANDIDATO);
    
    return {
        sqCandidato: String(r.SQ_CANDIDATO || '').trim(),
        cpf: normalizarCPF(r.NR_CPF_CANDIDATO || r.NR_CPF_CANDIDATO),
        nome: String(r.NM_CANDIDATO || '').trim(),
        nomeUrna: String(r.NM_URNA_CANDIDATO || '').trim(),
        partido: normalizarPartido(r.SG_PARTIDO || r.SG_PARTIDO),
        partidoNome: String(r.NM_PARTIDO || '').trim(),
        uf: normalizarUF(r.SG_UF || r.SG_UF),
        numero: String(r.NR_CANDIDATO || r.NR_CANDIDATO || '').trim(),
        sqCandidato: String(r.SQ_CANDIDATO || '').trim(),
        fichaLimpa: String(r.ST_MOTIVO_FICHA_LIMPA || '').toUpperCase() === 'S',
        situacao: String(r.CD_SITUACAO_CANDIDATURA || '').trim(),
        numero: String(r.NR_CANDIDATO || r.NR_CANDIDATO || '').trim(),
        nome: String(r.NM_CANDIDATO || '').trim(),
        nomeUrna: String(r.NM_URNA_CANDIDATO || '').trim(),
        partido: normalizarPartido(r.SG_PARTIDO || r.SG_PARTIDO),
        partidoNome: String(r.NM_PARTIDO || '').trim(),
        uf: normalizarUF(r.SG_UF || r.SG_UF),
        cpf: normalizarCPF(r.NR_CPF_CANDIDATO || r.NR_CPF_CANDIDATO),
        situacao: String(r.CD_SITUACAO_CANDIDATURA || '').trim(),
        fichaLimpa: String(r.ST_MOTIVO_FICHA_LIMPA || '').toUpperCase() === 'S',
        cargo: 'PRESIDENTE',
        fotoUrl: `https://divulgacandcontas.tse.jus.br/divulga/rest/v1/candidatura/buscar/foto/${String(r.SQ_CANDIDATO || '').trim()}`,
        links: {
            divulgacandcontas: `https://divulgacandcontas.tse.jus.br/divulga/#/candidato/${String(r.SQ_CANDIDATO || '').trim()}`,
            datajud: `https://datajud.cnj.jus.br/consulta?cpf=${normalizarCPF(r.NR_CPF_CANDIDATO || r.NR_CPF_CANDIDATO)}&nome=${encodeURIComponent(String(r.NM_CANDIDATO || '').trim())}`,
            pf: 'https://servicos.pf.gov.br/epol-sinic-publico/'
        }
    );
}

async function processarTSE() {
    console.log('[download-tse] Iniciando download e processamento TSE 2026...');
    
    const csvPath = await baixarECacheTSE();
    console.log('[download-tse] Lendo e parseando CSV...');
    
    const csvContent = fs.readFileSync('/tmp/candidatos-2026.csv', 'utf8');
    const registros = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        delimiter: ';',
        encoding: 'latin1'
    });
    
    console.log(`[download-tse] Total de registros no CSV: ${registros.length}`);
    
    const presidenciais = filtrarPresidenciais(registros);
    console.log(`[download-tse] Candidatos presidenciais: ${presidenciais.length}`);
    
    if (presidenciais.length === 0) {
        throw new Error('Nenhum candidato presidencial encontrado no CSV');
    }
    
    const candidatos = presidenciais.map(normalizarRegistro).filter(c => c.cpf && c.cpf.length === 11);
    console.log(`[download-tse] Candidatos válidos: ${candidatos.length}`);
    
    // Ordenar por número de urna
    candidatos.sort((a, b) => Number(a.numero) - Number(b.numero));
    
    return candidatos;
}

async function salvarJSON(candidatos) {
    const saida = path.join(PUBLIC_DIR, 'candidatos-tse-2026.json');
    const dados = {
        atualizadoEm: new Date().toISOString(),
        total: candidatos.length,
        candidatos: candidatos
    };
    fs.writeFileSync(saida, JSON.stringify({ candidatos }, null, 2));
    console.log(`[download-tse] Arquivo salvo: data/candidatos-tse-2026.json (${candidatos.length} candidatos)`);
    
    // Também atualiza o candidatos.json principal (fallback)
    const principal = path.join(__dirname, '..', 'data', 'candidatos.json');
    const dadosPrincipais = {
        eleicao: {
            ano: 2026,
            dataReferencia: '4 de outubro de 2026 (1º turno)',
            periodoAtivo: new Date() >= new Date('2026-08-16') && new Date() <= new Date('2026-11-30')
        },
        resumo: 'Candidatos à Presidência da República 2026 - Dados oficiais do TSE',
        candidatos: candidatos.map(c => ({
            numero: c.numero,
            nome: c.nome,
            nomeUrna: c.nomeUrna,
            partido: c.partido,
            uf: c.uf,
            vice: null, // Não disponível no CSV principal
            coligacao: '', // Não disponível no CSV principal
            foto: c.fotoUrl || '',
            linkWikipedia: '', // Será preenchido no frontend se necessário
            cpf: c.cpf,
            sqCandidato: c.sqCandidato,
            fichaLimpa: c.fichaLimpa,
            situacao: c.situacao,
            partido: c.partido,
            uf: c.uf,
            numero: c.numero,
            nome: c.nome,
            nomeUrna: c.nomeUrna,
            links: c.links
        })
    };
    fs.writeFileSync(principal, JSON.stringify(dadosPrincipais, null, 2));
    console.log('[download-tse] Fallback principal atualizado: data/candidatos.json');
}

async function main() {
    const inicio = Date.now();
    const SOFT = process.argv.includes('--soft');
    
    try {
        console.log('=== DOWNLOAD TSE 2026 ===');
        const candidatos = await processarTSE();
        
        await salvarJSON(candidatos);
        
        console.log(`=== CONCLUÍDO em ${((Date.now() - Date.now()) / 1000).toFixed(1)}s ===`);
    } catch (e) {
        console.error('[download-tse] ERRO:', e.message);
        console.error(e.stack);
        if (!process.argv.includes('--soft')) process.exitCode = 1;
    }
}

main();