"""
Gap H: Webhook endpoint для Event Trigger Service

Принимает внешние webhook-события (GitHub, CI/CD, Slack, cron)
и проксирует их в AI Studio EventTriggerService для автоматической
обработки агентом.
"""

from fastapi import APIRouter, HTTPException, Request, Header
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
from datetime import datetime
import hmac
import hashlib
import json
import os
import asyncio
import httpx

router = APIRouter(prefix="/api/agent", tags=["agent_webhook"])

# Секрет для верификации webhook подписей (GitHub, GitLab и т.д.)
WEBHOOK_SECRET = os.getenv("AGENT_WEBHOOK_SECRET", "")
AI_STUDIO_URL = os.getenv("AI_STUDIO_URL", "http://localhost:5174")


# ─── Модели ───

class WebhookEvent(BaseModel):
    """Входящее webhook событие."""
    event_type: str = Field(..., description="Тип события: git_push, git_pr, ci_build, data_update, schedule, custom")
    source: str = Field(..., description="Источник: github, gitlab, jenkins, cron, custom")
    data: Dict[str, Any] = Field(default_factory=dict, description="Payload события")
    timestamp: Optional[str] = Field(None, description="ISO timestamp события")


class TriggerRegistration(BaseModel):
    """Регистрация нового триггера."""
    name: str = Field(..., description="Имя триггера")
    event_type: str = Field(..., description="Тип события для отслеживания")
    agent_instruction: str = Field(..., description="Инструкция для агента при срабатывании")
    pattern: Optional[str] = Field(None, description="Regex/glob паттерн для фильтрации")
    cooldown_seconds: Optional[int] = Field(60, description="Cooldown между срабатываниями (сек)")


class CronSchedule(BaseModel):
    """Cron-подобное расписание."""
    name: str = Field(..., description="Имя расписания")
    cron_expression: str = Field(..., description="Cron выражение (например '0 9 * * 1' = каждый понедельник в 9:00)")
    agent_instruction: str = Field(..., description="Инструкция для агента")
    enabled: bool = Field(True, description="Активно ли расписание")


class WebhookResponse(BaseModel):
    """Ответ на webhook."""
    received: bool = True
    triggers_matched: int = 0
    triggers_executed: int = 0
    results: List[Dict[str, Any]] = []
    timestamp: str = ""


# ─── In-memory storage (для MVP, в проде — Redis/DB) ───

_triggers: Dict[str, Dict[str, Any]] = {}
_schedules: Dict[str, Dict[str, Any]] = {}
_event_log: List[Dict[str, Any]] = []
MAX_EVENT_LOG = 100


# ─── Утилитарные функции ───

def verify_github_signature(payload: bytes, signature: str) -> bool:
    """Верификация GitHub webhook подписи."""
    if not WEBHOOK_SECRET:
        return True  # Без секрета — не верифицируем
    expected = "sha256=" + hmac.new(
        WEBHOOK_SECRET.encode(), payload, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


def normalize_event_type(source: str, raw_event: str) -> str:
    """Нормализация типа события из разных источников в единый формат."""
    mapping = {
        "github": {
            "push": "git_push",
            "pull_request": "git_pr",
            "issues": "issue_update",
            "release": "release",
            "workflow_run": "ci_build",
        },
        "gitlab": {
            "push": "git_push",
            "merge_request": "git_pr",
            "pipeline": "ci_build",
            "issue": "issue_update",
        }
    }
    source_map = mapping.get(source, {})
    return source_map.get(raw_event, raw_event)


async def forward_to_ai_studio(event: WebhookEvent, trigger: Dict[str, Any]) -> Dict[str, Any]:
    """Проксирует событие в AI Studio для обработки агентом."""
    try:
        enriched_instruction = (
            f"[Автоматический триггер: {trigger['name']}]\n"
            f"[Событие: {event.event_type} от {event.source}]\n"
            f"[Данные: {json.dumps(event.data, ensure_ascii=False, default=str)[:1000]}]\n\n"
            f"{trigger['agent_instruction']}"
        )
        # Proxied to AI Studio chat endpoint (if available)
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{AI_STUDIO_URL}/api/chat",
                json={"message": enriched_instruction, "source": "webhook_trigger"}
            )
            return {"status": resp.status_code, "forwarded": True}
    except Exception as e:
        return {"status": 0, "forwarded": False, "error": str(e)}


# ─── Endpoints ───

