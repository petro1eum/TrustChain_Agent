import asyncio
import traceback
import logging

from backend.database.queue_db import claim_pending_task, update_task_status
from backend.database.idempotency_store import (
    init_idempotency_table, get_completed_steps
)
from backend.tools.agent_runtime import run_agent

logger = logging.getLogger("durable_queue_worker")

# Concurrency limit for the Task Engine
MAX_CONCURRENT_WORKERS = 10
_worker_semaphore = asyncio.Semaphore(MAX_CONCURRENT_WORKERS)


def _build_idempotency_prompt(task_id: str, instruction: str) -> str:
    """
    Augments the base instruction with:
    1. The task_id as an Idempotency-Key for all external API calls.
    2. A list of already-completed steps (for Retry safety).
    """
    completed_steps = get_completed_steps(task_id)

    # Part 1: Idempotency Header instruction — injected for EVERY run
    idempotency_header = (
        f"\n\n🔑 IDEMPOTENCY PROTOCOL (MANDATORY):\n"
        f"Your unique Task ID is: `{task_id}`\n"
        f"When making ANY external API call (Stripe, Salesforce, SendGrid, etc.), you MUST:\n"
        f"  1. Pass this value as an HTTP header: `Idempotency-Key: {task_id}`\n"
        f"  2. Pass this value as a URL parameter if headers are not supported: `?idempotency_key={task_id}`\n"
        f"This prevents double-charges or duplicate records if this task is ever retried.\n"
        f"APIs like Stripe, Twilio, and AWS natively support Idempotency-Key headers.\n"
    )

    # Part 2: Completed steps context — only injected on Retry (when previous steps exist)
    retry_context = ""
    if completed_steps:
        retry_context = (
            f"\n\n⚠️ RETRY EXECUTION — SKIP COMPLETED STEPS:\n"
            f"The following steps were ALREADY successfully executed in the previous attempt.\n"
            f"DO NOT execute them again. Resume from the first step NOT in this list:\n"
        )
        for i, step in enumerate(completed_steps, 1):
            retry_context += f"  ✅ Step {i}: {step['tool']} — {step['result_summary']} (done at {step['completed_at']})\n"

    return instruction + idempotency_header + retry_context


async def _process_task(task: dict):
    """Processes a single task end-to-end with idempotency guarantees."""
    task_id = task["id"]
    payload = task["payload"]
    instruction = payload.get("instruction", "")
    role = payload.get("role", "WebhookExecutor")

    # Augment instruction with idempotency protocol + any retry context
    enriched_instruction = _build_idempotency_prompt(task_id, instruction)

    try:
        result = await run_agent(
            instruction=enriched_instruction,
            session_id=task_id,
            role=role
        )

        # Safely serialize Pydantic model or other objects
        if hasattr(result, "model_dump"):
            safe_output = result.model_dump(mode='json')
        elif hasattr(result, "dict"):
            safe_output = result.dict()
        else:
            safe_output = str(result)

        update_task_status(task_id, "SUCCESS", result={"output": safe_output})
        logger.info(f"Task {task_id} completed successfully.")

    except Exception:
        error_trace = traceback.format_exc()
        update_task_status(task_id, "FAILED", error=error_trace)
        logger.error(f"Task {task_id} FAILED → DLQ. Error saved.")


async def _worker_loop():
    """Infinite loop that continuously polls SQLite for PENDING tasks."""
    while True:
        try:
            task = claim_pending_task()
            if not task:
                await asyncio.sleep(2.0)
                continue

            await _worker_semaphore.acquire()

            def release_sem(fut):
                _worker_semaphore.release()

            exec_task = asyncio.create_task(_process_task(task))
            exec_task.add_done_callback(release_sem)

        except Exception as e:
            logger.error(f"Queue Worker error: {e}")
            await asyncio.sleep(5.0)


def start_queue_worker(loop=None):
    """Entry point: initializes DB tables and starts the durable queue polling loop."""
    # Initialize idempotency table alongside tasks table
    try:
        init_idempotency_table()
        logger.info("Idempotency table ready.")
    except Exception as e:
        logger.warning(f"Idempotency table init failed (non-fatal): {e}")

    if loop is None:
        loop = asyncio.get_event_loop()
    loop.create_task(_worker_loop())
    logger.info("Durable Webhook Queue Worker + Idempotency Engine started.")
