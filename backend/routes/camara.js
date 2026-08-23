/* ==========================================================================
   routes/camara.js — Endpoints da Câmara dos Deputados (proxy + cache)
   ========================================================================== */

const express = require('express');
const { buscarDeputados, obterDeputado, obterTodasDespesas, obterFrequencia, obterDiscursos, listarPartidos, normalizarDespesa } = require('../services/deputados');
const mock = require('../services/mockData');
const cotas = require('../services/cotas');

const rota = express.Router();

/* ---- Normalização de uma votação do deputado (API da Câmara) ---- */

/* Nº de votações de plenário mais recentes analisadas por deputado/ano. */
const LIMITE_VOTACOES = 12;

/* A API de votações exige períodos de até 3 meses — dividimos o ano em trimestres. */
function fatiasDoAno(ano) {
    const hoje = new Date();
    const trimestres = [
        [1, 3], [4, 6], [7, 9], [10, 12],
    ];
    const fatias = [];
    for (const [ini, fim] of trimestres) {
        const dataInicio = new Date(ano, ini - 1, 1);
        const dataFim = new Date(ano, fim, 0); // último dia do mês fim
        if (dataInicio > hoje) continue;
        const fimEfetivo = dataFim > hoje ? hoje : dataFim;
        if (fimEfetivo < dataInicio) continue;
        fatias.push({
            inicio: `${ano}-${String(ini).padStart(2, '0')}-01`,
            fim: `${ano}-${String(fimEfetivo.getMonth() + 1).padStart(2, '0')}-${String(fimEfetivo.getDate()).padStart(2, '0')}`,
        });
    }
    return fatias.reverse(); // do trimestre mais recente ao mais antigo
}

/* Janela do trimestre atual (dataInicio/dataFim até hoje) — usada na lista recente. */
function janelaAtual() {
    const hoje = new Date();
    const tri = Math.floor(hoje.getMonth() / 3); // 0..3
    const iniMes = tri * 3 + 1;
    const fimMes = tri * 3 + 3;
    const inicio = new Date(hoje.getFullYear(), iniMes - 1, 1);
    const fimEfetivo = new Date(hoje.getFullYear(), fimMes, 0);
    const fim = fimEfetivo > hoje ? hoje : fimEfetivo;
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { inicio: fmt(inicio), fim: fmt(fim) };
}

/**
 * A API da Câmara não expõe "deputados/{id}/votacoes" (retorna 405). Para saber
 * como um deputado votou, listamos as votações recentes do ano (GET /votacoes,
 * em períodos de até 3 meses), mantemos as de Plenário e, para cada uma, buscamos
 * os votos (GET /votacoes/{id}/votos) procurando o voto do deputado. Cache 6h.
 */
async function obterVotacoesDoDeputado(deputadoId, ano) {
    const proxy = require('../services/proxy');

    const plenario = [];
    for (const fatia of fatiasDoAno(ano)) {
        const lista = await proxy.requisitarCamara('votacoes', {
            dataInicio: fatia.inicio,
            dataFim: fatia.fim,
            ordem: 'DESC',
            ordenarPor: 'dataHoraRegistro',
            pagina: 1,
            itens: 100,
        });
        for (const v of (lista.dados || [])) {
            if (v.siglaOrgao === 'PLEN') plenario.push(v);
            if (plenario.length >= LIMITE_VOTACOES) break;
        }
        if (plenario.length >= LIMITE_VOTACOES) break;
    }

    const registros = [];
    for (const v of plenario) {
        let voto = 'Não votou';
        try {
            const votos = await proxy.requisitarCamara(`votacoes/${v.id}/votos`);
            const encontrado = (votos.dados || []).find(
                (vv) => vv.deputado_ && String(vv.deputado_.id) === String(deputadoId)
            );
            if (encontrado) voto = encontrado.tipoVoto || '—';
        } catch (e) {
            // Votações simbólicas podem não expor votos individuais.
        }

        const propSigla = v.proposicaoObjeto;
        registros.push({
            idVotacao: v.id,
            data: v.data || '',
            orgao: v.siglaOrgao || 'PLEN',
            titulo: propSigla || (v.descricao || 'Votação em plenário'),
            ementa: v.descricao || '',
            voto,
        });
    }

    return { dados: registros, links: { pagina: 1, ultima: 1 } };
}

