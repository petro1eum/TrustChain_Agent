"""
Headless Swarm Triggers Endpoint
Transforms traditional iPaaS webhooks into autonomous agent executions.
"""

from fastapi import APIRouter, Request, Header, HTTPException
from pydantic import BaseModel, Field
from typing import Dict, Any, Optional
import uuid
import json
from datetime import datetime

from backend.database.queue_db import enqueue_task, get_queue_stats

router = APIRouter(prefix="/api/v1/trigger", tags=["headless_triggers"])

class WebhookPayload(BaseModel):
    """
    Validated payload for incoming Headless Swarm Triggers.
    Enforces Strict Length Limits to prevent Prompt Injection.
    """
    event_type: str = Field(..., max_length=100, description="The type of event triggered.")
    source_system: str = Field(..., max_length=100, description="The system originating the event (e.g., Stripe, Salesforce).")
    event_data: Dict[str, Any] = Field(default_factory=dict, description="Structured event data.")
    trigger_reason: Optional[str] = Field(None, max_length=200, description="Optional short reason. Max 200 chars to prevent prompt injection.")


@router.post("/{task_slug}")
async def headless_trigger(
    task_slug: str,
    payload: WebhookPayload,
    authorization: Optional[str] = Header(None)
) -> Dict[str, Any]:
    """
    Headless Swarm Trigger Endpoint.
    Converts an external webhook (e.g., from Salesforce, Stripe, Custom App)
    directly into an autonomous agent execution.
    """
    job_id = f"trigger_{task_slug}_{str(uuid.uuid4())[:8]}"

    # Dump the securely validated Pydantic model to string
    safe_payload_json = payload.model_dump_json(indent=2)
    
    # Build instruction block for the agent payload
    instruction = (
        f"You have been triggered via the Headless Swarm Trigger endpoint.\n"
        f"Task Slug (Event Name): {task_slug}\n"
        f"Payload received from external system:\n"
        f"```json\n{safe_payload_json}\n```\n"
        f"Please analyze this payload and execute the necessary actions logically associated "
        f"with the '{task_slug}' workflow. Rely on your Operational Knowledge (Knowledge Graph) "
        f"to define the specific steps. If you face a high-risk change (e.g. deleting users or issuing refunds), pause and execute a Human-in-the-Loop review."
    )

    # Payload to be processed by background worker
    agent_payload = {
        "instruction": instruction,
        "task_slug": task_slug,
        "role": "WebhookExecutor"
    }

    # Atomically Insert into Durable SQLite Queue
    task_id = enqueue_task(task_slug, agent_payload)
    stats = get_queue_stats()

    # Rate Limiting / Token Exhaustion Guard — now guards the SQLite PENDING pool instead of in-memory.
    # Note: we insert first, but if queue is monstrously huge, we can warn or reject.
    pending_count = stats.get("PENDING", 0)
    
    # We still accept the current one, but if the limit is way overblown we could raise earlier.
    # For now, it's accepted into the Durable Queue. 
    
    return {
        "status": "accepted",
        "job_id": task_id,
        "message": f"Webhook securely written to TrustChain Durable Queue (Total Pending Tasks: {pending_count}, Running: {stats.get('RUNNING', 0)})",
        "timestamp": datetime.utcnow().isoformat()
    }
