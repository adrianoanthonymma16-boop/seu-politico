/* ==========================================================================
   theme.js — Tema claro/escuro do Seu Político
   --------------------------------------------------------------------------
   - Aplica o tema o mais cedo possível (evita "flash" de tema errado).
   - Persiste a escolha em localStorage e respeita prefers-color-scheme
     na primeira visita.
   - Injeta o botão de alternância no header e expõe SeuPoliticoTema.
   ========================================================================== */

(() => {
    'use strict';

    const CHAVE = 'seuPolitico-tema';

    function temaSalvo() {
        try { return localStorage.getItem(CHAVE); } catch (e) { return null; }
    }

    function sistemaPrefereEscuro() {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    function aplicar(tema) {
        const escuro = tema === 'escuro' || (tema === null && sistemaPrefereEscuro());
        document.documentElement.setAttribute('data-tema', escuro ? 'escuro' : 'claro');
        return escuro ? 'escuro' : 'claro';
    }

    function alternar() {
        const atual = document.documentElement.getAttribute('data-tema');
        const novo = atual === 'escuro' ? 'claro' : 'escuro';
        try { localStorage.setItem(CHAVE, novo); } catch (e) { /* armazenamento indisponível */ }
        aplicar(novo);
        atualizarIcone(novo);
        return novo;
    }

    function atualizarIcone(escuro) {
        const btn = document.getElementById('botaoTema');
        if (!btn) return;
        const icone = btn.querySelector('i');
        if (icone) {
            icone.className = escuro === 'escuro' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
        }
        btn.setAttribute('aria-label', escuro === 'escuro' ? 'Ativar tema claro' : 'Ativar tema escuro');
    }

    function criarBotao() {
        if (document.getElementById('botaoTema')) return;
        const alvo = document.querySelector('header section');
        if (!alvo) return;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'botaoTema';
        btn.className = 'botao-tema';
        btn.title = 'Alternar tema claro/escuro';
        btn.innerHTML = '<i class="fa-solid fa-moon" aria-hidden="true"></i>';
        btn.addEventListener('click', alternar);

        // Inserir ANTES do botão do menu (à esquerda do menu hambúrguer)
        const botaoMenu = document.getElementById('botaoMenu');

        if (botaoMenu) {
            alvo.insertBefore(btn, botaoMenu);
        } else {
            alvo.appendChild(btn);
        }

        const atual = document.documentElement.getAttribute('data-tema');
        atualizarIcone(atual);
    }

    // Aplica antes de tudo (no <head>, sem aguardar o DOM).
    aplicar(temaSalvo());

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', criarBotao);
    } else {
        criarBotao();
    }

    window.SeuPoliticoTema = { aplicar, alternar };
})();
