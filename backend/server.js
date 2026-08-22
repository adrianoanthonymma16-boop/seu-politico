/* ==========================================================================
   server.js — Servidor Express do Seu Político
   --------------------------------------------------------------------------
   - Serve os arquivos estáticos do frontend (na raiz do projeto).
   - Expõe os endpoints /api (Câmara, Portal e Análise).
   - Protege a chave do Portal da Transparência (nunca sai do servidor).
   ========================================================================== */

const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');

const rotaCamara = require('./routes/camara');
const rotaPortal = require('./routes/portal');
const rotaSenado = require('./routes/senado');
const rotaAnalise = require('./routes/analise');
const { pool, habilitado } = require('./db');

const app = express();
const PORTA = Number(process.env.PORT) || 3000;
const RAIZ_FRONT = path.join(__dirname, '..');

/* Aplica o schema do PostgreSQL no boot (idempotente) — útil em deploys. */
async function garantirSchema() {
    if (!habilitado) return;
    try {
        const sql = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'schema.sql'), 'utf8');
        await pool.query(sql);
        console.log('[db] schema garantido.');
    } catch (erro) {
        console.warn('[db] falha ao aplicar schema (o cache usa memória):', erro.message);
    }
}

app.use(cors());
app.use(express.json());

/* Rota de saúde do servidor. */
app.get('/api/health', (req, res) => {
    res.json({
        ok: true,
        data: new Date().toISOString(),
        modoMock: process.env.USE_MOCK === 'true',
        banco: habilitado ? 'postgres' : 'memoria',
        chavePortal: Boolean(process.env.CHAVE_API_PORTAL),
    });
});

/* Endpoints da API. */
app.use('/api/camara', rotaCamara);
app.use('/api/portal', rotaPortal);
app.use('/api/senado', rotaSenado);
app.use('/api/analise', rotaAnalise);

/* Arquivos estáticos do frontend (index.html, dashboard.html, src/, etc.). */
app.use(express.static(RAIZ_FRONT));

/* Fallback para SPA simples (roteamento das páginas .html). */
app.get(['/', '/index.html', '/dashboard.html', '/resultados.html', '/politico.html', '/comparar.html', '/senadores.html', '/senador.html', '/executivo.html'], (req, res) => {
    const pagina = path.basename(req.path) || 'index.html';
    res.sendFile(path.join(RAIZ_FRONT, pagina === '/' ? 'index.html' : pagina));
});

/* Tratamento de erros global. */
app.use((erro, req, res, next) => {
    console.error('[server] erro não tratado:', erro.message);
    res.status(erro.status || 500).json({ erro: 'Erro interno do servidor.' });
});

async function iniciar() {
    await garantirSchema();

    app.listen(PORTA, () => {
        console.log('==============================================');
        console.log('  SEU POLÍTICO — transparência cidadã');
        console.log(`  Frontend:   http://localhost:${PORTA}`);
        console.log(`  API base:   http://localhost:${PORTA}/api`);
        console.log(`  Modo mock:  ${process.env.USE_MOCK === 'true' ? 'SIM (dados fictícios)' : 'não (API real)'}`);
        console.log(`  Banco:      ${habilitado ? 'PostgreSQL' : 'em memória (sem DATABASE_URL)'}`);
        console.log(`  Chave Portal: ${process.env.CHAVE_API_PORTAL ? 'configurada' : 'NÃO configurada (USE_MOCK=true para demo)'}`);
        console.log('==============================================');
    });
}

iniciar();
