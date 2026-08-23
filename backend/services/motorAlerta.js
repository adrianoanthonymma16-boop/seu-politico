/* ==========================================================================
   motorAlerta.js — Motor de Suspeita (lado do servidor)
   --------------------------------------------------------------------------
   Calcula métricas e sinais neutros a partir de despesas normalizadas.
   Espelha as regras do frontend (src/js/alerts.js) para que os endpoints
   de análise respondam com dados prontos para os gráficos.
   ========================================================================== */

const fmtBRL = (valor) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);

const fmtNumero = (valor, casas = 0) =>
    new Intl.NumberFormat('pt-BR', { maximumFractionDigits: casas }).format(valor || 0);

const fmtMes = (mes) =>
    ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][mes - 1] || mes;

/* Valores abaixo deste piso não geram sinais (evita alertas "pífios"). */
const VALOR_MINIMO_SINAL = Number(process.env.VALOR_MINIMO_SINAL) || 5000;

function somar(arr) {
    return arr.reduce((acc, v) => acc + (Number(v) || 0), 0);
}

function agruparPor(despesas, chaveFn) {
    const grupos = {};
    for (const d of despesas) {
        const chave = chaveFn(d);
        if (chave === undefined || chave === null) continue;
        const c = String(chave);
        grupos[c] = (grupos[c] || 0) + (Number(d.valor) || 0);
    }
    return grupos;
}

function calcularResumo(despesas, contexto = {}) {
    const total = somar(despesas.map((d) => d.valor));
    const quantidade = despesas.length;
    const media = quantidade ? total / quantidade : 0;
    const maior = quantidade ? Math.max(...despesas.map((d) => Number(d.valor) || 0)) : 0;

    const porTipo = agruparPor(despesas, (d) => d.tipo);
    const categorias = Object.entries(porTipo)
        .map(([tipo, valor]) => ({ tipo, valor }))
        .sort((a, b) => b.valor - a.valor);

    const serieMensal = Array.from({ length: 12 }, (_, i) => {
        const mes = i + 1;
        return { mes, valor: somar(despesas.filter((d) => Number(d.mes) === mes).map((d) => d.valor)) };
    });

    const porFornecedor = agruparPor(despesas, (d) => d.fornecedor);
    const fornecedores = Object.entries(porFornecedor)
        .map(([fornecedor, valor]) => ({
            fornecedor,
            valor,
            percentual: total > 0 ? (valor / total) * 100 : 0,
        }))
        .sort((a, b) => b.valor - a.valor);

    return { total, media, quantidade, maior, categorias, serieMensal, fornecedores };
}

