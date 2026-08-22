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
};
