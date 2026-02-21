"""
Vault REST API
Exposes the Encrypted Credential Vault to authorized internal consumers.
All routes require x-agent-key auth (same as the rest of the backend).
Plaintext values are returned only from the /reveal endpoint and only over HTTPS in production.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from backend.database.vault_db import (
    store_secret, reveal_secret, list_secrets, delete_secret, generate_master_key_hint
)

router = APIRouter(prefix="/api/v1/vault", tags=["vault"])


class StoreSecretRequest(BaseModel):
    name: str
    service: str
    value: str


class StoreSecretResponse(BaseModel):
    id: str
    name: str
    service: str
    message: str


@router.post("/secrets", response_model=StoreSecretResponse)
async def create_secret(req: StoreSecretRequest):
    """
    Store an encrypted secret. The plaintext `value` never touches disk after this call —
    only the AES-256-GCM ciphertext is persisted in SQLite.
    """
    if not req.name.strip() or not req.service.strip() or not req.value.strip():
        raise HTTPException(status_code=422, detail="name, service, and value are required.")

    secret_id = store_secret(req.name.strip(), req.service.strip(), req.value)
    return StoreSecretResponse(
        id=secret_id,
        name=req.name,
        service=req.service,
        message=f"Secret '{req.name}' encrypted and stored. Plaintext will never be logged."
    )


@router.get("/secrets")
async def get_secret_list():
    """
    Returns credential metadata (name, service, timestamps).
    Plaintext and ciphertext are NEVER included in this response.
    """
    return {"secrets": list_secrets()}


@router.get("/secrets/{name_or_id}/reveal")
async def reveal_secret_endpoint(name_or_id: str):
    """
    Decrypts and returns the secret value IN MEMORY.
    In production this endpoint should be behind HTTPS + additional MFA.
    Access is auditable because it requires the same x-agent-key auth.
    """
    value = reveal_secret(name_or_id)
    if value is None:
        raise HTTPException(status_code=404, detail=f"Secret '{name_or_id}' not found.")
    # Return in a wrapper — callers should discard after use, never log this response
    return {"name": name_or_id, "value": value, "warning": "Do not log this response."}


@router.delete("/secrets/{name_or_id}")
async def delete_secret_endpoint(name_or_id: str):
    """Permanently deletes a stored secret."""
    deleted = delete_secret(name_or_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Secret '{name_or_id}' not found.")
    return {"status": "ok", "message": f"Secret '{name_or_id}' permanently deleted."}


@router.get("/keygen")
async def keygen_hint():
    """
    Generates a cryptographically secure VAULT_MASTER_KEY for production use.
    Set this as an environment variable: VAULT_MASTER_KEY=<returned hex>
    """
    key_hex = generate_master_key_hint()
    return {
        "VAULT_MASTER_KEY": key_hex,
        "instructions": "Add this to your .env file or cloud secrets manager. Never commit it to git.",
        "length_bytes": 32,
        "algorithm": "AES-256-GCM"
    }
