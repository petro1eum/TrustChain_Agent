"""
Gap B: MCP Server Management API

CRUD endpoint для управления MCP серверами агента.
Используется MCPClientService на фронте для loadServerConfigs().
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
from datetime import datetime
from pathlib import Path
import json

router = APIRouter(prefix="/api/agent/mcp", tags=["agent_mcp"])

# Файловое хранилище
MCP_DIR = Path(__file__).parent.parent.parent / "data" / "agent_mcp"
MCP_DIR.mkdir(parents=True, exist_ok=True)
MCP_CONFIG_FILE = MCP_DIR / "servers.json"


# ─── Модели ───

class MCPServerConfig(BaseModel):
    """Конфигурация MCP сервера."""
    id: str = Field(..., description="Уникальный ID")
    name: str = Field(..., description="Человекочитаемое имя")
    url: str = Field(..., description="URL или команда для подключения")
    transport: str = Field("http", description="Тип транспорта: stdio | sse | http")
    enabled: bool = Field(True, description="Активен ли сервер")
    api_key: Optional[str] = Field(None, description="API ключ (если нужен)")
    timeout: int = Field(15000, description="Таймаут в мс")


# ─── Утилиты ───

def _load_servers() -> List[Dict[str, Any]]:
    """Загружает конфиги серверов."""
    if MCP_CONFIG_FILE.exists():
        try:
            return json.loads(MCP_CONFIG_FILE.read_text(encoding="utf-8"))
        except Exception:
            return []
    return []


def _save_servers(servers: List[Dict[str, Any]]) -> None:
    """Сохраняет конфиги серверов."""
    MCP_CONFIG_FILE.write_text(
        json.dumps(servers, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )


# ─── Endpoints ───

@router.get("/servers")
async def list_servers() -> Dict[str, Any]:
    """Список всех MCP серверов. Используется MCPClientService.loadServerConfigs()."""
    servers = _load_servers()
    return {"servers": servers, "count": len(servers)}


@router.post("/servers")
async def add_server(config: MCPServerConfig) -> Dict[str, Any]:
    """Добавляет новый MCP сервер."""
    servers = _load_servers()
    
    # Проверяем уникальность ID
    if any(s["id"] == config.id for s in servers):
        raise HTTPException(status_code=409, detail=f"Server '{config.id}' already exists")
    
    server_data = config.model_dump()
    server_data["added_at"] = datetime.utcnow().isoformat()
    servers.append(server_data)
    _save_servers(servers)
    
    return {"success": True, "server": server_data}


@router.put("/servers/{server_id}")
async def update_server(server_id: str, config: MCPServerConfig) -> Dict[str, Any]:
    """Обновляет конфигурацию MCP сервера."""
    servers = _load_servers()
    
    for i, s in enumerate(servers):
        if s["id"] == server_id:
            servers[i] = {**config.model_dump(), "added_at": s.get("added_at"), "updated_at": datetime.utcnow().isoformat()}
            _save_servers(servers)
            return {"success": True, "server": servers[i]}
    
    raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")


@router.delete("/servers/{server_id}")
async def delete_server(server_id: str) -> Dict[str, Any]:
    """Удаляет MCP сервер."""
    servers = _load_servers()
    new_servers = [s for s in servers if s["id"] != server_id]
    
    if len(new_servers) == len(servers):
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    _save_servers(new_servers)
    return {"success": True, "deleted": server_id}


@router.patch("/servers/{server_id}/toggle")
async def toggle_server(server_id: str, enabled: bool = True) -> Dict[str, Any]:
    """Включает/выключает MCP сервер."""
    servers = _load_servers()
    
    for s in servers:
        if s["id"] == server_id:
            s["enabled"] = enabled
            _save_servers(servers)
            return {"success": True, "server_id": server_id, "enabled": enabled}
    
    raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")


@router.get("/servers/{server_id}/test")
async def test_server_connection(server_id: str) -> Dict[str, Any]:
    """Тестирует подключение к MCP серверу."""
    servers = _load_servers()
    
    server = next((s for s in servers if s["id"] == server_id), None)
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    import httpx
    try:
        async with httpx.AsyncClient(timeout=float(server.get("timeout", 15000)) / 1000) as client:
            # Try to discover tools endpoint
            resp = await client.get(f"{server['url']}/tools")
            if resp.status_code == 200:
                tools = resp.json()
                return {
                    "success": True,
                    "server_id": server_id,
                    "tools_count": len(tools) if isinstance(tools, list) else 0,
                    "response_time_ms": resp.elapsed.total_seconds() * 1000
                }
            return {"success": False, "status_code": resp.status_code}
    except Exception as e:
        return {"success": False, "error": str(e)}


# Built-in MCP server presets
@router.get("/presets")
async def get_presets() -> Dict[str, Any]:
    """Возвращает список preset MCP серверов для быстрого добавления."""
    return {
        "presets": [
            {
                "id": "filesystem",
                "name": "File System MCP",
                "url": "npx -y @modelcontextprotocol/server-filesystem /",
                "transport": "stdio",
                "description": "Access to local filesystem"
            },
            {
                "id": "github",
                "name": "GitHub MCP",
                "url": "npx -y @modelcontextprotocol/server-github",
                "transport": "stdio",
                "description": "GitHub API integration (needs GITHUB_TOKEN)"
            },
            {
                "id": "postgres",
                "name": "PostgreSQL MCP",
                "url": "npx -y @modelcontextprotocol/server-postgres",
                "transport": "stdio",
                "description": "PostgreSQL database access"
            },
            {
                "id": "brave_search",
                "name": "Brave Search MCP",
                "url": "npx -y @modelcontextprotocol/server-brave-search",
                "transport": "stdio",
                "description": "Web search via Brave API"
            }
        ]
    }
