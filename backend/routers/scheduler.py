from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
from typing import List, Optional
import json
import os
import uuid
import datetime
import asyncio
from apscheduler.schedulers.asyncio import AsyncIOScheduler

import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.tools.agent_runtime import run_agent

router = APIRouter(prefix="/scheduler", tags=["Scheduler"])

# Global scheduler instance
try:
    scheduler_instance = AsyncIOScheduler()
    scheduler_instance.start()
except Exception as e:
    print(f"Failed to start AsyncIOScheduler: {e}")
    scheduler_instance = None

JOBS_FILE = ".trustchain/jobs.json"

class ScheduledJob(BaseModel):
    id: Optional[str] = None
    name: str = Field(..., description="Job name")
    schedule: str = Field(..., description="Cron expression e.g. '0 9 * * *'")
    instruction: str = Field(..., description="Agent instruction")
    tools: Optional[List[str]] = Field(default=None, description="Allowed tools")
    enabled: bool = True
    lastRun: Optional[int] = None
    nextRun: Optional[int] = None

def _load_jobs() -> dict:
    if os.path.exists(JOBS_FILE):
        try:
            with open(JOBS_FILE, "r") as f:
                return json.load(f)
        except:
            return {}
    return {}

def _save_jobs(jobs: dict):
    os.makedirs(os.path.dirname(JOBS_FILE), exist_ok=True)
    with open(JOBS_FILE, "w") as f:
        json.dump(jobs, f, indent=2)

def execute_job(job_id: str, instruction: str):
    """Callback for APScheduler. Must be threadsafe or use loop."""
    print(f"Executing scheduled job: {job_id}")
    jobs = _load_jobs()
    if job_id in jobs:
        jobs[job_id]["lastRun"] = int(datetime.datetime.now().timestamp() * 1000)
        _save_jobs(jobs)
        
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(
            run_agent(
                instruction=instruction,
                model="google/gemini-2.5-flash",
                max_iterations=10,
                agent_name=f"cron_{job_id}_{uuid.uuid4().hex[:4]}",
            )
        )
    except RuntimeError:
        # If no running loop, create one or run it
        asyncio.run(
            run_agent(
                instruction=instruction,
                model="google/gemini-2.5-flash",
                max_iterations=10,
                agent_name=f"cron_{job_id}_{uuid.uuid4().hex[:4]}",
            )
        )

def _sync_apscheduler():
    if not scheduler_instance: return
    
    scheduler_instance.remove_all_jobs()
    jobs = _load_jobs()
    for jid, data in jobs.items():
        if data.get("enabled", True):
            try:
                from apscheduler.triggers.cron import CronTrigger
                # "0 9 * * *"
                parts = data["schedule"].split()
                if len(parts) == 5:
                    minute, hour, day, month, day_of_week = parts
                    trigger = CronTrigger(minute=minute, hour=hour, day=day, month=month, day_of_week=day_of_week)
                    scheduler_instance.add_job(
                        execute_job,
                        trigger=trigger,
                        id=jid,
                        args=[jid, data["instruction"]]
                    )
            except Exception as e:
                print(f"Failed to add job {jid}: {e}")

# Initial sync
_sync_apscheduler()

@router.get("/jobs", response_model=List[ScheduledJob])
async def get_jobs():
    """List all scheduled jobs."""
    jobs = _load_jobs()
    # add synthetic next_run_time if available
    result = []
    for jid, data in jobs.items():
        if scheduler_instance:
            job = scheduler_instance.get_job(jid)
            if job and job.next_run_time:
                data["nextRun"] = int(job.next_run_time.timestamp() * 1000)
        result.append(data)
    return result

@router.post("/jobs", response_model=ScheduledJob)
async def create_job(job: ScheduledJob):
    """Create or update a scheduled job."""
    if not job.id:
        job.id = uuid.uuid4().hex[:8]
    jobs = _load_jobs()
    jobs[job.id] = job.model_dump()
    _save_jobs(jobs)
    _sync_apscheduler()
    return job

@router.delete("/jobs/{job_id}")
async def delete_job(job_id: str):
    """Delete a scheduled job."""
    jobs = _load_jobs()
    if job_id in jobs:
        del jobs[job_id]
        _save_jobs(jobs)
        _sync_apscheduler()
        return {"status": "deleted"}
    raise HTTPException(404, "Job not found")

@router.post("/jobs/{job_id}/run")
async def force_run_job(job_id: str, background_tasks: BackgroundTasks):
    """Force run a job immediately."""
    jobs = _load_jobs()
    if job_id not in jobs:
        raise HTTPException(404, "Job not found")
        
    job_data = jobs[job_id]
    
    background_tasks.add_task(
        run_agent,
        instruction=job_data["instruction"],
        model="google/gemini-2.5-flash",
        max_iterations=15,
        agent_name=f"cron_{job_id}_{uuid.uuid4().hex[:4]}",
    )
    
    return {"status": "started", "job_id": job_id}
