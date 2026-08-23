/* ==========================================================================
   mockData.js — Dados fictícios de demonstração
   --------------------------------------------------------------------------
   Usado quando USE_MOCK=true (sem chave da API ou para testes).
   Os dados são gerados de forma determinística (seed por id), então o site
   se comporta de forma estável. Em nenhuma hipótese representam pessoas reais.
   ========================================================================== */

const NOMES = [
    'Ana Ribeiro', 'Carlos Mendes', 'Beatriz Sales', 'Diego Alves', 'Eduarda Pinto',
    'Fernando Costa', 'Gabriela Lima', 'Henrique Souza', 'Isabela Rocha', 'João Pereira',
    'Karla Nogueira', 'Lucas Ferreira', 'Mariana Duarte', 'Nelson Barros', 'Olívia Campos',
    'Paulo Teixeira', 'Quitéria Farias', 'Rafael Monteiro', 'Sabrina Oliveira', 'Tiago Nunes',
    'Úrsula Batista', 'Victor Moraes', 'Wanda Luz', 'Xavier Peixoto', 'Yara Mello',
    'Zeca Andrade', 'Amanda Corrêa', 'Bruno Santana', 'Cíntia Ramos', 'Danilo Pires',
];

const SOBRENOMES_DOBLE = ['Nunes', 'Batista', 'Moraes', 'Luz', 'Peixoto', 'Mello', 'Andrade', 'Corrêa', 'Santana', 'Ramos'];

const PARTIDOS = ['PL', 'PT', 'PSDB', 'MDB', 'PSL', 'DEM', 'PSB', 'PP', 'PSD', 'Republicanos', 'PDT', 'Podemos', 'PV', 'PCdoB'];

const UFS = ['SP', 'RJ', 'MG', 'BA', 'RS', 'PR', 'CE', 'PE', 'PA', 'AM', 'GO', 'DF'];

const CATEGORIAS = [
    'Passagens aéreas', 'Hospedagem', 'Combustíveis e lubrificantes', 'Consultoria',
    'Serviços de comunicação', 'Divulgação da atividade parlamentar', 'Locação de veículos',
    'Material de escritório', 'Alimentação', 'Segurança', 'Manutenção de escritório', 'Outros',
];

const FORNECEDORES = [
    'Companhia Aérea Nacional', 'Hotéis do Brasil Ltda', 'Posto Central', 'Assessoria Júnior',
    'Mídia Propaganda SA', 'Eventos e Marketing', 'Locadora Nacional', 'Papelaria União',
    'Restaurantes Associados', 'Vigilância Total', 'Imobiliária Alfa', 'Serviços Gerais Ltda',
];

const EMAILS = [
    'gmail.com', 'outlook.com', 'hotmail.com', 'protonmail.com', 'yahoo.com',
];

const LEGISLATURA = 57;

function hashNumerico(texto) {
    let h = 0;
    for (let i = 0; i < texto.length; i++) {
        h = (h * 31 + texto.charCodeAt(i)) >>> 0;
    }
    return h;
}

