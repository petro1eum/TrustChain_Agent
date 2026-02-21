#!/bin/bash
# ═══════════════════════════════════════════
#  TrustChain Agent — Start All Services
# ═══════════════════════════════════════════

DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$DIR/.pids"

CONTAINER_NAME="trustchain-agent-container"
IMAGE_NAME="trustchain-agent:latest"

# ── Ensure Node.js runtime (nvm / Homebrew) ──
ensure_node_runtime() {
    if command -v node >/dev/null && command -v npx >/dev/null; then
        return
    fi
    if [ -s "$HOME/.nvm/nvm.sh" ]; then
        . "$HOME/.nvm/nvm.sh"
    fi
    for BIN in "/opt/homebrew/bin" "/usr/local/bin"; do
        case ":$PATH:" in
        *":$BIN:"*) ;;
        *)
            if [ -d "$BIN" ]; then
                PATH="$BIN:$PATH"
            fi
            ;;
        esac
    done
    export PATH
    if ! command -v node >/dev/null; then
        echo "❌ Node.js не найден. Установите Node.js."
        exit 1
    fi
}

ensure_node_runtime

# ── Load and Secure .env ──
if [ ! -f "$DIR/.env" ]; then
    touch "$DIR/.env"
fi

set -a
. "$DIR/.env"
set +a

# Auto-generate a local API key for security if missing
if [ -z "$VITE_LOCAL_API_KEY" ]; then
    echo "  🔒 Generating secure VITE_LOCAL_API_KEY for local authentication..."
    SECURE_KEY=$(openssl rand -hex 32)
    echo "VITE_LOCAL_API_KEY=$SECURE_KEY" >> "$DIR/.env"
    export VITE_LOCAL_API_KEY=$SECURE_KEY
fi

# ── Ports ──
FRONTEND_PORT="${AGENT_PORT:-9741}"
BACKEND_PORT="${BACKEND_PORT:-9742}"

echo ""
echo "═══════════════════════════════════════════"
echo "  🚀 TrustChain Agent — Starting..."
echo "═══════════════════════════════════════════"
echo ""

# ── 0. Kill anything on our ports ──
for PORT in $FRONTEND_PORT $BACKEND_PORT; do
    PID=$(lsof -ti :$PORT 2>/dev/null)
    if [ -n "$PID" ]; then
        echo "  🛑 Killing process on port $PORT (PID: $PID)"
        kill $PID 2>/dev/null
    fi
done
sleep 1

# ── 1. Docker Agent Container ──
echo "  🐳 Preparing Docker container..."
if ! command -v docker >/dev/null 2>&1; then
    echo "     ⚠️  Docker not found — skills/sandbox disabled"
elif ! docker info >/dev/null 2>&1; then
    echo "     ⚠️  Docker daemon not running — skills/sandbox disabled"
else
    # Собираем образ если отсутствует
    if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
        echo "     🔨 Building $IMAGE_NAME (first time, may take a while)..."
        docker build -f "$DIR/Dockerfile.agent" -t "$IMAGE_NAME" "$DIR" || {
            echo "     ⚠️  Docker build failed — skills/sandbox disabled"
        }
    fi

    # Проверяем контейнер
    EXISTING=$(docker ps -a --filter "name=^${CONTAINER_NAME}$" --format '{{.Status}}' 2>/dev/null)
    if [ -z "$EXISTING" ]; then
        echo "     🆕 Creating container $CONTAINER_NAME..."
        # User data directory — shared between host and container
        USER_DATA_DIR="${USER_DATA_DIR:-$HOME/TrustChain-Files}"
        mkdir -p "$USER_DATA_DIR"/{uploads,outputs,config,transcripts,skills}
        echo "     📂 User data: $USER_DATA_DIR → /mnt/user-data/default"
        docker run -d \
            --name "$CONTAINER_NAME" \
            -p 6080:6080 \
            -p 8931:8931 \
            -v "$DIR:/mnt/workspace:ro" \
            -v "$DIR/skills:/mnt/skills:ro" \
            -v "$USER_DATA_DIR:/mnt/user-data/default" \
            "$IMAGE_NAME"
        echo "     ✅ Container created & started"
    elif echo "$EXISTING" | grep -q "Up"; then
        echo "     ✅ Container already running"
    else
        echo "     🔄 Starting stopped container..."
        docker start "$CONTAINER_NAME"
        echo "     ✅ Container started"
    fi
fi

# ── 2. Backend (FastAPI + uvicorn) ──
echo "  🔧 Starting Backend (port $BACKEND_PORT)..."
cd "$DIR"
python3 -m uvicorn backend.main:app \
    --host 0.0.0.0 \
    --port $BACKEND_PORT \
    --reload \
    --reload-dir backend &
BACKEND_PID=$!
echo "     PID: $BACKEND_PID"

# Wait for backend to be ready
for i in $(seq 1 10); do
    if curl -s http://localhost:$BACKEND_PORT/health > /dev/null 2>&1; then
        echo "     ✅ Backend ready"
        break
    fi
    sleep 0.5
done

# ── 3. Frontend (Vite) ──
echo "  🤖 Starting Frontend (port $FRONTEND_PORT)..."
cd "$DIR"
npx vite --port $FRONTEND_PORT &
FRONTEND_PID=$!
echo "     PID: $FRONTEND_PID"

# Wait for frontend to be ready
for i in $(seq 1 10); do
    if curl -s http://localhost:$FRONTEND_PORT > /dev/null 2>&1; then
        echo "     ✅ Frontend ready"
        break
    fi
    sleep 0.5
done

# ── Save PIDs ──
echo "$BACKEND_PID $FRONTEND_PID" > "$PID_FILE"

# ── Graceful shutdown ──
cleanup() {
    echo ""
    echo "🛑 Shutting down..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    # Контейнер НЕ останавливаем — пусть живёт для быстрого рестарта
    rm -f "$PID_FILE"
    echo "✅ All services stopped."
    echo "   (Docker container $CONTAINER_NAME still running — docker stop $CONTAINER_NAME to stop)"
    exit 0
}
trap cleanup SIGINT SIGTERM

echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ TrustChain Agent running!"
echo ""
echo "  🤖 Frontend:  http://localhost:$FRONTEND_PORT"
echo "  🔧 Backend:   http://localhost:$BACKEND_PORT"
echo "  📚 API Docs:  http://localhost:$BACKEND_PORT/docs"
echo "  🐳 Docker:    $CONTAINER_NAME"
echo ""
echo "  Stop: Ctrl+C"
echo "═══════════════════════════════════════════"

# Wait for all background processes
wait
