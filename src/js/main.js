/* ==========================================================================
   main.js — Lógica de interface do Seu Político
   --------------------------------------------------------------------------
   - Menu lateral responsivo e busca
   - Página inicial (indicadores, destaques, gráfico)
   - Resultados de busca
   - Dashboard
   - Perfil do parlamentar
   - Comparação entre parlamentares
   ========================================================================== */

(() => {
    'use strict';

    /* ---- UTILITÁRIOS ---- */
    const $ = (seletor, raiz = document) => raiz.querySelector(seletor);
    const $$ = (seletor, raiz = document) => Array.from(raiz.querySelectorAll(seletor));

    function lerParametro(nome) {
        return new URLSearchParams(window.location.search).get(nome) || '';
    }

    const escaparHtml = (texto) =>
        String(texto ?? '').replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[c]));

    const UFs = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

    /* ---- REGISTRO DE GRÁFICOS (Chart.js) ---- */
    const graficos = {};

    /* ---- Estado das tabelas de despesas (para os filtros) ---- */
    let perfilDespesas = [];
    let senadorDespesas = [];
    let senadorAtualId = null;
    let presidenteViagens = [];
    function criarOuAtualizar(id, config) {
        // Proteção: se a biblioteca de gráficos não carregou, nunca derruba a página.
        if (typeof Chart === 'undefined') {
            console.warn(`Chart.js não carregado — gráfico "${id}" ignorado.`);
            marcarGraficoIndisponivel(id);
            return;
        }
        try {
            if (graficos[id]) graficos[id].destroy();
            const canvas = document.getElementById(id);
            if (!canvas) return;
            graficos[id] = new Chart(canvas.getContext('2d'), config);
        } catch (erro) {
            console.warn(`Falha ao renderizar gráfico "${id}":`, erro.message);
            marcarGraficoIndisponivel(id);
        }
    }

    // Substitui o canvas por um aviso amigável quando o gráfico não renderiza.
    function marcarGraficoIndisponivel(id) {
        const canvas = document.getElementById(id);
        if (!canvas) return;
        const caixa = canvas.closest('.chart-box');
        if (caixa) {
            caixa.innerHTML = `
                <div class="estado-vazio">
                    <i class="fa-solid fa-chart-column" aria-hidden="true"></i>
                    <p>Gráfico indisponível no momento.</p>
                </div>`;
        }
    }

    const coresPaleta = ['#007bff', '#5bc0de', '#5cb85c', '#f0ad4e', '#d9534f', '#8e6bbf', '#5f9ea0', '#d9a460', '#7d8ea3', '#b8860b'];

    /* ---- RENDERIZADORES DE SINAIS (motor de suspeita) ---- */
    function renderizarSinais(container, sinais) {
        if (!container) return;
        if (!Array.isArray(sinais) || sinais.length === 0) {
            container.innerHTML = `
                <div class="estado-vazio">
                    <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
                    <p>Nenhum padrão digno de nota encontrado no período analisado.</p>
                </div>`;
            return;
        }
        container.innerHTML = sinais.map((s) => `
            <div class="sinal sinal-${s.nivel}" role="status">
                <span class="sinal-icone" aria-hidden="true">${s.icone}</span>
                <div>
                    <div class="sinal-titulo">${escaparHtml(s.titulo)}</div>
                    <p class="sinal-texto">${escaparHtml(s.texto)}</p>
                </div>
            </div>`).join('');
    }

    function renderizarEstadosVazio(container, classe = 'estado-vazio', icone = 'fa-file-circle-question', texto = 'Nenhum dado disponível.') {
        if (container) {
            container.innerHTML = `
                <div class="${classe}">
                    <i class="fa-solid ${icone}" aria-hidden="true"></i>
                    <p>${texto}</p>
                </div>`;
        }
    }

    /* ---- FILTROS DE TABELA (gastos por tipo, mês e fornecedor) ---- */
    function popularTiposFiltro(select, itens, campoTipo = 'tipo') {
        if (!select) return;
        const tipos = [...new Set(itens.map((d) => d[campoTipo]).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, 'pt-BR'));
        select.innerHTML = '<option value="">Todos os tipos</option>' +
            tipos.map((t) => `<option value="${escaparHtml(t)}">${escaparHtml(t)}</option>`).join('');
    }

    function filtrarDespesas(despesas, { tipo, mes, busca, campoBusca = 'fornecedor' }) {
        return despesas.filter((d) => {
            if (tipo && d.tipo !== tipo) return false;
            if (mes && String(d.mes) !== String(mes)) return false;
            if (busca && !String(d[campoBusca] || '').toLowerCase().includes(busca)) return false;
            return true;
        });
    }

    // Liga os controles de filtro a um renderizador de tabela.
    function ligarFiltrosTabela(prefixo, renderer, campoBuscaId) {
        ['filtroTipo', 'filtroMes'].forEach((base) => {
            const el = $(`#${base}${prefixo}`);
            if (el) el.addEventListener('change', renderer);
        });
        const busca = $(campoBuscaId || `#filtroFornecedor${prefixo}`);
        if (busca) busca.addEventListener('input', renderer);
        const limpar = $(`#botaoLimparFiltros${prefixo}`);
        if (limpar) {
            limpar.addEventListener('click', () => {
                ['filtroTipo', 'filtroMes'].forEach((base) => {
                    const el = $(`#${base}${prefixo}`);
                    if (el) el.value = '';
                });
                const b = $(campoBuscaId || `#filtroFornecedor${prefixo}`);
                if (b) b.value = '';
                renderer();
            });
        }
    }

    function linhaDespesa(dsp) {
        return `
            <tr>
                <td>${escaparHtml(dsp.data || '—')}</td>
                <td>${MotorAlerta.fmtMes(dsp.mes)}/${dsp.ano}</td>
                <td>${escaparHtml(dsp.tipo || '—')}</td>
                <td>${escaparHtml(dsp.fornecedor || '—')}</td>
                <td>${MotorAlerta.fmtBRL(dsp.valor)}</td>
                <td>
                    ${dsp.url
                        ? `<a href="${escaparHtml(dsp.url)}" target="_blank" rel="noopener" title="Abrir comprovante no portal da Câmara">
                             <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> Comprovante
                           </a>`
                        : '<span class="texto-muted">—</span>'}
                </td>
            </tr>`;
    }

    /* ---- NOTIFICAÇÃO (toast) ---- */
    function notificar(mensagem, icone = 'fa-circle-info') {
        const el = document.createElement('div');
        el.className = 'notificacao';
        el.innerHTML = `<i class="fa-solid ${icone}" aria-hidden="true"></i><span>${escaparHtml(mensagem)}</span>`;
        document.body.appendChild(el);
        requestAnimationFrame(() => el.classList.add('visivel'));
        setTimeout(() => {
            el.classList.remove('visivel');
            setTimeout(() => el.remove(), 350);
        }, 4500);
    }

    /* ---- INICIALIZAÇÃO COMUM (menu + busca) ---- */
    function iniciarMenuResponsivo() {
        const botao = $('#botaoMenu');
        const menu = $('#menuLateral');
        if (!botao || !menu) return;
        botao.addEventListener('click', () => {
            const aberto = menu.classList.toggle('aberto');
            botao.setAttribute('aria-expanded', String(aberto));
            botao.setAttribute('aria-label', aberto ? 'Fechar menu de navegação' : 'Abrir menu de navegação');
        });
    }

    function iniciarBusca() {
        const form = $('#formBusca');
        if (!form) return;
        form.addEventListener('submit', (evento) => {
            evento.preventDefault();
            const nome = ($('#campoBusca')?.value || '').trim();
            const partido = $('#filtroPartido')?.value || '';
            const uf = $('#filtroUf')?.value || '';
            const params = new URLSearchParams();
            if (nome) params.set('nome', nome);
            if (partido) params.set('partido', partido);
            if (uf) params.set('uf', uf);
            window.location.href = `resultados.html?${params.toString()}`;
        });

        const formSenado = $('#formBuscaSenado');
        if (formSenado) {
            formSenado.addEventListener('submit', (evento) => {
                evento.preventDefault();
                const nome = ($('#campoBuscaSenado')?.value || '').trim();
                const partido = $('#filtroPartidoSenado')?.value || '';
                const uf = $('#filtroUfSenado')?.value || '';
                const params = new URLSearchParams();
                if (nome) params.set('nome', nome);
                if (partido) params.set('partido', partido);
                if (uf) params.set('uf', uf);
                window.location.href = `senadores.html?${params.toString()}`;
            });
        }
    }

    async function popularFiltros() {
        const selPartido = $('#filtroPartido');
        const selUf = $('#filtroUf');
        const selPartidoSen = $('#filtroPartidoSenado');
        const selUfSen = $('#filtroUfSenado');
        if (!selPartido && !selUf && !selPartidoSen && !selUfSen) return;

        if (selUf || selUfSen) {
            UFs.forEach((uf) => {
                if (selUf) {
                    const opt = document.createElement('option');
                    opt.value = uf;
                    opt.textContent = uf;
                    selUf.appendChild(opt);
                }
                if (selUfSen) {
                    const opt2 = document.createElement('option');
                    opt2.value = uf;
                    opt2.textContent = uf;
                    selUfSen.appendChild(opt2);
                }
            });
        }

        if (selPartido) {
            try {
                const { dados } = await SeuPoliticoAPI.obterPartidos();
                (dados || []).slice().sort((a, b) => a.sigla.localeCompare(b.sigla)).forEach((p) => {
                    const opt = document.createElement('option');
                    opt.value = p.sigla;
                    opt.textContent = p.sigla;
                    selPartido.appendChild(opt);
                });
            } catch (erro) {
                notificar(erro.message, 'fa-triangle-exclamation');
            }
        }

        if (selPartidoSen) {
            try {
                const { dados } = await SeuPoliticoAPI.buscarSenadores({});
                const partidos = [...new Set((dados || []).map((s) => s.partido).filter(Boolean))].sort();
                partidos.forEach((sigla) => {
                    const opt = document.createElement('option');
                    opt.value = sigla;
                    opt.textContent = sigla;
                    selPartidoSen.appendChild(opt);
                });
            } catch (erro) {
                notificar(erro.message, 'fa-triangle-exclamation');
            }
        }
    }

    /* ======================================================================
       PÁGINA INICIAL
       ====================================================================== */
    async function carregarHome() {
        const anoAtual = new Date().getFullYear();
        try {
            const dados = await SeuPoliticoAPI.analiseGeral(anoAtual);

            const set = (id, valor) => { const el = $(id); if (el) el.textContent = valor; };
            set('#totalDeputados', dados.totalDeputados ?? '—');
            set('#totalPartidos', dados.totalPartidos ?? '—');
            set('#totalAlertas', dados.totalAlertas ?? '—');

            const containerDestaques = $('#destaques');
            if (containerDestaques) {
                const destaques = dados.destaques || [];
                if (destaques.length) {
                    containerDestaques.innerHTML = destaques.slice(0, 6).map((d) => `
                        <div class="card destaque">
                            <div class="destaque-icone" aria-hidden="true">${d.icone || '🔍'}</div>
                            <div>
                                <h3>${escaparHtml(d.titulo)}</h3>
                                <p>${escaparHtml(d.texto)}</p>
                                <div class="destaque-tags">
                                    <span class="badge badge-uf">Dados públicos</span>
                                    <span class="badge badge-cargo">Neutro</span>
                                </div>
                            </div>
                        </div>`).join('');
                } else {
                    renderizarEstadosVazio(containerDestaques, 'estado-vazio', 'fa-triangle-exclamation', 'Nenhum destaque no momento.');
                }
            }

            // Gráfico de gastos por categoria.
            const categorias = (dados.categorias || []).slice(0, 8);
            const containerGrafico = $('#graficoHomeContainer');
            if (containerGrafico && categorias.length) {
                criarOuAtualizar('graficoHome', {
                    type: 'pie',
                    data: {
                        labels: categorias.map((c) => c.tipo),
                        datasets: [{
                            data: categorias.map((c) => c.valor),
                            backgroundColor: coresPaleta,
                        }],
                    },
                    options: {
                        responsive: true,
                        plugins: {
                            legend: { position: 'bottom', labels: { font: { family: 'Segoe UI' } } },
                            tooltip: {
                                callbacks: {
                                    label: (ctx) => ` ${ctx.label}: ${MotorAlerta.fmtBRL(ctx.parsed)}`,
                                },
                            },
                        },
                    },
                });
            } else {
                renderizarEstadosVazio(containerGrafico, 'carregando', 'fa-circle-info', 'Sem dados agregados para o gráfico no momento.');
            }
        } catch (erro) {
            notificar(erro.message, 'fa-triangle-exclamation');
            const ids = ['#totalDeputados', '#totalPartidos', '#totalAlertas'];
            ids.forEach((s) => { const el = $(s); if (el) el.textContent = '—'; });
            renderizarEstadosVazio($('#destaques'), 'erro', 'fa-triangle-exclamation', 'Não foi possível carregar os dados.');
        }
    }

    /* ======================================================================
       RESULTADOS DE BUSCA
       ====================================================================== */
    async function carregarResultados() {
        const nome = lerParametro('nome');
        const partido = lerParametro('partido');
        const uf = lerParametro('uf');

        const titulo = $('#tituloResultados');
        if (titulo) {
            const partes = [nome && `"${nome}"`, partido && `partido ${partido}`, uf && `UF ${uf}`].filter(Boolean);
            titulo.textContent = partes.length
                ? `Parlamentares para ${partes.join(' · ')}`
                : 'Parlamentares (última legislatura)';
        }

        const lista = $('#listaResultados');
        const resumo = $('#resumoBusca');
        if (!lista) return;

        try {
            const { dados, links } = await SeuPoliticoAPI.buscarDeputados({ nome, partido, uf });
            const listaDeputados = dados || [];

            if (resumo) {
                resumo.innerHTML = `<p class="page-subtitle">${listaDeputados.length} parlamentare${listaDeputados.length === 1 ? '' : 's'} encontrado${listaDeputados.length === 1 ? '' : 's'}. Os sinais apontados são neutros — investigue você mesmo.</p>`;
            }

            if (!listaDeputados.length) {
                renderizarEstadosVazio(lista, 'estado-vazio', 'fa-user-slash', 'Nenhum parlamentar encontrado com esses critérios. Tente outro nome, partido ou estado.');
                return;
            }

            lista.innerHTML = listaDeputados.map((d) => `
                <article class="politico-card" style="margin-bottom:14px;">
                    <div class="politico-avatar">
                        ${d.urlFoto
                            ? `<img src="${escaparHtml(d.urlFoto)}" alt="Foto de ${escaparHtml(d.nome)}" width="56" height="56" style="border-radius:50%;object-fit:cover;">`
                            : '<i class="fa-solid fa-user" aria-hidden="true"></i>'}
                    </div>
                    <div class="politico-info">
                        <h3>${escaparHtml(d.nome)}</h3>
                        <p>
                            <span class="badge badge-partido">${escaparHtml(d.partido || '—')}</span>
                            <span class="badge badge-uf">${escaparHtml(d.uf || '—')}</span>
                            <span class="badge badge-cargo">Deputado Federal</span>
                        </p>
                    </div>
                    <div class="politico-meta">
                        <a class="btn btn-sm" href="politico.html?id=${encodeURIComponent(d.id)}">
                            <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i> Analisar
                        </a>
                        <a class="btn btn-sm btn-outline" href="comparar.html?add=${encodeURIComponent(d.id)}">
                            <i class="fa-solid fa-scale-balanced" aria-hidden="true"></i> Comparar
                        </a>
                    </div>
                </article>`).join('');
        } catch (erro) {
            renderizarEstadosVazio(lista, 'erro', 'fa-triangle-exclamation', erro.message);
            notificar(erro.message, 'fa-triangle-exclamation');
        }
    }

    /* ======================================================================
       DASHBOARD
       ====================================================================== */
    async function carregarDashboard() {
        const seletor = $('#seletorAnoDashboard');
        const ano = seletor ? Number(seletor.value) : new Date().getFullYear();

        const set = (id, valor) => { const el = $(id); if (el) el.textContent = valor; };
        set('#indTotal', 'Carregando...');
        set('#indMedia', 'Carregando...');
        set('#indVariacao', 'Carregando...');
        set('#indTipos', 'Carregando...');
        set('#corpoTopFornecedores', '<tr><td colspan="3" class="carregando">Carregando...</td></tr>');

        try {
            const dados = await SeuPoliticoAPI.analiseGeral(ano);

            set('#indTotal', MotorAlerta.fmtBRL(dados.totalGasto));
            set('#indMedia', MotorAlerta.fmtBRL(dados.mediaMensal));
            set('#indVariacao', dados.variacao !== null && dados.variacao !== undefined
                ? `${dados.variacao > 0 ? '+' : ''}${MotorAlerta.fmtNumero(dados.variacao, 0)}%`
                : '—');
            set('#indTipos', String(dados.numTipos ?? '—'));

            // Barras por categoria.
            const categorias = (dados.categorias || []).slice(0, 10);
            if (categorias.length) {
                criarOuAtualizar('graficoBarra', {
                    type: 'bar',
                    data: {
                        labels: categorias.map((c) => c.tipo),
                        datasets: [{
                            label: `Gasto em ${ano}`,
                            data: categorias.map((c) => c.valor),
                            backgroundColor: coresPaleta[0],
                            borderRadius: 6,
                        }],
                    },
                    options: {
                        responsive: true,
                        indexAxis: 'y',
                        plugins: {
                            legend: { display: false },
                            tooltip: { callbacks: { label: (ctx) => ` ${MotorAlerta.fmtBRL(ctx.parsed.x)}` } },
                        },
                    },
                });
            }

            // Linha: evolução mensal.
            const serie = (dados.serieMensal || []).map((s) => ({ ...s, mes: String(s.mes).padStart(2, '0') }));
            if (serie.length) {
                criarOuAtualizar('graficoLinha', {
                    type: 'line',
                    data: {
                        labels: serie.map((s) => s.mes),
                        datasets: [{
                            label: `Gasto mensal em ${ano}`,
                            data: serie.map((s) => s.valor),
                            borderColor: coresPaleta[0],
                            backgroundColor: coresPaleta[0] + '22',
                            fill: true,
                            tension: 0.3,
                            pointRadius: 4,
                        }],
                    },
                    options: {
                        responsive: true,
                        plugins: {
                            tooltip: { callbacks: { label: (ctx) => ` Mês ${ctx.label}: ${MotorAlerta.fmtBRL(ctx.parsed.y)}` } },
                        },
                    },
                });
            }

            // Tabela de fornecedores.
            const fornecedores = (dados.fornecedores || []).slice(0, 10);
            set('#corpoTopFornecedores', fornecedores.length
                ? fornecedores.map((f) => `
                    <tr>
                        <td>${escaparHtml(f.fornecedor)}</td>
                        <td>${MotorAlerta.fmtBRL(f.valor)}</td>
                        <td>${MotorAlerta.fmtNumero(f.percentual, 1)}%</td>
                    </tr>`).join('')
                : '<tr><td colspan="3" class="estado-vazio">Sem dados de fornecedores.</td></tr>');
        } catch (erro) {
            notificar(erro.message, 'fa-triangle-exclamation');
            set('#corpoTopFornecedores', `<tr><td colspan="3" class="erro">${escaparHtml(erro.message)}</td></tr>`);
        }
    }

    function iniciarDashboard() {
        carregarDashboard();
        const botao = $('#botaoAtualizarDashboard');
        if (botao) botao.addEventListener('click', carregarDashboard);
        const seletor = $('#seletorAnoDashboard');
        if (seletor) seletor.addEventListener('change', carregarDashboard);
    }

    /* ======================================================================
       PERFIL DO PARLAMENTAR
       ====================================================================== */
    async function carregarPerfil() {
        const id = lerParametro('id');
        const cabecalho = $('#perfilCabecalho');
        const listaAlertas = $('#listaAlertas');

        if (!id) {
            renderizarEstadosVazio(cabecalho, 'estado-vazio', 'fa-user-slash', 'Nenhum parlamentar selecionado. Busque um parlamentar para ver o perfil.');
            return;
        }

        try {
            const dados = await SeuPoliticoAPI.analiseDeputado(id);
            const d = dados.deputado || {};
            const ano = dados.ano || '';

            // Cabeçalho do perfil.
            cabecalho.innerHTML = `
                <div class="perfil-avatar politico-avatar">
                    ${d.urlFoto
                        ? `<img src="${escaparHtml(d.urlFoto)}" alt="Foto de ${escaparHtml(d.nome)}" width="88" height="88" style="border-radius:50%;object-fit:cover;">`
                        : '<i class="fa-solid fa-user" aria-hidden="true"></i>'}
                </div>
                <div>
                    <h2>${escaparHtml(d.nome)}</h2>
                    <div class="perfil-dados">
                        <span><i class="fa-solid fa-building-columns" aria-hidden="true"></i> ${escaparHtml(d.partido || '—')}</span>
                        <span><i class="fa-solid fa-location-dot" aria-hidden="true"></i> ${escaparHtml(d.uf || '—')}</span>
                        <span><i class="fa-solid fa-briefcase" aria-hidden="true"></i> ${escaparHtml(d.cargo || 'Deputado Federal')}</span>
                        ${d.email ? `<span><i class="fa-solid fa-envelope" aria-hidden="true"></i> ${escaparHtml(d.email)}</span>` : ''}
                    </div>
                    <p style="margin-top:10px;color:var(--text-secondary);font-size:13px;">
                        Análise do ano de <strong>${ano}</strong> — dados públicos da Câmara dos Deputados.
                        <a href="https://www.camara.leg.br/deputados/${encodeURIComponent(d.id)}" target="_blank" rel="noopener">
                            <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> Ver página oficial na Câmara
                        </a>
                    </p>
                </div>`;

            // Indicadores.
            const set = (id, valor) => { const el = $(id); if (el) el.textContent = valor; };
            set('#perfilTotal', MotorAlerta.fmtBRL(dados.total));
            set('#perfilMedia', MotorAlerta.fmtBRL(dados.media));
            set('#perfilQtd', String(dados.quantidade ?? '—'));
            set('#perfilMaior', MotorAlerta.fmtBRL(dados.maior));

            // Sinais do motor de suspeita.
            renderizarSinais(listaAlertas, dados.sinais);

            // Gráfico de categorias.
            const categorias = (dados.categorias || []).slice(0, 10);
            if (categorias.length) {
                criarOuAtualizar('graficoPerfilBarra', {
                    type: 'bar',
                    data: {
                        labels: categorias.map((c) => c.tipo),
                        datasets: [{
                            label: `Gastos em ${ano}`,
                            data: categorias.map((c) => c.valor),
                            backgroundColor: coresPaleta[0],
                            borderRadius: 6,
                        }],
                    },
                    options: {
                        responsive: true,
                        indexAxis: 'y',
                        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${MotorAlerta.fmtBRL(ctx.parsed.x)}` } } },
                    },
                });
            }

            // Gráfico de evolução mensal.
            const serie = (dados.serieMensal || []).map((s) => ({ ...s, mes: String(s.mes).padStart(2, '0') }));
            if (serie.length) {
                criarOuAtualizar('graficoPerfilLinha', {
                    type: 'line',
                    data: {
                        labels: serie.map((s) => s.mes),
                        datasets: [{
                            label: `Gasto mensal (${ano})`,
                            data: serie.map((s) => s.valor),
                            borderColor: coresPaleta[3],
                            backgroundColor: coresPaleta[3] + '22',
                            fill: true,
                            tension: 0.3,
                        }],
                    },
                    options: { responsive: true, plugins: { tooltip: { callbacks: { label: (ctx) => ` Mês ${ctx.label}: ${MotorAlerta.fmtBRL(ctx.parsed.y)}` } } } },
                });
            }

            // Tabela de despesas (com filtros de tipo, mês e fornecedor).
            perfilDespesas = dados.despesas || [];
            popularTiposFiltro($('#filtroTipoDeputado'), perfilDespesas);
            renderizarTabelaDeputado();
            ligarFiltrosTabela('Deputado', renderizarTabelaDeputado);
        } catch (erro) {
            renderizarEstadosVazio(cabecalho, 'erro', 'fa-triangle-exclamation', erro.message);
            notificar(erro.message, 'fa-triangle-exclamation');
        }
    }

    function renderizarTabelaDeputado() {
        const corpo = $('#corpoTabelaDespesas');
        const contagem = $('#contagemDespesasDeputado');
        if (!corpo) return;

        const tipo = $('#filtroTipoDeputado')?.value || '';
        const mes = $('#filtroMesDeputado')?.value || '';
        const busca = ($('#filtroFornecedorDeputado')?.value || '').toLowerCase().trim();
        const filtradas = filtrarDespesas(perfilDespesas, { tipo, mes, busca });

        if (contagem) contagem.textContent = `Exibindo ${filtradas.length} de ${perfilDespesas.length} despesas.`;
        corpo.innerHTML = filtradas.length
            ? filtradas.slice(0, 100).map(linhaDespesa).join('')
            : '<tr><td colspan="6" class="estado-vazio">Nenhuma despesa encontrada com os filtros aplicados.</td></tr>';
    }

    /* ======================================================================
       SENADORES (lista) — dados oficiais do Senado
       ====================================================================== */
    async function carregarSenadores() {
        const nome = lerParametro('nome');
        const partido = lerParametro('partido');
        const uf = lerParametro('uf');

        const titulo = $('#tituloSenadores');
        if (titulo) {
            const partes = [nome && `"${nome}"`, partido && `partido ${partido}`, uf && `UF ${uf}`].filter(Boolean);
            titulo.textContent = partes.length ? `Senadores para ${partes.join(' · ')}` : 'Senadores em exercício';
        }

        const lista = $('#listaSenadores');
        if (!lista) return;

        try {
            const { dados } = await SeuPoliticoAPI.buscarSenadores({ nome, partido, uf });
            const listaSen = dados || [];

            if (!listaSen.length) {
                renderizarEstadosVazio(lista, 'estado-vazio', 'fa-user-slash', 'Nenhum senador encontrado com esses critérios.');
                return;
            }

            lista.innerHTML = listaSen.map((s) => `
                <article class="politico-card" style="margin-bottom:14px;">
                    <div class="politico-avatar">
                        ${s.urlFoto
                            ? `<img src="${escaparHtml(s.urlFoto)}" alt="Foto de ${escaparHtml(s.nome)}" width="56" height="56" style="border-radius:50%;object-fit:cover;">`
                            : '<i class="fa-solid fa-user" aria-hidden="true"></i>'}
                    </div>
                    <div class="politico-info">
                        <h3>${escaparHtml(s.nome)}</h3>
                        <p>
                            <span class="badge badge-partido">${escaparHtml(s.partido || '—')}</span>
                            <span class="badge badge-uf">${escaparHtml(s.uf || '—')}</span>
                            <span class="badge badge-cargo">Senador</span>
                        </p>
                    </div>
                    <div class="politico-meta">
                        <a class="btn btn-sm" href="senador.html?id=${encodeURIComponent(s.id)}">
                            <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i> Analisar
                        </a>
                    </div>
                </article>`).join('');
        } catch (erro) {
            renderizarEstadosVazio(lista, 'erro', 'fa-triangle-exclamation', erro.message);
            notificar(erro.message, 'fa-triangle-exclamation');
        }
    }

    /* ======================================================================
       SENADOR (perfil + análise)
       ====================================================================== */
    async function carregarSenador() {
        const id = lerParametro('id');
        const cabecalho = $('#perfilSenadorCabecalho');
        const listaAlertas = $('#listaAlertasSenador');

        if (!id) {
            renderizarEstadosVazio(cabecalho, 'estado-vazio', 'fa-user-slash', 'Nenhum senador selecionado.');
            return;
        }

        try {
            const dados = await SeuPoliticoAPI.analiseSenador(id);
            const s = dados.senador || {};
            const ano = dados.ano || '';

            cabecalho.innerHTML = `
                <div class="perfil-avatar politico-avatar">
                    ${s.urlFoto
                        ? `<img src="${escaparHtml(s.urlFoto)}" alt="Foto de ${escaparHtml(s.nome)}" width="88" height="88" style="border-radius:50%;object-fit:cover;">`
                        : '<i class="fa-solid fa-user" aria-hidden="true"></i>'}
                </div>
                <div>
                    <h2>${escaparHtml(s.nome)}</h2>
                    <div class="perfil-dados">
                        <span><i class="fa-solid fa-building-columns" aria-hidden="true"></i> ${escaparHtml(s.partido || '—')}</span>
                        <span><i class="fa-solid fa-location-dot" aria-hidden="true"></i> ${escaparHtml(s.uf || '—')}</span>
                        <span><i class="fa-solid fa-briefcase" aria-hidden="true"></i> ${escaparHtml(s.cargo || 'Senador')}</span>
                        ${s.email ? `<span><i class="fa-solid fa-envelope" aria-hidden="true"></i> ${escaparHtml(s.email)}</span>` : ''}
                    </div>
                    <p style="margin-top:10px;color:var(--text-secondary);font-size:13px;">
                        Análise do ano de <strong>${ano}</strong> — despesas CEAPS (cota parlamentar) do Senado Federal.
                        <a href="https://www25.senado.leg.br/web/senadores/senador/-/perfil/${encodeURIComponent(s.id)}" target="_blank" rel="noopener">
                            <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> Ver página oficial no Senado
                        </a>
                    </p>
                </div>`;

            const set = (idEl, valor) => { const el = $(idEl); if (el) el.textContent = valor; };
            set('#senadorTotal', MotorAlerta.fmtBRL(dados.total));
            set('#senadorMedia', MotorAlerta.fmtBRL(dados.media));
            set('#senadorQtd', String(dados.quantidade ?? '—'));
            set('#senadorMaior', MotorAlerta.fmtBRL(dados.maior));

            renderizarSinais(listaAlertas, dados.sinais);

            const categorias = (dados.categorias || []).slice(0, 10);
            if (categorias.length) {
                criarOuAtualizar('graficoSenadorBarra', {
                    type: 'bar',
                    data: {
                        labels: categorias.map((c) => c.tipo),
                        datasets: [{ label: `Gastos em ${ano}`, data: categorias.map((c) => c.valor), backgroundColor: coresPaleta[0], borderRadius: 6 }],
                    },
                    options: {
                        responsive: true, indexAxis: 'y',
                        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${MotorAlerta.fmtBRL(ctx.parsed.x)}` } } },
                    },
                });
            }

            const serie = (dados.serieMensal || []).map((s2) => ({ ...s2, mes: String(s2.mes).padStart(2, '0') }));
            if (serie.length) {
                criarOuAtualizar('graficoSenadorLinha', {
                    type: 'line',
                    data: {
                        labels: serie.map((s2) => s2.mes),
                        datasets: [{ label: `Gasto mensal (${ano})`, data: serie.map((s2) => s2.valor), borderColor: coresPaleta[3], backgroundColor: coresPaleta[3] + '22', fill: true, tension: 0.3 }],
                    },
                    options: { responsive: true, plugins: { tooltip: { callbacks: { label: (ctx) => ` Mês ${ctx.label}: ${MotorAlerta.fmtBRL(ctx.parsed.y)}` } } } },
                });
            }

            // Tabela de despesas CEAPS (com filtros de tipo, mês e fornecedor).
            senadorDespesas = dados.despesas || [];
            senadorAtualId = dados.senador ? dados.senador.id : null;
            popularTiposFiltro($('#filtroTipoSenador'), senadorDespesas);
            renderizarTabelaSenador();
            ligarFiltrosTabela('Senador', renderizarTabelaSenador);
        } catch (erro) {
            renderizarEstadosVazio(cabecalho, 'erro', 'fa-triangle-exclamation', erro.message);
            notificar(erro.message, 'fa-triangle-exclamation');
        }
    }

    function renderizarTabelaSenador() {
        const corpo = $('#corpoTabelaSenador');
        const contagem = $('#contagemDespesasSenador');
        if (!corpo) return;

        const tipo = $('#filtroTipoSenador')?.value || '';
        const mes = $('#filtroMesSenador')?.value || '';
        const busca = ($('#filtroFornecedorSenador')?.value || '').toLowerCase().trim();
        const filtradas = filtrarDespesas(senadorDespesas, { tipo, mes, busca });

        const linkPerfil = senadorAtualId
            ? `https://www25.senado.leg.br/web/senadores/senador/-/perfil/${encodeURIComponent(senadorAtualId)}`
            : 'https://www25.senado.leg.br/web/senadores/em-exercicio';

        if (contagem) contagem.textContent = `Exibindo ${filtradas.length} de ${senadorDespesas.length} despesas.`;
        corpo.innerHTML = filtradas.length
            ? filtradas.slice(0, 100).map((dsp) => `
                <tr>
                    <td>${escaparHtml(dsp.data || '—')}</td>
                    <td>${MotorAlerta.fmtMes(dsp.mes)}/${dsp.ano}</td>
                    <td>${escaparHtml(dsp.tipo || '—')}</td>
                    <td>${escaparHtml(dsp.fornecedor || '—')}</td>
                    <td>${MotorAlerta.fmtBRL(dsp.valor)}</td>
                    <td>
                        <a href="${escaparHtml(linkPerfil)}" target="_blank" rel="noopener" title="Ver despesas do senador no portal do Senado">
                            <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> Comprovante
                        </a>
                    </td>
                </tr>`).join('')
            : '<tr><td colspan="6" class="estado-vazio">Nenhuma despesa CEAPS encontrada com os filtros aplicados.</td></tr>';
    }

    /* ======================================================================
       EXECUTIVO FEDERAL (órgãos + contratos do Portal da Transparência)
       ====================================================================== */
    let orgaosCache = [];

    async function popularOrgaos() {
        const sel = $('#seletorOrgaoExecutivo');
        if (!sel) return;
        try {
            const { dados } = await SeuPoliticoAPI.buscarOrgaos({});
            orgaosCache = dados || [];
            const relevantes = orgaosCache
                .filter((o) => !/CODIGO INVALIDO/i.test(o.descricao || ''))
                .slice(0, 400)
                .sort((a, b) => a.descricao.localeCompare(b.descricao));
            sel.innerHTML = '<option value="">Selecione um órgão...</option>' +
                relevantes.map((o) => `<option value="${o.codigo}">${escaparHtml(o.descricao)}</option>`).join('');
        } catch (erro) {
            notificar(erro.message, 'fa-triangle-exclamation');
            sel.innerHTML = '<option value="">Órgãos indisponíveis</option>';
        }
    }

    function analisarContratos(contratos) {
        const sinais = [];
        if (!contratos.length) return sinais;

        const totalFinal = contratos.reduce((a, c) => a + c.valorFinal, 0);
        const totalInicial = contratos.reduce((a, c) => a + c.valorInicial, 0);
        const media = totalFinal / contratos.length;

        // Concentração por fornecedor.
        const porFornecedor = {};
        contratos.forEach((c) => { porFornecedor[c.fornecedor] = (porFornecedor[c.fornecedor] || 0) + c.valorFinal; });
        const fornecedores = Object.entries(porFornecedor).sort((a, b) => b[1] - a[1]);
        if (fornecedores.length && totalFinal > 0) {
            const [nome, valor] = fornecedores[0];
            const pct = (valor / totalFinal) * 100;
            if (pct > 70) {
                sinais.push({
                    nivel: 'info',
                    icone: '💡',
                    titulo: 'Concentração de contratos em um fornecedor',
                    texto: `"${nome}" concentrou ${MotorAlerta.fmtNumero(pct, 0)}% do valor contratado (${MotorAlerta.fmtBRL(valor)}). Vale a pena investigar?`,
                });
            }
        }

        // Contratos muito acima da média do órgão.
        const acima = contratos.filter((c) => c.valorFinal > media * 3 && media > 0).slice(0, 3);
        if (acima.length) {
            sinais.push({
                nivel: 'alerta',
                icone: '🟡',
                titulo: 'Contratos bem acima da média do órgão',
                texto: `${acima.length} contrato(s) superam 3x a média do órgão (média ${MotorAlerta.fmtBRL(media)}). Os dados públicos estão no Portal para conferência.`,
            });
        }

        // Variação valor inicial → final.
        const comVariacao = contratos.filter((c) => c.valorInicial > 0 && c.valorFinal > c.valorInicial * 1.5).slice(0, 3);
        if (comVariacao.length) {
            sinais.push({
                nivel: 'comparacao',
                icone: '📊',
                titulo: 'Aumento relevante no valor contratado',
                texto: `${comVariacao.length} contrato(s) tiveram valor final >1,5x o inicial (ex.: "${comVariacao[0].numero}"). Comparação neutra — confira no Portal.`,
            });
        }

        sinais.push({
            nivel: 'comparacao',
            icone: '🔍',
            titulo: 'Lembrete de transparência',
            texto: 'Padrões observados em dados públicos — não são acusações. Cada contrato tem link para conferência no Portal da Transparência.',
        });
        return sinais;
    }

    async function carregarContratosExecutivo() {
        const sel = $('#seletorOrgaoExecutivo');
        const ano = Number($('#seletorAnoExecutivo')?.value || new Date().getFullYear());
        const container = $('#resultadoExecutivo');
        if (!sel || !container) return;

        const codigo = sel.value;
        if (!codigo) { notificar('Selecione um órgão primeiro.', 'fa-hand-pointer'); return; }

        container.innerHTML = '<div class="carregando"><i class="fa-solid fa-circle-notch" aria-hidden="true"></i><p>Consultando contratos no Portal da Transparência...</p></div>';

        try {
            const { dados } = await SeuPoliticoAPI.buscarContratosPortal({ codigoOrgao: codigo, ano });
            const contratos = dados || [];

            if (!contratos.length) {
                renderizarEstadosVazio(container, 'estado-vazio', 'fa-file-circle-question', 'Nenhum contrato encontrado para este órgão e ano. Tente outro órgão ou ano.');
                return;
            }

            const totalFinal = contratos.reduce((a, c) => a + c.valorFinal, 0);
            const totalInicial = contratos.reduce((a, c) => a + c.valorInicial, 0);
            const maior = Math.max(...contratos.map((c) => c.valorFinal));

            const sinais = analisarContratos(contratos);

            container.innerHTML = `
                <h3 class="section-title"><i class="fa-solid fa-file-signature" aria-hidden="true"></i> Contratos de ${ano}</h3>
                <div id="sinaisExecutivo"></div>
                <div class="card-grid">
                    <div class="card">
                        <div class="card-titulo">Contratos no período</div>
                        <div class="card-valor">${contratos.length}</div>
                    </div>
                    <div class="card">
                        <div class="card-titulo">Valor inicial total</div>
                        <div class="card-valor">${MotorAlerta.fmtBRL(totalInicial)}</div>
                    </div>
                    <div class="card">
                        <div class="card-titulo">Valor final total</div>
                        <div class="card-valor">${MotorAlerta.fmtBRL(totalFinal)}</div>
                    </div>
                    <div class="card">
                        <div class="card-titulo">Maior contrato</div>
                        <div class="card-valor">${MotorAlerta.fmtBRL(maior)}</div>
                    </div>
                </div>
                <div class="tabela-wrapper" style="margin-top:20px;">
                    <table class="tabela">
                        <thead>
                            <tr>
                                <th>Número</th>
                                <th>Objeto</th>
                                <th>Fornecedor</th>
                                <th>Inicial</th>
                                <th>Final</th>
                                <th>Modalidade</th>
                                <th>Situação</th>
                                <th>Validar</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${contratos.slice(0, 60).map((c) => `
                                <tr>
                                    <td>${escaparHtml(c.numero)}</td>
                                    <td style="white-space:normal;max-width:320px;">${escaparHtml(c.objeto || '—')}</td>
                                    <td>${escaparHtml(c.fornecedor)}</td>
                                    <td>${MotorAlerta.fmtBRL(c.valorInicial)}</td>
                                    <td>${MotorAlerta.fmtBRL(c.valorFinal)}</td>
                                    <td>${escaparHtml(c.modalidade)}</td>
                                    <td>${escaparHtml(c.situacao)}</td>
                                    <td>
                                        <a href="${escaparHtml(c.linkPortal)}" target="_blank" rel="noopener" title="Abrir no Portal da Transparência">
                                            <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> Portal
                                        </a>
                                    </td>
                                </tr>`).join('')}
                        </tbody>
                    </table>
                </div>`;

            renderizarSinais($('#sinaisExecutivo'), sinais);
        } catch (erro) {
            renderizarEstadosVazio(container, 'erro', 'fa-triangle-exclamation', erro.message);
            notificar(erro.message, 'fa-triangle-exclamation');
        }
    }

    function iniciarExecutivo() {
        popularOrgaos();
        const botao = $('#botaoBuscarContratos');
        if (botao) botao.addEventListener('click', carregarContratosExecutivo);
        const sel = $('#seletorOrgaoExecutivo');
        if (sel) sel.addEventListener('change', carregarContratosExecutivo);
    }

    /* ======================================================================
       PRESIDENTE DA REPÚBLICA (informativo)
       ====================================================================== */
    async function carregarPresidente() {
        const container = $('#perfilPresidente');
        if (!container) return;
        try {
            const { presidente } = await SeuPoliticoAPI.obterPresidente();

            container.innerHTML = `
                <div class="card perfil-cabecalho">
                    <div class="perfil-avatar politico-avatar" style="width:96px;height:96px;font-size:44px;">
                        ${presidente.foto
                            ? `<img src="${escaparHtml(presidente.foto)}" alt="Foto de ${escaparHtml(presidente.nome)}" style="width:96px;height:96px;border-radius:50%;object-fit:cover;">`
                            : '<i class="fa-solid fa-user" aria-hidden="true"></i>'}
                    </div>
                    <div style="flex:1;min-width:260px;">
                        <h2>${escaparHtml(presidente.nome)}</h2>
                        <div class="perfil-dados">
                            <span><i class="fa-solid fa-building-columns" aria-hidden="true"></i> ${escaparHtml(presidente.partido || '—')}</span>
                            <span><i class="fa-solid fa-calendar-check" aria-hidden="true"></i> Mandato ${escaparHtml(presidente.mandato || '—')}</span>
                        </div>
                        <p style="margin-top:12px;color:var(--text-secondary);line-height:1.7;">
                            ${escaparHtml(presidente.resumo || '')}
                        </p>
                        <p style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">
                            <a href="${escaparHtml(presidente.links.oficial)}" target="_blank" rel="noopener" class="btn btn-sm">
                                <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> Página oficial (gov.br)
                            </a>
                            <a href="${escaparHtml(presidente.links.wikipedia)}" target="_blank" rel="noopener" class="btn btn-sm btn-outline">
                                <i class="fa-brands fa-wikipedia-w" aria-hidden="true"></i> Wikipédia
                            </a>
                        </p>
                    </div>
                </div>
                <div class="sinal sinal-comparacao" style="margin-top:16px;">
                    <span class="sinal-icone" aria-hidden="true">🔍</span>
                    <div>
                        <div class="sinal-titulo">Fonte dos dados</div>
                        <p class="sinal-texto">
                            Perfil informativo montado com fontes públicas, com link para a
                            página oficial do Planalto. Não é uma análise de gastos — é informação geral.
                        </p>
                    </div>
                </div>`;
        } catch (erro) {
            renderizarEstadosVazio(container, 'erro', 'fa-triangle-exclamation', erro.message);
            notificar(erro.message, 'fa-triangle-exclamation');
        }
    }

    /* ---- Gastos do presidente (viagens a serviço da Presidência) ---- */
    async function carregarGastosPresidente() {
        const ano = Number($('#seletorAnoPresidente')?.value || new Date().getFullYear());
        const set = (id, valor) => { const el = $(id); if (el) el.textContent = valor; };

        set('#presViagens', 'Carregando...');
        set('#presTotal', 'Carregando...');
        set('#presMedia', 'Carregando...');
        set('#presMaior', 'Carregando...');
        const corpoViagens = $('#corpoTabelaViagens');
        if (corpoViagens) corpoViagens.innerHTML = '<tr><td colspan="8" class="carregando">Carregando...</td></tr>';

        try {
            const dados = await SeuPoliticoAPI.obterGastosPresidente(ano);

            set('#presViagens', String(dados.totalViagens ?? '—'));
            set('#presTotal', MotorAlerta.fmtBRL(dados.totalGasto));
            set('#presMedia', MotorAlerta.fmtBRL(dados.mediaViagem));
            set('#presMaior', dados.maiorViagem ? MotorAlerta.fmtBRL(dados.maiorViagem.valorTotal) : '—');

            renderizarSinais($('#sinaisGastosPresidente'), dados.sinais);

            const porTipo = dados.porTipo || [];
            if (porTipo.length) {
                criarOuAtualizar('graficoPresidenteTipo', {
                    type: 'bar',
                    data: {
                        labels: porTipo.map((t) => t.tipo),
                        datasets: [{ label: `Gastos em ${ano}`, data: porTipo.map((t) => t.valor), backgroundColor: coresPaleta[0], borderRadius: 6 }],
                    },
                    options: { responsive: true, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${MotorAlerta.fmtBRL(ctx.parsed.y)}` } } } },
                });
            }

            const serie = (dados.serieMensal || []).filter((s) => s.valor > 0);
            if (serie.length) {
                criarOuAtualizar('graficoPresidenteMensal', {
                    type: 'line',
                    data: {
                        labels: serie.map((s) => String(s.mes).padStart(2, '0')),
                        datasets: [{ label: `Gastos em ${ano}`, data: serie.map((s) => s.valor), borderColor: coresPaleta[3], backgroundColor: coresPaleta[3] + '22', fill: true, tension: 0.3 }],
                    },
                    options: { responsive: true, plugins: { tooltip: { callbacks: { label: (ctx) => ` Mês ${ctx.label}: ${MotorAlerta.fmtBRL(ctx.parsed.y)}` } } } },
                });
            }

            const viagens = dados.viagens || [];
            presidenteViagens = viagens;
            popularTiposFiltro($('#filtroTipoPresidente'), presidenteViagens, 'tipoViagem');
            renderizarTabelaViagens();
            ligarFiltrosTabela('Presidente', renderizarTabelaViagens, '#filtroBeneficiarioPresidente');

            set('#avisoGastosPresidente', dados.aviso || '');
        } catch (erro) {
            ['#presViagens', '#presTotal', '#presMedia', '#presMaior'].forEach((id) => set(id, '—'));
            if (corpoViagens) corpoViagens.innerHTML = `<tr><td colspan="8" class="erro">${escaparHtml(erro.message)}</td></tr>`;
            notificar(erro.message, 'fa-triangle-exclamation');
        }
    }

    function renderizarTabelaViagens() {
        const corpo = $('#corpoTabelaViagens');
        const contagem = $('#contagemViagensPresidente');
        if (!corpo) return;

        const tipo = $('#filtroTipoPresidente')?.value || '';
        const mes = $('#filtroMesPresidente')?.value || '';
        const busca = ($('#filtroBeneficiarioPresidente')?.value || '').toLowerCase().trim();
        const filtradas = filtrarDespesas(presidenteViagens, { tipo, mes, busca, campoBusca: 'beneficiario' });

        if (contagem) contagem.textContent = `Exibindo ${filtradas.length} de ${presidenteViagens.length} viagens.`;
        corpo.innerHTML = filtradas.length
            ? filtradas.map((v) => `
                <tr>
                    <td>${escaparHtml(v.beneficiario)}</td>
                    <td style="white-space:normal;max-width:320px;">${escaparHtml(v.motivo || '—')}</td>
                    <td>${escaparHtml(v.tipoViagem || '—')}</td>
                    <td>${escaparHtml(v.dataInicio || '—')}</td>
                    <td>${MotorAlerta.fmtBRL(v.valorPassagem)}</td>
                    <td>${MotorAlerta.fmtBRL(v.valorDiarias)}</td>
                    <td>${MotorAlerta.fmtBRL(v.valorTotal)}</td>
                    <td><a href="${escaparHtml(v.linkPortal)}" target="_blank" rel="noopener" title="Abrir comprovante no Portal da Transparência"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> Comprovante</a></td>
                </tr>`).join('')
            : '<tr><td colspan="8" class="estado-vazio">Nenhuma viagem encontrada com os filtros aplicados.</td></tr>';
    }

    function iniciarPresidente() {
        carregarPresidente();
        carregarGastosPresidente();
        const botao = $('#botaoAtualizarGastosPresidente');
        if (botao) botao.addEventListener('click', carregarGastosPresidente);
        const sel = $('#seletorAnoPresidente');
        if (sel) sel.addEventListener('change', carregarGastosPresidente);
    }

    /* ======================================================================
       CANDIDATOS À PRESIDÊNCIA (período eleitoral)
       ====================================================================== */
    async function carregarCandidatos() {
        const banner = $('#bannerEleitoral');
        const resumo = $('#resumoEleicao');
        const lista = $('#listaCandidatos');
        const linksOficiais = $('#linksOficiais');
        if (!lista) return;

        try {
            const dados = await SeuPoliticoAPI.obterCandidatos();
            const eleicao = dados.eleicao || {};

            if (banner) {
                banner.innerHTML = eleicao.periodoAtivo
                    ? `<div class="card" style="border-left:4px solid var(--alerta-comparacao);">
                           <strong><i class="fa-solid fa-check-to-slot" aria-hidden="true"></i> Período eleitoral ativo</strong>
                           &nbsp;— Eleição ${eleicao.ano} · ${escaparHtml(eleicao.dataReferencia || '')}.
                       </div>`
                    : `<div class="card" style="border-left:4px solid var(--border-medium);">
                           <strong><i class="fa-solid fa-circle-info" aria-hidden="true"></i> Fora do período eleitoral</strong>
                           &nbsp;— estes dados são apenas informativos.
                       </div>`;
            }
            if (resumo) {
                resumo.innerHTML = `<p style="color:var(--text-secondary);line-height:1.7;">${escaparHtml(dados.resumo || '')}</p>`;
            }

            const candidatos = dados.candidatos || [];
            if (!candidatos.length) {
                renderizarEstadosVazio(lista, 'estado-vazio', 'fa-check-to-slot', 'Nenhum candidato listado no momento.');
            } else {
                lista.innerHTML = candidatos.map((c) => `
                    <article class="card" style="display:flex;flex-direction:column;gap:10px;">
                        <div class="politico-avatar" style="width:72px;height:72px;font-size:30px;align-self:center;">
                            ${c.foto
                                ? `<img src="${escaparHtml(c.foto)}" alt="Foto de ${escaparHtml(c.nome)}" style="width:72px;height:72px;border-radius:50%;object-fit:cover;">`
                                : '<i class="fa-solid fa-user" aria-hidden="true"></i>'}
                        </div>
                        <div style="text-align:center;">
                            <h3 style="font-family:var(--font-corpo);">${escaparHtml(c.nome)}</h3>
                            <div style="margin-top:6px;display:flex;gap:6px;justify-content:center;flex-wrap:wrap;">
                                <span class="badge badge-partido">${escaparHtml(c.partido || '—')}</span>
                                <span class="badge badge-uf">Nº ${c.numero}</span>
                            </div>
                        </div>
                        ${c.vice ? `<p style="font-size:13px;color:var(--text-secondary);text-align:center;">Vice: <strong>${escaparHtml(c.vice)}</strong></p>` : ''}
                        ${c.coligacao ? `<p style="font-size:12px;color:var(--text-muted);text-align:center;">${escaparHtml(c.coligacao)}</p>` : ''}
                        <a href="${escaparHtml(c.linkWikipedia)}" target="_blank" rel="noopener" class="btn btn-sm btn-outline" style="justify-content:center;">
                            <i class="fa-brands fa-wikipedia-w" aria-hidden="true"></i> Perfil
                        </a>
                    </article>`).join('');
            }

            if (linksOficiais) {
                linksOficiais.innerHTML = `
                    <div class="sinal sinal-info">
                        <span class="sinal-icone" aria-hidden="true">🔍</span>
                        <div>
                            <div class="sinal-titulo">Confira a situação oficial</div>
                            <p class="sinal-texto">
                                Estes dados são informativos e baseados em fontes públicas.
                                <a href="${escaparHtml(dados.links.tse)}" target="_blank" rel="noopener">Site do TSE</a> ·
                                <a href="${escaparHtml(dados.links.divulgacao)}" target="_blank" rel="noopener">Divulgação de Candidaturas</a> ·
                                <a href="${escaparHtml(dados.links.wikipedia)}" target="_blank" rel="noopener">Wikipédia</a>
                            </p>
                        </div>
                    </div>`;
            }
        } catch (erro) {
            renderizarEstadosVazio(lista, 'erro', 'fa-triangle-exclamation', erro.message);
            notificar(erro.message, 'fa-triangle-exclamation');
        }
    }

    /* ======================================================================
       COMPARAÇÃO
       ====================================================================== */
    let deputadosCache = [];

    async function popularSeletoresComparar() {
        const sel1 = $('#seletorDep1');
        const sel2 = $('#seletorDep2');
        if (!sel1 || !sel2) return;

        try {
            const { dados } = await SeuPoliticoAPI.buscarDeputados({});
            deputadosCache = dados || [];
            const options = deputadosCache.map((d) =>
                `<option value="${d.id}">${escaparHtml(d.nome)} (${escaparHtml(d.partido || '—')}-${escaparHtml(d.uf || '—')})</option>`).join('');
            sel1.insertAdjacentHTML('beforeend', options);
            sel2.insertAdjacentHTML('beforeend', options);

            const add = lerParametro('add');
            if (add) sel1.value = add;
        } catch (erro) {
            notificar(erro.message, 'fa-triangle-exclamation');
        }
    }

    async function comparar() {
        const sel1 = $('#seletorDep1');
        const sel2 = $('#seletorDep2');
        const ano = Number($('#seletorAnoComparar')?.value || new Date().getFullYear());
        const ids = [sel1.value, sel2.value].filter(Boolean);
        const container = $('#resultadoComparacao');
        if (!container) return;

        if (ids.length < 2) {
            notificar('Selecione dois parlamentares para comparar.', 'fa-hand-pointer');
            return;
        }

        container.innerHTML = '<div class="carregando"><i class="fa-solid fa-circle-notch" aria-hidden="true"></i><p>Comparando dados públicos...</p></div>';

        try {
            const dados = await SeuPoliticoAPI.analiseComparar(ids, ano);
            const lista = dados.deputados || [];

            // Sinais comparativos.
            const sinais = MotorAlerta.comparar(lista.map((d) => ({ nome: d.nome, total: d.total })));

            container.innerHTML = `
                <h3 class="section-title"><i class="fa-solid fa-scale-balanced" aria-hidden="true"></i> Comparação — ${ano}</h3>
                <div id="compararSinais"></div>
                <div class="card-grid" style="margin-top:16px;">
                    ${lista.map((d) => `
                        <div class="card">
                            <div class="card-titulo">${escaparHtml(d.nome)}</div>
                            <div class="perfil-dados" style="margin:6px 0 10px;">
                                <span class="badge badge-partido">${escaparHtml(d.partido || '—')}</span>
                                <span class="badge badge-uf">${escaparHtml(d.uf || '—')}</span>
                            </div>
                            <div class="card-valor">${MotorAlerta.fmtBRL(d.total)}</div>
                            <div style="margin-top:6px;font-size:13px;color:var(--text-secondary);">
                                Média mensal: ${MotorAlerta.fmtBRL(d.media)}<br>
                                Principal categoria: ${escaparHtml(d.categoriaPrincipal || '—')}
                            </div>
                            <a class="btn btn-sm btn-outline" style="margin-top:12px;" href="politico.html?id=${d.id}">Ver perfil</a>
                        </div>`).join('')}
                </div>
                <div class="chart-box" style="margin-top:18px;">
                    <canvas id="graficoComparar" aria-label="Gráfico de barras comparando gastos por categoria" role="img"></canvas>
                </div>`;

            renderizarSinais($('#compararSinais'), sinais);

            // Gráfico agrupado por categoria.
            const categorias = dados.categorias || [];
            if (categorias.length && lista.length) {
                const coresPorDep = coresPaleta;
                criarOuAtualizar('graficoComparar', {
                    type: 'bar',
                    data: {
                        labels: categorias.map((c) => c.tipo),
                        datasets: lista.map((d, i) => ({
                            label: d.nome,
                            data: categorias.map((c) => c.valores[d.id] || 0),
                            backgroundColor: coresPorDep[i],
                            borderRadius: 4,
                        })),
                    },
                    options: {
                        responsive: true,
                        plugins: {
                            tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${MotorAlerta.fmtBRL(ctx.parsed.y)}` } },
                        },
                    },
                });
            } else {
                renderizarEstadosVazio($('#compararSinais'), 'estado-vazio', 'fa-file-circle-question', 'Sem dados de categorias para comparar.');
            }
        } catch (erro) {
            renderizarEstadosVazio(container, 'erro', 'fa-triangle-exclamation', erro.message);
            notificar(erro.message, 'fa-triangle-exclamation');
        }
    }

    function iniciarComparar() {
        popularSeletoresComparar();
        const botao = $('#botaoComparar');
        if (botao) botao.addEventListener('click', comparar);
    }

    /* ======================================================================
       ROTEADOR DE PÁGINA
       ====================================================================== */
    function rotearPagina() {
        if ($('#indicadoresGerais')) carregarHome();
        else if ($('#listaResultados')) carregarResultados();
        else if ($('#seletorAnoDashboard')) iniciarDashboard();
        else if ($('#perfilCabecalho')) carregarPerfil();
        else if ($('#seletorDep1')) iniciarComparar();
        else if ($('#listaSenadores')) carregarSenadores();
        else if ($('#perfilSenadorCabecalho')) carregarSenador();
        else if ($('#seletorOrgaoExecutivo')) iniciarExecutivo();
        else if ($('#perfilPresidente')) iniciarPresidente();
        else if ($('#listaCandidatos')) carregarCandidatos();
    }

    /* ---- ARRANQUE ---- */
    document.addEventListener('DOMContentLoaded', () => {
        iniciarMenuResponsivo();
        iniciarBusca();
        popularFiltros();
        rotearPagina();
    });
})();
