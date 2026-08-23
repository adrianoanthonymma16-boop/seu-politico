/* ==========================================================================
   informacao.js — Presidente da República e Candidatos à Presidência
   --------------------------------------------------------------------------
   Fonte: Wikipedia em português (MediaWiki API) — artigos que espelham os
   registros oficiais do TSE. Tudo com cache, rate limit e links para as
   fontes oficiais de validação.
     - Presidente: artigo "Luiz Inácio Lula da Silva" (atual 39.º presidente)
     - Candidatos: template "Candidatos à presidência do Brasil em 2026"
   ========================================================================== */

const { requisitarWikipedia, requisitarPortal } = require('./proxy');
const cache = require('./cache');
const path = require('path');
const { calcularResumo, gerarSinais } = require('./motorAlerta');

const ARTIGO_ELEICAO = 'Eleição presidencial no Brasil em 2026';
const TEMPLATE_CANDIDATOS = 'Predefinição:Candidatos à presidência do Brasil em 2026';
const ARTIGO_PRESIDENTE = 'Luiz Inácio Lula da Silva';

const WIKI_ARTIGO = (titulo) => `https://pt.wikipedia.org/wiki/${String(titulo).replace(/ /g, '_')}`;
const WIKI_COMUNS_FOTO = (arquivo) =>
    `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(String(arquivo).replace(/ /g, '_'))}?width=240`;

/* ---- Utilitários de wikitexto ---- */

function limparTexto(s) {
    return String(s || '')
        .replace(/\{\{small\|([^}]*)\}\}/g, '$1')
        .replace(/\{\{N\/A\|([^}]*)\}\}/g, '$1')
        .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
        .replace(/\[\[([^\]]+)\]\]/g, '$1')
        .replace(/<br\s*\/?\s*>/g, ', ')
        .replace(/\{\{tooltip\|([^|]+)\|[^}]*\}\}/g, '$1')
        .replace(/\{\{[^}]*\}\}/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/* Primeiro wikilink de uma string (com ou sem pipe). */
function link(s) {
    const m = String(s || '').match(/\[\[([^\[\]]+?)\]\]/);
    if (!m) return null;
    const partes = m[1].split('|');
    return { pagina: partes[0].trim(), exibicao: (partes[1] || partes[0]).trim() };
}

