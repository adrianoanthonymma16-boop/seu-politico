/* ==========================================================================
   empresas.js — Empresas que recebem de mais de um parlamentar
   --------------------------------------------------------------------------
   Cruza as despesas de Câmara (cota parlamentar) e Senado (CEAPS) e identifica
   fornecedores que receberam recursos de 2 ou mais parlamentares distintos.
   Fonte primária: arquivos oficiais (camara.leg.br/cotas e adm.senado.gov.br).
   Neutro: apenas padrões de dados públicos — com comprovantes oficiais.
   ========================================================================== */

const { obterRegistrosCota } = require('./cotas');
const { obterRegistrosCeaps, listarSenadores } = require('./senado');
const cache = require('./cache');
const mock = require('./mockData');

const MOCK = process.env.USE_MOCK === 'true';

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

const CAP_COMPROVANTES = 10;
const LIMITE_EMPRESAS = 100;

function limparCnpj(valor) {
    return String(valor || '').replace(/[^0-9]/g, '').trim();
}

function normalizarNome(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .trim();
}

/* Registros da Câmara que representam parlamentares (exclui cotas de liderança). */
function ehParlamentarCota(r) {
    const nome = String(r.nomeParlamentar || '');
    if (/^(LID\.|GOV\.|MINORIA|MAIORIA|OPOSI|LEADER|MESA|VICE-?LID)/i.test(nome)) return false;
    if (r.siglaUF === 'NA' || !UFS.includes(String(r.siglaUF).toUpperCase())) return false;
    return true;
}

/**
 * Lista fornecedores com 2+ parlamentares distintos (Câmara e Senado).
 * @param {number} ano
 * @returns {Promise<Object>} { ano, totalEmpresas, empresas, aviso }
 */
async function listarEmpresasRecorrentes(ano) {
    const chaveCache = `analise:empresas:${ano}`;
    const cached = await cache.obter(chaveCache);
    if (cached) return cached;

    if (MOCK) {
        const resultado = mock.listarEmpresasRecorrentes(ano);
        await cache.gravar(chaveCache, resultado, 24 * 3600);
        return resultado;
    }

    const porFornecedor = {};

    const adicionar = (chave, fornecedor, cnpjCpf, politico, comprovante) => {
        if (!porFornecedor[chave]) {
            porFornecedor[chave] = { fornecedor, cnpjCpf: cnpjCpf || '', total: 0, numDespesas: 0, porParlamentar: {} };
        }
        const grupo = porFornecedor[chave];
        grupo.total += comprovante.valor;
        grupo.numDespesas += 1;

        const chavePol = `${politico.cargo}:${politico.cod}`;
        if (!grupo.porParlamentar[chavePol]) {
            grupo.porParlamentar[chavePol] = { ...politico, total: 0, qtd: 0, comprovantes: [] };
        }
        const p = grupo.porParlamentar[chavePol];
        p.total += comprovante.valor;
        p.qtd += 1;
        // Guarda só comprovantes com link oficial (até o limite), para exibição fiel.
        if (comprovante.url && p.comprovantes.length < CAP_COMPROVANTES) p.comprovantes.push(comprovante);
    };

    /* ---- Câmara (arquivo oficial de cota parlamentar) ---- */
    const registrosCota = await obterRegistrosCota(ano);
    for (const r of registrosCota) {
        if (!ehParlamentarCota(r)) continue;
        const valor = Number(r.valorLiquido ?? r.valorDocumento) || 0;
        if (!valor) continue;
        const chave = limparCnpj(r.cnpjCPF) || normalizarNome(r.fornecedor);
        if (!chave) continue;
        adicionar(chave, r.fornecedor, r.cnpjCPF, {
            cargo: 'Deputado Federal',
            cod: r.numeroDeputadoID,
            nome: r.nomeParlamentar,
            partido: r.siglaPartido || '—',
            uf: String(r.siglaUF || '—').toUpperCase(),
        }, {
            data: String(r.dataEmissao || '').slice(0, 10),
            tipo: r.descricao || 'Cota parlamentar',
            valor,
            url: r.urlDocumento || '',
            documento: r.idDocumento || '',
        });
    }

    /* ---- Senado (CEAPS) ---- */
    const registrosCeaps = await obterRegistrosCeaps(ano);
    let mapaSenadores = {};
    try {
        const lista = await listarSenadores({});
        for (const s of (lista.dados || [])) {
            mapaSenadores[String(s.id)] = { partido: s.partido, uf: s.uf };
        }
    } catch (e) { mapaSenadores = {}; }

    const perfilSenador = (cod) => `https://www25.senado.leg.br/web/senadores/senador/-/perfil/${encodeURIComponent(cod)}`;
    for (const r of registrosCeaps) {
        const valor = Number(r.valorReembolsado) || 0;
        if (!valor) continue;
        const chave = limparCnpj(r.cpfCnpj) || normalizarNome(r.fornecedor);
        if (!chave) continue;
        const info = mapaSenadores[String(r.codSenador)] || {};
        adicionar(chave, r.fornecedor, r.cpfCnpj, {
            cargo: 'Senador',
            cod: r.codSenador,
            nome: r.nomeSenador,
            partido: info.partido || '—',
            uf: info.uf || '—',
        }, {
            data: r.data || '',
            tipo: r.tipoDespesa || 'CEAPS',
            valor,
            url: perfilSenador(r.codSenador),
            documento: String(r.documento || ''),
        });
    }

    const empresas = Object.values(porFornecedor)
        .map((g) => ({
            fornecedor: g.fornecedor,
            cnpjCpf: g.cnpjCpf || '',
            total: Math.round(g.total * 100) / 100,
            numDespesas: g.numDespesas,
            parlamentares: Object.values(g.porParlamentar)
                .map((p) => ({
                    cargo: p.cargo,
                    nome: p.nome,
                    partido: p.partido,
                    uf: p.uf,
                    total: Math.round(p.total * 100) / 100,
                    qtd: p.qtd,
                    numComprovantes: p.qtd,
                    comprovantes: p.comprovantes,
                }))
                .sort((a, b) => b.total - a.total),
        }))
        .map((e) => ({ ...e, numParlamentares: e.parlamentares.length }))
        .filter((e) => e.numParlamentares >= 2)
        .sort((a, b) => b.numParlamentares - a.numParlamentares || b.total - a.total)
        .slice(0, LIMITE_EMPRESAS);

    const resultado = {
        ano: Number(ano),
        totalEmpresas: empresas.length,
        empresas,
        aviso: 'Empresas que receberam recursos de 2 ou mais parlamentares (Câmara e Senado), conforme dados públicos. ' +
               'Padrões neutros para investigação — os comprovantes remetem às fontes oficiais.',
    };
    await cache.gravar(chaveCache, resultado, 24 * 3600);
    return resultado;
}

module.exports = { listarEmpresasRecorrentes };
