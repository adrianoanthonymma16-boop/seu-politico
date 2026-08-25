/* ==========================================================================
   routes/senado.js — Endpoints do Senado Federal (dados oficiais)
   --------------------------------------------------------------------------
     GET /senado/senadores?nome=&partido=&uf=
     GET /senado/senador/:id
     GET /senado/ceaps/sincronizar?ano=
     GET /senado/despesas/:id?ano=&pagina=
     GET /senado/analise/:id?ano=          (motor de suspeita)
   ========================================================================== */

const express = require('express');
const { listarSenadores, obterSenador, sincronizarCeaps, obterDespesasCeaps, obterFrequenciaVotacoes, obterVotacoesSenador, obterDetalheVotacaoSenado, obterDiscursosSenador, mockDespesasSenador } = require('../services/senado');
const { calcularResumo, gerarSinais } = require('../services/motorAlerta');
const cache = require('../services/cache');
const mock = require('../services/mockData');

const rota = express.Router();
const MOCK = process.env.USE_MOCK === 'true';
const ANO_PADRAO = () => new Date().getFullYear();

/* Janela do trimestre atual (até hoje) — usada na lista de votações recentes. */
function janelaAtual() {
    const hoje = new Date();
    const tri = Math.floor(hoje.getMonth() / 3);
    const iniMes = tri * 3 + 1;
    const fimMes = tri * 3 + 3;
    const inicio = new Date(hoje.getFullYear(), iniMes - 1, 1);
    const fimEfetivo = new Date(hoje.getFullYear(), fimMes, 0);
    const fim = fimEfetivo > hoje ? hoje : fimEfetivo;
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { inicio: fmt(inicio), fim: fmt(fim) };
}

/* ---- Média de referência por UF (senadores) ---- */
async function calcularMediaUf(uf, ano) {
    if (!uf) return null;
    const chave = `senado:analise:media:${uf}:${ano}`;
    const cached = await cache.obter(chave);
    if (cached) return cached;

    const { dados } = await listarSenadores({ uf });
    const totais = [];
    for (const sen of dados.slice(0, 8)) {
        try {
            if (MOCK) {
                totais.push(mockDespesasSenador(sen.id, ano).reduce((a, d) => a + d.valor, 0));
            } else {
                const despesas = await obterDespesasCeaps(sen.nome, ano);
                totais.push((despesas || []).reduce((a, d) => a + d.valor, 0));
            }
        } catch (e) {
            // Ignora senadores com erro individual.
        }
    }
    const media = totais.length ? totais.reduce((a, b) => a + b, 0) / totais.length : 0;
    const resultado = { uf, ano, media, totalSenadores: totais.length };
    await cache.gravar(chave, resultado, 6 * 3600);
    return resultado;
}

async function obterDespesasDoSenador(id, ano) {
    if (MOCK) return mockDespesasSenador(id, ano);

    const senador = await obterSenador(id);
    if (!senador) return [];
    try {
        const despesas = await obterDespesasCeaps(senador.nome, ano);
        return Array.isArray(despesas) ? despesas : [];
    } catch (e) {
        console.warn('[senado/despesas]', senador.nome, e.message);
        return [];
    }
}

