#!/usr/bin/env bash
# ==========================================================================
# stop.sh — Encerra o serviço do Seu Político (porta 3000)
# --------------------------------------------------------------------------
# Não derruba o PostgreSQL (docker) para preservar o cache das APIs.
# Para derrubar o banco também: docker compose down
# ==========================================================================

set -euo pipefail

PORT=3000

PID="$(lsof -ti:"$PORT" 2>/dev/null || true)"
if [ -n "$PID" ]; then
    kill $PID >/dev/null 2>&1 || true
    sleep 1
    echo "✔ Serviço do Seu Político encerrado (porta $PORT)."
    echo "  PostgreSQL permanece de pé (cache preservado)."
else
    echo "ℹ Nenhum serviço do Seu Político rodando na porta $PORT."
fi

exit 0