/* Extrai a tabela de candidatos do template da Wikipédia. */
function extrairCandidatos(wikitext) {
    const candidatos = [];
    const linhas = String(wikitext || '').split('|-');

    for (const bloco of linhas) {
        const numM = bloco.match(/background:[^"]*"\s*\|\s*(\d+)/);
        if (!numM) continue;
        const celas = bloco.split(/\n\|/).map((c) => c.trim());

        const iNome = celas.findIndex((c) => /<br>\{\{small\|/.test(c) && /Campanha/.test(c));
        if (iNome < 0) continue;

        const l = link(celas[iNome]);
        const fM = celas.slice(0, iNome).map((c) => c.match(/\[\[Ficheiro:([^\]|]+)\|/)).find(Boolean);
        const iVice = celas.findIndex((c) => /width="1"/.test(c));
        const vl = iVice >= 0 && celas[iVice + 2] ? link(celas[iVice + 2]) : null;
        const iColig = celas.findIndex((c) => /align="center"/.test(c));
        const coligacao = iColig >= 0
            ? limparTexto(celas[iColig].replace(/align="center"/, '').replace(/^[\|\s]+/, ''))
            : null;

        candidatos.push({
            numero: Number(numM[1]),
            nome: l ? l.exibicao : null,
            nomePagina: l ? l.pagina : null,
            foto: fM ? fM[1] : null,
            partido: (link(celas[iNome + 1]) || {}).exibicao || null,
            vice: vl ? vl.exibicao : null,
            coligacao: coligacao || null,
        });
    }
    return candidatos;
}

/* ---- Resumo + foto de um artigo ---- */
async function obterArtigo(titulo, sentencas = 4) {
    const chave = `wikipedia:artigo:${titulo}:${sentencas}`;
    const cached = await cache.obter(chave);
    if (cached) return cached;

    const dados = await requisitarWikipedia({
        action: 'query',
        prop: 'extracts|pageimages',
        exintro: 1,
        explaintext: 1,
        exsentences: sentencas,
        pithumbsize: 300,
        redirects: 1,
        titles: titulo,
    });

    const pagina = Object.values(dados.query?.pages || {})[0];
    if (!pagina) throw new Error(`Artigo "${titulo}" não encontrado na Wikipédia.`);

    const resultado = {
        titulo: pagina.title,
        resumo: pagina.extract || '',
        foto: pagina.thumbnail?.source || '',
        url: WIKI_ARTIGO(pagina.title),
    };
    await cache.gravar(chave, resultado, 7 * 24 * 3600);
    return resultado;
}

/* ---- Wikitext de uma página ---- */
async function obterWikitext(titulo) {
    const chave = `wikipedia:wikitext:${titulo}`;
    const cached = await cache.obter(chave);
    if (cached) return cached;

    const dados = await requisitarWikipedia({
        action: 'query',
        prop: 'revisions',
        rvprop: 'content',
        rvslots: 'main',
        redirects: 1,
        titles: titulo,
    });

    const pagina = Object.values(dados.query?.pages || {})[0];
    const txt = pagina?.revisions?.[0]?.slots?.main?.['*'] || '';
    if (!txt) throw new Error(`Conteúdo de "${titulo}" não encontrado.`);

    await cache.gravar(chave, txt, 7 * 24 * 3600);
    return txt;
}

/* ---- Período eleitoral (configurável via env, padrão 2026) ---- */
function periodoEleitoral() {
    const inicio = new Date(process.env.ELEICAO_INICIO || '2026-08-16');
    const fim = new Date(process.env.ELEICAO_FIM || '2026-11-30');
    const agora = new Date();
    return agora >= inicio && agora <= fim;
}

/* ==========================================================================
   GASTOS — Viagens a serviço da Presidência da República (Portal)
   --------------------------------------------------------------------------
   A API do Portal exige período de no máximo 1 mês e um código de órgão.
   Consultamos, por mês, os órgãos 20000 (Presidência) e 20101 (Gabinete
   Pessoal) — onde ficam as viagens a serviço do gabinete presidencial.
   ========================================================================== */

const VIAGENS_ORGAOS = [20000, 20101]; // Presidência + Gabinete Pessoal
const CONTRATOS_ORGAOS = [20000, 20101];

const pad = (n) => String(n).padStart(2, '0');

/* Capitaliza nomes próprios (a API retorna em CAIXA ALTA, sem acentos). */
function capitalizarNome(nome) {
    const conectivos = new Set([
        'da', 'de', 'do', 'das', 'dos', 'e', 'em', 'na', 'no', 'nas', 'nos',
        'a', 'o', 'ao', 'aos', 'com', 'por', 'para', 'à', 'é',
    ]);
    return String(nome || '')
        .toLowerCase()
        .split(/\s+/)
        .map((parte) => {
            if (!parte) return parte;
            if (parte.includes('-')) {
                return parte.split('-')
                    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
                    .join('-');
            }
            if (conectivos.has(parte)) return parte;
            return parte.charAt(0).toUpperCase() + parte.slice(1);
        })
        .join(' ');
}

function normalizarViagem(v) {
    const b = v.beneficiario || {};
    const dataInicio = v.dataInicioAfastamento || '';
    const mes = dataInicio ? Number(dataInicio.slice(5, 7)) : (v.viagem?.mes || null);
    return {
        id: v.id,
        beneficiario: capitalizarNome(b.nome || 'Não informado'),
        cpf: b.cpfFormatado || '',
        motivo: (v.viagem && v.viagem.motivo) || '',
        situacao: v.situacao || '',
        tipoViagem: v.tipoViagem || '',
        numPcdp: (v.viagem && v.viagem.numPcdp) || '',
        dataInicio,
        dataFim: v.dataFimAfastamento || '',
        mes,
        valorTotal: Number(v.valorTotalViagem) || 0,
        valorPassagem: Number(v.valorTotalPassagem) || 0,
        valorDiarias: Number(v.valorTotalDiarias) || 0,
        valorTaxa: Number(v.valorTotalTaxaAgenciamento) || 0,
        linkPortal: `https://portaldatransparencia.gov.br/viagens/${v.id}`,
    };
}

async function obterViagensPresidencia(ano) {
    const chave = `portal:viagens:presidencia:${ano}`;
    const cached = await cache.obter(chave);
    if (cached) return cached;

    const viagens = [];
    const vistos = new Set();

    for (const orgao of VIAGENS_ORGAOS) {
        for (let mes = 1; mes <= 12; mes++) {
            const ultimoDia = new Date(ano, mes, 0).getDate();
            const de = `${pad(1)}/${pad(mes)}/${ano}`;
            const ate = `${pad(ultimoDia)}/${pad(mes)}/${ano}`;

            for (let pagina = 1; pagina <= 10; pagina++) {
                const dados = await requisitarPortal('viagens', {
                    codigoOrgao: orgao,
                    dataIdaDe: de,
                    dataIdaAte: ate,
                    dataRetornoDe: de,
                    dataRetornoAte: ate,
                    pagina,
                    paginaTamanho: 100,
                });

                const lista = Array.isArray(dados) ? dados : [];
                for (const v of lista) {
                    if (!vistos.has(v.id)) {
                        vistos.add(v.id);
                        viagens.push(normalizarViagem(v));
                    }
                }
                if (lista.length < 100) break;
            }
        }
    }

    viagens.sort((a, b) => (b.valorTotal || 0) - (a.valorTotal || 0));
    await cache.gravar(chave, viagens, 24 * 3600);
    return viagens;
}

async function obterGastosPresidente(ano = new Date().getFullYear()) {
    const viagens = await obterViagensPresidencia(Number(ano));

    // Mapeia viagens para o formato do motor (despesas) e calcula análise.
    const despesas = viagens.map((v) => ({
        mes: v.mes,
        tipo: v.tipoViagem || 'Não informado',
        valor: v.valorTotal,
    }));
    const resumo = calcularResumo(despesas);
    const sinais = gerarSinais(despesas, resumo, { nomePolitico: 'Presidência da República' });

    // Agregações específicas.
    const porTipo = {};
    const porMes = Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, valor: 0 }));
    const porBeneficiario = {};
    let total = 0;
    for (const v of viagens) {
        total += v.valorTotal;
        porTipo[v.tipoViagem] = (porTipo[v.tipoViagem] || 0) + v.valorTotal;
        if (v.mes >= 1 && v.mes <= 12) porMes[v.mes - 1].valor += v.valorTotal;
        porBeneficiario[v.beneficiario] = (porBeneficiario[v.beneficiario] || 0) + v.valorTotal;
    }

    return {
        ano,
        totalViagens: viagens.length,
        totalGasto: total,
        mediaViagem: viagens.length ? total / viagens.length : 0,
        maiorViagem: viagens.length ? viagens[0] : null,
        porTipo: Object.entries(porTipo).map(([tipo, valor]) => ({ tipo, valor })),
        serieMensal: porMes,
        topBeneficiarios: Object.entries(porBeneficiario)
            .map(([beneficiario, valor]) => ({ beneficiario, valor }))
            .sort((a, b) => b.valor - a.valor)
            .slice(0, 10),
        viagens,
        sinais,
        aviso: 'Gastos com viagens a serviço da Presidência da República (órgãos 20000 e 20101), publicados no Portal da Transparência. Incluem viagens de servidores e agentes do gabinete presidencial.',
    };
}

/* ==========================================================================
   CONTRATOS — Contratos públicos da Presidência da República (Portal)
   ========================================================================== */

function normalizarContratoPresidencia(c) {
    const fornecedor = typeof c.fornecedor === 'object' && c.fornecedor !== null
        ? (c.fornecedor.nome || c.fornecedor.descricao || 'Não informado')
        : (c.fornecedor || 'Não informado');
    const assinatura = c.dataAssinatura || '';
    // dataAssinatura vem como dd/mm/aaaa; também aceita aaaa-mm-dd.
    const partes = assinatura.includes('-')
        ? assinatura.split('-')
        : assinatura.split('/').reverse();
    const mes = partes.length === 3 ? Number(partes[1]) : null;

    return {
        id: c.id,
        numero: c.numero || '',
        objeto: String(c.objeto || '').replace(/^Objeto:\s*/i, ''),
        fornecedor: capitalizarNome(fornecedor),
        cnpjCpf: String(c.cnpjCpf || (typeof c.fornecedor === 'object' ? (c.fornecedor.cnpjCpf || '') : '') || '').replace(/[.\-\/]/g, '').trim(),
        valorInicial: Number(c.valorInicialCompra) || 0,
        valorFinal: Number(c.valorFinalCompra) || 0,
        modalidade: c.modalidadeCompra || '—',
        situacao: c.situacaoContrato || '—',
        dataAssinatura: assinatura,
        mes,
        vigenciaInicio: c.dataInicioVigencia || '',
        vigenciaFim: c.dataFimVigencia || '',
        unidadeGestora: c.unidadeGestora || '—',
        linkPortal: `https://portaldatransparencia.gov.br/contratos/${c.id}`,
    };
}

async function obterContratosPresidencia(ano) {
    const chave = `portal:contratos:presidencia:${ano}`;
    const cached = await cache.obter(chave);
    if (cached) return cached;

    const contratos = [];
    const vistos = new Set();
    for (const orgao of CONTRATOS_ORGAOS) {
        for (let pagina = 1; pagina <= 20; pagina++) {
            const dados = await requisitarPortal('contratos', {
                codigoOrgao: orgao, ano, pagina, paginaTamanho: 100,
            });
            const lista = Array.isArray(dados) ? dados : [];
            for (const c of lista) {
                if (!vistos.has(c.id)) {
                    vistos.add(c.id);
                    contratos.push(normalizarContratoPresidencia(c));
                }
            }
            if (lista.length < 100) break;
        }
    }

    // Agregações + motor de suspeita.
    const despesas = contratos.map((c) => ({
        mes: c.mes,
        tipo: c.modalidade || 'Não informado',
        valor: c.valorFinal,
    }));
    const resumo = calcularResumo(despesas);
    const sinais = gerarSinais(despesas, resumo, { nomePolitico: 'Contratos da Presidência da República' });

    const porModalidade = {};
    const porMes = Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, valor: 0 }));
    const porFornecedor = {};
    let totalFinal = 0;
    for (const c of contratos) {
        totalFinal += c.valorFinal;
        porModalidade[c.modalidade] = (porModalidade[c.modalidade] || 0) + c.valorFinal;
        if (c.mes >= 1 && c.mes <= 12) porMes[c.mes - 1].valor += c.valorFinal;
        porFornecedor[c.fornecedor] = (porFornecedor[c.fornecedor] || 0) + c.valorFinal;
    }

    const resultado = {
        ano,
        totalContratos: contratos.length,
        totalInicial: contratos.reduce((a, c) => a + c.valorInicial, 0),
        totalFinal,
        mediaContrato: contratos.length ? totalFinal / contratos.length : 0,
        maiorContrato: contratos.length ? contratos[0] : null,
        porModalidade: Object.entries(porModalidade).map(([modalidade, valor]) => ({ modalidade, valor })),
        serieMensal: porMes,
        topFornecedores: Object.entries(porFornecedor)
            .map(([fornecedor, valor]) => ({ fornecedor, valor }))
            .sort((a, b) => b.valor - a.valor)
            .slice(0, 10),
        contratos: contratos.slice().sort((a, b) => b.valorFinal - a.valorFinal),
        sinais,
        aviso: 'Contratos públicos da Presidência da República (órgãos SIAFI 20000 e 20101), publicados no Portal da Transparência.',
    };

    await cache.gravar(chave, resultado, 24 * 3600);
    return resultado;
}

