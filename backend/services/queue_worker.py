import asyncio
import traceback
import logging

from backend.database.queue_db import claim_pending_task, update_task_status
from backend.tools.agent_runtime import run_agent

logger = logging.getLogger("durable_queue_worker")

# Define concurrency limit strictly for the Task Engine
MAX_CONCURRENT_WORKERS = 10
_worker_semaphore = asyncio.Semaphore(MAX_CONCURRENT_WORKERS)

async def _process_task(task: dict):
    """Processes a single task end-to-end, updating its database status upon completion."""
    task_id = task["id"]
    payload = task["payload"]
    instruction = payload.get("instruction", "")
    session_id = task_id # Use the db trigger ID as the agent session ID
    role = payload.get("role", "WebhookExecutor")

    try:
        # Run the autonomous agent strictly
        result = await run_agent(instruction=instruction, session_id=session_id, role=role)
        
        # Safely serialize Pydantic model or other objects
        if hasattr(result, "model_dump"):
            safe_output = result.model_dump(mode='json')
        elif hasattr(result, "dict"):
            safe_output = result.dict()
        else:
            safe_output = str(result)
            
        # On success, mark as SUCCESS and save the agent result
        update_task_status(task_id, "SUCCESS", result={"output": safe_output})
        logger.info(f"Task {task_id} completed successfully.")
    except Exception as e:
        # If the API crashes or agent fails, Dead Letter Queue (DLQ) it
        error_trace = traceback.format_exc()
        update_task_status(task_id, "FAILED", error=error_trace)
        logger.error(f"Task {task_id} FAILED. Error saved to DLQ.")

async def _worker_loop():
    """Infinite loop that continuously polls SQLite for PENDING tasks."""
    while True:
        try:
            # Atomic claim
            task = claim_pending_task()
            
            if not task:
                # No tasks in queue, sleep briefly
                await asyncio.sleep(2.0)
                continue
                
            # Wait for an available worker slot
            # Note: We claimed the task from DB, it's now RUNNING. 
            # If the semaphore is blocked, this just means it stays RUNNING while waiting for capacity.
            # In a distributed multi-node setup with multiple processes, we'd acquire semaphore BEFORE claiming.
            # But since this is a unified local instance, claiming first prevents other threads from grabbing it.
            await _worker_semaphore.acquire()
            
            # Fire and forget the background execution to immediately poll the next one
            def release_sem(fut):
                _worker_semaphore.release()
            
            # Create the asyncio task
            # run_agent is technically async but can block slightly, so wrapping it protects the poller loop
            exec_task = asyncio.create_task(_process_task(task))
            exec_task.add_done_callback(release_sem)

        except Exception as e:
            logger.error(f"Queue Worker error: {e}")
            await asyncio.sleep(5.0)

def start_queue_worker(loop=None):
    """Entry point to launch the durable queue loop on FastAPI startup."""
    if loop is None:
        loop = asyncio.get_event_loop()
    loop.create_task(_worker_loop())
    logger.info("Durable Webhook Queue Worker started...")
