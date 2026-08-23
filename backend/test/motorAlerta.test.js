/* ==========================================================================
   test/motorAlerta.test.js — Testes unitários do motor de suspeita
   --------------------------------------------------------------------------
   O motor é o coração da credibilidade: se uma regra calcular errado, o site
   pode "acusar" injustamente — o que vai contra o compromisso do projeto.
   Estes testes garantem o comportamento das regras (com o piso de R$ 5.000).
   ========================================================================== */

// Garante piso determinístico (5.000) antes de carregar o módulo.
process.env.VALOR_MINIMO_SINAL = '5000';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { calcularResumo, gerarSinais, gerarSinaisComparacao } = require('../services/motorAlerta');

const despesa = (overrides = {}) => ({
    ano: 2025, mes: 1, tipo: 'Passagens aéreas', data: '2025-01-05',
    valor: 1000, fornecedor: 'Aérea Nacional', ...overrides,
});

const titulos = (sinais) => sinais.map((s) => s.titulo);
const tem = (sinais, titulo) => sinais.some((s) => s.titulo === titulo);

/* ======================================================================
   calcularResumo
   ====================================================================== */
test('calcularResumo: total, media, maior e quantidade', () => {
    const r = calcularResumo([
        despesa({ valor: 1000 }),
        despesa({ valor: 2000, mes: 2 }),
        despesa({ valor: 3000, mes: 3 }),
    ]);
    assert.equal(r.total, 6000);
    assert.equal(r.media, 2000);
    assert.equal(r.maior, 3000);
    assert.equal(r.quantidade, 3);
});

test('calcularResumo: categorias ordenadas por valor', () => {
    const r = calcularResumo([
        despesa({ valor: 1000, tipo: 'A' }),
        despesa({ valor: 5000, tipo: 'B' }),
        despesa({ valor: 2000, tipo: 'A' }),
    ]);
    assert.deepEqual(r.categorias, [
        { tipo: 'B', valor: 5000 },
        { tipo: 'A', valor: 3000 },
    ]);
});

test('calcularResumo: fornecedores com percentual e série mensal de 12', () => {
    const r = calcularResumo([despesa({ valor: 3000, fornecedor: 'X' }), despesa({ valor: 1000, fornecedor: 'Y' })]);
    assert.equal(r.fornecedores[0].fornecedor, 'X');
    assert.equal(r.fornecedores[0].percentual, 75);
    assert.equal(r.serieMensal.length, 12);
});

/* ======================================================================
   gerarSinais — regras
   ====================================================================== */
test('gerarSinais: sempre há o lembrete de transparência', () => {
    const r = calcularResumo([despesa({ valor: 1000 })]);
    const sinais = gerarSinais([despesa({ valor: 1000 })], r, { nomePolitico: 'X' });
    assert.ok(tem(sinais, 'Lembrete de transparência'));
});

test('fornecedor >70% e valor ≥ piso gera "Concentração em um fornecedor"', () => {
    const lista = [despesa({ valor: 40000, fornecedor: 'X' }), despesa({ valor: 4000, fornecedor: 'Y' })];
    const r = calcularResumo(lista);
    const sinais = gerarSinais(lista, r, {});
    assert.ok(tem(sinais, 'Concentração em um fornecedor'));
});

test('fornecedor concentrado mas valor abaixo do piso NÃO gera sinal', () => {
    const lista = [despesa({ valor: 800, fornecedor: 'X' }), despesa({ valor: 200, fornecedor: 'Y' })];
    const r = calcularResumo(lista);
    const sinais = gerarSinais(lista, r, {});
    assert.ok(!tem(sinais, 'Concentração em um fornecedor'));
    assert.ok(!tem(sinais, 'Categoria dominante nos gastos'));
});

