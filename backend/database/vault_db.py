"""
Encrypted Credential Vault — AES-256-GCM backend storage.

Security model:
  - VAULT_MASTER_KEY env var (32 raw bytes encoded as hex-64 chars).
  - If not set, a random key is generated and stored in `vault.key` (dev mode only).
  - Encryption: AES-256-GCM per secret — each secret gets a fresh 12-byte random nonce.
  - The `ciphertext` stored in SQLite includes the GCM authentication tag (last 16 bytes).
  - Plaintext NEVER touches disk or logs — decryption happens only in RAM at call time.

Usage:
    from backend.database.vault_db import store_secret, reveal_secret, list_secrets, delete_secret
"""

import os
import secrets
import base64
import json
import threading
from datetime import datetime
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from backend.database.queue_db import get_db_connection  # Reuse the same tasks.db

_lock = threading.Lock()

# ─── Master Key Resolution ────────────────────────────────────────────────────

def _load_master_key() -> bytes:
    """
    Returns the 32-byte AES key.
    Priority: VAULT_MASTER_KEY env var (hex) > vault.key file > auto-generate.
    """
    env_key = os.environ.get("VAULT_MASTER_KEY", "")
    if env_key:
        key_bytes = bytes.fromhex(env_key)
        if len(key_bytes) != 32:
            raise ValueError("VAULT_MASTER_KEY must be exactly 64 hex characters (32 bytes).")
        return key_bytes

    key_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "vault.key")
    if os.path.exists(key_file):
        return bytes.fromhex(open(key_file).read().strip())

    # Auto-generate (dev mode) — warn clearly
    new_key = secrets.token_bytes(32)
    with open(key_file, "w") as f:
        f.write(new_key.hex())
    import warnings
    warnings.warn(
        "⚠️  VAULT: No VAULT_MASTER_KEY set. Generated a random key in vault.key. "
        "Set VAULT_MASTER_KEY in production!",
        RuntimeWarning,
        stacklevel=2
    )
    return new_key


_master_key: bytes | None = None

def _get_key() -> bytes:
    global _master_key
    if _master_key is None:
        _master_key = _load_master_key()
    return _master_key


# ─── SQLite Schema ────────────────────────────────────────────────────────────

def init_vault_table():
    """Creates the credentials table in tasks.db. Called at startup."""
    conn = get_db_connection()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS credentials (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL UNIQUE,
            service     TEXT NOT NULL,
            ciphertext  TEXT NOT NULL,  -- base64(nonce || GCM ciphertext+tag)
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_cred_service ON credentials(service)")
    conn.commit()


# ─── Encryption Primitives ────────────────────────────────────────────────────

def _encrypt(plaintext: str) -> str:
    """Encrypts plaintext with AES-256-GCM. Returns base64(nonce + ciphertext+tag)."""
    aesgcm = AESGCM(_get_key())
    nonce = secrets.token_bytes(12)           # 96-bit nonce per NIST recommendation
    ciphertext = aesgcm.encrypt(nonce, plaintext.encode(), None)
    return base64.b64encode(nonce + ciphertext).decode()


def _decrypt(blob_b64: str) -> str:
    """Decrypts base64(nonce + ciphertext+tag) → plaintext string. Runs entirely in RAM."""
    blob = base64.b64decode(blob_b64)
    nonce, ciphertext = blob[:12], blob[12:]
    aesgcm = AESGCM(_get_key())
    return aesgcm.decrypt(nonce, ciphertext, None).decode()


# ─── Public API ───────────────────────────────────────────────────────────────

def store_secret(name: str, service: str, plaintext_value: str) -> str:
    """Encrypts and stores a secret. Returns the secret's UUID."""
    import uuid
    secret_id = str(uuid.uuid4())
    ciphertext = _encrypt(plaintext_value)

    conn = get_db_connection()
    with _lock:
        conn.execute(
            """INSERT INTO credentials (id, name, service, ciphertext, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(name) DO UPDATE SET
                 service = excluded.service,
                 ciphertext = excluded.ciphertext,
                 updated_at = excluded.updated_at""",
            (secret_id, name, service, ciphertext,
             datetime.utcnow().isoformat(), datetime.utcnow().isoformat())
        )
        conn.commit()
    return secret_id


def reveal_secret(name_or_id: str) -> str | None:
    """
    Decrypts and returns plaintext in RAM. NEVER logged.
    Accepts either the secret's name or its UUID.
    """
    conn = get_db_connection()
    row = conn.execute(
        "SELECT ciphertext FROM credentials WHERE name = ? OR id = ?",
        (name_or_id, name_or_id)
    ).fetchone()
    if not row:
        return None
    return _decrypt(row["ciphertext"])


def list_secrets() -> list[dict]:
    """Returns metadata only — names, services, timestamps. Plaintext is never exposed."""
    conn = get_db_connection()
    rows = conn.execute(
        "SELECT id, name, service, created_at, updated_at FROM credentials ORDER BY service, name"
    ).fetchall()
    return [dict(r) for r in rows]


def delete_secret(name_or_id: str) -> bool:
    """Deletes a secret. Returns True if a row was deleted."""
    conn = get_db_connection()
    with _lock:
        cursor = conn.execute(
            "DELETE FROM credentials WHERE name = ? OR id = ?",
            (name_or_id, name_or_id)
        )
        conn.commit()
    return cursor.rowcount > 0


def generate_master_key_hint() -> str:
    """Helper: prints a ready-to-paste VAULT_MASTER_KEY for production setup."""
    return secrets.token_bytes(32).hex()
