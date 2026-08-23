/* ==========================================================================
   routes/analise.js — Endpoints de análise (motor de suspeita)
   --------------------------------------------------------------------------
   Endpoints:
     GET /analise/geral?ano          → visão geral (home e dashboard)
     GET /analise/deputado/:id?ano   → análise completa de um parlamentar
     GET /analise/comparar?ids&ano   → comparação neutra entre parlamentares
     GET /analise/media?uf&ano       → média de referência por estado
   ========================================================================== */

const express = require('express');
const { buscarDeputados, obterDeputado, obterTodasDespesas, listarPartidos } = require('../services/deputados');
const senado = require('../services/senado');
const { listarEmpresasRecorrentes } = require('../services/empresas');
const { listarPoderes } = require('../services/poderes');
const { calcularResumo, gerarSinais, gerarSinaisComparacao } = require('../services/motorAlerta');
const cache = require('../services/cache');
const { habilitado } = require('../db');
const { obterRegistrosCota, normalizarNome } = require('../services/cotas');

const rota = express.Router();

const ANO_PADRAO = () => new Date().getFullYear();
const AMOSTRA = 40; // nº de deputados usados na visão geral
const MOCK = process.env.USE_MOCK === 'true';

async function obterDespesasDoSenador(id, ano) {
    if (MOCK) return senado.mockDespesasSenador(id, ano);
    const senador = await senado.obterSenador(id);
    if (!senador) return [];
    const despesas = await senado.obterDespesasCeaps(senador.nome, ano);
    return Array.isArray(despesas) ? despesas : [];
}

function variacaoPercentual(serie) {
    const meses = serie.filter((s) => s.valor > 0);
    if (meses.length < 2) return null;
    const ultimo = meses[meses.length - 1];
    const anterior = meses[meses.length - 2];
    if (anterior.valor === 0) return null;
    return Math.round(((ultimo.valor / anterior.valor) - 1) * 100);
}

/* ---- Média de gasto por UF (referência para os alertas) ---- */
async function calcularMediaUf(uf, ano) {
    if (!uf) return null;
    const chave = `analise:media:${uf}:${ano}`;
    const cached = await cache.obter(chave);
    if (cached) return cached;

    const { dados } = await buscarDeputados({ siglaUf: uf, pagina: 1 });
    const amostra = dados.slice(0, 20);

    const totais = [];
    for (const dep of amostra) {
        const despesas = await obterTodasDespesas(dep.id, ano);
        totais.push(despesas.reduce((acc, d) => acc + d.valor, 0));
    }

    const media = totais.length
        ? totais.reduce((a, b) => a + b, 0) / totais.length
        : 0;

    const resultado = { uf, ano, media, totalDeputados: amostra.length };
    await cache.gravar(chave, resultado, 6 * 3600);
    return resultado;
}

