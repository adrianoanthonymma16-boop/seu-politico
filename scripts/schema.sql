-- ==========================================================================
-- schema.sql — Esquema do banco de dados do Seu Político (PostgreSQL)
-- --------------------------------------------------------------------------
-- O banco serve como CAMADA DE CACHE das respostas da API para não
-- estourar o limite de requisições por minuto do Portal da Transparência.
-- ==========================================================================

-- Cache genérico de respostas da API (chave = endpoint + query).
CREATE TABLE IF NOT EXISTS api_cache (
    chave       TEXT PRIMARY KEY,
    payload     JSONB NOT NULL,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expira_em   TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_cache_expira ON api_cache (expira_em);
CREATE INDEX IF NOT EXISTS idx_api_cache_payload ON api_cache USING gin (payload);

-- Cache de deputados (dados consolidados da Câmara dos Deputados).
CREATE TABLE IF NOT EXISTS deputados (
    id              INTEGER PRIMARY KEY,
    dados           JSONB NOT NULL,
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cache de despesas de cota parlamentar (um registro por deputado/ano).
CREATE TABLE IF NOT EXISTS despesas_parlamentares (
    id              BIGSERIAL PRIMARY KEY,
    deputado_id     INTEGER NOT NULL,
    ano             INTEGER NOT NULL,
    dados           JSONB NOT NULL,
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (deputado_id, ano)
);

-- Cache de despesas CEAPS dos senadores (um registro por senador/ano).
CREATE TABLE IF NOT EXISTS despesas_senadores (
    id              BIGSERIAL PRIMARY KEY,
    senador_id      INTEGER NOT NULL,
    ano             INTEGER NOT NULL,
    dados           JSONB NOT NULL,
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (senador_id, ano)
);

-- Cache de senadores (dados consolidados da API de dados abertos do Senado).
CREATE TABLE IF NOT EXISTS senadores (
    id              INTEGER PRIMARY KEY,
    dados           JSONB NOT NULL,
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Registro de sinais de alerta gerados pelo motor de suspeita.
CREATE TABLE IF NOT EXISTS alertas (
    id              BIGSERIAL PRIMARY KEY,
    deputado_id     INTEGER NOT NULL,
    ano             INTEGER NOT NULL,
    nivel           TEXT NOT NULL,
    titulo          TEXT NOT NULL,
    texto           TEXT NOT NULL,
    payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_despesas_dep_ano ON despesas_parlamentares (deputado_id, ano);
CREATE INDEX IF NOT EXISTS idx_despesas_sen_ano ON despesas_senadores (senador_id, ano);
CREATE INDEX IF NOT EXISTS idx_alertas_dep_ano ON alertas (deputado_id, ano);
