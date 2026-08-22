#!/usr/bin/env bash
# ==========================================================================
# start.sh — Inicia o serviço do Seu Político e abre o navegador
# --------------------------------------------------------------------------
# - Se o serviço já estiver no ar, apenas abre o navegador.
# - Garante o PostgreSQL (docker compose), as dependências do backend e
#   sobe o servidor em background (desanexado), logando em backend/server.log.
# - Uso: ./start.sh            (abre e encerra imediatamente)
#        ./start.sh --foreground  (mantém o terminal e permite Ctrl+C)
# ==========================================================================

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

URL="http://localhost:3000"
PORT=3000
LOG="$DIR/backend/server.log"

echo "==================================================="
echo "  SEU POLÍTICO — transparência cidadã"
echo "==================================================="

# 1) Serviço já está rodando?
if curl -fsS "$URL/api/health" >/dev/null 2>&1; then
    echo "✔ Serviço já está no ar em $URL — abrindo o navegador."
    xdg-open "$URL" >/dev/null 2>&1 &
    exit 0
fi

# 2) PostgreSQL via docker compose (mantém o cache das APIs)
if command -v docker >/dev/null 2>&1; then
    echo "→ Garantindo o PostgreSQL (docker compose)..."
    docker compose up -d >/dev/null 2>&1 || echo "  (aviso: não foi possível iniciar o PostgreSQL via docker)"
fi

# 3) Dependências do backend (só na primeira execução)
if [ ! -d "$DIR/backend/node_modules" ]; then
    echo "→ Instalando dependências do backend (primeira execução)..."
    (cd "$DIR/backend" && npm install --no-audit --no-fund >/dev/null 2>&1) || echo "  (aviso: falha no npm install)"
fi

# 4) Subir o servidor em background, desanexado
mkdir -p "$(dirname "$LOG")"
if ! lsof -ti:"$PORT" >/dev/null 2>&1; then
    echo "→ Iniciando o servidor (porta $PORT)..."
    setsid nohup node "$DIR/backend/server.js" >> "$LOG" 2>&1 &
fi

# 5) Aguardar o serviço responder
ok=false
for _ in $(seq 1 45); do
    if curl -fsS "$URL/api/health" >/dev/null 2>&1; then
        ok=true
        break
    fi
    sleep 1
done

if $ok; then
    echo "✔ Seu Político no ar: $URL"
    echo "  Logs: $LOG"
    xdg-open "$URL" >/dev/null 2>&1 &
else
    echo "✖ O serviço não respondeu em $URL."
    echo "  Verifique os logs: $LOG"
    tail -20 "$LOG" 2>/dev/null || true
    exit 1
fi

# Modo foreground: mantém o terminal aberto (Ctrl+C encerra o serviço)
if [ "${1:-}" = "--foreground" ]; then
    echo "Pressione Ctrl+C para encerrar o serviço."
    wait
fi

exit 0
