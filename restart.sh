#!/bin/bash
# ═══════════════════════════════════════════
#  TrustChain Agent — Quick Restart
#  Restarts ONLY Frontend + Backend.
#  Docker sandbox (VNC/Chrome/MCP) stays alive.
# ═══════════════════════════════════════════

DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$DIR/.pids"

# ── Ensure Node.js runtime ──
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi
for BIN in "/opt/homebrew/bin" "/usr/local/bin"; do
    case ":$PATH:" in *":$BIN:"*) ;; *) [ -d "$BIN" ] && PATH="$BIN:$PATH" ;; esac
done
export PATH

# ── Load .env ──
if [ -f "$DIR/.env" ]; then set -a; . "$DIR/.env"; set +a; fi

FRONTEND_PORT="${AGENT_PORT:-9741}"
BACKEND_PORT="${BACKEND_PORT:-9742}"

echo ""
echo "═══════════════════════════════════════════"
echo "  🔄 TrustChain Agent — Quick Restart"
echo "═══════════════════════════════════════════"
echo ""

# ── 1. Kill old processes ──
echo "  🛑 Stopping old services..."
if [ -f "$PID_FILE" ]; then
    OLD_PIDS=$(cat "$PID_FILE")
    kill $OLD_PIDS 2>/dev/null
    echo "     Killed PIDs: $OLD_PIDS"
fi
# Also kill by port, in case PIDs are stale
for PORT in $FRONTEND_PORT $BACKEND_PORT; do
    PID=$(lsof -ti :$PORT 2>/dev/null)
    if [ -n "$PID" ]; then
        kill $PID 2>/dev/null
        echo "     Killed process on port $PORT (PID: $PID)"
    fi
done
sleep 1

# ── 2. Check Docker sandbox ──
CONTAINER_NAME="trustchain-agent-container"
if docker ps --filter "name=^${CONTAINER_NAME}$" --format '{{.Status}}' 2>/dev/null | grep -q "Up"; then
    echo "  🐳 Docker sandbox: ✅ running"
else
    echo "  🐳 Docker sandbox: ⚠️  not running — starting..."
    docker start "$CONTAINER_NAME" 2>/dev/null || echo "     Run ./start.sh first to create the container"
fi

# ── 3. Backend ──
echo "  🔧 Starting Backend (port $BACKEND_PORT)..."
cd "$DIR"
python3 -m uvicorn backend.main:app \
    --host 0.0.0.0 \
    --port $BACKEND_PORT \
    --reload \
    --reload-dir backend &
BACKEND_PID=$!

for i in $(seq 1 10); do
    curl -s http://localhost:$BACKEND_PORT/health > /dev/null 2>&1 && break
    sleep 0.5
done
echo "     ✅ Backend ready (PID: $BACKEND_PID)"

# ── 4. Frontend ──
echo "  🤖 Starting Frontend (port $FRONTEND_PORT)..."
cd "$DIR"
npx vite --port $FRONTEND_PORT &
FRONTEND_PID=$!

for i in $(seq 1 10); do
    curl -s http://localhost:$FRONTEND_PORT > /dev/null 2>&1 && break
    sleep 0.5
done
echo "     ✅ Frontend ready (PID: $FRONTEND_PID)"

# ── Save PIDs ──
echo "$BACKEND_PID $FRONTEND_PID" > "$PID_FILE"

# ── Graceful shutdown ──
cleanup() {
    echo ""
    echo "🛑 Shutting down..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    rm -f "$PID_FILE"
    echo "✅ Services stopped. Docker sandbox still running."
    exit 0
}
trap cleanup SIGINT SIGTERM

echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ TrustChain Agent restarted!"
echo ""
echo "  🤖 Frontend:  http://localhost:$FRONTEND_PORT"
echo "  🔧 Backend:   http://localhost:$BACKEND_PORT"
echo "  🐳 Docker:    $CONTAINER_NAME (untouched)"
echo ""
echo "  Stop: Ctrl+C"
echo "═══════════════════════════════════════════"

wait
