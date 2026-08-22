# SEU POLÍTICO

Ferramenta de **transparência cidadã** que analisa dados públicos e aponta
**padrões de gastos** de forma **neutra** — sem acusar ninguém, apenas mostrando
dados de forma clara e acessível.

> "Este gasto é 3x maior que a média. O que você acha disso?"
> "Dados públicos. Sua opinião importa."

---

## Índice

- [Sobre](#sobre)
- [Fontes de dados (APIs)](#fontes-de-dados-apis)
- [Funcionalidades](#funcionalidades)
- [Tecnologias](#tecnologias)
- [Estrutura de pastas](#estrutura-de-pastas)
- [Como rodar](#como-rodar)
- [Modo de demonstração](#modo-de-demonstração)
- [Banco de dados (PostgreSQL)](#banco-de-dados-postgresql)
- [Motor de suspeita](#motor-de-suspeita)
- [Termos de uso das APIs](#termos-de-uso-das-apis)
- [Próximos passos](#próximos-passos)

---

## Sobre

O **Seu Político** reúne dados de fontes oficiais e apresenta:
- busca por nome, partido ou estado;
- dashboards com gráficos e indicadores;
- **sinais de alerta neutros** (gastos acima da média, concentração em
  fornecedores, variações atípicas);
- comparação entre parlamentares;
- evolução dos gastos ao longo do tempo.

**Compromisso:** nunca acusa ninguém. Todos os padrões são apresentados como
"vale a pena investigar?" com os dados públicos disponíveis para conferência.

## Fontes de dados (APIs)

| Fonte | URL | Observações |
|-------|-----|-------------|
| **Câmara dos Deputados** | `https://dadosabertos.camara.leg.br/api/v2/` | Sem chave. Deputados, partidos e perfil. |
| **Cota parlamentar (Câmara)** | `https://www.camara.leg.br/cotas/Ano-{ano}.json.zip` | Arquivo anual oficial das despesas da cota parlamentar. |
| **Senado Federal** | `https://legis.senado.leg.br/dadosabertos/` + `https://adm.senado.gov.br/adm-dadosabertos/api/v1/` | Sem chave. Senadores (legis) e **despesas CEAPS** (adm). |
| **Portal da Transparência** | `https://api.portaldatransparencia.gov.br/api-de-dados/` | Requer **chave** (`chave-api-dados`). Órgãos e **contratos** do Executivo Federal. |

> ⚠️ O Portal da Transparência **não libera CORS** e cobre apenas o **Poder
> Executivo Federal**. O projeto usa um **proxy no backend** (protege sua chave
> e contorna o CORS).
>
> ℹ️ **Cota da Câmara:** a API REST (`/deputados/{id}/despesas`) está vazia; o
> projeto consome o arquivo anual oficial (`camara.leg.br/cotas/`), importa para
> o PostgreSQL e cruza com os deputados por nome.
>
> ℹ️ **Contratos do Portal:** os endpoints de licitações e despesas do Executivo
> exigem parâmetros específicos (período ≤ 1 mês, `dataEmissao`+`fase`) cuja
> especificação é protegida — por isso estão **desativados** (opção "só o que
> funciona"). Órgãos (lista curada) e **contratos por órgão** estão integrados.
>
> ✅ **Validação externa:** todos os dados exibidos têm link para a fonte oficial
> (comprovante na Câmara, perfil no Senado e contrato no Portal da Transparência).

## Funcionalidades

- **Página inicial** — buscador (nome, partido, estado), indicadores gerais e destaques.
- **Dashboard** — gastos por categoria, evolução mensal, top fornecedores e indicadores.
- **Parlamentares** — lista de deputados com atalhos para analisar/comparar.
- **Perfil** — histórico de despesas (com **comprovante oficial**) + análise com sinais.
- **Senadores** — lista e perfil com despesas **CEAPS** (cota parlamentar do Senado).
- **Contratos (Executivo)** — busca por ministério e tabela de contratos com link de validação no Portal.
- **Comparar** — gastos lado a lado com gráfico agrupado por categoria.

## Tecnologias

- **Frontend:** HTML5 semântico, CSS3 (variáveis, grid, flexbox, responsividade), JavaScript puro.
- **Gráficos:** Chart.js (arquivo local em `src/assets/vendor/`).
- **Ícones:** Font Awesome (arquivos locais em `src/assets/vendor/fontawesome/`).
- **Backend:** Node.js + Express (proxy com cache e rate limit).
- **Banco:** PostgreSQL (camada de cache).

> Os assets (Chart.js e Font Awesome) são **self-hosted** — o site não depende
> de CDN externo, funcionando offline e de forma estável quando publicado.

## Estrutura de pastas

```
seu-politico/
├── index.html              # Página inicial (buscador + destaques)
├── dashboard.html          # Dashboard de gastos
├── resultados.html         # Lista de deputados
├── politico.html           # Perfil e análise de um deputado
├── senadores.html          # Lista de senadores em exercício
├── senador.html            # Perfil e análise de um senador (CEAPS)
├── executivo.html          # Contratos do Executivo Federal (Portal)
├── comparar.html           # Comparação entre parlamentares
├── src/
│   ├── css/
│   │   └── style.css       # Paleta LightGray + layout + responsividade
│   ├── js/
│   │   ├── api.js          # Cliente HTTP (chama o proxy /api)
│   │   ├── alerts.js       # Motor de suspeita (frontend)
│   │   └── main.js         # Lógica de interface e gráficos
│   └── assets/
│       ├── images/
│       └── icons/
├── backend/
│   ├── server.js           # Express (estático + /api)
│   ├── db.js               # Pool PostgreSQL (fallback em memória)
│   ├── scripts/
│   │   └── rodarSchema.js  # Aplica scripts/schema.sql
│   ├── routes/
│   │   ├── camara.js       # Proxy Câmara dos Deputados
│   │   ├── senado.js       # Senadores + despesas CEAPS
│   │   ├── portal.js       # Proxy Portal da Transparência (órgãos + contratos)
│   │   └── analise.js      # Endpoints de análise
│   └── services/
│       ├── proxy.js        # Fetch com rate limit e retry em 429
│       ├── cache.js        # Cache PostgreSQL/memória
│       ├── deputados.js    # Acesso normalizado à Câmara
│       ├── cotas.js        # Importação da cota da Câmara (arquivos oficiais)
│       ├── senado.js       # Acesso normalizado ao Senado (CEAPS)
│       ├── orgaosPrincipais.js # Órgãos superiores do Executivo (SIAFI)
│       ├── motorAlerta.js  # Motor de suspeita (servidor)
│       └── mockData.js     # Dados fictícios (USE_MOCK=true)
├── scripts/
│   └── schema.sql          # Tabelas do PostgreSQL
├── docker-compose.yml      # PostgreSQL
├── .env.example
├── .gitignore
├── package.json            # (na pasta backend)
└── README.md
```

## Como rodar

**Pré-requisitos:** Node.js 18+.

```bash
# 1. Clone/entre na pasta do projeto e configure o ambiente
cp .env.example .env
#    No .env: USE_MOCK=false (dados reais) e CHAVE_API_PORTAL=SUA_CHAVE

# 2. Suba o PostgreSQL (obrigatório no modo real — guarda cache e cotas)
docker compose up -d

# 3. Aplique o esquema (a primeira subida do container já cria as tabelas)
cd backend
npm install
npm run schema

# 4. Inicie o servidor
npm run dev
```

Abra **http://localhost:3000** no navegador.

### Lançadores na área de trabalho

Na sua área de trabalho (Linux/GNOME) há dois ícones de app:
- **Seu Político** — inicia o PostgreSQL (docker), o backend e abre o navegador.
  Se já estiver rodando, apenas abre o navegador.
- **Parar Seu Político** — encerra o serviço (porta 3000), mantendo o PostgreSQL de pé.

Scripts equivalentes no projeto: `./start.sh` (ou `./start.sh --foreground`) e `./stop.sh`.
No primeiro clique, o GNOME pode pedir "Confiar e executar" — é um passo único.

> Na primeira consulta, o projeto baixa e importa os arquivos oficiais de
> cota (Câmara) e CEAPS (Senado). Para importar antes:
> ```bash
> curl "http://localhost:3000/api/camara/cotas/sincronizar?ano=2025"
> curl "http://localhost:3000/api/senado/ceaps/sincronizar?ano=2025"
> ```

## Modo de demonstração

Com `USE_MOCK=true`, o servidor usa **dados fictícios determinísticos**
(~30 parlamentares e senadores com despesas de 2022 a 2025) — o site fica
100% funcional sem chave e sem banco. Os dados **não** representam pessoas
reais. Para voltar aos dados reais, troque para `USE_MOCK=false`.

## Banco de dados (PostgreSQL)

O banco é usado como **cache** das respostas da API, evitando estourar o
limite de requisições por minuto, e também armazena as **cotas parlamentares
oficiais** (despesas da cota) importadas dos arquivos da Câmara.
Sem `DATABASE_URL`, o servidor usa um cache em memória e o modo mock —
os dados reais de cota exigem PostgreSQL.

```bash
# Suba o PostgreSQL (tabelas criadas automaticamente pelo initdb)
docker compose up -d

# Aplique o esquema manualmente (se necessário)
cd backend
npm run schema
```

Configuração no `.env`:

```env
DATABASE_URL=postgres://seupolitico:seupolitico@localhost:5432/seupolitico
```

Tabelas: `api_cache`, `deputados`, `despesas_parlamentares`, `alertas`.

## Motor de suspeita

Regras neutras implementadas no **frontend** (`src/js/alerts.js`) e no
**backend** (`backend/services/motorAlerta.js`):

| Sinal | Como detectar | Nível |
|-------|---------------|-------|
| Gasto acima da média | Compara o total com a média dos deputados do mesmo estado | 🟡 alerta |
| Fornecedor recorrente | Concentração de >70% dos recursos em um fornecedor | 💡 info |
| Serviço caro | Despesa >3x a média do mesmo tipo de despesa | 🟡 alerta |
| Padrão incomum | Salto >200% em uma categoria entre meses | 📊 comparação |
| Variação atípica | Aumento >100% no total entre dois meses | 🟡 alerta |

A linguagem é sempre neutra e participativa ("O que você acha disso?",
"Vale a pena investigar?").

## Termos de uso das APIs

- **Portal da Transparência:** limite de **400 requisições/minuto**
  (6h–23h59) e 700/min (0h–5h59). O projeto usa `PORTAL_RPM` (padrão 350),
  fila de agendamento, retry em 429 e cache para nunca ultrapassar o teto.
- **Câmara dos Deputados:** uso consciente (`CAMARA_RPM`, padrão 120) com o
  mesmo cuidado.
- Header de autenticação (`chave-api-dados`) fica **somente no servidor**.
- Dados sujeitos aos termos de uso do
  [Decreto nº 8.777/2016](http://www.planalto.gov.br/ccivil_03/_ato2015-2018/2016/decreto/D8777.htm).

## Próximos passos

- [ ] Integrar **licitações e despesas do Executivo** quando a especificação
      oficial do Portal estiver acessível (hoje a API exige parâmetros protegidos).
- [ ] Comparar deputados × senadores no mesmo gráfico.
- [ ] Autenticação/usuários e alertas por e-mail.
- [ ] Exportação de dados (CSV/JSON) e compartilhamento de análises.
- [ ] Testes automatizados (front e back).
