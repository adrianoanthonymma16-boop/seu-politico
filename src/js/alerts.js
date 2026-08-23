/* ==========================================================================
   alerts.js — Formatação e utilitários de exibição do Seu Político
   --------------------------------------------------------------------------
   O motor de suspeita (regras que apontam padrões de gastos) vive ÚNICAMENTE
   no backend (`backend/services/motorAlerta.js`). O frontend apenas renderiza
   os sinais que a API já entrega — aqui ficam só os formatadores de valor,
   número e mês usados na interface.
   ========================================================================== */

const MotorAlerta = (() => {
    'use strict';

    const fmtBRL = (valor) =>
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);

    const fmtNumero = (valor, casas = 0) =>
        new Intl.NumberFormat('pt-BR', { maximumFractionDigits: casas }).format(valor || 0);

    const fmtMes = (mes) =>
        ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][mes - 1] || mes;

    return {
        fmtBRL,
        fmtNumero,
        fmtMes,
    };
})();
