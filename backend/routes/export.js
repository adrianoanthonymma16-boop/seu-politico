/* ==========================================================================
   routes/export.js — Exportação de dados em CSV (servidor)
   --------------------------------------------------------------------------
   Endpoints:
     GET /api/export/empresas.csv?ano=        → empresas que recebem de 2+ parlamentares
     GET /api/export/despesas.csv?ano=&uf=    → despesas da cota da Câmara do ano (por UF)
   Útil para jornalistas e pesquisadores cruzarem os dados fora do site.
   ========================================================================== */

const express = require('express');
const { listarEmpresasRecorrentes } = require('../services/empresas');
const { obterRegistrosCota } = require('../services/cotas');

const rota = express.Router();

function escaparCSV(valor) {
    const texto = String(valor ?? '');
    return /[";\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

function toCSV(colunas, linhas) {
    const cabecalho = colunas.map(escaparCSV).join(';');
    const corpo = linhas.map((linha) => linha.map(escaparCSV).join(';')).join('\n');
    return `\ufeff${cabecalho}\n${corpo}`;
}

function enviarCSV(res, nomeArquivo, csv) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
    res.send(csv);
}

/** GET /api/export/empresas.csv?ano= */
rota.get('/empresas.csv', async (req, res) => {
    try {
        const ano = Number(req.query.ano) || new Date().getFullYear();
        const dados = await listarEmpresasRecorrentes(ano);

        const linhas = (dados.empresas || []).map((e) => [
            e.fornecedor,
            e.cnpjCpf,
            e.total,
            e.numParlamentares,
            e.numDespesas,
            (e.parlamentares || [])
                .map((p) => `${p.cargo}: ${p.nome} (${p.partido}-${p.uf}) R$ ${p.total}`)
                .join(' | '),
        ]);

        enviarCSV(res, `empresas-${ano}.csv`, toCSV(
            ['Fornecedor', 'CNPJ/CPF', 'Total recebido (R$)', 'Nº parlamentares', 'Nº despesas', 'Parlamentares'],
            linhas
        ));
    } catch (erro) {
        console.error('[export/empresas]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/export/despesas.csv?ano=&uf= */
rota.get('/despesas.csv', async (req, res) => {
    try {
        const ano = Number(req.query.ano) || new Date().getFullYear();
        const uf = String(req.query.uf || '').toUpperCase().trim();
        if (!uf) {
            return res.status(400).json({ erro: 'Informe a UF (ex.: ?ano=2025&uf=SP).' });
        }

        const registros = await obterRegistrosCota(ano);
        const linhas = [];
        for (const r of registros) {
            if (String(r.siglaUF || '').toUpperCase() !== uf) continue;
            linhas.push([
                r.nomeParlamentar || '',
                r.siglaPartido || '',
                r.siglaUF || '',
                String(r.dataEmissao || '').slice(0, 10),
                r.mes || '',
                r.descricao || '',
                r.fornecedor || '',
                r.cnpjCPF || '',
                Number(r.valorLiquido ?? r.valorDocumento) || 0,
                r.urlDocumento || '',
                r.idDocumento || '',
            ]);
        }

        enviarCSV(res, `despesas-cota-${ano}-${uf}.csv`, toCSV(
            ['Deputado', 'Partido', 'UF', 'Data', 'Mês', 'Tipo', 'Fornecedor', 'CNPJ/CPF', 'Valor (R$)', 'Comprovante', 'Documento'],
            linhas
        ));
    } catch (erro) {
        console.error('[export/despesas]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

module.exports = rota;
