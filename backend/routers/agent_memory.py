"""
Gap A: Persistent Memory API — Backend Storage for Cross-Session Memory

CRUD endpoint для хранения cross-session памяти агента.
Используется PersistentMemoryService на фронте для load/save.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
from datetime import datetime
from pathlib import Path
import json

router = APIRouter(prefix="/api/agent/memory", tags=["agent_memory"])

# Файловое хранилище (для MVP, в проде — Redis/DB)
MEMORY_DIR = Path(__file__).parent.parent.parent / "data" / "agent_memory"
MEMORY_DIR.mkdir(parents=True, exist_ok=True)


# ─── Модели ───

class MemoryEntry(BaseModel):
    """Одна запись памяти."""
    key: str = Field(..., description="Уникальный ключ")
    value: str = Field(..., description="Содержание памяти")
    category: str = Field("general", description="Категория: preference, decision, fact, context")
    importance: float = Field(0.5, ge=0.0, le=1.0, description="Важность 0-1")
    source_session: Optional[str] = Field(None, description="ID сессии-источника")
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    access_count: int = 0


class MemoryStore(BaseModel):
    """Полное хранилище памяти пользователя."""
    user_id: str = "default"
    memories: Dict[str, MemoryEntry] = {}
    metadata: Dict[str, Any] = {}


# ─── Утилиты ───

def _get_store_path(user_id: str = "default") -> Path:
    """Путь к файлу хранилища."""
    safe_id = user_id.replace("/", "_").replace("..", "_")
    return MEMORY_DIR / f"{safe_id}.json"


def _load_store(user_id: str = "default") -> MemoryStore:
    """Загружает хранилище из файла."""
    path = _get_store_path(user_id)
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return MemoryStore(**data)
        except Exception:
            return MemoryStore(user_id=user_id)
    return MemoryStore(user_id=user_id)


def _save_store(store: MemoryStore) -> None:
    """Сохраняет хранилище в файл."""
    path = _get_store_path(store.user_id)
    path.write_text(
        json.dumps(store.model_dump(), ensure_ascii=False, indent=2, default=str),
        encoding="utf-8"
    )


# ─── Endpoints ───

@router.get("/")
async def list_memories(
    user_id: str = "default",
    category: Optional[str] = None,
    min_importance: float = 0.0
) -> Dict[str, Any]:
    """Получить все записи памяти (с фильтрацией)."""
    store = _load_store(user_id)
    memories = list(store.memories.values())
    
    if category:
        memories = [m for m in memories if m.category == category]
    if min_importance > 0:
        memories = [m for m in memories if m.importance >= min_importance]
    
    return {
        "memories": [m.model_dump() for m in memories],
        "total": len(memories),
        "user_id": user_id
    }


@router.get("/{key}")
async def get_memory(key: str, user_id: str = "default") -> Dict[str, Any]:
    """Получить конкретную запись памяти."""
    store = _load_store(user_id)
    if key not in store.memories:
        raise HTTPException(status_code=404, detail=f"Memory '{key}' not found")
    
    entry = store.memories[key]
    entry.access_count += 1
    _save_store(store)
    
    return {"memory": entry.model_dump()}


@router.post("/")
async def save_memory(entry: MemoryEntry, user_id: str = "default") -> Dict[str, Any]:
    """Сохранить или обновить запись памяти."""
    store = _load_store(user_id)
    now = datetime.utcnow().isoformat()
    
    if entry.key in store.memories:
        entry.updated_at = now
        entry.created_at = store.memories[entry.key].created_at
        entry.access_count = store.memories[entry.key].access_count
    else:
        entry.created_at = now
        entry.updated_at = now
    
    store.memories[entry.key] = entry
    _save_store(store)
    
    return {"success": True, "key": entry.key, "action": "updated" if entry.updated_at else "created"}


@router.post("/bulk")
async def save_memories_bulk(
    entries: List[MemoryEntry],
    user_id: str = "default"
) -> Dict[str, Any]:
    """Batch-сохранение нескольких записей."""
    store = _load_store(user_id)
    now = datetime.utcnow().isoformat()
    saved = 0
    
    for entry in entries:
        if entry.key in store.memories:
            entry.updated_at = now
            entry.created_at = store.memories[entry.key].created_at
        else:
            entry.created_at = now
            entry.updated_at = now
        store.memories[entry.key] = entry
        saved += 1
    
    _save_store(store)
    return {"success": True, "saved": saved}


@router.delete("/{key}")
async def delete_memory(key: str, user_id: str = "default") -> Dict[str, Any]:
    """Удалить запись памяти."""
    store = _load_store(user_id)
    if key not in store.memories:
        raise HTTPException(status_code=404, detail=f"Memory '{key}' not found")
    
    del store.memories[key]
    _save_store(store)
    return {"success": True, "deleted": key}


@router.delete("/")
async def clear_memories(user_id: str = "default", category: Optional[str] = None) -> Dict[str, Any]:
    """Очистить память (всю или по категории)."""
    store = _load_store(user_id)
    
    if category:
        keys_to_delete = [k for k, v in store.memories.items() if v.category == category]
        for key in keys_to_delete:
            del store.memories[key]
        count = len(keys_to_delete)
    else:
        count = len(store.memories)
        store.memories = {}
    
    _save_store(store)
    return {"success": True, "cleared": count, "category": category}


@router.get("/search/relevant")
async def search_relevant(
    query: str,
    user_id: str = "default",
    limit: int = 5
) -> Dict[str, Any]:
    """Поиск релевантных записей по ключевым словам (простой TF-based)."""
    store = _load_store(user_id)
    query_words = set(query.lower().split())
    
    scored = []
    for entry in store.memories.values():
        text = f"{entry.key} {entry.value} {entry.category}".lower()
        overlap = sum(1 for w in query_words if w in text)
        if overlap > 0:
            score = overlap / len(query_words) * entry.importance
            scored.append((score, entry))
    
    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[:limit]
    
    return {
        "results": [{"score": s, "memory": e.model_dump()} for s, e in top],
        "total_matches": len(scored)
    }
