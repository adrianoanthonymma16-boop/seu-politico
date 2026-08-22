/* ==========================================================================
   routes/portal.js — Endpoints do Portal da Transparência (proxy + cache)
   --------------------------------------------------------------------------
   Requer CHAVE_API_PORTAL. Todas as chamadas passam pelo proxy que:
     - injeta o header "chave-api-dados",
     - respeita o rate limit da API,
     - aplica cache para evitar estourar o limite.

   Estado atual (opção "só o que funciona"):
     ✅ /orgaos    — lista de órgãos do SIAFI
     ✅ /contratos — contratos por órgão (com link de validação no Portal)
     ⏸️ /licitacoes e /despesas — a API exige parâmetros específicos
        (dataEmissao/fase, período ≤ 1 mês) cuja especificação é protegida;
        retornam 501 com orientação até que a spec oficial esteja disponível.
   ========================================================================== */

const express = require('express');
const { requisitarPortal } = require('../services/proxy');
const cache = require('../services/cache');
const { ORGAOS_PRINCIPAIS } = require('../services/orgaosPrincipais');

const rota = express.Router();

const MOCK = process.env.USE_MOCK === 'true';

/* ---- Normalização de contrato ---- */
function normalizarContrato(c) {
    const fornecedor = typeof c.fornecedor === 'object' && c.fornecedor !== null
        ? (c.fornecedor.nome || c.fornecedor.descricao || 'Não informado')
        : (c.fornecedor || 'Não informado');

    const cnpj = (typeof c.fornecedor === 'object' && c.fornecedor !== null)
        ? (c.fornecedor.cnpjCpf || c.fornecedor.cpfCnpj || '')
        : '';

    return {
        id: c.id,
        numero: c.numero || '',
        objeto: String(c.objeto || '').replace(/^Objeto:\s*/i, ''),
        fornecedor,
        cnpjCpf: String(cnpj).replace(/[.\-\/]/g, '').trim(),
        valorInicial: Number(c.valorInicialCompra) || 0,
        valorFinal: Number(c.valorFinalCompra) || 0,
        modalidade: c.modalidadeCompra || '—',
        situacao: c.situacaoContrato || '—',
        dataAssinatura: c.dataAssinatura || '',
        vigenciaInicio: c.dataInicioVigencia || '',
        vigenciaFim: c.dataFimVigencia || '',
        unidadeGestora: c.unidadeGestora || '—',
        fundamentoLegal: String(c.fundamentoLegal || '').replace(/^Fundamento Legal:\s*/i, ''),
        numeroProcesso: c.numeroProcesso || '',
        linkPortal: `https://portaldatransparencia.gov.br/contratos/${c.id}`,
    };
}

function responderProxy(res, erro) {
    console.error('[portal]', erro.message);
    const status = erro.status || 502;
    res.status(status).json({ erro: erro.message });
}

/* GET /api/portal/orgaos?nome= */
rota.get('/orgaos', async (req, res) => {
    const { nome } = req.query;
    try {
        const normalizar = (s) => String(s || '')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

        let lista = ORGAOS_PRINCIPAIS.slice();
        if (nome) {
            const q = normalizar(nome);
            lista = lista.filter((o) => normalizar(o.descricao).includes(q));
        }
        lista.sort((a, b) => a.descricao.localeCompare(b.descricao));
        res.json({ dados: lista, total: lista.length });
    } catch (erro) {
        responderProxy(res, erro);
    }
});

/* GET /api/portal/contratos?codigoOrgao=&ano=&pagina= */
rota.get('/contratos', async (req, res) => {
    const { codigoOrgao, ano, pagina = 1, paginaTamanho = 100 } = req.query;
    if (!codigoOrgao) {
        return res.status(400).json({ erro: 'Informe o parâmetro codigoOrgao (ex.: 36000 = Ministério da Saúde).' });
    }
    const chave = `portal:contratos:${codigoOrgao}:${ano || ''}:${pagina}:${paginaTamanho}`;
    try {
        const cached = await cache.obter(chave);
        if (cached) return res.json(cached);

        const dados = await requisitarPortal('contratos', { codigoOrgao, ano, pagina, paginaTamanho });
        const normalizados = (Array.isArray(dados) ? dados : []).map(normalizarContrato);

        const resultado = { dados: normalizados, total: normalizados.length };
        await cache.gravar(chave, resultado, 6 * 3600);
        res.json(resultado);
    } catch (erro) {
        responderProxy(res, erro);
    }
});

/* GET /api/portal/licitacoes — desativado (spec da API protegida) */
rota.get('/licitacoes', (req, res) => {
    res.status(501).json({
        erro: 'Licitações do Portal da Transparência ainda não integradas: a API exige parâmetros específicos ' +
              '(período de até 1 mês com nomes de parâmetros protegidos). Consulte diretamente em ' +
              'https://portaldatransparencia.gov.br/licitacoes enquanto isso.',
        linkOficial: 'https://portaldatransparencia.gov.br/licitacoes',
    });
});

/* GET /api/portal/despesas — desativado (spec da API protegida) */
rota.get('/despesas', (req, res) => {
    res.status(501).json({
        erro: 'Despesas do Portal da Transparência ainda não integradas: a API exige os parâmetros ' +
              'dataEmissao e fase, cuja especificação é protegida. Consulte diretamente em ' +
              'https://portaldatransparencia.gov.br/despesas enquanto isso.',
        linkOficial: 'https://portaldatransparencia.gov.br/despesas',
    });
});

module.exports = rota;
