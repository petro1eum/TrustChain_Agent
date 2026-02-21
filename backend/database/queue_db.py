import sqlite3
import json
import uuid
import os
from datetime import datetime
import threading
import asyncio
from typing import Set

# Use a relative or absolute path for the SQLite database
DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tasks.db")

# Thread-local storage to prevent sqlite3 multi-thread errors
_local = threading.local()

# ─── SSE Event Bus ────────────────────────────────────────────────────────────
# A set of asyncio.Queue objects, one per connected SSE client.
# This is an in-process broadcast bus — zero network overhead.
_sse_subscribers: Set[asyncio.Queue] = set()
_sse_lock = threading.Lock()

def subscribe_events() -> asyncio.Queue:
    """Register a new SSE subscriber. Returns a Queue the endpoint should read from."""
    q: asyncio.Queue = asyncio.Queue(maxsize=100)
    with _sse_lock:
        _sse_subscribers.add(q)
    return q

def unsubscribe_events(q: asyncio.Queue):
    """Remove a subscriber when the SSE connection closes."""
    with _sse_lock:
        _sse_subscribers.discard(q)

def get_db_connection():
    if not hasattr(_local, "conn"):
        _local.conn = sqlite3.connect(DB_PATH, timeout=5.0)
        _local.conn.row_factory = sqlite3.Row
        # WAL mode: allows concurrent reads while writing, eliminates "database is locked" under high load
        _local.conn.execute("PRAGMA journal_mode=WAL;")
        # Busy timeout: if the write lock is held, wait up to 5000ms before raising OperationalError
        _local.conn.execute("PRAGMA busy_timeout=5000;")
        _local.conn.execute("PRAGMA synchronous=NORMAL;")  # Balance durability vs. speed
    return _local.conn

def init_db():
    """Initializes the SQLite schema for background webhook trigger tasks."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS trigger_tasks (
            id TEXT PRIMARY KEY,
            task_slug TEXT NOT NULL,
            payload JSON NOT NULL,
            status TEXT NOT NULL,
            result JSON,
            error TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # Index for fast polling of PENDING tasks
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_status ON trigger_tasks(status)")
    conn.commit()

def enqueue_task(task_slug: str, payload: dict) -> str:
    """Inserts a new task into the database as PENDING and returns its ID."""
    conn = get_db_connection()
    cursor = conn.cursor()
    task_id = f"trigger_{task_slug}_{str(uuid.uuid4())[:8]}"
    
    cursor.execute(
        "INSERT INTO trigger_tasks (id, task_slug, payload, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        (task_id, task_slug, json.dumps(payload), "PENDING", datetime.utcnow().isoformat(), datetime.utcnow().isoformat())
    )
    conn.commit()
    return task_id

def claim_pending_task():
    """Atomically claims a single PENDING task by turning it into RUNNING. Returns the task dict or None."""
    conn = get_db_connection()
    # SQLite doesn't have true FOR UPDATE SKIP LOCKED until recent versions, so we use a subquery trick or an optimistic lock.
    # We will try to fetch one, and update it atomically.
    cursor = conn.cursor()
    
    # Needs to be a serialzied transaction
    cursor.execute("BEGIN IMMEDIATE")
    try:
        cursor.execute("SELECT id, task_slug, payload FROM trigger_tasks WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT 1")
        row = cursor.fetchone()
        
        if not row:
            conn.commit()
            return None
            
        task_id = row['id']
        
        cursor.execute(
            "UPDATE trigger_tasks SET status = 'RUNNING', updated_at = ? WHERE id = ?",
            (datetime.utcnow().isoformat(), task_id)
        )
        conn.commit()
        return {
            "id": row['id'],
            "task_slug": row['task_slug'],
            "payload": json.loads(row['payload'])
        }
    except Exception as e:
        conn.rollback()
        raise e

def update_task_status(task_id: str, status: str, result: dict = None, error: str = None):
    """Updates the status and outputs of an existing task, then fires an SSE event."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE trigger_tasks SET status = ?, result = ?, error = ?, updated_at = ? WHERE id = ?",
        (
            status,
            json.dumps(result) if result is not None else None,
            error,
            datetime.utcnow().isoformat(),
            task_id
        )
    )
    conn.commit()

    # ── Broadcast state change to all SSE subscribers ──
    event = json.dumps({"task_id": task_id, "status": status})
    with _sse_lock:
        dead = set()
        for q in _sse_subscribers:
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                dead.add(q)  # Slow/dead client — remove
        _sse_subscribers.difference_update(dead)

def get_queue_stats() -> dict:
    """Returns basic counts of tasks for the router."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT status, count(*) FROM trigger_tasks GROUP BY status")
    rows = cursor.fetchall()
    
    stats = {"PENDING": 0, "RUNNING": 0, "SUCCESS": 0, "FAILED": 0}
    for row in rows:
        status_name = row[0]
        if status_name in stats:
            stats[status_name] = row[1]
    return stats