function sementeDe(valor) {
    let s = hashNumerico(String(valor));
    return function aleatorio() {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function gerarDeputados() {
    const lista = NOMES.map((nome, i) => {
        const rng = sementeDe(`dep${i + 1}`);
        const id = i + 1;
        const partido = PARTIDOS[Math.floor(rng() * PARTIDOS.length)];
        const uf = UFS[Math.floor(rng() * UFS.length)];
        return {
            id,
            nome,
            nomeCivil: nome,
            partido,
            uf,
            urlFoto: '',
            email: `${nome.split(' ')[0].toLowerCase()}.${nome.split(' ')[1].toLowerCase()}@${EMAILS[Math.floor(rng() * EMAILS.length)]}`,
            cargo: 'Deputado Federal',
            legislatura: LEGISLATURA,
        };
    });
    return lista;
}

const DEPUTADOS = gerarDeputados();

function gerarDespesas(deputadoId, ano) {
    const dep = DEPUTADOS.find((d) => d.id === deputadoId);
    if (!dep) return [];

    const rng = sementeDe(`desp${deputadoId}-${ano}`);
    const despesas = [];
    const anos = [ano];

    // Perfil de gastos do deputado (determinístico).
    const fornecedorForte = FORNECEDORES[Math.floor(rng() * FORNECEDORES.length)];
    const perfilConcentrado = rng() > 0.6; // alguns deputados concentram em um fornecedor
    const mesPico = 3 + Math.floor(rng() * 6); // alguns têm um mês com pico atípico
    const picoForte = rng() > 0.7;

    for (const a of anos) {
        const numDespesas = 60 + Math.floor(rng() * 60);
        for (let i = 0; i < numDespesas; i++) {
            const mes = 1 + Math.floor(rng() * 12);
            const tipo = CATEGORIAS[Math.floor(rng() * CATEGORIAS.length)];

            let fornecedor = FORNECEDORES[Math.floor(rng() * FORNECEDORES.length)];
            if (perfilConcentrado && rng() < 0.75) fornecedor = fornecedorForte;

            let valor = 80 + rng() * 6000;
            if (picoForte && mes === mesPico && rng() < 0.5) valor *= 5 + rng() * 4;

            despesas.push({
                ano: a,
                mes,
                tipo,
                data: `${String(mes).padStart(2, '0')}/${a}`,
                valor: Math.round(valor * 100) / 100,
                fornecedor,
                cnpjCpf: `${String(100000 + Math.floor(rng() * 899999)).padStart(8, '0')}000001${String(Math.floor(rng() * 90)).padStart(2, '0')}`,
                documento: `${ano}${String(mes).padStart(2, '0')}${String(100000 + Math.floor(rng() * 899999))}`,
                restituicao: 0,
            });
        }
    }

    // Ordena por mês.
    despesas.sort((x, y) => x.mes - y.mes);
    return despesas;
}

function paginar(itens, pagina = 1, itensPorPagina = 100) {
    const inicio = (pagina - 1) * itensPorPagina;
    const fatia = itens.slice(inicio, inicio + itensPorPagina);
    return { dados: fatia, links: { pagina, ultima: Math.max(1, Math.ceil(itens.length / itensPorPagina)) } };
}

/* ---- Votações fictícias (demonstração) ---- */
const PROPOSICOES_MOCK = [
    { id: 100, sigla: 'PL 1234/2025', tema: 'Incentivo à educação digital' },
    { id: 101, sigla: 'PLC 87/2024', tema: 'Regulamentação do transporte por aplicativo' },
    { id: 102, sigla: 'PEC 45/2023', tema: 'Reforma administrativa' },
    { id: 103, sigla: 'MPV 1150/2025', tema: 'Medidas de emergência climática' },
    { id: 104, sigla: 'PL 567/2025', tema: 'Transparência em licitações públicas' },
    { id: 105, sigla: 'PDL 77/2025', tema: 'Sustação de decreto sobre impostos' },
    { id: 106, sigla: 'PL 899/2024', tema: 'Regulamentação da telemedicina' },
    { id: 107, sigla: 'PEC 55/2024', tema: 'Fundo nacional de segurança pública' },
];

function gerarVotacoes(deputadoId) {
    const rng = sementeDe(`vot${deputadoId}`);
    const votos = ['Sim', 'Não', 'Abstenção', 'Artigo 17'];
    return PROPOSICOES_MOCK.map((p, i) => {
        const mes = 1 + Math.floor(rng() * 12);
        return {
            idVotacao: 5000 + i + 1,
            data: `2025-${String(mes).padStart(2, '0')}-${String(1 + Math.floor(rng() * 27)).padStart(2, '0')}`,
            orgao: 'Plenário',
            titulo: p.sigla,
            ementa: p.tema,
            voto: votos[Math.floor(rng() * votos.length)],
            proposicao: { id: p.id, sigla: p.sigla, ementa: p.tema },
        };
    });
}

module.exports = {
    listarDeputados({ nome = '', siglaPartido = '', siglaUf = '', pagina = 1 } = {}) {
        let lista = DEPUTADOS;
        if (nome) lista = lista.filter((d) => d.nome.toLowerCase().includes(String(nome).toLowerCase()));
        if (siglaPartido) lista = lista.filter((d) => d.partido === siglaPartido);
        if (siglaUf) lista = lista.filter((d) => d.uf === siglaUf);
        return paginar(lista, pagina, 100);
    },

    obterDeputado(id) {
        const dep = DEPUTADOS.find((d) => d.id === Number(id));
        return dep ? { dados: [dep] } : null;
    },

    obterDespesas(id, { ano = new Date().getFullYear(), mes, pagina = 1 } = {}) {
        let despesas = gerarDespesas(Number(id), Number(ano));
        if (mes) despesas = despesas.filter((d) => d.mes === Number(mes));
        return paginar(despesas, pagina, 100);
    },

    listarPartidos() {
        const dados = PARTIDOS.map((sigla, i) => ({ id: i + 1, sigla, nome: sigla }));
        return { dados };
    },

    obterVotacoes(id, { ano, pagina = 1 } = {}) {
        let lista = gerarVotacoes(Number(id));
        if (ano) lista = lista.filter((v) => String(v.data).startsWith(String(ano)));
        return paginar(lista, pagina, 100);
    },

    obterDetalheVotacao(idVotacao, pagina = 1) {
        const numero = Number(idVotacao);
        const indice = Math.abs((numero - 5001) % PROPOSICOES_MOCK.length);
        const prop = PROPOSICOES_MOCK[indice];
        const rng = sementeDe(`votDet${numero}`);

        const votos = NOMES.map((nome, i) => {
            const opcoes = ['Sim', 'Não', 'Abstenção'];
            return {
                deputado: {
                    id: i + 1,
                    nome,
                    partido: PARTIDOS[Math.floor(rng() * PARTIDOS.length)],
                    uf: UFS[Math.floor(rng() * UFS.length)],
                },
                voto: opcoes[Math.floor(rng() * opcoes.length)],
            };
        });
        const paginado = paginar(votos, pagina, 100);
        const sim = votos.filter((v) => v.voto === 'Sim').length;
        const nao = votos.filter((v) => v.voto === 'Não').length;
        const abstencoes = votos.filter((v) => v.voto === 'Abstenção').length;

        return {
            idVotacao: numero,
            data: '2025-03-10',
            orgao: 'Plenário',
            titulo: prop.sigla,
            ementa: prop.tema,
            proposicao: { id: prop.id, sigla: prop.sigla, ementa: prop.tema },
            resultado: { aprovado: sim > nao, totalVotos: votos.length, sim, nao, abstencoes },
            votos: paginado.dados,
            totalVotosLista: paginado.dados.length,
            links: paginado.links,
        };
    },

    obterVotacoesSenador(id, { ano } = {}) {
        const rng = sementeDe(`votSen${id}`);
        const votos = ['Sim', 'Não', 'Abstenção', 'P-NRV', 'NCom'];
        const lista = PROPOSICOES_MOCK.map((p, i) => {
            const mes = 3 + ((i * 2) % 9);
            return {
                idVotacao: 7000 + i + 1,
                sessao: 400000 + i,
                data: `2025-${String(mes).padStart(2, '0')}-${String(1 + Math.floor(rng() * 27)).padStart(2, '0')}`,
                orgao: 'Plenário',
                titulo: p.sigla,
                ementa: p.tema,
                voto: votos[Math.floor(rng() * votos.length)],
            };
        });
        if (ano) {
            return { dados: lista.filter((v) => String(v.data).startsWith(String(ano))), links: { pagina: 1, ultima: 1 } };
        }
        return { dados: lista, links: { pagina: 1, ultima: 1 } };
    },

    obterDetalheVotacaoSenado(codigoSessaoVotacao) {
        const numero = Number(codigoSessaoVotacao);
        const indice = Math.abs((numero - 7001) % PROPOSICOES_MOCK.length);
        const prop = PROPOSICOES_MOCK[indice];
        const rng = sementeDe(`votSenDet${numero}`);
        const votos = NOMES.map((nome, i) => {
            const opcoes = ['Sim', 'Não', 'Abstenção'];
            return {
                senador: {
                    id: 9000 + i + 1,
                    nome,
                    partido: PARTIDOS[Math.floor(rng() * PARTIDOS.length)],
                    uf: UFS[Math.floor(rng() * UFS.length)],
                },
                voto: opcoes[Math.floor(rng() * opcoes.length)],
            };
        });
        const sim = votos.filter((v) => v.voto === 'Sim').length;
        const nao = votos.filter((v) => v.voto === 'Não').length;
        const abstencoes = votos.filter((v) => v.voto === 'Abstenção').length;
        return {
            idVotacao: numero,
            data: '2025-03-10',
            orgao: 'Plenário',
            titulo: prop.sigla,
            ementa: prop.tema,
            resultado: { totalVotos: votos.length, sim, nao, abstencoes },
            votos,
        };
    },

    obterVotacoesRecentesCamara(pagina = 1) {
        const itens = 50;
        const rng = sementeDe('votRecCam');
        const todas = [];
        for (let i = 0; i < 120; i++) {
            const prop = PROPOSICOES_MOCK[i % PROPOSICOES_MOCK.length];
            todas.push({
                idVotacao: 8000 + i,
                data: `2025-${String(1 + Math.floor(rng() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rng() * 27)).padStart(2, '0')}`,
                orgao: i % 5 === 0 ? 'CCJC' : 'PLEN',
                descricao: ['Aprovado o texto base', 'Rejeitado o Requerimento', 'Aprovada a Redação Final'][i % 3],
                proposicaoObjeto: prop.sigla,
                aprovacao: i % 2 === 0 ? 1 : 0,
                casa: 'camara',
            });
        }
        todas.sort((a, b) => b.data.localeCompare(a.data));
        const inicio = (pagina - 1) * itens;
        return { dados: todas.slice(inicio, inicio + itens), links: { pagina, ultima: Math.ceil(todas.length / itens) } };
    },

    obterVotacoesRecentesSenado(pagina = 1) {
        const itens = 50;
        const rng = sementeDe('votRecSen');
        const todas = [];
        for (let i = 0; i < 40; i++) {
            const prop = PROPOSICOES_MOCK[i % PROPOSICOES_MOCK.length];
            todas.push({
                idVotacao: 9000 + i,
                sessao: 500000 + i,
                data: `2025-${String(3 + (i % 9)).padStart(2, '0')}-${String(1 + Math.floor(rng() * 27)).padStart(2, '0')}`,
                orgao: 'Plenário',
                titulo: prop.sigla,
                descricao: ['Aprovado o texto base', 'Rejeitado o Requerimento'][i % 2],
                casa: 'senado',
            });
        }
        todas.sort((a, b) => b.data.localeCompare(a.data));
        const inicio = (pagina - 1) * itens;
        return { dados: todas.slice(inicio, inicio + itens), links: { pagina, ultima: Math.ceil(todas.length / itens) } };
    },

    buscarProposicao(siglaTipo, numero, ano) {
        const tipoAlvo = String(siglaTipo).toUpperCase();
        const numAlvo = String(numero);
        const anoAlvo = String(ano);
        const prop = PROPOSICOES_MOCK.find((p) => {
            const m = String(p.sigla).match(/^([A-Z]+)\s+(\d+)\s*\/\s*(\d{4})$/);
            return m && m[1] === tipoAlvo && m[2] === numAlvo && m[3] === anoAlvo;
        });
        if (!prop) {
            const erro = new Error('Proposição não encontrada.');
            erro.status = 404;
            throw erro;
        }
        return {
            id: prop.id,
            siglaTipo: tipoAlvo,
            numero,
            ano,
            sigla: `${tipoAlvo} ${numero}/${ano}`,
            ementa: prop.tema,
            dataApresentacao: '2025-03-10',
            autor: 'Deputado Fictício',
        };
    },

    obterVotacoesProposicao(idProposicao) {
        const prop = PROPOSICOES_MOCK.find((p) => p.id === Number(idProposicao));
        if (!prop) return { dados: [], links: {} };
        const rng = sementeDe(`votProp${prop.id}`);
        const descricoes = ['Aprovado o texto base', 'Rejeitado o Requerimento', 'Aprovada a Redação Final', 'Mantido o texto'];
        return {
            dados: Array.from({ length: 3 }, (_, i) => ({
                idVotacao: 6000 + prop.id + i,
                data: `2025-${String(3 + i).padStart(2, '0')}-${String(10 + Math.floor(rng() * 10)).padStart(2, '0')}`,
                orgao: 'PLEN',
                descricao: descricoes[i % descricoes.length],
                aprovacao: i % 2 === 0 ? 1 : 0,
                proposicaoObjeto: prop.sigla,
            })),
            links: { pagina: 1, ultima: 1 },
        };
    },

    obterDiscursosDeputado(id, ano) {
        const rng = sementeDe(`discDep${id}-${ano}`);
        const temas = ['Saúde pública', 'Educação básica', 'Reforma tributária', 'Segurança nas estradas', 'Meio ambiente', 'Incentivo ao empreendedorismo'];
        const tipos = ['PELA ORDEM', 'DISCURSO', 'EXPLICAÇÃO PESSOAL', 'BREVES COMUNICAÇÕES'];
        return {
            dados: temas.map((tema, i) => ({
                dataHoraInicio: `2025-${String(3 + (i % 9)).padStart(2, '0')}-${String(1 + Math.floor(rng() * 27)).padStart(2, '0')}T10:00`,
                tipoDiscurso: tipos[i % tipos.length],
                sumario: `A deputada falou sobre ${tema} em Plenário.`,
                transcricao: `A SRA. DEPUTADA — Sr. Presidente, quero destacar a importância de ${tema.toLowerCase()} para a população. (Dados fictícios.)`,
                keywords: tema,
                urlTexto: '', urlAudio: '', urlVideo: '',
            })),
            links: { pagina: 1, ultima: 1 },
        };
    },

    obterDiscursosSenador(id, ano) {
        const rng = sementeDe(`discSen${id}-${ano}`);
        const temas = ['Segurança pública', 'Agronegócio', 'Reforma administrativa', 'Educação profissional', 'Infraestrutura', 'Combate à corrupção'];
        const tipos = ['DISCURSO', 'EXPLICAÇÃO PESSOAL', 'PELA ORDEM'];
        return {
            dados: temas.map((tema, i) => ({
                dataHoraInicio: `2025-${String(3 + (i % 9)).padStart(2, '0')}-${String(1 + Math.floor(rng() * 27)).padStart(2, '0')}`,
                tipoDiscurso: tipos[i % tipos.length],
                sumario: `O senador falou sobre ${tema}.`,
                transcricao: `O SR. SENADOR — Sr. Presidente, sobre ${tema.toLowerCase()}, é preciso avançar. (Dados fictícios.)`,
                urlTexto: '', urlAudio: '', urlVideo: '',
            })),
            links: { pagina: 1, ultima: 1 },
        };
    },

    obterFrequenciaDeputado(id, ano) {
        const rng = sementeDe(`freqDep${id}-${ano}`);
        const presencas = 80 + Math.floor(rng() * 40);
        const faltasJustificadas = Math.floor(rng() * 12);
        const faltasInjustificadas = Math.floor(rng() * 10);
        const totalSessoes = presencas + faltasJustificadas + faltasInjustificadas;
        return {
            fonte: 'Presença em Plenário — Câmara dos Deputados (dados fictícios)',
            urlFonte: 'https://www.camara.leg.br/deputados',
            ano: Number(ano),
            totalSessoes,
            presencas,
            faltasJustificadas,
            faltasInjustificadas,
            taxaPresenca: totalSessoes ? Math.round((presencas / totalSessoes) * 10000) / 100 : null,
        };
    },

    obterFrequenciaSenador(id, ano) {
        const rng = sementeDe(`freqSen${id}-${ano}`);
        const presencas = 60 + Math.floor(rng() * 40);
        const faltasJustificadas = 5 + Math.floor(rng() * 15);
        const faltasInjustificadas = Math.floor(rng() * 8);
        const totalVotacoes = presencas + faltasJustificadas + faltasInjustificadas;
        return {
            fonte: 'Comparecimento em votações nominais — Senado Federal (dados fictícios)',
            urlFonte: 'https://legis.senado.leg.br/dadosabertos',
            ano: Number(ano),
            totalVotacoes,
            presencas,
            faltasJustificadas,
            faltasInjustificadas,
            outras: 0,
            taxaPresenca: totalVotacoes ? Math.round((presencas / totalVotacoes) * 10000) / 100 : null,
        };
    },
};
