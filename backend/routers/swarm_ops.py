"""
Swarm Ops API Router
Exposes Durable Task Queue state from SQLite for the Swarm Command Center UI.
"""

from fastapi import APIRouter, HTTPException
from typing import List, Optional
import json
import sqlite3
from datetime import datetime

from backend.database.queue_db import get_db_connection, update_task_status, enqueue_task

router = APIRouter(prefix="/api/v1/swarm", tags=["swarm_ops"])


@router.get("/tasks")
async def list_tasks(
    status: Optional[str] = None,
    limit: int = 100,
    offset: int = 0
):
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
        # Parse JSON fields safely
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
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT status, COUNT(*) as count FROM trigger_tasks GROUP BY status")
    rows = cursor.fetchall()

    stats = {"PENDING": 0, "RUNNING": 0, "SUCCESS": 0, "FAILED": 0, "total": 0}
    for row in rows:
        s = row["status"]
        if s in stats:
            stats[s] = row["count"]
        stats["total"] += row["count"]

    return stats


@router.post("/tasks/{task_id}/retry")
async def retry_task(task_id: str):
    """Resets a FAILED task back to PENDING so the worker will pick it up again."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT status FROM trigger_tasks WHERE id = ?", (task_id,))
    row = cursor.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Task not found")
    if row["status"] != "FAILED":
        raise HTTPException(status_code=400, detail=f"Cannot retry a task with status '{row['status']}'")

    cursor.execute(
        "UPDATE trigger_tasks SET status = 'PENDING', error = NULL, updated_at = ? WHERE id = ?",
        (datetime.utcnow().isoformat(), task_id)
    )
    conn.commit()

    return {"status": "ok", "message": f"Task {task_id} has been re-queued for retry."}


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str):
    """Deletes a task from the queue permanently (e.g., dismiss from DLQ)."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT status FROM trigger_tasks WHERE id = ?", (task_id,))
    row = cursor.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Task not found")

    cursor.execute("DELETE FROM trigger_tasks WHERE id = ?", (task_id,))
    conn.commit()

    return {"status": "ok", "message": f"Task {task_id} deleted."}
