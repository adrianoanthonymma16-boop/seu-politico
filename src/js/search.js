/* ==========================================================================
   search.js — Busca contextual por página
   --------------------------------------------------------------------------
   Cada página chama SeuPoliticoBusca.init({...}) com a configuração da sua
   busca. Assim o header fica limpo (só logo + tema + menu) e a busca aparece
   no conteúdo, restrita ao contexto da página (deputados, senadores, etc.).

   Exemplo de uso (no final de cada página, antes do </body>):
     <script src="src/js/api.js"></script>
     <script src="src/js/search.js"></script>
     <script>
       SeuPoliticoBusca.init({
         alvo: '#buscaContextual',      // container onde montar a busca
         placeholder: 'Buscar deputado por nome...',
         destino: 'resultados.html',    // página para onde a busca leva
         filtros: ['partido', 'uf'],    // filtros opcionais a montar
       });
     </script>
   ========================================================================== */

window.SeuPoliticoBusca = (() => {
    'use strict';

    const UFs = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

    /* ---- Monta o HTML do formulário de busca contextual ---- */
    function montarForm(config) {
        const filtros = config.filtros || [];

        const opcoesPartidos = `
            <option value="">Todos os partidos</option>
            <option value="AVANTE">AVANTE</option>
            <option value="CIDADANIA">CIDADANIA</option>
            <option value="DC">DC</option>
            <option value="MDB">MDB</option>
            <option value="NOVO">NOVO</option>
            <option value="PCdoB">PCdoB</option>
            <option value="PCB">PCB</option>
            <option value="PDT">PDT</option>
            <option value="PL">PL</option>
            <option value="PMB">PMB</option>
            <option value="PMN">PMN</option>
            <option value="PODE">PODE</option>
            <option value="PP">PP</option>
            <option value="PRD">PRD</option>
            <option value="PRTB">PRTB</option>
            <option value="PSB">PSB</option>
            <option value="PSD">PSD</option>
            <option value="PSDB">PSDB</option>
            <option value="PSOL">PSOL</option>
            <option value="PSTU">PSTU</option>
            <option value="PT">PT</option>
            <option value="PV">PV</option>
            <option value="REPUBLICANOS">REPUBLICANOS</option>
            <option value="SOLIDARIEDADE">SOLIDARIEDADE</option>
            <option value="UNIÃO">UNIÃO</option>
            <option value="UP">UP</option>
        `;

        const opcoesUf = `<option value="">Todos os estados</option>${['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'].map((uf) => `<option value="${uf}">${uf}</option>`).join('')}`;

        let htmlFiltros = '';
        if (config.filtros && config.filtros.includes('partido')) {
            htmlFiltros += `
                <label class="visually-hidden" for="${config.id}-partido">Partido</label>
                <select id="${config.id}-partido" name="partido" aria-label="Filtrar por partido">${opcoesPartidos}</select>`;
        }
        if (config.filtros && config.filtros.includes('uf')) {
            htmlFiltros += `
                <label class="visually-hidden" for="${config.id}-uf">Estado</label>
                <select id="${config.id}-uf" name="uf" aria-label="Filtrar por estado">
                    <option value="">Todos os estados</option>
                    <option value="AC">AC</option><option value="AL">AL</option><option value="AP">AP</option><option value="AM">AM</option><option value="BA">BA</option><option value="CE">CE</option><option value="DF">DF</option><option value="ES">ES</option><option value="GO">GO</option><option value="MA">MA</option><option value="MT">MT</option><option value="MS">MS</option><option value="MG">MG</option><option value="PA">PA</option><option value="PB">PB</option><option value="PR">PR</option><option value="PE">PE</option><option value="PI">PI</option><option value="RJ">RJ</option><option value="RN">RN</option><option value="RS">RS</option><option value="RO">RO</option><option value="RR">RR</option><option value="SC">SC</option><option value="SP">SP</option><option value="SE">SE</option><option value="TO">TO</option>
                </select>`;
        }

        return `
            <form class="search-wrapper busca-contextual" id="${config.id}" action="${config.destino}" method="get">
                <label class="visually-hidden" for="${config.id}-nome">${config.placeholder}</label>
                <input type="text" id="${config.id}-nome" name="nome" placeholder="${config.placeholder}" autocomplete="off">
                <button type="submit" aria-label="Buscar">
                    <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                </button>
            </form>
            ${htmlFiltros ? `<div class="filtros-busca">${htmlFiltros}</div>` : ''}`;
    }

    function init(config) {
        const alvo = document.querySelector(config.alvo);
        if (!alvo) return;

        const id = config.id || 'buscaContextualForm';
        alvo.innerHTML = montarForm({ ...config, id });

        const form = alvo.querySelector(`#${config.id || 'buscaContextualForm'}`);
        if (!form) return;

        form.addEventListener('submit', (evento) => {
            evento.preventDefault();
            const nome = (form.querySelector('[name="nome"]')?.value || '').trim();
            const partido = form.querySelector('[name="partido"]')?.value || '';
            const uf = form.querySelector('[name="uf"]')?.value || '';

            const params = new URLSearchParams();
            if (nome) params.set('nome', nome);
            if (partido) params.set('partido', partido);
            if (uf) params.set('uf', uf);

            // Se a página define um filtro client-side, chama o callback (não navega).
            if (typeof config.aoBuscar === 'function') {
                config.aoBuscar(params);
                return;
            }

            const destino = config.destino || 'resultados.html';
            window.location.href = `${config.destino}?${params.toString()}`;
        });
    }

    return { init };
})();
