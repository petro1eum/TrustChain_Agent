"""
Idempotency Store — prevents double-charges and duplicate API calls on Retry.

Pattern: Before any external HTTP call, compute a deterministic key.
If this key is already COMPLETED in the store, return the cached response.
If it's STARTED (previous run crashed mid-call), attempt the call again.
If it doesn't exist, insert STARTED, make the call, save to COMPLETED.
"""

import hashlib
import json
import threading
from datetime import datetime

from backend.database.queue_db import get_db_connection  # Shares the same tasks.db

_lock = threading.Lock()


def init_idempotency_table():
    """Creates the idempotency_log table if it doesn't exist. Called on startup."""
    conn = get_db_connection()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS idempotency_log (
            idempotency_key TEXT PRIMARY KEY,
            task_id         TEXT NOT NULL,
            tool_name       TEXT NOT NULL,
            status          TEXT NOT NULL,   -- 'STARTED' | 'COMPLETED'
            response_body   JSON,
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at    TIMESTAMP
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_idem_task ON idempotency_log(task_id)")
    conn.commit()


def make_idempotency_key(task_id: str, tool_name: str, call_args: dict) -> str:
    """
    Builds a deterministic, collision-resistant key from (task_id, tool_name, sorted args).
    Format: "{task_id}::{tool_name}::{sha256[:12]}"
    """
    args_fingerprint = hashlib.sha256(
        json.dumps(call_args, sort_keys=True).encode()
    ).hexdigest()[:12]
    return f"{task_id}::{tool_name}::{args_fingerprint}"


def check_idempotent(idempotency_key: str) -> dict | None:
    """
    Returns cached response if key is COMPLETED, else None.
    Callers should skip the HTTP call and return the cached result immediately.
    """
    conn = get_db_connection()
    row = conn.execute(
        "SELECT status, response_body FROM idempotency_log WHERE idempotency_key = ?",
        (idempotency_key,)
    ).fetchone()

    if not row:
        return None
    if row["status"] == "COMPLETED":
        return {"__cached__": True, "response": json.loads(row["response_body"]) if row["response_body"] else None}
    # STARTED means a previous attempt crashed — allow retry
    return None


def mark_started(idempotency_key: str, task_id: str, tool_name: str):
    """Inserts a STARTED record; safe to call multiple times (INSERT OR IGNORE)."""
    conn = get_db_connection()
    with _lock:
        conn.execute(
            """INSERT OR IGNORE INTO idempotency_log
               (idempotency_key, task_id, tool_name, status, created_at)
               VALUES (?, ?, ?, 'STARTED', ?)""",
            (idempotency_key, task_id, tool_name, datetime.utcnow().isoformat())
        )
        conn.commit()


def mark_completed(idempotency_key: str, response: dict):
    """Upgrades the record to COMPLETED and persists the response body for future retries."""
    conn = get_db_connection()
    with _lock:
        conn.execute(
            """UPDATE idempotency_log
               SET status = 'COMPLETED', response_body = ?, completed_at = ?
               WHERE idempotency_key = ?""",
            (json.dumps(response), datetime.utcnow().isoformat(), idempotency_key)
        )
        conn.commit()


def get_completed_steps(task_id: str) -> list[dict]:
    """Returns all COMPLETED steps for a task — used to build Retry context for the agent."""
    conn = get_db_connection()
    rows = conn.execute(
        """SELECT tool_name, response_body, completed_at
           FROM idempotency_log
           WHERE task_id = ? AND status = 'COMPLETED'
           ORDER BY completed_at ASC""",
        (task_id,)
    ).fetchall()
    return [
        {
            "tool": r["tool_name"],
            "result_summary": (json.loads(r["response_body"]) if r["response_body"] else {})
                              .get("summary", "completed"),
            "completed_at": r["completed_at"],
        }
        for r in rows
    ]