/** GET /api/camara/deputados?nome=&siglaPartido=&siglaUf=&pagina= */
rota.get('/deputados', async (req, res) => {
    try {
        const { nome, siglaPartido, siglaUf, pagina = 1 } = req.query;
        const resultado = await buscarDeputados({ nome, siglaPartido, siglaUf, pagina });
        res.json(resultado);
    } catch (erro) {
        console.error('[camara/deputados]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/camara/deputado/:id */
rota.get('/deputado/:id', async (req, res) => {
    try {
        const deputado = await obterDeputado(req.params.id);
        if (!deputado) return res.status(404).json({ erro: 'Parlamentar não encontrado.' });
        res.json({ dados: [deputado] });
    } catch (erro) {
        console.error('[camara/deputado]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/camara/cotas/sincronizar?ano= — baixa/importa a cota oficial */
rota.get('/cotas/sincronizar', async (req, res) => {
    try {
        const ano = Number(req.query.ano) || new Date().getFullYear();
        const resultado = await cotas.sincronizarAno(ano);
        res.json(resultado);
    } catch (erro) {
        console.error('[camara/cotas]', erro.message);
        res.status(erro.status || 500).json({ erro: erro.message });
    }
});

/** GET /api/camara/votacoes/recentes?pagina= — lista de votações recentes (Câmara) */
rota.get('/votacoes/recentes', async (req, res) => {
    try {
        const pagina = Math.max(1, Number(req.query.pagina) || 1);

        const MOCK = process.env.USE_MOCK === 'true';
        if (MOCK) {
            return res.json(mock.obterVotacoesRecentesCamara(pagina));
        }

        const proxy = require('../services/proxy');
        const cache = require('../services/cache');
        const janela = janelaAtual();
        const chave = `camara:votacoes:recentes:${janela.inicio}:${pagina}`;
        const cached = await cache.obter(chave);
        if (cached) return res.json(cached);

        const r = await proxy.requisitarCamara('votacoes', {
            dataInicio: janela.inicio,
            dataFim: janela.fim,
            ordem: 'DESC',
            ordenarPor: 'dataHoraRegistro',
            pagina,
            itens: 50,
        });

        const dados = (r.dados || []).map((v) => ({
            idVotacao: v.id,
            data: v.data || '',
            orgao: v.siglaOrgao || '',
            descricao: v.descricao || '',
            proposicaoObjeto: v.proposicaoObjeto || '',
            aprovacao: v.aprovacao,
            casa: 'camara',
        }));

        let ultima = pagina;
        if (Array.isArray(r.links)) {
            const last = r.links.find((l) => l.rel === 'last');
            if (last && last.href) {
                try { ultima = Number(new URL(last.href).searchParams.get('pagina')) || pagina; } catch (e) { /* keep */ }
            }
        }

        const resultado = { dados, links: { pagina, ultima } };
        await cache.gravar(chave, resultado, 6 * 3600);
        res.json(resultado);
    } catch (erro) {
        console.error('[camara/votacoes/recentes]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/camara/proposicao?siglaTipo=&numero=&ano= — busca uma proposição */
rota.get('/proposicao', async (req, res) => {
    try {
        const { siglaTipo, numero, ano } = req.query;
        if (!siglaTipo || !numero || !ano) {
            return res.status(400).json({ erro: 'Informe siglaTipo, numero e ano (ex.: ?siglaTipo=PL&numero=1234&ano=2025).' });
        }

        const MOCK = process.env.USE_MOCK === 'true';
        if (MOCK) {
            return res.json(mock.buscarProposicao(siglaTipo, numero, ano));
        }

        const proxy = require('../services/proxy');
        const cache = require('../services/cache');
        const chave = `camara:proposicao:${String(siglaTipo).toUpperCase()}:${numero}:${ano}`;
        const cached = await cache.obter(chave);
        if (cached) return res.json(cached);

        const r = await proxy.requisitarCamara('proposicoes', {
            siglaTipo, numero, ano, itens: 10,
        });
        const primeira = (r.dados || [])[0];
        if (!primeira) return res.status(404).json({ erro: 'Proposição não encontrada.' });

        const resultado = {
            id: primeira.id,
            siglaTipo: primeira.siglaTipo,
            numero: primeira.numero,
            ano: primeira.ano,
            sigla: `${primeira.siglaTipo} ${primeira.numero}/${primeira.ano}`,
            ementa: primeira.ementa || '',
            dataApresentacao: primeira.dataApresentacao || '',
            autor: primeira.autor ? (primeira.autor.nome || '') : '',
        };
        await cache.gravar(chave, resultado, 24 * 3600);
        res.json(resultado);
    } catch (erro) {
        console.error('[camara/proposicao]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/camara/proposicao/:id/votacoes — votações de uma proposição */
rota.get('/proposicao/:id/votacoes', async (req, res) => {
    try {
        const MOCK = process.env.USE_MOCK === 'true';
        if (MOCK) {
            return res.json(mock.obterVotacoesProposicao(req.params.id));
        }

        const proxy = require('../services/proxy');
        const cache = require('../services/cache');
        const chave = `camara:proposicao:votacoes:${req.params.id}`;
        const cached = await cache.obter(chave);
        if (cached) return res.json(cached);

        const r = await proxy.requisitarCamara(`proposicoes/${req.params.id}/votacoes`);
        const dados = (r.dados || []).map((v) => ({
            idVotacao: v.id,
            data: v.data || '',
            orgao: v.siglaOrgao || '',
            descricao: v.descricao || '',
            aprovacao: v.aprovacao,
            proposicaoObjeto: v.proposicaoObjeto || '',
        }));
        const resultado = { dados, links: r.links || {} };
        await cache.gravar(chave, resultado, 12 * 3600);
        res.json(resultado);
    } catch (erro) {
        console.error('[camara/proposicao/votacoes]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/camara/deputado/:id/discursos?ano= — pronunciamentos do deputado */
rota.get('/deputado/:id/discursos', async (req, res) => {
    try {
        const ano = Number(req.query.ano) || new Date().getFullYear();
        res.json(await obterDiscursos(req.params.id, ano));
    } catch (erro) {
        console.error('[camara/discursos]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/camara/deputado/:id/frequencia?ano= — presenças e faltas em plenário */
rota.get('/deputado/:id/frequencia', async (req, res) => {
    try {
        const ano = Number(req.query.ano) || new Date().getFullYear();
        const resultado = await obterFrequencia(req.params.id, ano);
        res.json(resultado);
    } catch (erro) {
        console.error('[camara/frequencia]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/camara/deputado/:id/despesas?ano=&mes=&pagina= */
rota.get('/deputado/:id/despesas', async (req, res) => {
    try {
        const { ano, mes, pagina = 1 } = req.query;

        const MOCK = process.env.USE_MOCK === 'true';
        const resposta = await (MOCK
            ? (() => {
                const r = mock.obterDespesas(req.params.id, { ano, mes, pagina });
                return { dados: (r.dados || []).map(normalizarDespesa), links: r.links || {} };
            })()
            : (async () => {
                const proxy = require('../services/proxy');
                const cache = require('../services/cache');
                const chave = `camara:despesas:${req.params.id}:${ano || ''}:${mes || ''}:${pagina}`;
                const cached = await cache.obter(chave);
                if (cached) return cached;

                const r = await proxy.requisitarCamara(`deputados/${req.params.id}/despesas`, {
                    ano, mes, itens: 100, pagina,
                });
                let dados = (r.dados || []).map(normalizarDespesa);

                // Fallback: arquivo oficial de cota parlamentar (fonte confiável).
                if (dados.length === 0 && ano && !mes) {
                    const deputado = await obterDeputado(req.params.id);
                    if (deputado) {
                        const viaCota = await cotas.obterDespesasDeCota(deputado.nome, Number(ano));
                        if (Array.isArray(viaCota)) dados = viaCota;
                    }
                }

                const resultado = { dados, links: r.links || {} };
                await cache.gravar(chave, resultado, 2 * 3600);
                return resultado;
            })());

        res.json(resposta);
    } catch (erro) {
        console.error('[camara/despesas]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/camara/deputado/:id/votacoes?ano= — como o deputado votou */
rota.get('/deputado/:id/votacoes', async (req, res) => {
    try {
        const { ano } = req.query;

        const MOCK = process.env.USE_MOCK === 'true';
        if (MOCK) {
            return res.json(mock.obterVotacoes(req.params.id, { ano, pagina: 1 }));
        }

        const cache = require('../services/cache');
        const anoNum = Number(ano) || new Date().getFullYear();
        const chave = `camara:votacoes:${req.params.id}:${anoNum}`;
        const cached = await cache.obter(chave);
        if (cached) return res.json(cached);

        const resultado = await obterVotacoesDoDeputado(req.params.id, anoNum);
        await cache.gravar(chave, resultado, 6 * 3600);
        res.json(resultado);
    } catch (erro) {
        console.error('[camara/votacoes]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/camara/votacao/:idVotacao — detalhe + votos de uma votação */
rota.get('/votacao/:idVotacao', async (req, res) => {
    try {
        const MOCK = process.env.USE_MOCK === 'true';
        if (MOCK) {
            return res.json(mock.obterDetalheVotacao(req.params.idVotacao, 1));
        }

        const proxy = require('../services/proxy');
        const cache = require('../services/cache');
        const chave = `camara:votacao:${req.params.idVotacao}`;
        const cached = await cache.obter(chave);
        if (cached) return res.json(cached);

        const detalheRaw = await proxy.requisitarCamara(`votacoes/${req.params.idVotacao}`);
        const votosRaw = await proxy.requisitarCamara(`votacoes/${req.params.idVotacao}/votos`);

        const votoObj = detalheRaw.dados || {};
        const prop = Array.isArray(votoObj.objetosPossiveis) && votoObj.objetosPossiveis[0]
            ? votoObj.objetosPossiveis[0]
            : null;

        const votos = (votosRaw.dados || []).map((v) => {
            const dep = v.deputado_;
            return {
                deputado: dep ? {
                    id: dep.id,
                    nome: dep.nome,
                    partido: dep.siglaPartido,
                    uf: dep.siglaUf,
                } : null,
                voto: v.tipoVoto || '',
            };
        });

        const resultado = {
            idVotacao: votoObj.id,
            data: votoObj.data || '',
            orgao: votoObj.siglaOrgao || '',
            titulo: votoObj.descricao || 'Votação',
            ementa: (prop && prop.ementa) || votoObj.descricao || '',
            proposicao: prop ? {
                id: prop.id,
                sigla: prop.siglaTipo
                    ? `${prop.siglaTipo} ${prop.numero || ''}/${prop.ano || ''}`
                    : (prop.sigla || ''),
                ementa: prop.ementa || '',
            } : null,
            resultado: {
                aprovado: votoObj.aprovacao === 1,
                totalVotos: votos.length,
                sim: votos.filter((x) => x.voto === 'Sim').length,
                nao: votos.filter((x) => x.voto === 'Não').length,
                abstencoes: votos.filter((x) => x.voto === 'Abstenção').length,
            },
            votos,
            totalVotosLista: votos.length,
            links: { pagina: 1, ultima: 1 },
        };
        await cache.gravar(chave, resultado, 12 * 3600);
        res.json(resultado);
    } catch (erro) {
        console.error('[camara/votacao]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/camara/partidos */
rota.get('/partidos', async (req, res) => {
    try {
        const dados = await listarPartidos();
        res.json({ dados });
    } catch (erro) {
        console.error('[camara/partidos]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

module.exports = rota;
