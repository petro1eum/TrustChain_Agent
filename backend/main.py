"""
TrustChain Agent — FastAPI Backend
"""

from fastapi import FastAPI, Request, Depends, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
import os

from contextlib import asynccontextmanager

from backend.database.queue_db import init_db
from backend.services.queue_worker import start_queue_worker
from backend.database.vault_db import init_vault_table

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup Events
    print("🚀 Initializing TrustChain Durable Task Engine...")
    init_db()                   # Create SQLite Schema if not exists
    init_vault_table()          # Create encryption credentials table
    start_queue_worker()        # Spawn the Asyncio polling loop
    yield
    # Shutdown Events
    print("🛑 Shutting down TrustChain Durable Task Engine...")

app = FastAPI(
    title="TrustChain Agent API",
    version="0.1.0",
    lifespan=lifespan
)

# ── Global Local Auth ──
LOCAL_API_KEY = os.getenv("VITE_LOCAL_API_KEY")

async def verify_local_api_key(request: Request):
    if not LOCAL_API_KEY:
        # Dev mode: If no key is set, log a warning but allow for now, 
        # but in production start.sh will enforce it.
        return True
        
    key = request.headers.get("x-agent-key") or request.query_params.get("x-agent-key")
    if key != LOCAL_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid x-agent-key header or query parameter")
    return True

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
from backend.routers.scheduler import router as scheduler_router
from backend.routers.swarm_ops import router as swarm_ops_router
from backend.routers.vault import router as vault_router
from backend.routers.triggers import router as triggers_router

try:
    from backend.routers.trustchain_pro_api import router as trustchain_pro_router
    _has_trustchain_pro = True
except Exception as _pro_err:
    _has_trustchain_pro = False
    print(f"⚠️  trustchain_pro not available — Pro API disabled: {_pro_err}")

app.include_router(trustchain_router, dependencies=[Depends(verify_local_api_key)])
app.include_router(mcp_router, dependencies=[Depends(verify_local_api_key)])
app.include_router(memory_router, dependencies=[Depends(verify_local_api_key)])
app.include_router(webhook_router, dependencies=[Depends(verify_local_api_key)])
app.include_router(bash_router, dependencies=[Depends(verify_local_api_key)])
app.include_router(docker_router, dependencies=[Depends(verify_local_api_key)])
app.include_router(skills_router, dependencies=[Depends(verify_local_api_key)])
app.include_router(browser_proxy_router, dependencies=[Depends(verify_local_api_key)])
app.include_router(scheduler_router, dependencies=[Depends(verify_local_api_key)])
app.include_router(swarm_ops_router, dependencies=[Depends(verify_local_api_key)])
app.include_router(vault_router, dependencies=[Depends(verify_local_api_key)])

# Triggers are public webhooks, so they DO NOT receive the internal local API key guard.
# They are guarded by the WebhookExecutor RBAC role instead.
app.include_router(triggers_router)

if _has_trustchain_pro:
    app.include_router(trustchain_pro_router, dependencies=[Depends(verify_local_api_key)])
else:
    # Graceful fallback — return "not available" instead of 500
    @app.api_route("/api/trustchain-pro/{path:path}", methods=["GET", "POST"], dependencies=[Depends(verify_local_api_key)])
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

@app.api_route("/api/mcp-trust/{path:path}", methods=["GET", "POST"], dependencies=[Depends(verify_local_api_key)])
async def mcp_trust_stub(path: str):
    return JSONResponse(status_code=503, content={
        "error": "MCP Trust Registry не подключён",
        "hint": "Запустите OnaiDocs start.sh для полного стека с MCP server",
        "status": "unavailable",
    })

@app.post("/trustchain/register-key", dependencies=[Depends(verify_local_api_key)])
async def trustchain_register_key_stub(request: Request):
    body = await request.json()
    return {
        "status": "accepted",
        "key_id": body.get("key_id", "unknown"),
        "message": "Key registered (standalone mode)",
    }