/** GET /api/senado/senadores?nome=&partido=&uf= */
rota.get('/senadores', async (req, res) => {
    try {
        const { nome, partido, uf } = req.query;
        res.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
        res.json(await listarSenadores({ nome, partido, uf }));
    } catch (erro) {
        console.error('[senado/senadores]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/senado/senador/:id */
rota.get('/senador/:id', async (req, res) => {
    try {
        const senador = await obterSenador(req.params.id);
        if (!senador) return res.status(404).json({ erro: 'Senador não encontrado.' });
        res.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
        res.json({ dados: [senador] });
    } catch (erro) {
        console.error('[senado/senador]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/senado/ceaps/sincronizar?ano= */
rota.get('/ceaps/sincronizar', async (req, res) => {
    try {
        const ano = Number(req.query.ano) || ANO_PADRAO();
        res.json(await sincronizarCeaps(ano));
    } catch (erro) {
        console.error('[senado/ceaps]', erro.message);
        res.status(erro.status || 500).json({ erro: erro.message });
    }
});

/** GET /api/senado/votacoes/recentes?pagina= — lista de votações recentes (Senado) */
rota.get('/votacoes/recentes', async (req, res) => {
    try {
        const pagina = Math.max(1, Number(req.query.pagina) || 1);
        const limite = 50;

        if (MOCK) {
            return res.json(mock.obterVotacoesRecentesSenado(pagina));
        }

        const cache = require('../services/cache');
        const { requisitarSenadoLegis } = require('../services/proxy');
        const janela = janelaAtual();
        const chave = `senado:votacoes:recentes:${janela.inicio}`;

        let todos = await cache.obter(chave);
        if (!todos) {
            const resposta = await requisitarSenadoLegis('votacao', {
                dataInicio: janela.inicio,
                dataFim: janela.fim,
            });
            todos = (Array.isArray(resposta) ? resposta : (resposta.data || []))
                .map((rec) => ({
                    idVotacao: rec.codigoSessaoVotacao,
                    sessao: rec.codigoSessao,
                    data: rec.dataSessao || '',
                    orgao: 'Plenário',
                    titulo: rec.identificacao || 'Votação',
                    descricao: rec.descricaoVotacao || rec.ementa || '',
                    casa: 'senado',
                }))
                .sort((a, b) => String(b.data).localeCompare(String(a.data)));
            await cache.gravar(chave, todos, 6 * 3600);
        }

        const inicio = (pagina - 1) * limite;
        res.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
        res.json({
            dados: todos.slice(inicio, inicio + limite),
            links: { pagina, ultima: Math.max(1, Math.ceil(todos.length / limite)) },
        });
    } catch (erro) {
        console.error('[senado/votacoes/recentes]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/senado/senador/:id/frequencia?ano= — presenças e faltas em votações */
rota.get('/senador/:id/frequencia', async (req, res) => {
    try {
        const ano = Number(req.query.ano) || ANO_PADRAO();
        const resultado = await obterFrequenciaVotacoes(req.params.id, ano);
        res.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
        res.json(resultado);
    } catch (erro) {
        console.error('[senado/frequencia]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/senado/senador/:id/discursos?ano= — pronunciamentos do senador */
rota.get('/senador/:id/discursos', async (req, res) => {
    try {
        const ano = Number(req.query.ano) || ANO_PADRAO();
        res.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
        res.json(await obterDiscursosSenador(req.params.id, ano));
    } catch (erro) {
        console.error('[senado/discursos]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/senado/senador/:id/votacoes?ano= — como o senador votou */
rota.get('/senador/:id/votacoes', async (req, res) => {
    try {
        const ano = Number(req.query.ano) || ANO_PADRAO();
        const resultado = await obterVotacoesSenador(req.params.id, ano);
        res.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
        res.json(resultado);
    } catch (erro) {
        console.error('[senado/votacoes]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/senado/votacao/:sessao/:votacao — placar + votos de uma votação */
rota.get('/votacao/:sessao/:votacao', async (req, res) => {
    try {
        const resultado = await obterDetalheVotacaoSenado(req.params.sessao, req.params.votacao);
        res.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
        res.json(resultado);
    } catch (erro) {
        console.error('[senado/votacao]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/senado/despesas/:id?ano=&pagina= */
rota.get('/despesas/:id', async (req, res) => {
    try {
        const ano = Number(req.query.ano) || ANO_PADRAO();
        const pagina = Number(req.query.pagina) || 1;
        const itens = Number(req.query.itens) || 100;

        const todas = await obterDespesasDoSenador(req.params.id, ano);
        const inicio = (pagina - 1) * itens;
        const dados = todas.slice(inicio, inicio + itens);
        res.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
        res.json({ dados, total: todas.length, links: { pagina, ultima: Math.max(1, Math.ceil(todas.length / itens)) } });
    } catch (erro) {
        console.error('[senado/despesas]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/senado/analise/:id?ano= */
rota.get('/analise/:id', async (req, res) => {
    const ano = Number(req.query.ano) || ANO_PADRAO();
    try {
        const senador = await obterSenador(req.params.id);
        if (!senador) return res.status(404).json({ erro: 'Senador não encontrado.' });

        const despesas = await obterDespesasDoSenador(req.params.id, ano);
        const resumo = calcularResumo(despesas);

        const referencia = await calcularMediaUf(senador.uf, ano);
        const mediaUf = referencia ? referencia.media : 0;

        const sinais = gerarSinais(despesas, resumo, {
            nomePolitico: senador.nome,
            mediaUf,
        });

        res.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
        res.json({
            senador,
            ano,
            mediaUf,
            ...resumo,
            sinais,
            despesas,
        });
    } catch (erro) {
        console.error('[senado/analise]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

module.exports = rota;