/** GET /api/analise/poderes?ano=&mes= — partidos, emendas e gastos por poder */
rota.get('/poderes', async (req, res) => {
    try {
        const ano = Number(req.query.ano) || ANO_PADRAO();
        const mes = req.query.mes ? Number(req.query.mes) : 0;
        res.json(await listarPoderes(ano, mes));
    } catch (erro) {
        console.error('[analise/poderes]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/analise/empresas?ano= — empresas que recebem de 2+ parlamentares */
rota.get('/empresas', async (req, res) => {
    try {
        const ano = Number(req.query.ano) || ANO_PADRAO();
        res.json(await listarEmpresasRecorrentes(ano));
    } catch (erro) {
        console.error('[analise/empresas]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/analise/media?uf=&ano= */
rota.get('/media', async (req, res) => {
    try {
        const { uf, ano = ANO_PADRAO() } = req.query;
        const resultado = await calcularMediaUf(uf, Number(ano));
        res.json(resultado || { media: 0 });
    } catch (erro) {
        console.error('[analise/media]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/analise/geral?ano= */
rota.get('/geral', async (req, res) => {
    const ano = Number(req.query.ano) || ANO_PADRAO();
    const chave = `analise:geral:${ano}`;
    try {
        const cached = await cache.obter(chave);
        if (cached) return res.json(cached);

        // Contagem de deputados (via links de paginação da Câmara).
        const primeiro = await buscarDeputados({ pagina: 1 });
        const totalDeputados = primeiro.links.ultima > 1
            ? (primeiro.links.ultima - 1) * 100 + primeiro.dados.length
            : primeiro.dados.length;

        const partidos = await listarPartidos();

        // Amostra para agregação — otimizado: em modo memoria (Vercel) usa o arquivo de cota direto, sem 40 chamadas à Câmara.
        const amostra = primeiro.dados.slice(0, AMOSTRA);

        const todasDespesas = [];
        const sinaisAmostra = [];
        const totaisPorPartido = {};
        const totaisPorUf = {};
        const contagemPorPartido = {};
        const contagemPorUf = {};

        // Fast path: sem Postgres e sem mock, lê o zip da cota uma vez e distribui (1 download vs 40 API calls)
        const usarCotaDireto = !habilitado && !MOCK;
        if (usarCotaDireto) {
            try {
                const registros = await obterRegistrosCota(ano);
                // Índice nome normalizado → lista de despesas normalizadas do arquivo
                const porNome = new Map();
                for (const r of registros) {
                    const nomeNorm = normalizarNome(r.nomeParlamentar);
                    if (!porNome.has(nomeNorm)) porNome.set(nomeNorm, []);
                    porNome.get(nomeNorm).push({
                        ano: Number(r.ano) || ano,
                        mes: Number(r.mes) || null,
                        tipo: r.descricao || `Cota ${r.numeroSubCota}`,
                        data: String(r.dataEmissao || '').slice(0, 10),
                        valor: Number(r.valorLiquido ?? r.valorDocumento) || 0,
                        fornecedor: r.fornecedor || 'Não informado',
                        cnpjCpf: String(r.cnpjCPF || '').replace(/[.\-\/]/g, '').trim(),
                        documento: r.idDocumento || '',
                        url: r.urlDocumento || '',
                    });
                }
                for (const dep of amostra) {
                    const nomeNorm = normalizarNome(dep.nome);
                    let despesas = porNome.get(nomeNorm) || [];
                    if (!despesas.length) {
                        // tenta match parcial (nome curto vs nome completo)
                        for (const [k, v] of porNome.entries()) {
                            if (k.includes(nomeNorm) || nomeNorm.includes(k)) { despesas = v; break; }
                        }
                    }
                    const resumo = calcularResumo(despesas);
                    const sinais = gerarSinais(despesas, resumo, { nomePolitico: dep.nome });
                    todasDespesas.push(...despesas);
                    sinaisAmostra.push({ dep, sinais });
                    const partido = dep.partido || '—';
                    const uf = dep.uf || '—';
                    totaisPorPartido[partido] = (totaisPorPartido[partido] || 0) + resumo.total;
                    totaisPorUf[uf] = (totaisPorUf[uf] || 0) + resumo.total;
                    contagemPorPartido[partido] = (contagemPorPartido[partido] || 0) + 1;
                    contagemPorUf[uf] = (contagemPorUf[uf] || 0) + 1;
                }
            } catch (e) {
                console.warn('[analise/geral] cota direto falhou, caindo para loop paralelo:', e.message);
                // fallback para loop paralelo abaixo
                for (const dep of amostra) {
                    const despesas = await obterTodasDespesas(dep.id, ano);
                    const resumo = calcularResumo(despesas);
                    const sinais = gerarSinais(despesas, resumo, { nomePolitico: dep.nome });
                    todasDespesas.push(...despesas);
                    sinaisAmostra.push({ dep, sinais });
                    const partido = dep.partido || '—';
                    const uf = dep.uf || '—';
                    totaisPorPartido[partido] = (totaisPorPartido[partido] || 0) + resumo.total;
                    totaisPorUf[uf] = (totaisPorUf[uf] || 0) + resumo.total;
                    contagemPorPartido[partido] = (contagemPorPartido[partido] || 0) + 1;
                    contagemPorUf[uf] = (contagemPorUf[uf] || 0) + 1;
                }
            }
        } else {
            // Caminho com Postgres/mock: paraleliza em lotes de 5 para respeitar 120 RPM e ser ~4x mais rápido
            const tamanhoLote = 5;
            for (let i = 0; i < amostra.length; i += tamanhoLote) {
                const lote = amostra.slice(i, i + tamanhoLote);
                const resultados = await Promise.all(lote.map(async (dep) => {
                    const despesas = await obterTodasDespesas(dep.id, ano);
                    const resumo = calcularResumo(despesas);
                    const sinais = gerarSinais(despesas, resumo, { nomePolitico: dep.nome });
                    return { dep, despesas, resumo, sinais };
                }));
                for (const { dep, despesas, resumo, sinais } of resultados) {
                    todasDespesas.push(...despesas);
                    sinaisAmostra.push({ dep, sinais });
                    const partido = dep.partido || '—';
                    const uf = dep.uf || '—';
                    totaisPorPartido[partido] = (totaisPorPartido[partido] || 0) + resumo.total;
                    totaisPorUf[uf] = (totaisPorUf[uf] || 0) + resumo.total;
                    contagemPorPartido[partido] = (contagemPorPartido[partido] || 0) + 1;
                    contagemPorUf[uf] = (contagemPorUf[uf] || 0) + 1;
                }
            }
        }

        const resumo = calcularResumo(todasDespesas);

        // Destaques: sinais de alerta/info mais representativos.
        const destaques = [];
        for (const { dep, sinais } of sinaisAmostra) {
            if (destaques.length >= 6) break;
            const candidato = sinais.find((s) => s.nivel === 'alerta')
                || sinais.find((s) => s.nivel === 'info')
                || sinais.find((s) => s.nivel === 'comparacao');
            if (candidato) {
                destaques.push({
                    icone: candidato.icone,
                    titulo: `${candidato.titulo} — ${dep.nome} (${dep.partido}-${dep.uf})`,
                    texto: candidato.texto,
                });
            }
        }

        const totalAlertas = sinaisAmostra.reduce(
            (acc, { sinais }) => acc + sinais.filter((s) => s.nivel === 'alerta').length,
            0
        );

        const resultado = {
            ano,
            totalDeputados,
            totalPartidos: partidos.length,
            totalAlertas,
            totalGasto: resumo.total,
            mediaMensal: resumo.total / 12,
            numTipos: resumo.categorias.length,
            variacao: variacaoPercentual(resumo.serieMensal),
            categorias: resumo.categorias.slice(0, 12),
            serieMensal: resumo.serieMensal,
            fornecedores: resumo.fornecedores.slice(0, 10),
            porPartido: Object.entries(totaisPorPartido)
                .map(([partido, valor]) => ({ partido, valor, totalDeputados: contagemPorPartido[partido] }))
                .sort((a, b) => b.valor - a.valor)
                .slice(0, 12),
            porUf: Object.entries(totaisPorUf)
                .map(([uf, valor]) => ({ uf, valor, totalDeputados: contagemPorUf[uf] }))
                .sort((a, b) => b.valor - a.valor),
            destaques,
            aviso: 'Visão geral calculada a partir de uma amostra de dados públicos.',
        };

        await cache.gravar(chave, resultado, 24 * 3600); // 1x/dia — protege o limite da Câmara
        // Cache de borda explícito (fallback se middleware não aplicar)
        res.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
        res.json(resultado);
    } catch (erro) {
        console.error('[analise/geral]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/analise/deputado/:id?ano=&nome=&partido=&uf= */
rota.get('/deputado/:id', async (req, res) => {
    const ano = Number(req.query.ano) || ANO_PADRAO();
    try {
        // Se o frontend já passou nome/partido/uf (evita chamada à Câmara de 5s).
        const dadosLista = req.query.nome ? {
            id: Number(req.params.id),
            nome: decodeURIComponent(req.query.nome),
            partido: decodeURIComponent(req.query.partido || '—'),
            uf: decodeURIComponent(req.query.uf || '—'),
        } : null;

        const deputado = await obterDeputado(req.params.id, dadosLista);
        if (!deputado) return res.status(404).json({ erro: 'Parlamentar não encontrado.' });

        const despesas = await obterTodasDespesas(req.params.id, ano);
        const resumo = calcularResumo(despesas);

        const referencia = await calcularMediaUf(deputado.uf, ano);
        const mediaUf = referencia ? referencia.media : 0;

        const sinais = gerarSinais(despesas, resumo, {
            nomePolitico: deputado.nome,
            mediaUf,
        });

        res.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
        res.json({
            deputado,
            ano,
            mediaUf,
            ...resumo,
            sinais,
            despesas,
        });
    } catch (erro) {
        console.error('[analise/deputado]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

/** GET /api/analise/comparar?ids=dep:1,sen:9001&ano= */
rota.get('/comparar', async (req, res) => {
    const ano = Number(req.query.ano) || ANO_PADRAO();
    const ids = String(req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 4);
    try {
        if (ids.length < 2) {
            return res.status(400).json({ erro: 'Informe ao menos dois parlamentares (ids).' });
        }

        const parlamentares = [];
        const categoriasMap = {};

        // Paraleliza o processamento dos parlamentares (antes sequencial ~15-30s).
        const resultados = await Promise.all(ids.map(async (ref) => {
            const tipo = ref.includes(':') ? ref.split(':')[0] : 'dep';
            const id = ref.includes(':') ? ref.slice(ref.indexOf(':') + 1) : ref;
            let registro = null;

            if (tipo === 'sen') {
                const senador = await senado.obterSenador(id);
                if (!senador) return null;

                const despesas = await obterDespesasDoSenador(senador.id, ano);
                const resumo = calcularResumo(despesas);
                return {
                    registro: {
                        id: `sen:${senador.id}`,
                        nome: senador.nome,
                        partido: senador.partido,
                        uf: senador.uf,
                        urlFoto: senador.urlFoto || '',
                        cargo: 'Senador',
                        total: resumo.total,
                        media: resumo.media,
                        quantidade: resumo.quantidade,
                        categoriaPrincipal: resumo.categorias[0] ? resumo.categorias[0].tipo : '—',
                    },
                    categorias: resumo.categorias,
                    prefixo: `sen:${senador.id}`,
                };
            }

            const deputado = await obterDeputado(id);
            if (!deputado) return null;

            const despesas = await obterTodasDespesas(id, ano);
            const resumo = calcularResumo(despesas);
            return {
                registro: {
                    id: `dep:${deputado.id}`,
                    nome: deputado.nome,
                    partido: deputado.partido,
                    uf: deputado.uf,
                    urlFoto: deputado.urlFoto || '',
                    cargo: 'Deputado Federal',
                    total: resumo.total,
                    media: resumo.media,
                    quantidade: resumo.quantidade,
                    categoriaPrincipal: resumo.categorias[0] ? resumo.categorias[0].tipo : '—',
                },
                categorias: resumo.categorias,
                prefixo: `dep:${deputado.id}`,
            };
        }));

        for (const r of resultados) {
            if (!r) continue;
            parlamentares.push(r.registro);
            for (const cat of r.categorias) {
                if (!categoriasMap[cat.tipo]) categoriasMap[cat.tipo] = {};
                categoriasMap[cat.tipo][r.prefixo] = cat.valor;
            }
        }

        const categorias = Object.entries(categoriasMap).map(([tipo, valores]) => ({ tipo, valores }));
        const sinais = gerarSinaisComparacao(parlamentares);

        res.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
        res.json({ ano, deputados: parlamentares, categorias, sinais });
    } catch (erro) {
        console.error('[analise/comparar]', erro.message);
        res.status(erro.status || 502).json({ erro: erro.message });
    }
});

module.exports = rota;
