/* ==========================================================================
   api.js — Cliente HTTP do Seu Político
   --------------------------------------------------------------------------
   Todas as chamadas passam pelo proxy do backend (/api/...), que:
     - protege a chave do Portal da Transparência (header chave-api-dados),
     - aplica cache para respeitar o limite de requisições da API,
     - normaliza os dados vindos da Câmara e do Portal da Transparência.
   ========================================================================== */

const SeuPoliticoAPI = (() => {
    const API_BASE = '/api';
    const TEMPO_MAXIMO_MS = 30000; // 30s — evita "carregando" infinito; endpoints pesados agora são lazy-load

    /**
     * Requisição base com tratamento de erros amigável.
     * @param {string} caminho  ex: "/camara/deputados"
     * @param {Object} [params] query string
     * @returns {Promise<any>}
     */
    async function requisicao(caminho, params = {}) {
        const url = new URL(API_BASE + caminho, window.location.origin);
        Object.entries(params).forEach(([chave, valor]) => {
            if (valor !== undefined && valor !== null && valor !== '') {
                url.searchParams.set(chave, valor);
            }
        });

        const controlador = new AbortController();
        const timer = setTimeout(() => controlador.abort(), TEMPO_MAXIMO_MS);

        try {
            const resposta = await fetch(url.toString(), { signal: controlador.signal });
            if (!resposta.ok) {
                let mensagem = `Erro ao consultar os dados (${resposta.status}).`;
                try {
                    const corpo = await resposta.json();
                    if (corpo && corpo.erro) mensagem = corpo.erro;
                } catch (e) { /* corpo não-JSON */ }
                throw new Error(mensagem);
            }
            return await resposta.json();
        } catch (erro) {
            if (erro.name === 'AbortError') {
                throw new Error('A consulta demorou demais. Tente novamente em instantes.');
            }
            if (erro instanceof TypeError) {
                throw new Error('Não foi possível conectar ao servidor. Verifique se o backend está rodando (npm run dev).');
            }
            throw erro;
        } finally {
            clearTimeout(timer);
        }
    }

    return {
        /* ---- CÂMARA DOS DEPUTADOS ---- */

        /** Lista estática completa de deputados (gerada no build) — resposta instantânea via CDN. */
        async listaDeputadosEstatica() {
            const resp = await fetch('/data/deputados.json', { signal: AbortSignal.timeout(8000) });
            if (!resp.ok) throw new Error(`Lista estática indisponível (${resp.status}).`);
            const dados = await resp.json();
            return dados.dados || [];
        },

        /** Busca deputados por nome, partido e/ou UF. */
        buscarDeputados({ nome, partido, uf, pagina = 1 } = {}) {
            return requisicao('/camara/deputados', { nome, siglaPartido: partido, siglaUf: uf, pagina });
        },

        /** Detalhes de um deputado pelo id. */
        obterDeputado(id) {
            return requisicao(`/camara/deputado/${id}`);
        },

        /** Despesas da cota parlamentar de um deputado. */
        obterDespesas(id, { ano, mes, pagina = 1 } = {}) {
            return requisicao(`/camara/deputado/${id}/despesas`, { ano, mes, pagina });
        },

        /** Como o deputado votou em proposições (registo de votos). */
        obterVotacoesDeputado(id, { ano, pagina = 1 } = {}) {
            return requisicao(`/camara/deputado/${id}/votacoes`, { ano, pagina });
        },

        /** Busca como o deputado votou em uma proposição específica (ex.: "PL 1234/2025"). */
        buscarVotacoesDeputado(id, q) {
            return requisicao(`/camara/deputado/${id}/votacoes/busca`, { q });
        },

        /** Detalhe de uma votação + votos dos parlamentares. */
        obterDetalheVotacao(idVotacao, { pagina = 1 } = {}) {
            return requisicao(`/camara/votacao/${idVotacao}`, { pagina });
        },

        /** Busca uma proposição por sigla, número e ano (ex.: PL 1234/2025). */
        buscarProposicao(siglaTipo, numero, ano) {
            return requisicao('/camara/proposicao', { siglaTipo, numero, ano });
        },

        /** Votações de uma proposição. */
        obterVotacoesProposicao(idProposicao) {
            return requisicao(`/camara/proposicao/${idProposicao}/votacoes`);
        },

        /** Votações recentes da Câmara (página da lista). */
        obterVotacoesRecentesCamara({ pagina = 1 } = {}) {
            return requisicao('/camara/votacoes/recentes', { pagina });
        },

        /** Votações recentes do Senado (página da lista). */
        obterVotacoesRecentesSenado({ pagina = 1 } = {}) {
            return requisicao('/senado/votacoes/recentes', { pagina });
        },

        /** Presenças e faltas de um deputado em plenário no ano. */
        obterFrequenciaDeputado(id, ano) {
            return requisicao(`/camara/deputado/${id}/frequencia`, { ano });
        },

        /** Discursos/pronunciamentos de um deputado no ano. */
        obterDiscursosDeputado(id, ano) {
            return requisicao(`/camara/deputado/${id}/discursos`, { ano });
        },

        /** Presenças e faltas de um senador em votações nominais no ano. */
        obterFrequenciaSenador(id, ano) {
            return requisicao(`/senado/senador/${id}/frequencia`, { ano });
        },

        /** Como o senador votou em proposições (registo de votos). */
        obterVotacoesSenador(id, { ano, pagina = 1 } = {}) {
            return requisicao(`/senado/senador/${id}/votacoes`, { ano });
        },

        /** Detalhe de uma votação do Senado + votos de todos os senadores. */
        obterDetalheVotacaoSenado(sessao, votacao) {
            return requisicao(`/senado/votacao/${sessao}/${votacao}`);
        },

        /** Discursos/pronunciamentos de um senador no ano. */
        obterDiscursosSenador(id, ano) {
            return requisicao(`/senado/senador/${id}/discursos`, { ano });
        },

        /** Lista de partidos (para o filtro). */
        obterPartidos() {
            return requisicao('/camara/partidos');
        },

        /* ---- PORTAL DA TRANSPARÊNCIA ---- */

        /** Órgãos do Poder Executivo Federal. */
        buscarOrgaos({ nome, pagina = 1 } = {}) {
            return requisicao('/portal/orgaos', { nome, pagina });
        },

        /** Contratos do Executivo Federal por órgão. */
        buscarContratosPortal({ codigoOrgao, ano, pagina = 1 } = {}) {
            return requisicao('/portal/contratos', { codigoOrgao, ano, pagina });
        },

        /* ---- SENADO FEDERAL ---- */

        /** Senadores em exercício (nome, partido, UF). */
        buscarSenadores({ nome, partido, uf } = {}) {
            return requisicao('/senado/senadores', { nome, partido, uf });
        },

        /** Detalhes de um senador. */
        obterSenador(id) {
            return requisicao(`/senado/senador/${id}`);
        },

        /** Despesas CEAPS de um senador. */
        obterDespesasSenador(id, { ano, pagina = 1 } = {}) {
            return requisicao(`/senado/despesas/${id}`, { ano, pagina });
        },

        /** Análise completa de um senador (motor de suspeita). */
        analiseSenador(id, ano) {
            return requisicao(`/senado/analise/${id}`, { ano });
        },

        /* ---- INFORMAÇÃO (Presidente e Candidatos) ---- */

        /** Perfil informativo do Presidente da República. */
        obterPresidente() {
            return requisicao('/informacao/presidente');
        },

        /** Gastos do presidente (viagens a serviço da Presidência). */
        obterGastosPresidente(ano) {
            return requisicao('/informacao/presidente/gastos', { ano });
        },

        /** Contratos públicos da Presidência da República. */
        obterContratosPresidente(ano) {
            return requisicao('/informacao/presidente/contratos', { ano });
        },

        /** Candidatos à Presidência (período eleitoral). */
        obterCandidatos() {
            return requisicao('/informacao/candidatos');
        },

        /* ---- ANÁLISE (MOTOR DE SUSPEITA) ---- */

        /** Visão geral agregada (home e dashboard). */
        analiseGeral(ano) {
            return requisicao('/analise/geral', { ano });
        },

        /** Análise completa de um deputado. */
        analiseDeputado(id, ano, { nome, partido, uf } = {}) {
            return requisicao(`/analise/deputado/${id}`, { ano, nome, partido, uf });
        },

        /** Comparação neutra entre parlamentares. */
        analiseComparar(ids, ano) {
            return requisicao('/analise/comparar', { ids: ids.join(','), ano });
        },

        /** Médias de referência por UF (para contextualizar alertas). */
        mediaReferencia({ uf, ano } = {}) {
            return requisicao('/analise/media', { uf, ano });
        },

        /** Empresas que recebem de 2+ parlamentares no ano. */
        listarEmpresasRecorrentes(ano) {
            return requisicao('/analise/empresas', { ano });
        },

        /** Dashboard "Partidos e Poderes" (partidos, emendas e gastos por poder). */
        analisePoderes({ ano, mes } = {}) {
            return requisicao('/analise/poderes', { ano, mes });
        },

        /** Ranking de deputados que mais gastaram (cota parlamentar). */
        rankingDeputados({ ano, uf, partido, limite } = {}) {
            return requisicao('/analise/ranking', { ano, uf, partido, limite });
        },

        /** Busca empresa por CNPJ ou nome no backend. */
        buscarEmpresa(query) {
            return requisicao('/analise/buscar-empresa', { q: query });
        },
    };
})();
