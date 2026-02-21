from typing import Any, Dict, List, Optional, ClassVar
import uuid
import asyncio
from pydantic import Field

from backend.tools.base_tool import BaseTool
from backend.tools.agent_runtime import run_agent, get_all_tasks

class SessionSpawnTool(BaseTool):
    """
    Spawn a background sub-agent session for a long-running or independent task.
    Returns a run_id for tracking. Use for parallel research, code analysis, etc.
    """
    name: ClassVar[str] = "session_spawn"
    description: ClassVar[str] = (
        "Spawn a background sub-agent session for a long-running or independent task. "
        "The sub-agent works asynchronously without blocking the current conversation. "
        "Returns a run_id for tracking. Use for: parallel research, code analysis, "
        "web scraping, document processing, any task that can run independently."
    )
    
    parameters: ClassVar[dict] = {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Short name for the session (e.g. 'code-review')",
            },
            "instruction": {
                "type": "string",
                "description": "Detailed task instruction for the sub-agent.",
            },
            "tools": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Whitelist of tool names available to the sub-agent.",
            },
            "priority": {
                "type": "string",
                "enum": ["low", "normal", "high"],
                "description": "Execution priority (default: normal)",
            },
            "sync": {
                "type": "boolean",
                "description": "If true, wait for the sub-agent to finish (synchronous). Defaults to False.",
            },
            "role": {
                "type": "string",
                "enum": ["CEO", "Researcher", "Developer", "SysAdmin", "Verifier"],
                "description": "The specialized role of the agent. Defaults to CEO (unconstrained).",
            },
        },
        "required": ["name", "instruction"],
    }

    async def run(self, context=None, **kwargs) -> Any:
        name = kwargs.get("name", "sub-agent")
        instruction = kwargs.get("instruction", "")
        sync = kwargs.get("sync", False)
        role = kwargs.get("role", "CEO")
        
        run_id = f"subagent_{uuid.uuid4().hex[:8]}"
        
        async def _spawn_subagent():
            try:
                await run_agent(
                    instruction=instruction,
                    session_id=run_id,
                    model="gemini-2.0-flash",
                    max_iterations=25,
                    role=role,
                )
            except Exception as e:
                pass
                
        if sync:
            await run_agent(
                instruction=instruction,
                session_id=run_id,
                model="gemini-2.0-flash",
                max_iterations=25,
                role=role,
            )
            task = next((t for t in get_all_tasks() if t.task_id == run_id), None)
            if not task:
                return {"error": "Synchronous subagent execution failed to return a result"}
                
            return {
                "run_id": run_id,
                "name": name,
                "status": task.status,
                "result": task.result or task.error or "No output produced",
                "tools_used": [tc["tool"] for tc in task.tool_calls],
            }
        else:
            # Note: since tools are executed in asyncio event loop we can just schedule it
            loop = asyncio.get_running_loop()
            loop.create_task(_spawn_subagent())
            
            return {
                "run_id": run_id,
                "name": name,
                "status": "pending",
                "message": "Sub-agent spawned successfully in background. Use session_status(run_id) to check progress and session_result(run_id) to get the final result."
            }


class SessionStatusTool(BaseTool):
    """
    Check the status and progress of a spawned sub-agent session.
    """
    name: ClassVar[str] = "session_status"
    description: ClassVar[str] = (
        "Check the status and progress of a spawned sub-agent session. "
        "Returns status (pending/running/completed/failed) and progress."
    )
    
    parameters: ClassVar[dict] = {
        "type": "object",
        "properties": {
            "run_id": {
                "type": "string",
                "description": "Run ID of the session to check. If omitted, returns summary of all sessions.",
            },
        },
        "required": [],
    }

    async def run(self, context=None, **kwargs) -> Any:
        run_id = kwargs.get("run_id")
        history = get_all_tasks()
        
        if run_id:
            task = next((t for t in history if t.task_id == run_id), None)
            if not task:
                return {"error": f"Session not found: {run_id}"}
                
            return {
                "run_id": task.task_id,
                "name": f"Session {task.task_id}",
                "status": task.status,
                "progress": 100 if task.status == "completed" else 50,
                "current_step": f"Iteration {task.iterations}",
                "has_result": task.status == "completed",
                "error": task.error
            }
        else:
            sessions = [
                {
                    "run_id": t.task_id,
                    "name": f"Session {t.task_id}",
                    "status": t.status,
                    "progress": 100 if t.status == "completed" else 50,
                }
                for t in history
            ]
            active_count = sum(1 for s in sessions if s["status"] in ("pending", "running"))
            return {
                "active_count": active_count,
                "sessions": sessions[:10]
            }