@app.api_route("/api/conversations{path:path}", methods=["GET", "POST", "PUT", "DELETE"], dependencies=[Depends(verify_local_api_key)])
async def conversations_stub(path: str = ""):
    return JSONResponse(status_code=503, content={
        "error": "Conversations API не доступен в standalone режиме",
        "hint": "Модуль conversations зависит от database/models из OnaiDocs",
        "status": "unavailable",
        "status": "unavailable",
    })

# ── Docker Async Helper ──
import os
import asyncio

AGENT_CONTAINER_NAME = os.getenv("AGENT_CONTAINER_NAME", "trustchain-agent-container")

async def docker_exec_async(*cmd_args, input_bytes=None, timeout=30):
    """Async helper to execute commands inside the Agent Docker container without blocking the event loop."""
    try:
        args = ["docker", "exec"]
        if input_bytes:
            args.append("-i")
        args.append(AGENT_CONTAINER_NAME)
        args.extend(cmd_args)
        
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            stdin=asyncio.subprocess.PIPE if input_bytes else None
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(input=input_bytes), timeout=timeout)
            return stdout.decode(), stderr.decode(), proc.returncode
        except asyncio.TimeoutError:
            proc.kill()
            raise Exception("Docker exec timed out")
    except Exception as e:
        raise Exception(f"Docker exec failed: {str(e)}")

# ── Sandbox VNC Resize ──

@app.post("/api/sandbox/resize", dependencies=[Depends(verify_local_api_key)])
async def sandbox_resize(request: Request):
    """Resize Xvfb + Chrome inside the Docker container to match the requested dimensions."""
    body = await request.json()
    w = int(body.get("width", 1920))
    h = int(body.get("height", 1080))
    # Clamp to sane range
    w = max(640, min(w, 3840))
    h = max(480, min(h, 2160))
    try:
        # Generate arbitrary resolution modeline dynamically using cvt
        bash_script = f"""
        export DISPLAY=:99
        # Get Modeline from cvt, e.g. 'Modeline "1234x567_60.00"  57.25 ...'
        CVT_OUT=$(cvt {w} {h} 60 | grep Modeline)
        # Extract everything after 'Modeline '
        MODELINE=$(echo "$CVT_OUT" | sed 's/Modeline //')
        # Extract just the name (first word)
        MODENAME=$(echo "$MODELINE" | awk '{{print $1}}')
        
        # Add and apply the new mode
        xrandr --newmode $MODELINE 2>/dev/null
        xrandr --addmode screen $MODENAME 2>/dev/null
        xrandr -s $MODENAME 2>/dev/null
        
        # Maximise all visible windows to the new resolution dynamically
        for WID in $(xdotool search --onlyvisible --name "." 2>/dev/null); do
            xdotool windowactivate --sync $WID 2>/dev/null || true
            xdotool windowmove $WID 0 0 2>/dev/null
            xdotool windowsize $WID 100% 100% 2>/dev/null
        done
        
        echo "Resized to $MODENAME"
        """
        stdout, stderr, code = await docker_exec_async("bash", "-c", bash_script, timeout=10)
        return {"status": "ok", "width": w, "height": h, "output": stdout.strip()}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@app.post("/api/sandbox/navigate", dependencies=[Depends(verify_local_api_key)])
async def sandbox_navigate(request: Request):
    """Navigate Chrome inside the Docker container to a URL via xdotool."""
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
        await docker_exec_async("bash", "-c", cmd, timeout=10)
        return {"status": "ok", "url": raw_url}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@app.post("/api/sandbox/upload", dependencies=[Depends(verify_local_api_key)])
async def sandbox_upload(request: Request):
    """Upload a file to the Docker container's user-data directory."""
    import base64
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
        script = f'mkdir -p /mnt/user-data/default/{subdir} && cat > "{dest}"'
        await docker_exec_async("bash", "-c", script, input_bytes=file_bytes, timeout=30)
        return {"status": "ok", "path": dest, "size": len(file_bytes)}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@app.get("/api/sandbox/files", dependencies=[Depends(verify_local_api_key)])