test('fornecedor 40–70% gera "Fornecedor com participação relevante"', () => {
    const lista = [
        despesa({ valor: 6000, fornecedor: 'X' }),
        despesa({ valor: 3000, fornecedor: 'Y' }),
        despesa({ valor: 3000, fornecedor: 'Z' }),
    ]; // X = 50%
    const r = calcularResumo(lista);
    const sinais = gerarSinais(lista, r, {});
    assert.ok(tem(sinais, 'Fornecedor com participação relevante'));
});

test('serviço caro (>3x média do tipo e ≥ piso) gera alerta', () => {
    const lista = [
        despesa({ valor: 1000, tipo: 'Consultoria' }),
        despesa({ valor: 1000, tipo: 'Consultoria' }),
        despesa({ valor: 1000, tipo: 'Consultoria' }),
        despesa({ valor: 20000, tipo: 'Consultoria' }),
    ];
    const r = calcularResumo(lista);
    const sinais = gerarSinais(lista, r, {});
    assert.ok(tem(sinais, 'Despesa bem acima da média do mesmo tipo'));
});

test('serviço caro mas abaixo do piso NÃO gera alerta', () => {
    const lista = [
        despesa({ valor: 100, tipo: 'Consultoria' }),
        despesa({ valor: 100, tipo: 'Consultoria' }),
        despesa({ valor: 100, tipo: 'Consultoria' }),
        despesa({ valor: 901, tipo: 'Consultoria' }),
    ]; // 901 > 3x média (~300), mas < piso
    const r = calcularResumo(lista);
    const sinais = gerarSinais(lista, r, {});
    assert.ok(!tem(sinais, 'Despesa bem acima da média do mesmo tipo'));
});

test('variação atípica (>2x mês anterior e ≥ piso) gera alerta', () => {
    const lista = [despesa({ valor: 6000, mes: 1 }), despesa({ valor: 14000, mes: 2 })];
    const r = calcularResumo(lista);
    const sinais = gerarSinais(lista, r, {});
    assert.ok(tem(sinais, 'Variação atípica entre meses'));
});

test('padrão incomum (salto >3x em categoria e ≥ piso) gera comparação', () => {
    const lista = [
        despesa({ valor: 1000, mes: 1, tipo: 'Combustíveis' }),
        despesa({ valor: 1000, mes: 2, tipo: 'Combustíveis' }),
        despesa({ valor: 7000, mes: 3, tipo: 'Combustíveis' }),
    ];
    const r = calcularResumo(lista);
    const sinais = gerarSinais(lista, r, {});
    assert.ok(tem(sinais, 'Padrão incomum de gastos'));
});

test('maior despesa ≥ piso gera "Maior despesa registrada"', () => {
    const lista = [despesa({ valor: 12000, fornecedor: 'X' }), despesa({ valor: 300, fornecedor: 'Y' })];
    const r = calcularResumo(lista);
    const sinais = gerarSinais(lista, r, {});
    assert.ok(tem(sinais, 'Maior despesa registrada'));
});

test('gasto acima da média da UF gera alerta', () => {
    const lista = [despesa({ valor: 9000 }), despesa({ valor: 9000 })];
    const r = calcularResumo(lista);
    const sinais = gerarSinais(lista, r, { nomePolitico: 'X', mediaUf: 10000 }); // total 18000 > 1.5x
    assert.ok(tem(sinais, 'Gasto acima da média — vale a pena olhar'));
});

/* ======================================================================
   gerarSinaisComparacao
   ====================================================================== */
test('comparação com razão >1.5 gera sinal', () => {
    const sinais = gerarSinaisComparacao([
        { nome: 'A', total: 30000 },
        { nome: 'B', total: 10000 },
    ]);
    assert.ok(tem(sinais, 'Diferença de volume de gastos'));
});

test('comparação com razão ≤1.5 não gera sinal', () => {
    const sinais = gerarSinaisComparacao([
        { nome: 'A', total: 10000 },
        { nome: 'B', total: 9000 },
    ]);
    assert.equal(sinais.length, 0);
});