class SessionResultTool(BaseTool):
    """
    Get the final result of a completed sub-agent session.
    """
    name: ClassVar[str] = "session_result"
    description: ClassVar[str] = (
        "Get the final result of a completed sub-agent session. "
        "Only works for sessions with status 'completed'."
    )
    
    parameters: ClassVar[dict] = {
        "type": "object",
        "properties": {
            "run_id": {
                "type": "string",
                "description": "Run ID of the completed session",
            },
        },
        "required": ["run_id"],
    }

    async def run(self, context=None, **kwargs) -> Any:
        run_id = kwargs.get("run_id")
        history = get_all_tasks()
        
        task = next((t for t in history if t.task_id == run_id), None)
        if not task:
            return {"error": f"Session not found: {run_id}"}
            
        if task.status != "completed":
            return {"error": f"Session '{task.task_id}' is {task.status}, not completed yet."}
            
        return {
            "run_id": task.task_id,
            "name": f"Session {task.task_id}",
            "result": task.result,
            "tools_used": [tc["tool"] for tc in task.tool_calls],
        }

class MessageAgentTool(BaseTool):
    """
    Agency Swarm Message Communication: Send a directed message to a specific agent role 
    or an existing target run session. If targeting a 'new' subagent, it will automatically
    start a task and yield its conversational response.
    """
    name: ClassVar[str] = "message_agent"
    description: ClassVar[str] = (
        "Send a direct message or delegation request to another agent. "
        "Allows you to ask a Specialist Role (e.g. 'Researcher', 'Developer') for help, "
        "pass them context, and wait for their direct response without completing your main task."
    )
    
    parameters: ClassVar[dict] = {
        "type": "object",
        "properties": {
            "target_run_id": {
                "type": "string",
                "description": "The specific run_id to message, or 'new' to spawn a fresh listener.",
            },
            "role": {
                "type": "string",
                "enum": ["CEO", "Researcher", "Developer", "SysAdmin", "Verifier"],
                "description": "The specialized role of the agent. Required if target_run_id is 'new'.",
            },
            "message": {
                "type": "string",
                "description": "Your question, task delegation, or context sharing payload.",
            },
        },
        "required": ["target_run_id", "message"],
    }

    async def run(self, context=None, **kwargs) -> Any:
        target_run_id = kwargs.get("target_run_id")
        role = kwargs.get("role", "Developer")
        message = kwargs.get("message", "")
        
        if target_run_id == "new":
            run_id = f"{role.lower()}_{uuid.uuid4().hex[:6]}"
            instruction = f"Role: {role}\nRequest from main agent: {message}\nProvide a direct response or action."
            
            # MessageAgent is always synchronous (P2P implies waiting for an answer in context)
            await run_agent(
                instruction=instruction,
                session_id=run_id,
                model="gemini-2.0-flash",
                max_iterations=8, # Bounded iterations for sub-tasks
            )
            
            task = next((t for t in get_all_tasks() if t.task_id == run_id), None)
            if not task:
                return {"error": "Sub-agent failed to return a response."}
                
            return {
                "status": "success",
                "target_run_id": run_id,
                "role": role,
                "response": task.result or task.error or "No final output produced",
            }
        else:
            # Future implementation: Hooking into pre-existing queues
            return {
                "error": "Messaging a currently running session via queue is not yet implemented. Use target_run_id='new'."
            }

