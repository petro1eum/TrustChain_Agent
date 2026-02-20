"""
TrustChain Agent — FastAPI Backend
"""

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

app = FastAPI(
    title="TrustChain Agent API",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── TrustChain OSS: FastAPI Middleware (auto-sign all JSON responses) ──
try:
    from trustchain.integrations.fastapi import TrustChainMiddleware
    from backend.routers.trustchain_api import _tc as _signing_tc
    app.add_middleware(
        TrustChainMiddleware,
        trustchain=_signing_tc,
        sign_all=True,
        skip_paths=["/docs", "/openapi.json", "/health", "/redoc", "/", "/api/browser/proxy"],
    )
    print("✅ TrustChain OSS: FastAPI TrustChainMiddleware active (auto-sign responses)")
except ImportError as _mw_err:
    print(f"⚠️  TrustChainMiddleware not installed — responses unsigned: {_mw_err}")


# ── Routers ──
from backend.routers.trustchain_api import router as trustchain_router
from backend.routers.agent_mcp import router as mcp_router
from backend.routers.agent_memory import router as memory_router
from backend.routers.agent_webhook import router as webhook_router
from backend.routers.bash_executor import router as bash_router
from backend.routers.docker_agent import router as docker_router
from backend.routers.skills import router as skills_router
from backend.routers.browser_proxy import router as browser_proxy_router
try:
    from backend.routers.trustchain_pro_api import router as trustchain_pro_router
    _has_trustchain_pro = True
except Exception as _pro_err:
    _has_trustchain_pro = False
    print(f"⚠️  trustchain_pro not available — Pro API disabled: {_pro_err}")

app.include_router(trustchain_router)
app.include_router(mcp_router)
app.include_router(memory_router)
app.include_router(webhook_router)
app.include_router(bash_router)
app.include_router(docker_router)
app.include_router(skills_router)
app.include_router(browser_proxy_router)
if _has_trustchain_pro:
    app.include_router(trustchain_pro_router)
else:
    # Graceful fallback — return "not available" instead of 500
    @app.api_route("/api/trustchain-pro/{path:path}", methods=["GET", "POST"])
    async def trustchain_pro_stub(path: str = ""):
        return JSONResponse(status_code=200, content={
            "status": "unavailable",
            "available_count": 0,
            "total_count": 0,
            "modules": {},
            "hint": "trustchain_pro not installed — run in full platform mode for Pro features",
        })
# conversations — пропущен, зависит от database/models из OnaiDocs


# ── Stubs: понятные ответы для сервисов, которые не подключены ──

@app.api_route("/api/mcp-trust/{path:path}", methods=["GET", "POST"])
async def mcp_trust_stub(path: str):
    return JSONResponse(status_code=503, content={
        "error": "MCP Trust Registry не подключён",
        "hint": "Запустите OnaiDocs start.sh для полного стека с MCP server",
        "status": "unavailable",
    })

@app.post("/trustchain/register-key")
async def trustchain_register_key_stub(request: Request):
    body = await request.json()
    return {
        "status": "accepted",
        "key_id": body.get("key_id", "unknown"),
        "message": "Key registered (standalone mode)",
    }

@app.api_route("/api/conversations{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def conversations_stub(path: str = ""):
    return JSONResponse(status_code=503, content={
        "error": "Conversations API не доступен в standalone режиме",
        "hint": "Модуль conversations зависит от database/models из OnaiDocs",
        "status": "unavailable",
    })


# ── Sandbox VNC Resize ──

@app.post("/api/sandbox/resize")
async def sandbox_resize(request: Request):
    """Resize Xvfb + Chrome inside the Docker container to match the requested dimensions."""
    import subprocess
    body = await request.json()
    w = int(body.get("width", 1920))
    h = int(body.get("height", 1080))
    # Clamp to sane range
    w = max(640, min(w, 3840))
    h = max(480, min(h, 2160))
    try:
        result = subprocess.run(
            ["docker", "exec", "trustchain-agent-container", "bash", "/home/kb/resize.sh", str(w), str(h)],
            capture_output=True, text=True, timeout=10
        )
        return {"status": "ok", "width": w, "height": h, "output": result.stdout.strip()}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@app.post("/api/sandbox/navigate")
async def sandbox_navigate(request: Request):
    """Navigate Chrome inside the Docker container to a URL via xdotool."""
    import subprocess
    import shlex as _shlex
    body = await request.json()
    raw_url = body.get("url", "").strip()
    if not raw_url:
        return {"status": "error", "error": "No URL provided"}
    if not raw_url.startswith("http://") and not raw_url.startswith("https://"):
        raw_url = "https://" + raw_url
    try:
        safe = _shlex.quote(raw_url)
        cmd = (
            f"export DISPLAY=:99; "
            f"xdotool key F6; sleep 0.2; "
            f"xdotool key ctrl+a; sleep 0.1; "
            f"xdotool type --delay 5 --clearmodifiers {safe}; sleep 0.1; "
            f"xdotool key Return"
        )
        subprocess.run(
            ["docker", "exec", "trustchain-agent-container", "bash", "-c", cmd],
            capture_output=True, text=True, timeout=10,
        )
        return {"status": "ok", "url": raw_url}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@app.post("/api/sandbox/upload")
async def sandbox_upload(request: Request):
    """Upload a file to the Docker container's user-data directory."""
    import subprocess, base64
    body = await request.json()
    filename = body.get("filename", "").strip()
    data_b64 = body.get("data", "")
    subdir = body.get("subdir", "uploads")
    if not filename or not data_b64:
        return {"status": "error", "error": "filename and data required"}
    # Sanitize
    safe_name = filename.replace("/", "_").replace("..", "_")
    dest = f"/mnt/user-data/default/{subdir}/{safe_name}"
    try:
        file_bytes = base64.b64decode(data_b64)
        # Write via docker exec with stdin
        proc = subprocess.run(
            ["docker", "exec", "-i", "trustchain-agent-container", "bash", "-c",
             f'mkdir -p /mnt/user-data/default/{subdir} && cat > "{dest}"'],
            input=file_bytes, capture_output=True, timeout=30
        )
        return {"status": "ok", "path": dest, "size": len(file_bytes)}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@app.get("/api/sandbox/files")
async def sandbox_files(subdir: str = "uploads"):
    """List files in the Docker container's user-data directory."""
    import subprocess
    try:
        result = subprocess.run(
            ["docker", "exec", "trustchain-agent-container", "bash", "-c",
             f'ls -la /mnt/user-data/default/{subdir}/ 2>/dev/null || echo "empty"'],
            capture_output=True, text=True, timeout=5
        )
        return {"status": "ok", "files": result.stdout.strip()}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@app.post("/api/sandbox/open")
async def sandbox_open(request: Request):
    """Open a file in the Docker container using LibreOffice on VNC."""
    import subprocess, shlex as _shlex, asyncio
    body = await request.json()
    filepath = body.get("path", "").strip()
    if not filepath:
        return {"status": "error", "error": "No path provided"}
    safe_path = _shlex.quote(filepath)
    try:
        # Kill existing LibreOffice — use soffice.bin not -f soffice (avoids killing bash session)
        subprocess.run(
            ["docker", "exec", "trustchain-agent-container", "bash", "-c",
             "pkill -9 soffice.bin 2>/dev/null; pkill -9 oosplash 2>/dev/null; sleep 1.5; rm -f /tmp/.~lock.open_file.xlsx* 2>/dev/null"],
            capture_output=True, timeout=10
        )
        # Copy file to ASCII name to avoid Cyrillic locale issues inside container
        subprocess.run(
            ["docker", "exec", "trustchain-agent-container", "bash", "-c",
             f"cp {_shlex.quote(filepath)} /tmp/open_file.xlsx 2>/dev/null && echo ok"],
            capture_output=True, timeout=10
        )
        # Launch LibreOffice with list args (avoids shell quoting issues with Cyrillic filenames)
        subprocess.Popen(
            [
                "docker", "exec",
                "-e", "DISPLAY=:99",
                "trustchain-agent-container",
                "soffice", "--nofirststartwizard", "--norestore", "--calc", "/tmp/open_file.xlsx"
            ],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        # After LibreOffice loads, maximize it via xdotool
        async def maximize_later():
            await asyncio.sleep(5)
            subprocess.run(
                ["docker", "exec", "trustchain-agent-container", "bash", "-c",
                 "DISPLAY=:99 xdotool search --sync --onlyvisible --name 'LibreOffice Calc' "
                 "windowactivate --sync windowsize --sync 1920 1080 2>/dev/null || "
                 "DISPLAY=:99 xdotool search --sync --onlyvisible --name 'Calc' windowactivate windowsize 1920 1080 2>/dev/null"],
                capture_output=True, timeout=10
            )
        asyncio.create_task(maximize_later())
        return {"status": "ok", "path": filepath}
    except Exception as e:
        return {"status": "error", "error": str(e)}


# ── Health / Root ──

@app.get("/health")
async def health():
    return {"status": "ok", "service": "trustchain-agent-backend"}

@app.get("/metrics")
async def metrics():
    """Prometheus metrics endpoint (TrustChain OSS Metrics)."""
    try:
        from prometheus_client import generate_latest
        return Response(
            content=generate_latest(),
            media_type="text/plain; version=0.0.4; charset=utf-8",
        )
    except ImportError:
        return {"error": "prometheus_client not installed"}

@app.get("/")
async def root():
    return {"service": "TrustChain Agent API", "version": "0.1.0", "docs": "/docs"}