function gerarSinais(despesas, resumo, contexto = {}) {
    const sinais = [];
    if (!despesas.length) return sinais;

    const { total, categorias, fornecedores, serieMensal } = resumo;
    const nome = contexto.nomePolitico || 'Este parlamentar';

    /* 1. Gasto acima da média (referência por UF/cargo). */
    const categoriaPrincipal = categorias.length ? categorias[0] : null;
    if (categoriaPrincipal && contexto.mediaUf > 0 && total > contexto.mediaUf * 1.5) {
        const razao = Math.round((total / contexto.mediaUf) * 10) / 10;
        sinais.push({
            nivel: 'alerta',
            icone: '⚠️',
            titulo: 'Gasto acima da média — vale a pena olhar',
            texto: `O total gasto é ${fmtNumero(razao, 1)}x maior que a média dos deputados do mesmo estado (${fmtBRL(contexto.mediaUf)}). Os dados estão aqui — o que você acha disso?`,
        });
    }

    if (categoriaPrincipal && total > 0) {
        const participacao = (categoriaPrincipal.valor / total) * 100;
        if (participacao > 60) {
            sinais.push({
                nivel: 'info',
                icone: '💡',
                titulo: 'Categoria dominante nos gastos',
                texto: `${fmtNumero(participacao, 0)}% dos recursos estão concentrados em "${categoriaPrincipal.tipo}" (${fmtBRL(categoriaPrincipal.valor)} de ${fmtBRL(total)}). Vale a pena investigar?`,
            });
        }
    }

    /* 2. Fornecedor recorrente. */
    if (fornecedores.length && fornecedores[0].valor >= VALOR_MINIMO_SINAL) {
        const [top] = fornecedores;
        if (top.percentual > 70) {
            sinais.push({
                nivel: 'info',
                icone: '💡',
                titulo: 'Concentração em um fornecedor',
                texto: `"${top.fornecedor}" recebeu ${fmtNumero(top.percentual, 0)}% dos recursos analisados (${fmtBRL(top.valor)}). A maior parte dos recursos foi para um único fornecedor.`,
            });
        } else if (top.percentual > 40) {
            sinais.push({
                nivel: 'comparacao',
                icone: '📊',
                titulo: 'Fornecedor com participação relevante',
                texto: `"${top.fornecedor}" concentrou ${fmtNumero(top.percentual, 0)}% dos recursos. É apenas contexto, mas vale observar.`,
            });
        }
    }

    /* 3. Serviço caro (acima de 3x a média do mesmo tipo). */
    const mediasPorTipo = {};
    for (const [tipo, valor] of Object.entries(agruparPor(despesas, (d) => d.tipo))) {
        const itens = despesas.filter((d) => String(d.tipo) === tipo);
        mediasPorTipo[tipo] = valor / itens.length;
    }
    for (const d of despesas) {
        const mediaTipo = mediasPorTipo[d.tipo] || 0;
        if (mediaTipo > 0
            && (Number(d.valor) || 0) >= VALOR_MINIMO_SINAL
            && (Number(d.valor) || 0) > mediaTipo * 3) {
            sinais.push({
                nivel: 'alerta',
                icone: '🟡',
                titulo: 'Despesa bem acima da média do mesmo tipo',
                texto: `Uma despesa em "${d.tipo}" foi de ${fmtBRL(d.valor)} em ${fmtMes(d.mes)}, enquanto a média desse tipo é ${fmtBRL(mediaTipo)}. Comparação neutra — os dados estão públicos.`,
            });
            break;
        }
    }

    /* 4. Padrão incomum (salto em categoria específica). */
    const porTipoMensal = {};
    for (const d of despesas) {
        if (!porTipoMensal[d.tipo]) porTipoMensal[d.tipo] = {};
        porTipoMensal[d.tipo][d.mes] = (porTipoMensal[d.tipo][d.mes] || 0) + (Number(d.valor) || 0);
    }

    let saltosPadrao = 0;
    for (const [tipo, meses] of Object.entries(porTipoMensal)) {
        if (saltosPadrao >= 3) break;
        const lista = Object.entries(meses)
            .map(([m, v]) => [Number(m), v])
            .sort((a, b) => a[0] - b[0]);
        for (let i = 1; i < lista.length; i++) {
            const anterior = lista[i - 1][1];
            const atual = lista[i][1];
            if (anterior > 0 && atual > anterior * 3 && atual >= VALOR_MINIMO_SINAL) {
                const aumento = Math.round((atual / anterior - 1) * 100);
                sinais.push({
                    nivel: 'comparacao',
                    icone: '📈',
                    titulo: 'Padrão incomum de gastos',
                    texto: `Os gastos com "${tipo}" aumentaram ${fmtNumero(aumento, 0)}% entre ${fmtMes(lista[i - 1][0])} e ${fmtMes(lista[i][0])} (de ${fmtBRL(anterior)} para ${fmtBRL(atual)}). O que você acha disso?`,
                });
                saltosPadrao++;
                break;
            }
        }
    }

    /* 5. Variação atípica (total, mês a mês). */
    const mesesComDados = serieMensal.filter((s) => s.valor > 0);
    if (mesesComDados.length >= 2) {
        const ultimo = mesesComDados[mesesComDados.length - 1];
        const anterior = mesesComDados[mesesComDados.length - 2];
        if (anterior.valor > 0 && ultimo.valor > anterior.valor * 2 && ultimo.valor >= VALOR_MINIMO_SINAL) {
            const aumento = Math.round((ultimo.valor / anterior.valor - 1) * 100);
            sinais.push({
                nivel: 'alerta',
                icone: '📊',
                titulo: 'Variação atípica entre meses',
                texto: `O gasto subiu ${fmtNumero(aumento, 0)}% em um mês (de ${fmtBRL(anterior.valor)} em ${fmtMes(anterior.mes)} para ${fmtBRL(ultimo.valor)} em ${fmtMes(ultimo.mes)}). Sem explicação aparente — apenas os dados.`,
            });
        }
    }

    /* 6. Maior despesa registrada (valor relevante, apenas contexto). */
    if (resumo.maior >= VALOR_MINIMO_SINAL) {
        const maiorDespesa = despesas.reduce((a, b) =>
            ((Number(b.valor) || 0) > (Number(a.valor) || 0) ? b : a), despesas[0]);
        const receptor = maiorDespesa.fornecedor || maiorDespesa.beneficiario || 'fornecedor não informado';
        sinais.push({
            nivel: 'info',
            icone: '💰',
            titulo: 'Maior despesa registrada',
            texto: `A maior despesa do período foi de ${fmtBRL(maiorDespesa.valor)} em "${maiorDespesa.tipo}" (${receptor}). Apenas dados públicos — o que você acha disso?`,
        });
    }

    sinais.push({
        nivel: 'comparacao',
        icone: '🔍',
        titulo: 'Lembrete de transparência',
        texto: `Estes são apenas padrões observados em dados públicos — não são acusações. Compartilhe se achar importante e aprenda a fiscalizar.`,
    });

    return sinais;
}

module.exports = { calcularResumo, gerarSinais };