@router.post("/webhook", response_model=WebhookResponse)
async def receive_webhook(
    event: WebhookEvent,
    request: Request,
    x_hub_signature_256: Optional[str] = Header(None),
    x_github_event: Optional[str] = Header(None),
    x_gitlab_event: Optional[str] = Header(None),
):
    """
    Принимает внешние webhook-события и обрабатывает через зарегистрированные триггеры.
    
    Поддерживает:
    - GitHub webhooks (верификация подписи через X-Hub-Signature-256)
    - GitLab webhooks
    - Произвольные webhooks (CI/CD, мониторинг, cron)
    """
    # GitHub signature verification
    if x_hub_signature_256 and WEBHOOK_SECRET:
        body = await request.body()
        if not verify_github_signature(body, x_hub_signature_256):
            raise HTTPException(status_code=401, detail="Invalid webhook signature")

    # Normalize event type from GitHub/GitLab headers
    if x_github_event:
        event.event_type = normalize_event_type("github", x_github_event)
        event.source = event.source or "github"
    elif x_gitlab_event:
        event.event_type = normalize_event_type("gitlab", x_gitlab_event)
        event.source = event.source or "gitlab"

    if not event.timestamp:
        event.timestamp = datetime.utcnow().isoformat()

    # Log event
    _event_log.append({
        "event_type": event.event_type,
        "source": event.source,
        "timestamp": event.timestamp,
        "data_keys": list(event.data.keys())
    })
    if len(_event_log) > MAX_EVENT_LOG:
        _event_log.pop(0)

    # Match triggers
    matched = 0
    executed = 0
    results = []

    for tid, trigger in _triggers.items():
        if not trigger.get("enabled", True):
            continue
        if trigger["event_type"] != event.event_type and trigger["event_type"] != "*":
            continue

        # Pattern matching (simple substring check)
        pattern = trigger.get("pattern")
        if pattern:
            data_str = json.dumps(event.data, default=str)
            if pattern not in data_str:
                continue

        matched += 1

        # Cooldown check
        last = trigger.get("last_triggered", 0)
        cooldown = trigger.get("cooldown_seconds", 60)
        now = datetime.utcnow().timestamp()
        if now - last < cooldown:
            results.append({"trigger": trigger["name"], "skipped": "cooldown"})
            continue

        # Execute
        trigger["last_triggered"] = now
        trigger["trigger_count"] = trigger.get("trigger_count", 0) + 1

        fwd = await forward_to_ai_studio(event, trigger)
        executed += 1
        results.append({
            "trigger": trigger["name"],
            "executed": True,
            "forward_result": fwd
        })

    return WebhookResponse(
        received=True,
        triggers_matched=matched,
        triggers_executed=executed,
        results=results,
        timestamp=event.timestamp or datetime.utcnow().isoformat()
    )


@router.post("/webhook/triggers")
async def register_trigger(reg: TriggerRegistration) -> Dict[str, Any]:
    """Регистрирует новый триггер для обработки webhook событий."""
    import uuid
    tid = str(uuid.uuid4())[:8]
    _triggers[tid] = {
        "id": tid,
        "name": reg.name,
        "event_type": reg.event_type,
        "agent_instruction": reg.agent_instruction,
        "pattern": reg.pattern,
        "cooldown_seconds": reg.cooldown_seconds or 60,
        "enabled": True,
        "created_at": datetime.utcnow().isoformat(),
        "last_triggered": 0,
        "trigger_count": 0
    }
    return {"success": True, "trigger_id": tid, "trigger": _triggers[tid]}


@router.get("/webhook/triggers")
async def list_triggers() -> Dict[str, Any]:
    """Возвращает список всех зарегистрированных триггеров."""
    return {"triggers": list(_triggers.values()), "count": len(_triggers)}


@router.delete("/webhook/triggers/{trigger_id}")
async def delete_trigger(trigger_id: str) -> Dict[str, Any]:
    """Удаляет триггер."""
    if trigger_id not in _triggers:
        raise HTTPException(status_code=404, detail="Trigger not found")
    name = _triggers[trigger_id]["name"]
    del _triggers[trigger_id]
    return {"success": True, "deleted": name}


@router.patch("/webhook/triggers/{trigger_id}")
async def toggle_trigger(trigger_id: str, enabled: bool = True) -> Dict[str, Any]:
    """Включает/выключает триггер."""
    if trigger_id not in _triggers:
        raise HTTPException(status_code=404, detail="Trigger not found")
    _triggers[trigger_id]["enabled"] = enabled
    return {"success": True, "trigger_id": trigger_id, "enabled": enabled}


# ─── Cron Scheduler ───

@router.post("/webhook/schedules")
async def register_schedule(schedule: CronSchedule) -> Dict[str, Any]:
    """
    Регистрирует cron-like расписание для периодического запуска.
    
    Cron expressions:
    - '*/5 * * * *' — каждые 5 минут
    - '0 9 * * 1-5' — каждый будний день в 9:00
    - '0 0 * * 0' — каждое воскресенье в полночь
    """
    import uuid
    sid = str(uuid.uuid4())[:8]
    _schedules[sid] = {
        "id": sid,
        "name": schedule.name,
        "cron_expression": schedule.cron_expression,
        "agent_instruction": schedule.agent_instruction,
        "enabled": schedule.enabled,
        "created_at": datetime.utcnow().isoformat(),
        "last_run": None,
        "run_count": 0
    }
    return {"success": True, "schedule_id": sid, "schedule": _schedules[sid]}


@router.get("/webhook/schedules")
async def list_schedules() -> Dict[str, Any]:
    """Возвращает список всех cron расписаний."""
    return {"schedules": list(_schedules.values()), "count": len(_schedules)}


@router.delete("/webhook/schedules/{schedule_id}")
async def delete_schedule(schedule_id: str) -> Dict[str, Any]:
    """Удаляет расписание."""
    if schedule_id not in _schedules:
        raise HTTPException(status_code=404, detail="Schedule not found")
    del _schedules[schedule_id]
    return {"success": True}


# ─── Event Log ───

@router.get("/webhook/events")
async def get_event_log(limit: int = 20) -> Dict[str, Any]:
    """Возвращает лог последних webhook событий."""
    return {"events": _event_log[-limit:], "total": len(_event_log)}


@router.get("/webhook/github")
async def github_webhook_info() -> Dict[str, Any]:
    """Инструкции по настройке GitHub webhook."""
    return {
        "instructions": "Настройте GitHub webhook на URL: POST /api/agent/webhook",
        "content_type": "application/json",
        "secret": "Задайте через AGENT_WEBHOOK_SECRET env variable",
        "recommended_events": ["push", "pull_request", "issues", "workflow_run"],
        "example_trigger": {
            "name": "PR Review",
            "event_type": "git_pr",
            "agent_instruction": "Проанализируй новый Pull Request и проверь code quality",
            "pattern": None,
            "cooldown_seconds": 300
        }
    }