async def sandbox_files(subdir: str = "uploads"):
    """List files in the Docker container's user-data directory."""
    try:
        script = f'ls -la /mnt/user-data/default/{subdir}/ 2>/dev/null || echo "empty"'
        stdout, _, _ = await docker_exec_async("bash", "-c", script, timeout=5)
        return {"status": "ok", "files": stdout.strip()}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@app.post("/api/sandbox/open", dependencies=[Depends(verify_local_api_key)])
async def sandbox_open(request: Request):
    """Open a file in the Docker container using LibreOffice on VNC."""
    import shlex as _shlex
    body = await request.json()
    filepath = body.get("path", "").strip()
    if not filepath:
        return {"status": "error", "error": "No path provided"}
    
    try:
        # Kill existing LibreOffice
        await docker_exec_async("bash", "-c", "pkill -9 soffice.bin 2>/dev/null; pkill -9 oosplash 2>/dev/null; sleep 1.5; rm -f /tmp/.~lock.open_file.xlsx* 2>/dev/null", timeout=10)
        
        # Copy file
        await docker_exec_async("bash", "-c", f"cp {_shlex.quote(filepath)} /tmp/open_file.xlsx 2>/dev/null", timeout=10)
        
        # 1. Enforce landscape resolution BEFORE LibreOffice boots (fixes portrait squish)
        await docker_exec_async("bash", "-c", "DISPLAY=:99 xrandr -s 1920x1080 2>/dev/null", timeout=10)
        
        # Launch LibreOffice utilizing create_subprocess_exec independently (as a long-lived fire-and-forget process)
        await asyncio.create_subprocess_exec(
            "docker", "exec", "-e", "DISPLAY=:99", AGENT_CONTAINER_NAME,
            "soffice", "--nofirststartwizard", "--norestore", "--calc", "/tmp/open_file.xlsx",
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
        )
        
        # After LibreOffice loads, maximize it via xdotool and auto-accept Repair dialog
        async def maximize_later():
            await asyncio.sleep(4)
            # 2. Auto-accept "Repair File?" dialog if it appears
            await docker_exec_async("bash", "-c", "DISPLAY=:99 xdotool search --name 'LibreOffice 24.2' windowactivate --sync key Right Return 2>/dev/null || true", timeout=10)
            
            await asyncio.sleep(2)
            # 3. Maximize ALL visible windows
            script = """
            export DISPLAY=:99
            for WID in $(xdotool search --onlyvisible --name "." 2>/dev/null); do
                xdotool windowactivate --sync $WID 2>/dev/null || true
                xdotool windowmove $WID 0 0 2>/dev/null
                xdotool windowsize $WID 100% 100% 2>/dev/null
            done
            """
            await docker_exec_async("bash", "-c", script, timeout=10)
            
        asyncio.create_task(maximize_later())
        return {"status": "ok", "path": filepath}
    except Exception as e:
        return {"status": "error", "error": str(e)}

@app.get("/api/sandbox/screenshot", dependencies=[Depends(verify_local_api_key)])
async def sandbox_screenshot():
    """Capture a raw X11 screenshot of the VNC display for Agent Vision tools."""
    from fastapi.responses import FileResponse
    try:
        # Capture screen directly from Xvfb using ImageMagick
        await docker_exec_async("bash", "-c", "export DISPLAY=:99; import -window root /tmp/x11_screen.png", timeout=10)
        
        # Copy from container to host to serve it
        host_png_path = "/tmp/sandbox_x11_screen.png"
        import subprocess
        subprocess.run(["docker", "cp", f"{AGENT_CONTAINER_NAME}:/tmp/x11_screen.png", host_png_path], check=True)
        
        return FileResponse(host_png_path, media_type="image/png")
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
