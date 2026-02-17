"""
TrustChain Agent — FastAPI Backend
"""

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

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

# ── Routers ──
from backend.routers.trustchain_api import router as trustchain_router
from backend.routers.agent_mcp import router as mcp_router
from backend.routers.agent_memory import router as memory_router
from backend.routers.agent_webhook import router as webhook_router
from backend.routers.bash_executor import router as bash_router
from backend.routers.docker_agent import router as docker_router
from backend.routers.skills import router as skills_router
try:
    from backend.routers.trustchain_pro_api import router as trustchain_pro_router
    _has_trustchain_pro = True
except ImportError:
    _has_trustchain_pro = False
    print("⚠️  trustchain_pro not installed — Pro API disabled")

app.include_router(trustchain_router)
app.include_router(mcp_router)
app.include_router(memory_router)
app.include_router(webhook_router)
app.include_router(bash_router)
app.include_router(docker_router)
app.include_router(skills_router)
if _has_trustchain_pro:
    app.include_router(trustchain_pro_router)
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


# ── Health / Root ──

@app.get("/health")
async def health():
    return {"status": "ok", "service": "trustchain-agent-backend"}

@app.get("/")
async def root():
    return {"service": "TrustChain Agent API", "version": "0.1.0", "docs": "/docs"}
