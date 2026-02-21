"""
Headless Swarm Triggers Endpoint
Transforms traditional iPaaS webhooks into autonomous agent executions.
"""

from fastapi import APIRouter, Request, BackgroundTasks, Header, HTTPException
from pydantic import BaseModel, Field
from typing import Dict, Any, Optional
import uuid
import json
from datetime import datetime

from backend.tools.agent_runtime import run_agent

router = APIRouter(prefix="/api/v1/trigger", tags=["headless_triggers"])

import asyncio

MAX_CONCURRENT_WEBHOOKS = 10
MAX_QUEUE_SIZE = 1000

_active_webhook_count = 0
_pending_webhook_count = 0
_webhook_semaphore = None

def get_semaphore():
    global _webhook_semaphore
    if _webhook_semaphore is None:
        _webhook_semaphore = asyncio.Semaphore(MAX_CONCURRENT_WEBHOOKS)
    return _webhook_semaphore

async def queued_background_agent(*args, **kwargs):
    """Wrapper that gracefully waits in an async queue if swarm capacity is full."""
    global _active_webhook_count, _pending_webhook_count
    sem = get_semaphore()
    
    async with sem:
        # Move from pending queue to active execution
        _pending_webhook_count -= 1
        _active_webhook_count += 1
        try:
            await run_agent(*args, **kwargs)
        finally:
            _active_webhook_count -= 1

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
    background_tasks: BackgroundTasks,
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
    
    instruction = (
        f"You have been triggered via the Headless Swarm Trigger endpoint.\n"
        f"Task Slug (Event Name): {task_slug}\n"
        f"Payload received from external system:\n"
        f"```json\n{safe_payload_json}\n```\n"
        f"Please analyze this payload and execute the necessary actions logically associated "
        f"with the '{task_slug}' workflow. Rely on your Operational Knowledge (Knowledge Graph) "
        f"to define the specific steps. If you face a high-risk change (e.g. deleting users or issuing refunds), pause and execute a Human-in-the-Loop review."
    )

    # Rate Limiting / Token Exhaustion Guard — now guards the Queue instead of Concurrency
    global _pending_webhook_count
    if _pending_webhook_count >= MAX_QUEUE_SIZE:
        raise HTTPException(
            status_code=429, 
            detail=f"Rate Limit Exceeded: The TrustChain queue is completely full ({MAX_QUEUE_SIZE} pending webhooks). Please try again later."
        )

    # Place in Async Queue
    _pending_webhook_count += 1
    background_tasks.add_task(
        queued_background_agent,
        instruction=instruction,
        session_id=job_id,
        role="WebhookExecutor"
    )

    return {
        "status": "accepted",
        "job_id": job_id,
        "message": f"Webhook accepted and queued for autonomous processing (Queue size: {_pending_webhook_count}, Active: {_active_webhook_count})",
        "timestamp": datetime.utcnow().isoformat()
    }
