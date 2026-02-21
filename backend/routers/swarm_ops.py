"""
Swarm Ops API Router
Exposes Durable Task Queue state from SQLite for the Swarm Command Center UI.
Includes SSE streaming endpoint for zero-poll real-time updates.
"""

import asyncio
import json
from typing import Optional
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from sse_starlette.sse import EventSourceResponse

from backend.database.queue_db import (
    get_db_connection, update_task_status, get_queue_stats,
    subscribe_events, unsubscribe_events
)

router = APIRouter(prefix="/api/v1/swarm", tags=["swarm_ops"])


# ─── SSE Stream ───────────────────────────────────────────────────────────────

@router.get("/stream")
async def swarm_stream(request: Request):
    """
    Server-Sent Events endpoint. The UI connects ONCE and receives push events
    only when a task status changes — zero polling overhead during idle periods.
    """
    queue = subscribe_events()

    async def event_generator():
        # 1. Immediately send a snapshot of current stats so the UI populates instantly
        try:
            stats = get_queue_stats()
            yield {"event": "stats", "data": json.dumps(stats)}
        except Exception:
            pass

        # 2. Stream delta events as tasks change state
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    # Wait up to 15s; if nothing happens, send a keepalive ping
                    event_data = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield {"event": "task_update", "data": event_data}
                except asyncio.TimeoutError:
                    # Keepalive comment — prevents proxies from closing the connection
                    yield {"event": "ping", "data": "{}"}
        finally:
            unsubscribe_events(queue)

    return EventSourceResponse(event_generator())


# ─── REST Endpoints ───────────────────────────────────────────────────────────

@router.get("/tasks")
async def list_tasks(status: Optional[str] = None, limit: int = 100, offset: int = 0):
    """List all tasks in the Durable Queue, optionally filtered by status."""
    conn = get_db_connection()
    cursor = conn.cursor()
    if status:
        cursor.execute(
            "SELECT * FROM trigger_tasks WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (status, limit, offset)
        )
    else:
        cursor.execute(
            "SELECT * FROM trigger_tasks ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (limit, offset)
        )
    rows = cursor.fetchall()

    tasks = []
    for row in rows:
        task = dict(row)
        for field in ("payload", "result"):
            if task.get(field):
                try:
                    task[field] = json.loads(task[field])
                except Exception:
                    pass
        tasks.append(task)

    return {"tasks": tasks, "total": len(tasks)}


@router.get("/stats")
async def queue_stats():
    """Returns high-level queue statistics for the dashboard header."""
    stats = get_queue_stats()
    return stats


@router.post("/tasks/{task_id}/retry")
async def retry_task(task_id: str):
    """Resets a FAILED task back to PENDING so the worker will pick it up again."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT status, payload FROM trigger_tasks WHERE id = ?", (task_id,))
    row = cursor.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Task not found")
    if row["status"] != "FAILED":
        raise HTTPException(status_code=400, detail=f"Cannot retry a task with status '{row['status']}'")

    # Load completed idempotency steps to inject into the retry prompt
    try:
        from backend.database.idempotency_store import get_completed_steps
        completed_steps = get_completed_steps(task_id)
    except Exception:
        completed_steps = []

    # Patch the payload to include retry context if there are completed steps
    if completed_steps:
        try:
            payload = json.loads(row["payload"]) if isinstance(row["payload"], str) else dict(row["payload"])
            if completed_steps:
                retry_note = (
                    "\n\n⚠️ RETRY CONTEXT — DO NOT REPEAT COMPLETED STEPS:\n"
                    "The following steps were ALREADY successfully executed in the previous attempt:\n"
                )
                for step in completed_steps:
                    retry_note += f"  ✅ {step['tool']} — {step['result_summary']} (at {step['completed_at']})\n"
                retry_note += "\nSkip these steps and continue from where the previous run failed."
                payload["instruction"] = payload.get("instruction", "") + retry_note
            
            cursor.execute(
                "UPDATE trigger_tasks SET status = 'PENDING', error = NULL, payload = ?, updated_at = ? WHERE id = ?",
                (json.dumps(payload), datetime.utcnow().isoformat(), task_id)
            )
        except Exception:
            cursor.execute(
                "UPDATE trigger_tasks SET status = 'PENDING', error = NULL, updated_at = ? WHERE id = ?",
                (datetime.utcnow().isoformat(), task_id)
            )
    else:
        cursor.execute(
            "UPDATE trigger_tasks SET status = 'PENDING', error = NULL, updated_at = ? WHERE id = ?",
            (datetime.utcnow().isoformat(), task_id)
        )

    conn.commit()
    return {
        "status": "ok",
        "message": f"Task {task_id} re-queued for retry.",
        "completed_steps_injected": len(completed_steps)
    }


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str):
    """Deletes a task permanently from the queue (e.g., dismiss from DLQ)."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT status FROM trigger_tasks WHERE id = ?", (task_id,))
    row = cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Task not found")

    cursor.execute("DELETE FROM trigger_tasks WHERE id = ?", (task_id,))
    conn.commit()
    return {"status": "ok", "message": f"Task {task_id} deleted."}
