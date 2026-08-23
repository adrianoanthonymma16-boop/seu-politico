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

    // Busca TODOS os deputados (pagina por página), sem limite de 100.
    async function buscarTodosDeputados(filtros = {}) {
        const pagina1 = await SeuPoliticoAPI.buscarDeputados({ ...filtros, pagina: 1 });
        const dados = pagina1.dados || [];
        const ultima = (pagina1.links && pagina1.links.ultima) || 1;
        for (let p = 2; p <= ultima; p++) {
            const r = await SeuPoliticoAPI.buscarDeputados({ ...filtros, pagina: p });
            dados.push(...(r.dados || []));
        }
        return dados;
    }

    /* ---- REGISTRO DE GRÁFICOS (Chart.js) ---- */
    const graficos = {};

    /* ---- Estado das tabelas de despesas (para os filtros) ---- */
    let perfilDespesas = [];
    let senadorDespesas = [];
    let senadorAtualId = null;
    let presidenteViagens = [];
    let presidenteContratos = [];
    let comparacaoAtual = null;
    let votacoesAtuais = [];
    let votacaoPagina = 1;
    let votacoesSenadorAtuais = [];
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

    // Bloco "Maiores fornecedores" na análise de gastos (top 5, neutro).
    function renderizarTopFornecedores(container, fornecedores, { total = 0 } = {}) {
        if (!container) return;
        const lista = (Array.isArray(fornecedores) ? fornecedores : []).slice(0, 5);
        if (!lista.length) {
            container.innerHTML = '';
            return;
        }
        container.innerHTML = `
            <div class="card" style="margin-top:16px;">
                <h4 style="margin:0 0 2px;"><i class="fa-solid fa-building-user" aria-hidden="true"></i> Maiores fornecedores no ano</h4>
                <p style="font-size:12px;color:var(--text-muted);margin:0 0 10px;">Apenas dados públicos — veja quem mais recebeu recursos.</p>
                <table class="tabela">
                    <thead><tr><th>Fornecedor</th><th>Total</th><th>%</th></tr></thead>
                    <tbody>
                        ${lista.map((f) => {
                            const percentual = f.percentual != null
                                ? f.percentual
                                : (total > 0 ? ((Number(f.valor) || 0) / total) * 100 : 0);
                            return `
                            <tr>
                                <td>${escaparHtml(f.fornecedor || '—')}</td>
                                <td>${MotorAlerta.fmtBRL(f.valor)}</td>
                                <td>${MotorAlerta.fmtNumero(percentual, 1)}%</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>`;
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

    // Liga os controles de filtro a um renderizador de tabela e sincroniza a URL.
    function ligarFiltrosTabela(prefixo, renderer, campoBuscaId) {
        const cfg = configFiltrosUrl(prefixo);
        const buscaId = campoBuscaId || cfg.buscaId;
        aplicarFiltrosDaUrl(prefixo);

        const sincronizar = () => { renderer(); gravarFiltrosNaUrl(prefixo); };

        ['filtroTipo', 'filtroMes'].forEach((base) => {
            const el = $(`#${base}${prefixo}`);
            if (el) el.addEventListener('change', sincronizar);
        });
        const busca = $(buscaId);
        if (busca) busca.addEventListener('input', sincronizar);
        const limpar = $(`#botaoLimparFiltros${prefixo}`);
        if (limpar) {
            limpar.addEventListener('click', () => {
                ['filtroTipo', 'filtroMes'].forEach((base) => {
                    const el = $(`#${base}${prefixo}`);
                    if (el) el.value = '';
                });
                const b = $(buscaId);
                if (b) b.value = '';
                renderer();
                gravarFiltrosNaUrl(prefixo);
            });
        }

        // Re-renderiza com os filtros vindos da URL já aplicados.
        renderer();
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

    /* ---- EXPORTAÇÃO (CSV/JSON) E COMPARTILHAMENTO POR URL ---- */
    function baixarArquivo(nomeArquivo, conteudo, tipoMime) {
        const blob = new Blob([conteudo], { type: tipoMime });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = nomeArquivo;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function escaparCSV(valor) {
        const texto = String(valor ?? '');
        return /[";\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
    }

    function exportarCSV(nomeArquivo, colunas, linhas) {
        const cabecalho = colunas.map((c) => escaparCSV(c.titulo)).join(';');
        const corpo = linhas.map((linha) =>
            colunas.map((c) => escaparCSV(linha[c.chave])).join(';')
        ).join('\n');
        // BOM UTF-8 para o Excel abrir corretamente acentos em pt-BR.
        baixarArquivo(nomeArquivo, `\ufeff${cabecalho}\n${corpo}`, 'text/csv;charset=utf-8');
    }

    function exportarJSON(nomeArquivo, dados) {
        baixarArquivo(nomeArquivo, JSON.stringify(dados, null, 2), 'application/json;charset=utf-8');
    }

    async function copiarLink() {
        const url = window.location.href;
        try {
            await navigator.clipboard.writeText(url);
            notificar('Link copiado! Compartilhe sua análise.', 'fa-link');
        } catch (erro) {
            const temporario = document.createElement('textarea');
            temporario.value = url;
            temporario.style.position = 'fixed';
            temporario.style.opacity = '0';
            document.body.appendChild(temporario);
            temporario.select();
            try {
                document.execCommand('copy');
                notificar('Link copiado! Compartilhe sua análise.', 'fa-link');
            } catch (e) {
                notificar('Não foi possível copiar o link automaticamente.', 'fa-triangle-exclamation');
            }
            document.body.removeChild(temporario);
        }
    }

    // Configuração dos filtros para sincronizar com a URL (e reutilizada na exportação).
    function configFiltrosUrl(prefixo) {
        if (prefixo === 'Presidente') {
            return { buscaId: '#filtroBeneficiarioPresidente', campoBusca: 'beneficiario', paramBusca: 'beneficiario' };
        }
        if (prefixo === 'ContratoPresidente') {
            return { buscaId: '#filtroFornecedorContratoPresidente', campoBusca: 'fornecedor', paramBusca: 'fornecedor' };
        }
        return { buscaId: `#filtroFornecedor${prefixo}`, campoBusca: 'fornecedor', paramBusca: 'fornecedor' };
    }

    function obterFiltrosDeControles(prefixo) {
        const cfg = configFiltrosUrl(prefixo);
        const tipo = $(`#filtroTipo${prefixo}`)?.value || '';
        const mes = $(`#filtroMes${prefixo}`)?.value || '';
        const busca = ($(cfg.buscaId)?.value || '').toLowerCase().trim();
        return { tipo, mes, busca, campoBusca: cfg.campoBusca };
    }

    function gravarFiltrosNaUrl(prefixo) {
        const cfg = configFiltrosUrl(prefixo);
        const { tipo, mes, busca } = obterFiltrosDeControles(prefixo);
        const url = new URL(window.location);
        if (tipo) url.searchParams.set('tipo', tipo); else url.searchParams.delete('tipo');
        if (mes) url.searchParams.set('mes', mes); else url.searchParams.delete('mes');
        if (busca) url.searchParams.set(cfg.paramBusca, busca); else url.searchParams.delete(cfg.paramBusca);
        history.replaceState(null, '', url);
    }

    function aplicarFiltrosDaUrl(prefixo) {
        const cfg = configFiltrosUrl(prefixo);
        const tipo = lerParametro('tipo');
        const mes = lerParametro('mes');
        const busca = lerParametro(cfg.paramBusca);
        const selTipo = $(`#filtroTipo${prefixo}`);
        const selMes = $(`#filtroMes${prefixo}`);
        const inputBusca = $(cfg.buscaId);
        if (selTipo && tipo) selTipo.value = tipo;
        if (selMes && mes) selMes.value = mes;
        if (inputBusca && busca) inputBusca.value = busca;
    }

    const COLUNAS_DESPESA = [
        { titulo: 'Data', chave: 'data' },
        { titulo: 'Mês', chave: 'mes' },
        { titulo: 'Ano', chave: 'ano' },
        { titulo: 'Tipo', chave: 'tipo' },
        { titulo: 'Fornecedor', chave: 'fornecedor' },
        { titulo: 'Valor (R$)', chave: 'valor' },
        { titulo: 'Comprovante', chave: 'url' },
    ];

    const COLUNAS_VIAGENS = [
        { titulo: 'Beneficiário', chave: 'beneficiario' },
        { titulo: 'Motivo', chave: 'motivo' },
        { titulo: 'Tipo', chave: 'tipoViagem' },
        { titulo: 'Início', chave: 'dataInicio' },
        { titulo: 'Passagem (R$)', chave: 'valorPassagem' },
        { titulo: 'Diárias (R$)', chave: 'valorDiarias' },
        { titulo: 'Total (R$)', chave: 'valorTotal' },
        { titulo: 'Comprovante', chave: 'linkPortal' },
    ];

    const COLUNAS_CONTRATOS = [
        { titulo: 'Número', chave: 'numero' },
        { titulo: 'Objeto', chave: 'objeto' },
        { titulo: 'Fornecedor', chave: 'fornecedor' },
        { titulo: 'Modalidade', chave: 'modalidade' },
        { titulo: 'Assinatura', chave: 'dataAssinatura' },
        { titulo: 'Valor inicial (R$)', chave: 'valorInicial' },
        { titulo: 'Valor final (R$)', chave: 'valorFinal' },
        { titulo: 'Comprovante', chave: 'linkPortal' },
    ];

    const CONTEXTOS_EXPORTACAO = {
        Deputado: { prefixo: 'Deputado', colunas: COLUNAS_DESPESA, fonte: () => perfilDespesas, arquivo: 'deputado-despesas' },
        Senador: { prefixo: 'Senador', colunas: COLUNAS_DESPESA, fonte: () => senadorDespesas, arquivo: 'senador-despesas' },
        Presidente: { prefixo: 'Presidente', colunas: COLUNAS_VIAGENS, fonte: () => presidenteViagens, arquivo: 'presidente-viagens' },
        ContratoPresidente: { prefixo: 'ContratoPresidente', colunas: COLUNAS_CONTRATOS, fonte: () => presidenteContratos, arquivo: 'presidente-contratos' },
    };

    function registrosFiltradosDoContexto(chave) {
        const ctx = CONTEXTOS_EXPORTACAO[chave];
        if (!ctx) return [];
        const { tipo, mes, busca, campoBusca } = obterFiltrosDeControles(ctx.prefixo);
        return filtrarDespesas(ctx.fonte(), { tipo, mes, busca, campoBusca });
    }

    function exportarCSVDoContexto(chave) {
        const ctx = CONTEXTOS_EXPORTACAO[chave];
        if (!ctx) return;
        exportarCSV(`${ctx.arquivo}.csv`, ctx.colunas, registrosFiltradosDoContexto(chave));
    }

    function exportarJSONDoContexto(chave) {
        const ctx = CONTEXTOS_EXPORTACAO[chave];
        if (!ctx) return;
        const { tipo, mes, busca } = obterFiltrosDeControles(ctx.prefixo);
        exportarJSON(`${ctx.arquivo}.json`, {
            geradoEm: new Date().toISOString(),
            filtros: { tipo, mes, busca },
            registros: registrosFiltradosDoContexto(chave),
        });
    }

    function exportarComparacao(formato) {
        if (!comparacaoAtual) {
            notificar('Faça uma comparação antes de exportar.', 'fa-hand-pointer');
            return;
        }
        const dados = comparacaoAtual;
        if (formato === 'json') {
            exportarJSON('comparacao.json', {
                geradoEm: new Date().toISOString(),
                ano: dados.ano,
                deputados: dados.deputados,
                categorias: dados.categorias,
            });
        } else {
            const colunas = [
                { titulo: 'Nome', chave: 'nome' },
                { titulo: 'Partido', chave: 'partido' },
                { titulo: 'UF', chave: 'uf' },
                { titulo: 'Cargo', chave: 'cargo' },
                { titulo: 'Total (R$)', chave: 'total' },
                { titulo: 'Média mensal (R$)', chave: 'media' },
                { titulo: 'Nº despesas', chave: 'quantidade' },
                { titulo: 'Principal categoria', chave: 'categoriaPrincipal' },
            ];
            exportarCSV('comparacao.csv', colunas, dados.deputados);
        }
    }

    function ligarExportacao() {
        $$('.btn-exportar').forEach((btn) => {
            btn.addEventListener('click', () => {
                const formato = btn.dataset.formato;
                const contexto = btn.dataset.contexto;
                if (contexto === 'Comparar') exportarComparacao(formato);
                else if (formato === 'csv') exportarCSVDoContexto(contexto);
                else if (formato === 'json') exportarJSONDoContexto(contexto);
            });
        });
    }

    function ligarCompartilhamento() {
        $$('.btn-compartilhar').forEach((btn) => {
            btn.addEventListener('click', copiarLink);
        });
    }

    /* ---- SEGUIR POLÍTICOS (localStorage) ---- */
    const CHAVE_SEGUIDOS = 'seuPolitico-seguidos';

    function lerSeguidos() {
        try { return JSON.parse(localStorage.getItem(CHAVE_SEGUIDOS)) || []; } catch (e) { return []; }
    }

    function salvarSeguidos(lista) {
        try { localStorage.setItem(CHAVE_SEGUIDOS, JSON.stringify(lista)); } catch (e) { /* armazenamento indisponível */ }
    }

    function estaSeguido(tipo, id) {
        return lerSeguidos().some((s) => s.tipo === tipo && String(s.id) === String(id));
    }

    function alternarSeguido(tipo, id, nome) {
        const lista = lerSeguidos();
        const indice = lista.findIndex((s) => s.tipo === tipo && String(s.id) === String(id));
        if (indice >= 0) lista.splice(indice, 1);
        else lista.push({ tipo, id: String(id), nome });
        salvarSeguidos(lista);
        return indice < 0; // true = passou a seguir
    }

    // Botão "Seguir" do perfil (chamado após renderizar o cabeçalho).
    function ligarBotaoSeguir(raiz, tipo, id, nome) {
        const btn = raiz.querySelector('.btn-seguir');
        if (!btn) return;
        const atualizar = () => {
            const seguindo = estaSeguido(tipo, id);
            btn.innerHTML = seguindo
                ? '<i class="fa-solid fa-user-check" aria-hidden="true"></i> Seguindo'
                : '<i class="fa-solid fa-user-plus" aria-hidden="true"></i> Seguir';
            btn.classList.toggle('btn-ativo', seguindo);
        };
        btn.addEventListener('click', () => {
            const agoraSeguindo = alternarSeguido(tipo, id, nome);
            atualizar();
            notificar(
                agoraSeguindo ? `Você passou a acompanhar ${nome}.` : `Você deixou de acompanhar ${nome}.`,
                agoraSeguindo ? 'fa-heart' : 'fa-user-minus'
            );
        });
        atualizar();
    }

    async function carregarSeguidosHome() {
        const container = $('#seguidosHome');
        if (!container) return;
        const seguidos = lerSeguidos().slice(0, 5);
        if (!seguidos.length) { container.innerHTML = ''; return; }

        container.innerHTML = `
            <h3 class="section-title" style="margin-top:24px;"><i class="fa-solid fa-heart" aria-hidden="true"></i> Você acompanha</h3>
            <div class="carregando"><i class="fa-solid fa-circle-notch" aria-hidden="true"></i><p>Carregando seus políticos...</p></div>`;

        try {
            const anoAtual = new Date().getFullYear();
            const cards = [];
            for (const s of seguidos) {
                try {
                    if (s.tipo === 'sen') {
                        const d = await SeuPoliticoAPI.analiseSenador(s.id, anoAtual);
                        const sen = d.senador || {};
                        cards.push({
                            nome: sen.nome || s.nome, partido: sen.partido, uf: sen.uf,
                            cargo: 'Senador', total: d.total, link: `senador.html?id=${s.id}`,
                        });
                    } else {
                        const d = await SeuPoliticoAPI.analiseDeputado(s.id, anoAtual);
                        const dep = d.deputado || {};
                        cards.push({
                            nome: dep.nome || s.nome, partido: dep.partido, uf: dep.uf,
                            cargo: 'Deputado Federal', total: d.total, link: `politico.html?id=${s.id}`,
                        });
                    }
                } catch (e) { /* ignora seguido que falhou */ }
            }
            container.innerHTML = `
                <h3 class="section-title" style="margin-top:24px;"><i class="fa-solid fa-heart" aria-hidden="true"></i> Você acompanha</h3>
                <div class="card-grid">
                    ${cards.length
                        ? cards.map((c) => `
                            <a href="${c.link}" class="card" style="text-decoration:none;color:inherit;">
                                <div class="card-titulo">${escaparHtml(c.nome)}</div>
                                <div class="perfil-dados" style="margin:6px 0 10px;">
                                    <span class="badge badge-partido">${escaparHtml(c.partido || '—')}</span>
                                    <span class="badge badge-uf">${escaparHtml(c.uf || '—')}</span>
                                    <span class="badge badge-cargo">${escaparHtml(c.cargo || '')}</span>
                                </div>
                                <div class="card-valor">${MotorAlerta.fmtBRL(c.total)}</div>
                                <div style="font-size:12px;color:var(--text-muted);margin-top:6px;">Total gasto no ano</div>
                            </a>`).join('')
                        : '<p style="color:var(--text-muted);font-size:14px;">Não foi possível carregar os políticos em acompanhamento.</p>'}
                </div>`;
        } catch (erro) {
            container.innerHTML = '';
        }
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

        // Políticos que o cidadão acompanha (localStorage) — carrega em paralelo.
        carregarSeguidosHome();
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
                ? `Deputados para ${partes.join(' · ')}`
                : 'Deputados (última legislatura)';
        }

        const lista = $('#listaResultados');
        const resumo = $('#resumoBusca');
        if (!lista) return;

        try {
            const listaDeputados = await buscarTodosDeputados({ nome, partido, uf });

            if (resumo) {
                resumo.innerHTML = `<p class="page-subtitle">${listaDeputados.length} deputado${listaDeputados.length === 1 ? '' : 's'} encontrado${listaDeputados.length === 1 ? '' : 's'}. Os sinais apontados são neutros — investigue você mesmo.</p>`;
            }

            if (!listaDeputados.length) {
                renderizarEstadosVazio(lista, 'estado-vazio', 'fa-user-slash', 'Nenhum deputado encontrado com esses critérios. Tente outro nome, partido ou estado.');
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
                        <a class="btn btn-sm btn-outline" href="comparar.html?add=dep:${encodeURIComponent(d.id)}">
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

            // Gráfico: gastos por partido.
            const porPartido = (dados.porPartido || []).slice(0, 12);
            if (porPartido.length) {
                criarOuAtualizar('graficoPartido', {
                    type: 'bar',
                    data: {
                        labels: porPartido.map((p) => p.partido),
                        datasets: [{
                            label: `Gasto em ${ano}`,
                            data: porPartido.map((p) => p.valor),
                            backgroundColor: coresPaleta[3],
                            borderRadius: 4,
                        }],
                    },
                    options: {
                        responsive: true,
                        plugins: {
                            tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${MotorAlerta.fmtBRL(ctx.parsed.y)}` } },
                        },
                    },
                });
            }

            // Gráfico: gastos por UF.
            const porUf = (dados.porUf || []).slice(0, 20);
            if (porUf.length) {
                criarOuAtualizar('graficoUf', {
                    type: 'bar',
                    data: {
                        labels: porUf.map((u) => u.uf),
                        datasets: [{
                            label: `Gasto em ${ano}`,
                            data: porUf.map((u) => u.valor),
                            backgroundColor: coresPaleta[6],
                            borderRadius: 4,
                        }],
                    },
                    options: {
                        responsive: true,
                        plugins: {
                            tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${MotorAlerta.fmtBRL(ctx.parsed.y)}` } },
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

        const seletorAno = $('#seletorAnoDeputado');
        const anoParam = Number(lerParametro('ano'));
        const anoSelecionado = anoParam || Number(seletorAno?.value) || new Date().getFullYear();
        if (seletorAno) seletorAno.value = String(anoSelecionado);

        try {
            const dados = await SeuPoliticoAPI.analiseDeputado(id, anoSelecionado);
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
                    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
                        <button class="btn btn-sm btn-outline btn-seguir" type="button">
                            <i class="fa-solid fa-user-plus" aria-hidden="true"></i> Seguir
                        </button>
                    </div>
                </div>`;

            ligarBotaoSeguir(cabecalho, 'dep', d.id, d.nome);

            // Indicadores.
            const set = (id, valor) => { const el = $(id); if (el) el.textContent = valor; };
            set('#perfilTotal', MotorAlerta.fmtBRL(dados.total));
            set('#perfilMedia', MotorAlerta.fmtBRL(dados.media));
            set('#perfilQtd', String(dados.quantidade ?? '—'));
            set('#perfilMaior', MotorAlerta.fmtBRL(dados.maior));

            // Sinais do motor de suspeita.
            renderizarSinais(listaAlertas, dados.sinais);

            // Maiores fornecedores no ano (top 5, neutro).
            renderizarTopFornecedores($('#topFornecedoresPerfil'), dados.fornecedores, { total: dados.total });

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

            // Votações em projetos de lei (mesmo ano de referência).
            carregarVotacoes(id, anoSelecionado);

            // Presença em Plenário (mesmo ano de referência).
            carregarPresencaDeputado(id, anoSelecionado);

            // Discursos em Plenário (mesmo ano de referência).
            carregarDiscursosDeputado(id, anoSelecionado);
        } catch (erro) {
            renderizarEstadosVazio(cabecalho, 'erro', 'fa-triangle-exclamation', erro.message);
            notificar(erro.message, 'fa-triangle-exclamation');
        }
    }

    function iniciarPerfil() {
        const sel = $('#seletorAnoDeputado');
        if (sel) {
            sel.addEventListener('change', () => {
                const url = new URL(window.location);
                url.searchParams.set('ano', sel.value);
                history.replaceState(null, '', url);
                carregarPerfil();
            });
        }
        carregarPerfil();
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
            ? filtradas.map(linhaDespesa).join('')
            : '<tr><td colspan="6" class="estado-vazio">Nenhuma despesa encontrada com os filtros aplicados.</td></tr>';
    }

    /* ======================================================================
       VOTAÇÕES EM PROJETOS DE LEI (Câmara)
       ====================================================================== */
    async function carregarVotacoes(id, ano, pagina = 1) {
        const container = $('#listaVotacoes');
        if (!container) return;
        try {
            const dados = await SeuPoliticoAPI.obterVotacoesDeputado(id, { ano, pagina });
            votacoesAtuais = dados.dados || [];
            votacaoPagina = pagina;
            renderizarVotacoes(container, id, ano, dados.links || {});
        } catch (erro) {
            renderizarEstadosVazio(container, 'erro', 'fa-triangle-exclamation',
                `${erro.message} As votações podem não estar disponíveis para este parlamentar.`);
        }
    }

    function renderizarVotacoes(container, id, ano, links) {
        const pagina = links.pagina || 1;
        const ultima = links.ultima || 1;

        container.innerHTML = `
            <div class="tabela-wrapper">
                <table class="tabela">
                    <thead>
                        <tr>
                            <th>Data</th>
                            <th>Proposição</th>
                            <th>Órgão</th>
                            <th>Voto</th>
                            <th>Detalhe</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${votacoesAtuais.length
                            ? votacoesAtuais.map((v) => `
                                <tr>
                                    <td>${escaparHtml(v.data || '—')}</td>
                                    <td style="white-space:normal;max-width:340px;">
                                        <strong>${escaparHtml(v.titulo || '—')}</strong>
                                        ${v.ementa ? `<div style="font-size:12px;color:var(--text-muted);">${escaparHtml(v.ementa)}</div>` : ''}
                                    </td>
                                    <td>${escaparHtml(v.orgao || '—')}</td>
                                    <td><span class="badge badge-partido">${escaparHtml(v.voto || '—')}</span></td>
                                    <td>
                                        <button class="btn btn-sm btn-outline btn-detalhe-votacao" type="button" data-id="${escaparHtml(v.idVotacao)}">
                                            <i class="fa-solid fa-eye" aria-hidden="true"></i> Detalhes
                                        </button>
                                    </td>
                                </tr>`).join('')
                            : '<tr><td colspan="5" class="estado-vazio">Nenhuma votação encontrada para o ano selecionado.</td></tr>'}
                    </tbody>
                </table>
            </div>
            <div style="display:flex;gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap;">
                ${pagina > 1 ? `<button class="btn btn-sm btn-outline btn-pag-votacao" type="button" data-pagina="${pagina - 1}">← Anterior</button>` : ''}
                <span style="font-size:13px;color:var(--text-muted);">Página ${pagina} de ${ultima}</span>
                ${pagina < ultima ? `<button class="btn btn-sm btn-outline btn-pag-votacao" type="button" data-pagina="${pagina + 1}">Próxima →</button>` : ''}
            </div>
            <div id="detalheVotacao" style="margin-top:14px;"></div>`;

        container.querySelectorAll('.btn-pag-votacao').forEach((btn) => {
            btn.addEventListener('click', () => carregarVotacoes(id, ano, Number(btn.dataset.pagina)));
        });
        container.querySelectorAll('.btn-detalhe-votacao').forEach((btn) => {
            btn.addEventListener('click', () => carregarDetalheVotacao(btn.dataset.id));
        });
    }

    async function carregarDetalheVotacao(idVotacao) {
        const caixa = $('#detalheVotacao');
        if (!caixa) return;
        caixa.innerHTML = '<div class="carregando"><i class="fa-solid fa-circle-notch" aria-hidden="true"></i><p>Carregando detalhes da votação...</p></div>';
        try {
            const dados = await SeuPoliticoAPI.obterDetalheVotacao(idVotacao);
            const resultado = dados.resultado || {};
            const votos = dados.votos || [];
            caixa.innerHTML = `
                <div class="card">
                    <div class="card-titulo">${escaparHtml(dados.titulo || 'Votação')}</div>
                    ${dados.ementa ? `<p style="color:var(--text-secondary);font-size:14px;margin-top:4px;">${escaparHtml(dados.ementa)}</p>` : ''}
                    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;">
                        <span class="badge badge-uf">Sim: ${escaparHtml(resultado.sim ?? '—')}</span>
                        <span class="badge badge-partido">Não: ${escaparHtml(resultado.nao ?? '—')}</span>
                        <span class="badge badge-cargo">Abstenções: ${escaparHtml(resultado.abstencoes ?? '—')}</span>
                        ${resultado.totalVotos ? `<span class="badge badge-uf">Total: ${escaparHtml(resultado.totalVotos)}</span>` : ''}
                    </div>
                    <div class="tabela-wrapper" style="margin-top:14px;">
                        <table class="tabela">
                            <thead><tr><th>Deputado</th><th>Partido</th><th>UF</th><th>Voto</th></tr></thead>
                            <tbody>
                                ${votos.length
                                    ? votos.map((v) => `
                                        <tr>
                                            <td>${escaparHtml(v.deputado?.nome || '—')}</td>
                                            <td>${escaparHtml(v.deputado?.partido || '—')}</td>
                                            <td>${escaparHtml(v.deputado?.uf || '—')}</td>
                                            <td>${escaparHtml(v.voto || '—')}</td>
                                        </tr>`).join('')
                                    : '<tr><td colspan="4" class="estado-vazio">Detalhes de votos indisponíveis.</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>`;
        } catch (erro) {
            caixa.innerHTML = `<div class="erro"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><p>${escaparHtml(erro.message)}</p></div>`;
        }
    }

    /* ======================================================================
       VOTAÇÕES DO SENADOR (Plenário — Senado Federal)
       ====================================================================== */
    async function carregarVotacoesSenador(id, ano) {
        const container = $('#listaVotacoesSenador');
        if (!container) return;
        try {
            const dados = await SeuPoliticoAPI.obterVotacoesSenador(id, { ano });
            votacoesSenadorAtuais = dados.dados || [];
            renderizarVotacoesSenador(container, ano);
        } catch (erro) {
            renderizarEstadosVazio(container, 'erro', 'fa-triangle-exclamation',
                `${erro.message} As votações podem não estar disponíveis para este senador.`);
        }
    }

    function renderizarVotacoesSenador(container, ano) {
        const rows = votacoesSenadorAtuais;
        container.innerHTML = `
            <div class="tabela-wrapper">
                <table class="tabela">
                    <thead>
                        <tr>
                            <th>Data</th>
                            <th>Proposição</th>
                            <th>Votação</th>
                            <th>Voto</th>
                            <th>Detalhe</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.length
                            ? rows.map((v) => `
                                <tr>
                                    <td>${escaparHtml(v.data || '—')}</td>
                                    <td style="white-space:normal;max-width:140px;"><strong>${escaparHtml(v.titulo || '—')}</strong></td>
                                    <td style="white-space:normal;max-width:340px;">${escaparHtml(v.ementa || '—')}</td>
                                    <td><span class="badge badge-partido">${escaparHtml(v.voto || '—')}</span></td>
                                    <td>
                                        <button class="btn btn-sm btn-outline btn-detalhe-votacao-senador" type="button" data-sessao="${escaparHtml(v.sessao)}" data-id="${escaparHtml(v.idVotacao)}">
                                            <i class="fa-solid fa-eye" aria-hidden="true"></i> Detalhes
                                        </button>
                                    </td>
                                </tr>`).join('')
                            : '<tr><td colspan="5" class="estado-vazio">Nenhuma votação encontrada para o ano selecionado.</td></tr>'}
                    </tbody>
                </table>
            </div>
            <div id="detalheVotacaoSenador" style="margin-top:14px;"></div>`;

        container.querySelectorAll('.btn-detalhe-votacao-senador').forEach((btn) => {
            btn.addEventListener('click', () => carregarDetalheVotacaoSenado(btn.dataset.sessao, btn.dataset.id));
        });
    }

    async function carregarDetalheVotacaoSenado(sessao, idVotacao) {
        const caixa = $('#detalheVotacaoSenador');
        if (!caixa) return;
        caixa.innerHTML = '<div class="carregando"><i class="fa-solid fa-circle-notch" aria-hidden="true"></i><p>Carregando detalhes da votação...</p></div>';
        try {
            const dados = await SeuPoliticoAPI.obterDetalheVotacaoSenado(sessao, idVotacao);
            const r = dados.resultado || {};
            const votos = dados.votos || [];
            caixa.innerHTML = `
                <div class="card">
                    <div class="card-titulo">${escaparHtml(dados.titulo || 'Votação')}</div>
                    ${dados.ementa ? `<p style="color:var(--text-secondary);font-size:14px;margin-top:4px;">${escaparHtml(dados.ementa)}</p>` : ''}
                    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;">
                        <span class="badge badge-uf">Sim: ${escaparHtml(r.sim ?? '—')}</span>
                        <span class="badge badge-partido">Não: ${escaparHtml(r.nao ?? '—')}</span>
                        <span class="badge badge-cargo">Abstenções: ${escaparHtml(r.abstencoes ?? '—')}</span>
                        ${r.totalVotos ? `<span class="badge badge-uf">Total: ${escaparHtml(r.totalVotos)}</span>` : ''}
                    </div>
                    <div class="tabela-wrapper" style="margin-top:14px;">
                        <table class="tabela">
                            <thead><tr><th>Senador</th><th>Partido</th><th>UF</th><th>Voto</th></tr></thead>
                            <tbody>
                                ${votos.length
                                    ? votos.map((v) => `
                                        <tr>
                                            <td>${escaparHtml(v.senador?.nome || '—')}</td>
                                            <td>${escaparHtml(v.senador?.partido || '—')}</td>
                                            <td>${escaparHtml(v.senador?.uf || '—')}</td>
                                            <td>${escaparHtml(v.voto || '—')}</td>
                                        </tr>`).join('')
                                    : '<tr><td colspan="4" class="estado-vazio">Detalhes de votos indisponíveis.</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>`;
        } catch (erro) {
            caixa.innerHTML = `<div class="erro"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><p>${escaparHtml(erro.message)}</p></div>`;
        }
    }

    /* ======================================================================
       PRESENÇA / FREQUÊNCIA (deputados e senadores)
       ====================================================================== */
    function renderizarFrequencia(container, dados) {
        if (!container) return;
        if (!dados || dados.presencas === undefined) {
            renderizarEstadosVazio(container, 'erro', 'fa-triangle-exclamation', 'Dados de presença indisponíveis.');
            return;
        }

        const totalDias = dados.totalSessoes ?? dados.totalVotacoes ?? null;
        const rotuloTotal = dados.totalSessoes != null ? 'dias de sessão' : 'votações registradas';

        container.innerHTML = `
            <div class="card-grid">
                <div class="card">
                    <div class="card-titulo">Presenças</div>
                    <div class="card-valor" style="color:var(--alerta-comparacao);">${dados.presencas}</div>
                </div>
                <div class="card">
                    <div class="card-titulo">Faltas justificadas</div>
                    <div class="card-valor" style="color:var(--alerta-voce-olhar);">${dados.faltasJustificadas}</div>
                </div>
                <div class="card">
                    <div class="card-titulo">Faltas injustificadas</div>
                    <div class="card-valor" style="color:#b23b3b;">${dados.faltasInjustificadas}</div>
                </div>
                ${totalDias != null ? `
                <div class="card">
                    <div class="card-titulo">Total de ${rotuloTotal}</div>
                    <div class="card-valor">${totalDias}</div>
                </div>` : ''}
            </div>
            <div class="card" style="margin-top:16px;display:flex;gap:18px;flex-wrap:wrap;align-items:center;">
                <div style="min-width:220px;max-width:280px;flex:1;">
                    <canvas id="graficoPresenca" aria-label="Gráfico de presença e faltas" role="img"></canvas>
                </div>
                <div style="flex:1;min-width:220px;font-size:13px;color:var(--text-secondary);line-height:1.8;">
                    <strong>Taxa de presença:</strong> ${MotorAlerta.fmtNumero(dados.taxaPresenca ?? 0, 1)}%<br>
                    <span>${escaparHtml(dados.fonte || '')}</span><br>
                    <a href="${escaparHtml(dados.urlFonte || '#')}" target="_blank" rel="noopener" class="btn btn-sm btn-outline" style="margin-top:8px;">
                        <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> Verificar na fonte oficial
                    </a>
                </div>
            </div>`;

        criarOuAtualizar('graficoPresenca', {
            type: 'doughnut',
            data: {
                labels: ['Presenças', 'Faltas justificadas', 'Faltas injustificadas'],
                datasets: [{
                    data: [dados.presencas, dados.faltasJustificadas, dados.faltasInjustificadas],
                    backgroundColor: [coresPaleta[2], coresPaleta[3], coresPaleta[4]],
                    borderWidth: 0,
                }],
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { position: 'bottom', labels: { font: { family: 'Segoe UI' } } },
                    tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${ctx.parsed}` } },
                },
            },
        });
    }

    async function carregarPresencaDeputado(id, ano) {
        const container = $('#conteudoPresencaDeputado');
        if (!container) return;
        try {
            const dados = await SeuPoliticoAPI.obterFrequenciaDeputado(id, ano);
            renderizarFrequencia(container, dados);
        } catch (erro) {
            renderizarEstadosVazio(container, 'erro', 'fa-triangle-exclamation',
                `${erro.message} A presença pode não estar disponível para este parlamentar.`);
        }
    }

    async function carregarPresencaSenador(id, ano) {
        const container = $('#conteudoPresencaSenador');
        if (!container) return;
        try {
            const dados = await SeuPoliticoAPI.obterFrequenciaSenador(id, ano);
            renderizarFrequencia(container, dados);
        } catch (erro) {
            renderizarEstadosVazio(container, 'erro', 'fa-triangle-exclamation',
                `${erro.message} A presença pode não estar disponível para este senador.`);
        }
    }

    /* ======================================================================
       DISCURSOS / PRONUNCIAMENTOS
       ====================================================================== */
    function renderizarDiscursos(container, dados) {
        if (!container) return;
        const lista = dados && Array.isArray(dados.dados) ? dados.dados : [];
        if (!lista.length) {
            renderizarEstadosVazio(container, 'estado-vazio', 'fa-microphone-lines', 'Nenhum pronunciamento encontrado para o ano selecionado.');
            return;
        }
        container.innerHTML = `
            <div class="tabela-wrapper">
                <table class="tabela">
                    <thead><tr><th>Data</th><th>Tipo</th><th>Resumo</th><th>Texto</th></tr></thead>
                    <tbody>
                        ${lista.map((d, i) => {
                            const data = String(d.dataHoraInicio || '').slice(0, 10);
                            const temConteudo = d.transcricao || d.urlTexto || d.urlAudio || d.urlVideo;
                            return `
                            <tr>
                                <td>${escaparHtml(data || '—')}</td>
                                <td>${escaparHtml(d.tipoDiscurso || '—')}</td>
                                <td style="white-space:normal;max-width:380px;">${escaparHtml(d.sumario || '—')}</td>
                                <td>
                                    ${temConteudo ? `
                                        <button class="btn btn-sm btn-outline btn-discurso" type="button" data-indice="${i}">
                                            <i class="fa-solid fa-comment" aria-hidden="true"></i> Ler
                                        </button>` : '<span class="texto-muted">—</span>'}
                                </td>
                            </tr>
                            ${temConteudo ? `
                            <tr class="linha-discurso" id="discurso-${i}" style="display:none;">
                                <td colspan="4" style="white-space:normal;background:var(--bg-main);">
                                    ${d.transcricao ? `<p style="font-size:13px;line-height:1.7;">${escaparHtml(d.transcricao)}</p>` : ''}
                                    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
                                        ${d.urlTexto ? `<a class="btn btn-sm" href="${escaparHtml(d.urlTexto)}" target="_blank" rel="noopener"><i class="fa-solid fa-file-lines" aria-hidden="true"></i> Texto completo</a>` : ''}
                                        ${d.urlAudio ? `<a class="btn btn-sm" href="${escaparHtml(d.urlAudio)}" target="_blank" rel="noopener"><i class="fa-solid fa-volume-high" aria-hidden="true"></i> Áudio</a>` : ''}
                                        ${d.urlVideo ? `<a class="btn btn-sm" href="${escaparHtml(d.urlVideo)}" target="_blank" rel="noopener"><i class="fa-solid fa-video" aria-hidden="true"></i> Vídeo</a>` : ''}
                                    </div>
                                </td>
                            </tr>` : ''}`;
                        }).join('')}
                    </tbody>
                </table>
            </div>`;
        container.querySelectorAll('.btn-discurso').forEach((btn) => {
            btn.addEventListener('click', () => {
                const linha = document.getElementById(`discurso-${btn.dataset.indice}`);
                if (linha) linha.style.display = linha.style.display === 'none' ? '' : 'none';
            });
        });
    }

    async function carregarDiscursosDeputado(id, ano) {
        const container = $('#listaDiscursosDeputado');
        if (!container) return;
        try {
            const dados = await SeuPoliticoAPI.obterDiscursosDeputado(id, ano);
            renderizarDiscursos(container, dados);
        } catch (erro) {
            renderizarEstadosVazio(container, 'erro', 'fa-triangle-exclamation',
                `${erro.message} Os pronunciamentos podem não estar disponíveis para este deputado.`);
        }
    }

    async function carregarDiscursosSenador(id, ano) {
        const container = $('#listaDiscursosSenador');
        if (!container) return;
        try {
            const dados = await SeuPoliticoAPI.obterDiscursosSenador(id, ano);
            renderizarDiscursos(container, dados);
        } catch (erro) {
            renderizarEstadosVazio(container, 'erro', 'fa-triangle-exclamation',
                `${erro.message} Os pronunciamentos podem não estar disponíveis para este senador.`);
        }
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
                        <a class="btn btn-sm btn-outline" href="comparar.html?add=sen:${encodeURIComponent(s.id)}">
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

        const seletorAno = $('#seletorAnoSenador');
        const anoParam = Number(lerParametro('ano'));
        const anoSelecionado = anoParam || Number(seletorAno?.value) || new Date().getFullYear();
        if (seletorAno) seletorAno.value = String(anoSelecionado);

        try {
            const dados = await SeuPoliticoAPI.analiseSenador(id, anoSelecionado);
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
                    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
                        <button class="btn btn-sm btn-outline btn-seguir" type="button">
                            <i class="fa-solid fa-user-plus" aria-hidden="true"></i> Seguir
                        </button>
                    </div>
                </div>`;

            ligarBotaoSeguir(cabecalho, 'sen', s.id, s.nome);

            const set = (idEl, valor) => { const el = $(idEl); if (el) el.textContent = valor; };
            set('#senadorTotal', MotorAlerta.fmtBRL(dados.total));
            set('#senadorMedia', MotorAlerta.fmtBRL(dados.media));
            set('#senadorQtd', String(dados.quantidade ?? '—'));
            set('#senadorMaior', MotorAlerta.fmtBRL(dados.maior));

            renderizarSinais(listaAlertas, dados.sinais);

            // Maiores fornecedores no ano (top 5, neutro).
            renderizarTopFornecedores($('#topFornecedoresSenador'), dados.fornecedores, { total: dados.total });

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

            // Presença em votações nominais (mesmo ano de referência).
            carregarPresencaSenador(id, anoSelecionado);

            // Votações em projetos de lei (mesmo ano de referência).
            carregarVotacoesSenador(id, anoSelecionado);

            // Discursos (mesmo ano de referência).
            carregarDiscursosSenador(id, anoSelecionado);
        } catch (erro) {
            renderizarEstadosVazio(cabecalho, 'erro', 'fa-triangle-exclamation', erro.message);
            notificar(erro.message, 'fa-triangle-exclamation');
        }
    }

    function iniciarSenador() {
        const sel = $('#seletorAnoSenador');
        if (sel) {
            sel.addEventListener('change', () => {
                const url = new URL(window.location);
                url.searchParams.set('ano', sel.value);
                history.replaceState(null, '', url);
                carregarSenador();
            });
        }
        carregarSenador();
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
            ? filtradas.map((dsp) => `
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

    /* ---- Contratos da Presidência ---- */
    async function carregarContratosPresidente() {
        const ano = Number($('#seletorAnoPresidente')?.value || new Date().getFullYear());
        const set = (id, valor) => { const el = $(id); if (el) el.textContent = valor; };
        const corpo = $('#corpoTabelaContratosPresidente');

        set('#presContratos', 'Carregando...');
        set('#presContratosTotal', 'Carregando...');
        set('#presContratosMedia', 'Carregando...');
        set('#presContratosMaior', 'Carregando...');
        if (corpo) corpo.innerHTML = '<tr><td colspan="8" class="carregando">Carregando...</td></tr>';

        try {
            const dados = await SeuPoliticoAPI.obterContratosPresidente(ano);

            set('#presContratos', String(dados.totalContratos ?? '—'));
            set('#presContratosTotal', MotorAlerta.fmtBRL(dados.totalFinal));
            set('#presContratosMedia', MotorAlerta.fmtBRL(dados.mediaContrato));
            set('#presContratosMaior', dados.maiorContrato ? MotorAlerta.fmtBRL(dados.maiorContrato.valorFinal) : '—');

            renderizarSinais($('#sinaisContratosPresidente'), dados.sinais);

            // Maiores fornecedores de contratos no ano (top 5, neutro).
            renderizarTopFornecedores($('#topFornecedoresPresidente'), dados.topFornecedores, { total: dados.totalFinal });

            const porModalidade = dados.porModalidade || [];
            if (porModalidade.length) {
                criarOuAtualizar('graficoContratoPresidente', {
                    type: 'bar',
                    data: {
                        labels: porModalidade.map((m) => m.modalidade),
                        datasets: [{ label: `Contratos em ${ano}`, data: porModalidade.map((m) => m.valor), backgroundColor: coresPaleta[0], borderRadius: 6 }],
                    },
                    options: { responsive: true, indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${MotorAlerta.fmtBRL(ctx.parsed.x)}` } } } },
                });
            }

            presidenteContratos = dados.contratos || [];
            popularTiposFiltro($('#filtroTipoContratoPresidente'), presidenteContratos, 'modalidade');
            renderizarTabelaContratosPresidente();
            ligarFiltrosTabela('ContratoPresidente', renderizarTabelaContratosPresidente);

            set('#avisoContratosPresidente', dados.aviso || '');
        } catch (erro) {
            ['#presContratos', '#presContratosTotal', '#presContratosMedia', '#presContratosMaior'].forEach((id) => set(id, '—'));
            if (corpo) corpo.innerHTML = `<tr><td colspan="8" class="erro">${escaparHtml(erro.message)}</td></tr>`;
            notificar(erro.message, 'fa-triangle-exclamation');
        }
    }

    function renderizarTabelaContratosPresidente() {
        const corpo = $('#corpoTabelaContratosPresidente');
        const contagem = $('#contagemContratosPresidente');
        if (!corpo) return;

        const tipo = $('#filtroTipoContratoPresidente')?.value || '';
        const mes = $('#filtroMesContratoPresidente')?.value || '';
        const busca = ($('#filtroFornecedorContratoPresidente')?.value || '').toLowerCase().trim();
        const filtradas = filtrarDespesas(presidenteContratos, { tipo, mes, busca, campoBusca: 'fornecedor' });

        if (contagem) contagem.textContent = `Exibindo ${filtradas.length} de ${presidenteContratos.length} contratos.`;
        corpo.innerHTML = filtradas.length
            ? filtradas.map((c) => `
                <tr>
                    <td>${escaparHtml(c.numero || '—')}</td>
                    <td style="white-space:normal;max-width:300px;">${escaparHtml(c.objeto || '—')}</td>
                    <td>${escaparHtml(c.fornecedor)}</td>
                    <td>${escaparHtml(c.modalidade || '—')}</td>
                    <td>${escaparHtml(c.dataAssinatura || '—')}</td>
                    <td>${MotorAlerta.fmtBRL(c.valorInicial)}</td>
                    <td>${MotorAlerta.fmtBRL(c.valorFinal)}</td>
                    <td><a href="${escaparHtml(c.linkPortal)}" target="_blank" rel="noopener" title="Abrir comprovante no Portal da Transparência"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> Comprovante</a></td>
                </tr>`).join('')
            : '<tr><td colspan="8" class="estado-vazio">Nenhum contrato encontrado com os filtros aplicados.</td></tr>';
    }

    function iniciarPresidente() {
        const sel = $('#seletorAnoPresidente');
        const anoParam = Number(lerParametro('ano'));
        if (sel && anoParam) sel.value = String(anoParam);
        if (sel) {
            sel.addEventListener('change', () => {
                const url = new URL(window.location);
                url.searchParams.set('ano', sel.value);
                history.replaceState(null, '', url);
                carregarGastosPresidente();
                carregarContratosPresidente();
            });
        }
        carregarPresidente();
        carregarGastosPresidente();
        carregarContratosPresidente();
        const botao = $('#botaoAtualizarGastosPresidente');
        if (botao) botao.addEventListener('click', () => { carregarGastosPresidente(); carregarContratosPresidente(); });
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
    let senadoresCache = [];

    function sincronizarCompararUrl() {
        const url = new URL(window.location);
        const set = (chave, valor) => {
            if (valor) url.searchParams.set(chave, valor); else url.searchParams.delete(chave);
        };
        set('dep1', $('#seletorDep1')?.value || '');
        set('dep2', $('#seletorDep2')?.value || '');
        set('cargo1', $('#cargoDep1')?.value || '');
        set('cargo2', $('#cargoDep2')?.value || '');
        set('ano', $('#seletorAnoComparar')?.value || '');
        history.replaceState(null, '', url);
    }

    async function popularSeletoresComparar() {
        const sel1 = $('#seletorDep1');
        const sel2 = $('#seletorDep2');
        const cargo1 = $('#cargoDep1');
        const cargo2 = $('#cargoDep2');
        const anoSel = $('#seletorAnoComparar');
        if (!sel1 || !sel2) return;

        const anoParam = Number(lerParametro('ano'));
        if (anoSel && anoParam) anoSel.value = String(anoParam);

        const preencherSelect = (sel, dados) => {
            const valorAtual = sel.value;
            sel.innerHTML = '<option value="">Selecione...</option>';
            dados.forEach((d) => {
                const opt = document.createElement('option');
                opt.value = d.id;
                opt.textContent = `${d.nome} (${d.partido || '—'}-${d.uf || '—'})`;
                sel.appendChild(opt);
            });
            return valorAtual;
        };

        try {
            if (!deputadosCache.length) deputadosCache = await buscarTodosDeputados({});
            if (!senadoresCache.length) {
                const { dados: senadores } = await SeuPoliticoAPI.buscarSenadores({});
                senadoresCache = senadores || [];
            }

            const depOpts = deputadosCache.map((d) => ({ id: `dep:${d.id}`, nome: d.nome, partido: d.partido, uf: d.uf }));
            const senOpts = senadoresCache.map((s) => ({ id: `sen:${s.id}`, nome: s.nome, partido: s.partido, uf: s.uf }));

            const preencherPorCargo = (cargo, sel) => {
                preencherSelect(sel, cargo === 'sen' ? senOpts : depOpts);
            };

            const aplicarUrl = () => {
                const dep1 = lerParametro('dep1');
                const dep2 = lerParametro('dep2');
                const cargo1Param = lerParametro('cargo1');
                const cargo2Param = lerParametro('cargo2');
                if (cargo1 && cargo1Param) cargo1.value = cargo1Param;
                if (cargo2 && cargo2Param) cargo2.value = cargo2Param;
                preencherPorCargo(cargo1?.value || 'dep', sel1);
                preencherPorCargo(cargo2?.value || 'dep', sel2);
                if (dep1) sel1.value = dep1;
                if (dep2) sel2.value = dep2;
            };

            if (cargo1) cargo1.addEventListener('change', () => { preencherPorCargo(cargo1.value, sel1); sincronizarCompararUrl(); });
            if (cargo2) cargo2.addEventListener('change', () => { preencherPorCargo(cargo2.value, sel2); sincronizarCompararUrl(); });
            [sel1, sel2].forEach((sel) => sel.addEventListener('change', sincronizarCompararUrl));
            if (anoSel) anoSel.addEventListener('change', sincronizarCompararUrl);

            aplicarUrl();

            const add = lerParametro('add');
            if (add) {
                const tipoAdd = add.includes(':') ? add.split(':')[0] : 'dep';
                if (cargo1) cargo1.value = tipoAdd;
                preencherPorCargo(tipoAdd, sel1);
                sel1.value = add;
            }
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
            comparacaoAtual = dados;
            const lista = dados.deputados || [];

            // Sinais comparativos.
            const sinais = MotorAlerta.comparar(lista.map((d) => ({ nome: d.nome, total: d.total })));

            const linkPerfil = (d) => {
                const idPuro = String(d.id).slice(4);
                const pagina = String(d.id).startsWith('sen:') ? 'senador.html' : 'politico.html';
                return `${pagina}?id=${encodeURIComponent(idPuro)}`;
            };

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
                                <span class="badge badge-cargo">${escaparHtml(d.cargo || '—')}</span>
                            </div>
                            <div class="card-valor">${MotorAlerta.fmtBRL(d.total)}</div>
                            <div style="margin-top:6px;font-size:13px;color:var(--text-secondary);">
                                Média mensal: ${MotorAlerta.fmtBRL(d.media)}<br>
                                Principal categoria: ${escaparHtml(d.categoriaPrincipal || '—')}
                            </div>
                            <a class="btn btn-sm btn-outline" style="margin-top:12px;" href="${linkPerfil(d)}">Ver perfil</a>
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
       VOTAÇÃO POR PROPOSIÇÃO (votacao.html)
       ====================================================================== */
    async function buscarProposicao() {
        const campo = $('#campoProposicao');
        const container = $('#resultadoProposicao');
        if (!campo || !container) return;
        const texto = (campo.value || '').trim();
        const m = texto.match(/^([A-Z]{1,6})\s*(\d+)\s*\/\s*(\d{4})$/i);
        if (!m) {
            notificar('Formato: sigla número/ano — ex.: PL 1234/2025', 'fa-hand-pointer');
            return;
        }
        const [, siglaTipo, numero, ano] = m;
        container.innerHTML = '<div class="carregando"><i class="fa-solid fa-circle-notch" aria-hidden="true"></i><p>Buscando proposição...</p></div>';
        try {
            const prop = await SeuPoliticoAPI.buscarProposicao(siglaTipo.toUpperCase(), numero, ano);
            const votacoes = await SeuPoliticoAPI.obterVotacoesProposicao(prop.id);
            renderizarProposicao(container, prop, votacoes.dados || []);
        } catch (erro) {
            renderizarEstadosVazio(container, 'erro', 'fa-triangle-exclamation', erro.message);
        }
    }

    function renderizarProposicao(container, prop, votacoes) {
        container.innerHTML = `
            <div class="card">
                <div class="card-titulo">${escaparHtml(prop.sigla || '')}</div>
                <p style="color:var(--text-secondary);font-size:14px;">${escaparHtml(prop.ementa || '—')}</p>
                <div class="perfil-dados" style="margin-top:8px;">
                    ${prop.autor ? `<span><i class="fa-solid fa-user-pen" aria-hidden="true"></i> ${escaparHtml(prop.autor)}</span>` : ''}
                    <span><i class="fa-solid fa-calendar" aria-hidden="true"></i> ${escaparHtml((prop.dataApresentacao || '').slice(0, 10))}</span>
                </div>
            </div>
            <h3 class="section-title" style="margin-top:20px;"><i class="fa-solid fa-check-to-slot" aria-hidden="true"></i> Votações</h3>
            ${votacoes.length ? `
                <div class="tabela-wrapper">
                    <table class="tabela">
                        <thead><tr><th>Data</th><th>Órgão</th><th>Votação</th><th>Placar</th></tr></thead>
                        <tbody>
                            ${votacoes.map((v) => `
                                <tr>
                                    <td>${escaparHtml(v.data || '—')}</td>
                                    <td>${escaparHtml(v.orgao || '—')}</td>
                                    <td style="white-space:normal;max-width:380px;">${escaparHtml(v.descricao || '—')}</td>
                                    <td>
                                        <button class="btn btn-sm btn-outline btn-votos-proposicao" type="button" data-id="${escaparHtml(v.idVotacao)}">
                                            <i class="fa-solid fa-eye" aria-hidden="true"></i> Ver votos
                                        </button>
                                    </td>
                                </tr>`).join('')}
                        </tbody>
                    </table>
                </div>
                <div id="detalheProposicao" style="margin-top:14px;"></div>`
            : '<div class="estado-vazio"><i class="fa-solid fa-inbox" aria-hidden="true"></i><p>Esta proposição ainda não teve votações registradas.</p></div>'}`;

        container.querySelectorAll('.btn-votos-proposicao').forEach((btn) => {
            btn.addEventListener('click', () => carregarVotosProposicao(btn.dataset.id));
        });
    }

    async function carregarVotosProposicao(idVotacao) {
        const caixa = $('#detalheProposicao');
        if (!caixa) return;
        caixa.innerHTML = '<div class="carregando"><i class="fa-solid fa-circle-notch" aria-hidden="true"></i><p>Carregando votos...</p></div>';
        try {
            const dados = await SeuPoliticoAPI.obterDetalheVotacao(idVotacao);
            const r = dados.resultado || {};
            const votos = dados.votos || [];
            const ufUsuario = lerUfUsuario();
            caixa.innerHTML = `
                <div class="card">
                    <div class="card-titulo">${escaparHtml(dados.titulo || 'Votação')}</div>
                    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;">
                        <span class="badge badge-uf">Sim: ${escaparHtml(r.sim ?? '—')}</span>
                        <span class="badge badge-partido">Não: ${escaparHtml(r.nao ?? '—')}</span>
                        <span class="badge badge-cargo">Abstenções: ${escaparHtml(r.abstencoes ?? '—')}</span>
                        ${r.totalVotos ? `<span class="badge badge-uf">Total: ${escaparHtml(r.totalVotos)}</span>` : ''}
                    </div>
                    <div class="tabela-wrapper" style="margin-top:12px;">
                        <table class="tabela">
                            <thead><tr><th>Deputado</th><th>Partido</th><th>UF</th><th>Voto</th></tr></thead>
                            <tbody>
                                ${votos.length
                                    ? votos.map((v) => `
                                        <tr${v.deputado?.uf === ufUsuario ? ' style="background:var(--hover-bg);"' : ''}>
                                            <td>${escaparHtml(v.deputado?.nome || '—')}</td>
                                            <td>${escaparHtml(v.deputado?.partido || '—')}</td>
                                            <td>${escaparHtml(v.deputado?.uf || '—')}</td>
                                            <td>${escaparHtml(v.voto || '—')}</td>
                                        </tr>`).join('')
                                    : '<tr><td colspan="4" class="estado-vazio">Sem votos individuais disponíveis.</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                    ${ufUsuario ? `<p style="font-size:12px;color:var(--text-muted);margin-top:8px;">Linhas destacadas: deputados de <strong>${ufUsuario}</strong>.</p>` : ''}
                </div>`;
        } catch (erro) {
            caixa.innerHTML = `<div class="erro"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><p>${escaparHtml(erro.message)}</p></div>`;
        }
    }

    function lerUfUsuario() {
        try { return localStorage.getItem('seuPolitico-uf') || ''; } catch (e) { return ''; }
    }

    function iniciarVotacaoProposicao() {
        const form = $('#formProposicao');
        if (form) form.addEventListener('submit', (e) => { e.preventDefault(); buscarProposicao(); });

        const selUf = $('#seletorUfUsuario');
        if (selUf) {
            UFs.forEach((uf) => {
                const o = document.createElement('option');
                o.value = uf;
                o.textContent = uf;
                selUf.appendChild(o);
            });
            try {
                const t = localStorage.getItem('seuPolitico-uf');
                if (t) selUf.value = t;
            } catch (e) { /* armazenamento indisponível */ }
            selUf.addEventListener('change', () => {
                try { localStorage.setItem('seuPolitico-uf', selUf.value); } catch (e) { /* ignore */ }
            });
        }

        const q = lerParametro('q');
        if (q) {
            const campo = $('#campoProposicao');
            if (campo) campo.value = q;
            buscarProposicao();
        }
    }

    /* ======================================================================
       ROTEADOR DE PÁGINA
       ====================================================================== */
    function rotearPagina() {
        if ($('#indicadoresGerais')) carregarHome();
        else if ($('#listaResultados')) carregarResultados();
        else if ($('#seletorAnoDashboard')) iniciarDashboard();
        else if ($('#perfilCabecalho')) iniciarPerfil();
        else if ($('#seletorDep1')) iniciarComparar();
        else if ($('#listaSenadores')) carregarSenadores();
        else if ($('#perfilSenadorCabecalho')) iniciarSenador();
        else if ($('#seletorOrgaoExecutivo')) iniciarExecutivo();
        else if ($('#perfilPresidente')) iniciarPresidente();
        else if ($('#listaCandidatos')) carregarCandidatos();
        else if ($('#formProposicao')) iniciarVotacaoProposicao();
    }

    /* ---- ARRANQUE ---- */
    document.addEventListener('DOMContentLoaded', () => {
        iniciarMenuResponsivo();
        iniciarBusca();
        popularFiltros();
        ligarExportacao();
        ligarCompartilhamento();
        rotearPagina();
    });
})();
