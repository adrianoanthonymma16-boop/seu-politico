/* ==========================================================================
   informacao.js — Presidente da República e Candidatos à Presidência
   --------------------------------------------------------------------------
   Fonte: Wikipedia em português (MediaWiki API) — artigos que espelham os
   registros oficiais do TSE. Tudo com cache, rate limit e links para as
   fontes oficiais de validação.
     - Presidente: artigo "Luiz Inácio Lula da Silva" (atual 39.º presidente)
     - Candidatos: template "Candidatos à presidência do Brasil em 2026"
   ========================================================================== */

const { requisitarWikipedia } = require('./proxy');
const cache = require('./cache');

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
    await cache.gravar(chave, resultado, 24 * 3600);
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

    await cache.gravar(chave, txt, 6 * 3600);
    return txt;
}

/* ---- Período eleitoral (configurável via env, padrão 2026) ---- */
function periodoEleitoral() {
    const inicio = new Date(process.env.ELEICAO_INICIO || '2026-08-16');
    const fim = new Date(process.env.ELEICAO_FIM || '2026-11-30');
    const agora = new Date();
    return agora >= inicio && agora <= fim;
}

/* ---- Presidente da República ---- */
async function obterPresidente() {
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
}

/* ---- Candidatos à Presidência 2026 ---- */
async function obterCandidatos() {
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
}

module.exports = { obterPresidente, obterCandidatos, periodoEleitoral };
