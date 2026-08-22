/* ==========================================================================
   alerts.js — Motor de Suspeita do Seu Político
   --------------------------------------------------------------------------
   Identifica PADRÕES em dados públicos de forma NEUTRA, sem acusar ninguém.
   Cada sinal gera um objeto:
     { nivel: 'alerta' | 'info' | 'comparacao',
       icone, titulo, texto }

   Regras implementadas:
     1. Gasto acima da média (comparação com a média da UF / do cargo)
     2. Fornecedor recorrente (concentração de recursos em um fornecedor)
     3. Serviço caro (comparação com a média do mesmo tipo de despesa)
     4. Padrão incomum (evolução no tempo)
     5. Variação atípica (aumento/queda brusca entre meses)
   ========================================================================== */

const MotorAlerta = (() => {
    /* ---- Formatação ---- */
    const fmtBRL = (valor) =>
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);

    const fmtNumero = (valor, casas = 0) =>
        new Intl.NumberFormat('pt-BR', { maximumFractionDigits: casas }).format(valor || 0);

    const fmtMes = (mes) =>
        ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][mes - 1] || mes;

    /* ---- Utilidades estatísticas ---- */
    const somar = (arr) => arr.reduce((acc, v) => acc + (Number(v) || 0), 0);

    const media = (arr) => (arr.length ? somar(arr) / arr.length : 0);

    const percentual = (parte, total) => (total > 0 ? (parte / total) * 100 : 0);

    const arredondar = (v, casas = 2) => Math.round(v * 10 ** casas) / 10 ** casas;

    /**
     * Agrupa despesas por chave e soma os valores.
     * @param {Array} despesas
     * @param {Function} chaveFn
     * @returns {Object} { chave: valorTotal }
     */
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

    /**
     * Totais mensais: { 1: x, 2: y, ... }
     */
    function totaisMensais(despesas) {
        return agruparPor(despesas, (d) => d.mes);
    }

    /**
     * Recebe despesas normalizadas e um contexto de referência.
     * @param {Array} despesas   [{ano, mes, tipo, data, valor, fornecedor, cnpjCpf, documento}]
     * @param {Object} [contexto] { mediaUf, mediaGeral, nomePolitico }
     * @returns {Array} sinais
     */
    function analisar(despesas, contexto = {}) {
        const sinais = [];
        if (!Array.isArray(despesas) || despesas.length === 0) {
            return sinais;
        }

        const totalGeral = somar(despesas.map((d) => d.valor));
        const nome = contexto.nomePolitico || 'Este parlamentar';

        /* ---- 1. GASTO ACIMA DA MÉDIA ---- */
        const porTipo = agruparPor(despesas, (d) => d.tipo);
        const tipos = Object.entries(porTipo).sort((a, b) => b[1] - a[1]);

        if (tipos.length) {
            const [tipoPrincipal, valorTipo] = tipos[0];
            const participacao = percentual(valorTipo, totalGeral);

            // Comparação com a média de referência (por UF/cargo), se disponível.
            if (contexto.mediaUf && contexto.mediaUf > 0 && participacao > 40) {
                const razao = arredondar(totalGeral / contexto.mediaUf, 1);
                if (razao > 1.5) {
                    sinais.push({
                        nivel: 'alerta',
                        icone: '⚠️',
                        titulo: 'Gasto acima da média — vale a pena olhar',
                        texto: `O total gasto com "${tipoPrincipal}" é ${fmtNumero(razao, 1)}x maior que a média dos deputados do mesmo estado. Os dados estão aqui — o que você acha disso?`,
                    });
                }
            }

            // Categoria dominante na própria despesa.
            if (participacao > 60) {
                sinais.push({
                    nivel: 'info',
                    icone: '💡',
                    titulo: 'Categoria dominante nos gastos',
                    texto: `${fmtNumero(participacao, 0)}% dos recursos estão concentrados em "${tipoPrincipal}" (${fmtBRL(valorTipo)} de ${fmtBRL(totalGeral)}). Vale a pena investigar?`,
                });
            }
        }

        /* ---- 2. FORNECEDOR RECORRENTE ---- */
        const porFornecedor = agruparPor(despesas, (d) => d.fornecedor);
        const fornecedores = Object.entries(porFornecedor).sort((a, b) => b[1] - a[1]);

        if (fornecedores.length) {
            const [fornecedorTop, valorTop] = fornecedores[0];
            const pctFornecedor = percentual(valorTop, totalGeral);
            if (pctFornecedor > 70) {
                sinais.push({
                    nivel: 'info',
                    icone: '💡',
                    titulo: 'Concentração em um fornecedor',
                    texto: `"${fornecedorTop}" recebeu ${fmtNumero(pctFornecedor, 0)}% dos recursos analisados (${fmtBRL(valorTop)}). A maior parte dos recursos foi para um único fornecedor.`,
                });
            } else if (pctFornecedor > 40 && pctFornecedor <= 70) {
                sinais.push({
                    nivel: 'comparacao',
                    icone: '📊',
                    titulo: 'Fornecedor com participação relevante',
                    texto: `"${fornecedorTop}" concentrou ${fmtNumero(pctFornecedor, 0)}% dos recursos. É apenas contexto, mas vale observar.`,
                });
            }
        }

        /* ---- 3. SERVIÇO CARO (comparação com a média do mesmo tipo) ---- */
        const mediasPorTipo = {};
        for (const [tipo, valor] of Object.entries(porTipo)) {
            const itens = despesas.filter((d) => String(d.tipo) === tipo);
            mediasPorTipo[tipo] = valor / itens.length;
        }

        for (const d of despesas) {
            const mediaTipo = mediasPorTipo[d.tipo] || 0;
            if (mediaTipo > 0 && (Number(d.valor) || 0) > mediaTipo * 3) {
                sinais.push({
                    nivel: 'alerta',
                    icone: '🟡',
                    titulo: 'Despesa bem acima da média do mesmo tipo',
                    texto: `Uma despesa em "${d.tipo}" foi de ${fmtBRL(d.valor)} em ${fmtMes(d.mes)}, enquanto a média desse tipo de serviço é ${fmtBRL(mediaTipo)}. Comparação neutra — os dados estão públicos.`,
                });
                break;
            }
        }

        /* ---- 4. PADRÃO INCOMUM (evolução no tempo) ---- */
        const mensal = totaisMensais(despesas);
        const mesesOrdenados = Object.keys(mensal)
            .map(Number)
            .sort((a, b) => a - b);

        // Série mensal por tipo, para detectar saltos em categorias específicas.
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
                if (anterior > 0 && atual > anterior * 3) {
                    const aumento = arredondar((atual / anterior - 1) * 100, 0);
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

        /* ---- 5. VARIAÇÃO ATÍPICA (mês a mês, total) ---- */
        if (mesesOrdenados.length >= 2) {
            const ultimoMes = mesesOrdenados[mesesOrdenados.length - 1];
            const mesAnterior = mesesOrdenados[mesesOrdenados.length - 2];
            const atual = mensal[ultimoMes];
            const anterior = mensal[mesAnterior];
            if (anterior > 0 && atual > anterior * 2) {
                const aumento = arredondar((atual / anterior - 1) * 100, 0);
                sinais.push({
                    nivel: 'alerta',
                    icone: '📊',
                    titulo: 'Variação atípica entre meses',
                    texto: `O gasto subiu ${fmtNumero(aumento, 0)}% em um mês (de ${fmtBRL(anterior)} em ${fmtMes(mesAnterior)} para ${fmtBRL(atual)} em ${fmtMes(ultimoMes)}). Sem explicação aparente — apenas os dados.`,
                });
            }
        }

        /* ---- SINAL EDUCATIVO DE FECHAMENTO (sempre presente) ---- */
        sinais.push({
            nivel: 'comparacao',
            icone: '🔍',
            titulo: 'Lembrete de transparência',
            texto: `Estes são apenas padrões observados em dados públicos — não são acusações. Compartilhe se achar importante e aprenda a fiscalizar.`,
        });

        return sinais;
    }

    /**
     * Constrói um resumo comparativo entre dois políticos.
     * @param {Array} resumoDeputados  [{nome, total, media, categorias}]
     * @returns {Array} sinais comparativos
     */
    function comparar(resumoDeputados) {
        const sinais = [];
        if (!Array.isArray(resumoDeputados) || resumoDeputados.length < 2) return sinais;

        const validos = resumoDeputados.filter((d) => d && d.total !== undefined);
        if (validos.length < 2) return sinais;

        const [a, b] = validos;
        if (a.total > 0 && b.total > 0) {
            const maior = a.total >= b.total ? a : b;
            const menor = maior === a ? b : a;
            const razao = arredondar(maior.total / menor.total, 1);
            if (razao > 1.5) {
                sinais.push({
                    nivel: 'comparacao',
                    icone: '📊',
                    titulo: 'Diferença de volume de gastos',
                    texto: `${maior.nome} gastou ${fmtNumero(razao, 1)}x mais que ${menor.nome} no período (${fmtBRL(maior.total)} contra ${fmtBRL(menor.total)}). Comparação neutra.`,
                });
            }
        }
        return sinais;
    }

    return {
        analisar,
        comparar,
        fmtBRL,
        fmtNumero,
        fmtMes,
    };
})();