/* ---- Presidente da República ---- */
async function obterPresidente() {
    try {
        const artigo = await obterArtigo(ARTIGO_PRESIDENTE, 4);
        return {
            presidente: {
                nome: artigo.titulo,
                nomeComum: 'Lula',
                partido: 'PT',
                mandato: '2023–2026',
                foto: artigo.foto,
                resumo: artigo.resumo,
                links: {
                    wikipedia: artigo.url,
                    oficial: 'https://www.gov.br/planalto',
                },
            },
        };
    } catch (e) {
        // Fallback: arquivo estático gerado no build (evita depender da Wikipédia).
        try {
            const dados = require(path.join(__dirname, '..', '..', 'data', 'presidente.json'));
            return dados;
        } catch (e2) { throw e; }
    }
}

/* ---- Candidatos à Presidência 2026 ---- */
async function obterCandidatos() {
    try {
        const [artigo, wikitext] = await Promise.all([
            obterArtigo(ARTIGO_ELEICAO, 3),
            obterWikitext(TEMPLATE_CANDIDATOS),
        ]);

        const candidatos = extrairCandidatos(wikitext).map((c) => ({
            numero: c.numero,
            nome: c.nome,
            partido: c.partido,
            vice: c.vice,
            coligacao: c.coligacao,
            foto: c.foto ? WIKI_COMUNS_FOTO(c.foto) : null,
            linkWikipedia: c.nomePagina ? WIKI_ARTIGO(c.nomePagina) : artigo.url,
        }));

        return {
            eleicao: {
                ano: 2026,
                dataReferencia: '4 de outubro de 2026 (1º turno)',
                periodoAtivo: periodoEleitoral(),
            },
            resumo: artigo.resumo,
            candidatos,
            links: {
                wikipedia: artigo.url,
                tse: 'https://www.tse.jus.br/eleicoes/eleicoes-2026',
                divulgacao: 'https://divulgacandcontas.tse.jus.br',
            },
        };
    } catch (e) {
        // Fallback: arquivo estático gerado no build (evita depender da Wikipédia).
        try {
            return require(path.join(__dirname, '..', '..', 'data', 'candidatos.json'));
        } catch (e2) { throw e; }
    }
}

module.exports = { obterPresidente, obterCandidatos, obterGastosPresidente, obterContratosPresidencia, periodoEleitoral };
