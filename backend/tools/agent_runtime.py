"""
AgentRuntime — LLM tool-calling loop.
Loads skills from SKILL.md, sends to LLM (Gemini/OpenRouter),
executes tool_calls via ToolRegistry, loops until final answer.

Adapted from kb-catalog agent_headless.py (_run_agent_task).
"""

import asyncio
import json
import logging
import os
import time
import uuid
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import httpx
from dotenv import load_dotenv
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# Load env
_env_path = Path(__file__).resolve().parents[2] / ".env"
if _env_path.exists():
    load_dotenv(_env_path)


# ── TrustChain Integration (real Ed25519 signing) ──

from backend.routers.trustchain_api import sign_operation as _tc_sign


# ── TrustChain Pro Integration (optional — graceful degradation) ──

_tc_analytics = None
_tc_graph = None
_tc_compliance_cls = None

try:
    from trustchain_pro.enterprise.analytics import TrustChainAnalytics
    _tc_analytics = TrustChainAnalytics()
    logger.info("📊 TrustChain Pro: Analytics module loaded")
except ImportError:
    pass

try:
    from trustchain_pro.enterprise.graph import ExecutionGraph
    _tc_graph = ExecutionGraph()
    logger.info("🗓 TrustChain Pro: ExecutionGraph module loaded")
except ImportError:
    pass

try:
    from trustchain_pro.enterprise.compliance import ComplianceReport
    _tc_compliance_cls = ComplianceReport
    logger.info("⚖️  TrustChain Pro: Compliance module loaded")
except ImportError:
    pass

_tc_streaming = None
_tc_streaming_available = False

try:
    from trustchain_pro.enterprise.streaming import StreamingReasoningChain as _SRC_cls
    _tc_streaming_available = True
    logger.info("🌊 TrustChain Pro: StreamingReasoningChain module loaded")
except ImportError:
    _SRC_cls = None


def _get_streaming_chain():
    """Lazy-init StreamingReasoningChain (needs TrustChain instance)."""
    global _tc_streaming
    if _tc_streaming is None and _tc_streaming_available:
        try:
            from backend.routers.trustchain_api import _tc
            _tc_streaming = _SRC_cls(_tc, name="agent_reasoning")
        except Exception as ex:
            logger.debug(f"StreamingReasoningChain init failed: {ex}")
    return _tc_streaming


_tc_policy_engine = None
_tc_policy_available = False

try:
    from trustchain_pro.enterprise.policy_engine import PolicyEngine as _PE_cls
    _tc_policy_available = True
    logger.info("🛡️  TrustChain Pro: PolicyEngine module loaded")
except ImportError:
    _PE_cls = None


def _get_policy_engine():
    """Lazy-init PolicyEngine."""
    global _tc_policy_engine
    if _tc_policy_engine is None and _tc_policy_available:
        try:
            _tc_policy_engine = _PE_cls()
        except Exception as ex:
            logger.debug(f"PolicyEngine init failed: {ex}")
    return _tc_policy_engine


_tc_chain_explorer_available = False

try:
    from trustchain_pro.enterprise.exports import ChainExplorer as _CE_cls
    _tc_chain_explorer_available = True
    logger.info("📄 TrustChain Pro: ChainExplorer module loaded")
except ImportError:
    _CE_cls = None


# ── TrustChain OSS: Events (CloudEvents) ──

_tc_events_available = False
try:
    from trustchain.v2.events import TrustEvent
    _tc_events_available = True
    logger.info("📡 TrustChain OSS: Events (CloudEvents) module loaded")
except ImportError:
    TrustEvent = None

# ── TrustChain OSS: Metrics (Prometheus) ──

_tc_metrics = None
try:
    from trustchain.v2.metrics import get_metrics
    _tc_metrics = get_metrics(enabled=True)
    logger.info("📈 TrustChain OSS: Metrics (Prometheus) module loaded")
except ImportError:
    pass

# ── TrustChain OSS: OpenTelemetry ──

_tc_otel_available = False
try:
    from trustchain.integrations.opentelemetry import (
        TrustChainInstrumentor,
        set_trustchain_span_attributes,
    )
    TrustChainInstrumentor().instrument()
    _tc_otel_available = True
    logger.info("🔭 TrustChain OSS: OpenTelemetry instrumentor activated")
except ImportError:
    set_trustchain_span_attributes = None
except Exception as _otel_err:
    logger.debug(f"OpenTelemetry init skipped: {_otel_err}")
    set_trustchain_span_attributes = None


# ── SSE Event Queues (for live streaming to frontend) ──

_event_queues: dict[str, list[asyncio.Queue]] = defaultdict(list)


def subscribe_events(session_id: str) -> asyncio.Queue:
    """Create a new SSE event queue for a session. Frontend calls this via /agent/stream."""
    q: asyncio.Queue = asyncio.Queue(maxsize=200)
    _event_queues[session_id].append(q)
    return q


def unsubscribe_events(session_id: str, q: asyncio.Queue) -> None:
    """Remove an SSE event queue."""
    if session_id in _event_queues and q in _event_queues[session_id]:
        _event_queues[session_id].remove(q)


def _emit(session_id: str, event: dict) -> None:
    """Push an event to all subscribed SSE queues for this session."""
    for q in _event_queues.get(session_id, []):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass  # drop if consumer is slow


# ── Config ──

DEFAULT_MODEL = "google/gemini-2.0-flash-001"
MAX_ITERATIONS = 25
LLM_TIMEOUT = 90

MODEL_MAP = {
    "gemini-2.0-flash": "google/gemini-2.0-flash-001",
    "gemini-2.5-flash": "google/gemini-2.5-flash-preview",
    "gemini-2.0-pro": "google/gemini-2.5-pro",
    "gemini-2.5-pro": "google/gemini-2.5-pro",
}


# ── Skills Loader ──

def load_skills(skills_dir: str | Path) -> str:
    """
    Recursively load all SKILL.md files and format them as context.
    Returns a combined string for system prompt injection.
    """
    skills_dir = Path(skills_dir)
    if not skills_dir.exists():
        return ""

    skills = []
    for skill_path in sorted(skills_dir.rglob("SKILL.md")):
        rel = skill_path.relative_to(skills_dir)
        # Derive skill name from parent directory
        skill_name = skill_path.parent.name
        category = "/".join(str(rel).split("/")[:-1])
        content = skill_path.read_text("utf-8", errors="replace").strip()
        if content:
            skills.append(f"### Skill: {skill_name} ({category})\n{content}")

    if not skills:
        skills_text = ""
    else:
        skills_text = "## Available Skills\n\n" + "\n\n---\n\n".join(skills)
        
    # Semantic Knowledge Router (inject newly formed knowledge units)
    knowledge_dir = skills_dir.parent / ".tc_knowledge"
    knowledge_text = ""
    if knowledge_dir.exists():
        knowledge_units = []
        for kw_path in sorted(knowledge_dir.rglob("*.md")):
            try:
                content = kw_path.read_text("utf-8", errors="replace").strip()
                if content:
                    knowledge_units.append(f"### Knowledge Unit: {kw_path.name}\n{content}")
            except Exception as e:
                logger.error(f"Failed to read knowledge unit {kw_path}: {e}")
                
        if knowledge_units:
            knowledge_text = "\n\n## Operational Knowledge (Meta-Learning)\nThe following knowledge units apply to your current operational context:\n\n" + "\n\n---\n\n".join(knowledge_units)

    return skills_text + knowledge_text


def list_skill_files(skills_dir: str | Path) -> list[dict]:
    """List all available skills with metadata."""
    skills_dir = Path(skills_dir)
    if not skills_dir.exists():
        return []

    result = []
    for skill_path in sorted(skills_dir.rglob("SKILL.md")):
        rel = skill_path.relative_to(skills_dir)
        content = skill_path.read_text("utf-8", errors="replace").strip()
        # Extract first line as description
        first_line = content.split("\n")[0] if content else ""
        result.append({
            "name": skill_path.parent.name,
            "path": str(rel),
            "description": first_line.strip("# -").strip(),
        })
    return result


# ── Task State ──

class AgentTask(BaseModel):
    task_id: str = Field(default_factory=lambda: str(uuid.uuid4())[:12])
    status: str = "pending"
    instruction: str = ""
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    result: Optional[str] = None
    tool_calls: list[dict[str, Any]] = Field(default_factory=list)
    error: Optional[str] = None
    model: str = DEFAULT_MODEL
    iterations: int = 0
    chain_export_path: Optional[str] = None


# In-memory state (isolated by session_id)
_active_tasks: dict[str, AgentTask] = {}
_task_histories: dict[str, list[AgentTask]] = defaultdict(list)
MAX_HISTORY = 20

# ── Cross-Agent Collective Memory (Blackboard) ──
# This allows parallel and serial Subagents to share findings globally
_collective_memory: dict[str, str] = {}

def get_collective_memory() -> dict[str, str]:
    return _collective_memory

def set_collective_memory(key: str, value: str) -> None:
    _collective_memory[key] = value

def delete_collective_memory(key: str) -> bool:
    if key in _collective_memory:
        del _collective_memory[key]
        return True
    return False


# ── OpenAI Tools Spec from Registry ──

def _build_tools_spec() -> list[dict]:
    """Convert ToolRegistry tools into OpenAI function-calling format."""
    from backend.tools.tool_registry import registry
    tools = registry.list_tools()
    return [
        {
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t["description"],
                "parameters": t["parameters"],
            }
        }
        for t in tools
    ]


# ── System Prompt ──

SYSTEM_PROMPT_TEMPLATE = """You are TrustChain Agent — an AI assistant with access to a Docker sandbox.
You can execute bash commands, read files, and present results using the tools below.

## Your Tools
- **PersistentShellTool**: Execute bash commands in the Docker container. Working directory persists between calls.
- **PresentFiles**: Return metadata for files inside the container.
- **LoadFileAttachment**: Read file content from the container.

{skills_context}

## Cross-Agent Collective Memory
You operate in a multi-agent environment where other agents may run in parallel or sequence. 
Access the Shared Blackboard Collective Memory using the **ReadMemoryTool** and **WriteMemoryTool**.
Use this memory to share important discoveries, API keys, or task context with the rest of the swarm instead of repeating yourself.

## Guidelines
- Use PersistentShellTool for all bash/code execution
- Break complex tasks into steps
- Always verify results after execution
- Use the Collective Memory Tools to coordinate and pass state between complex sub-tasks
- If a command fails, analyze the error and try a different approach
- Respond in the same language as the user's instruction
"""


# ── Agent Runtime ──

async def run_agent(
    instruction: str,
    session_id: str,
    model: str = DEFAULT_MODEL,
    max_iterations: int = MAX_ITERATIONS,
    skills_dir: str | Path = "skills",
    role: str = "CEO",
) -> AgentTask:
    """
    Run the LLM agent with tool-calling loop.
    This is the core runtime — adapted from kb-catalog's _run_agent_task.
    """
    global _active_tasks, _task_histories

    from backend.tools.tool_registry import registry

    # Resolve model
    model = MODEL_MAP.get(model, model)

    # Create task
    task = AgentTask(
        instruction=instruction,
        model=model,
        status="running",
        started_at=datetime.now().isoformat(),
    )
    _active_tasks[session_id] = task
    _task_histories[session_id].append(task)
    if len(_task_histories[session_id]) > MAX_HISTORY:
        _task_histories[session_id].pop(0)

    try:
        # Load skills
        project_root = Path(__file__).resolve().parents[2]
        skills_path = project_root / skills_dir
        skills_context = load_skills(skills_path)

        # Build system prompt
        system_prompt = SYSTEM_PROMPT_TEMPLATE.format(skills_context=skills_context)
        
        if role != "CEO":
            # For specialized agents, we constrain their behavior.
            system_prompt = f"YOU ARE A SPECIALIZED SUB-AGENT. YOUR ROLE IS: {role.upper()}.\n" \
                            "You must strictly focus on the task delegated to you by the main agent. " \
                            "Do not attempt to solve the overall user objective. Return your specific sub-task result directly.\n\n" \
                            + system_prompt
                            
        # LLM config
        base_url = os.getenv("VITE_OPENAI_BASE_URL") or os.getenv("OPENAI_BASE_URL", "")
        api_key = os.getenv("VITE_OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY", "")

        if not base_url:
            raise RuntimeError("No LLM API URL configured. Set VITE_OPENAI_BASE_URL in .env")

        # Build endpoint
        base_url = base_url.rstrip("/")
        if base_url.endswith("/v1"):
            api_endpoint = f"{base_url}/chat/completions"
        else:
            api_endpoint = f"{base_url}/v1/chat/completions"

        # Build tools spec
        tools_spec = _build_tools_spec()

        # Message history
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": instruction},
        ]

        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        # OpenRouter headers
        if "openrouter.ai" in base_url:
            headers["HTTP-Referer"] = "http://localhost:5174"
            headers["X-Title"] = "TrustChain Agent"

        logger.info(f"🤖 AGENT START | model={model} | tools={len(tools_spec)} | instruction={instruction[:100]}")

        # ── Tool-calling loop ──
        async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client:
            for iteration in range(max_iterations):
                task.iterations = iteration + 1
                logger.info(f"── Session {session_id} | Iteration {iteration + 1}/{max_iterations} ({len(messages)} messages) ──")
                _emit(session_id, {"type": "thinking", "iteration": iteration + 1, "message": f"Iteration {iteration + 1}", "timestamp": datetime.now().isoformat()})

                payload = {
                    "model": model,
                    "messages": messages,
                }
                if tools_spec:
                    payload["tools"] = tools_spec
                    payload["tool_choice"] = "auto"

                # Call LLM
                resp = await client.post(api_endpoint, headers=headers, json=payload)

                if resp.status_code != 200:
                    logger.error(f"LLM error: HTTP {resp.status_code} — {resp.text[:300]}")
                    raise RuntimeError(f"LLM API error: HTTP {resp.status_code}")

                data = resp.json()
                if "error" in data:
                    raise RuntimeError(f"LLM error: {data['error']}")

                choice = data["choices"][0]
                msg = choice["message"]

                # Add assistant message to history
                messages.append(msg)

                # ── TrustChain Pro: Sign reasoning content (StreamingReasoningChain) ──
                reasoning_content = msg.get("content") or ""
                streaming = _get_streaming_chain()
                if reasoning_content and streaming:
                    try:
                        streaming._sign_step(reasoning_content[:2000])
                    except Exception as ex:
                        logger.debug(f"StreamingReasoningChain sign failed: {ex}")

                # Check for tool calls
                tool_calls = msg.get("tool_calls")
                if tool_calls:
                    logger.info(f"🔧 Tool calls: {len(tool_calls)}")
                    for tc in tool_calls:
                        tool_name = tc["function"]["name"]
                        try:
                            tool_args = json.loads(tc["function"].get("arguments", "{}") or "{}")
                            json_error = None
                        except json.JSONDecodeError as e:
                            tool_args = {}
                            json_error = f"Invalid JSON arguments from LLM: {str(e)}"

                        logger.info(f"   [{session_id}] → {tool_name}({json.dumps(tool_args, ensure_ascii=False)[:200]})")
                        _emit(session_id, {"type": "tool_call", "iteration": iteration + 1, "tool": tool_name, "args": tool_args, "timestamp": datetime.now().isoformat()})

                        # Record
                        t_start = time.monotonic()
                        tool_record = {
                            "iteration": iteration,
                            "tool": tool_name,
                            "args": tool_args,
                            "timestamp": datetime.now().isoformat(),
                        }

                        # ── TrustChain Pro: PolicyEngine pre-flight ──
                        policy_engine = _get_policy_engine()
                        policy_denied = False
                        if policy_engine:
                            try:
                                evaluation = policy_engine.evaluate(
                                    tool_id=tool_name,
                                    args=tool_args,
                                    context={"task_id": task.task_id, "iteration": iteration},
                                )
                                tool_record["policy_result"] = {
                                    "allowed": evaluation.allowed if hasattr(evaluation, 'allowed') else True,
                                    "violations": [str(v) for v in (evaluation.violations if hasattr(evaluation, 'violations') else [])],
                                }
                                if hasattr(evaluation, 'allowed') and not evaluation.allowed:
                                    logger.warning(f"🛡️ Policy DENIED tool {tool_name}: {evaluation.violations}")
                                    _emit(session_id, {"type": "policy_violation", "tool": tool_name, "violations": tool_record["policy_result"]["violations"], "timestamp": datetime.now().isoformat()})
                                    policy_denied = True
                            except Exception as ex:
                                logger.debug(f"PolicyEngine evaluate failed: {ex}")

                        if json_error:
                            tool_result = {"error": json_error}
                        elif policy_denied:
                            tool_result = {"error": f"POLICY DENIED: {tool_record['policy_result']['violations']} - Execution blocked."}
                        else:
                            # Execute via registry
                            tool_result = await registry.run_tool(
                                tool_name=tool_name,
                                params=tool_args,
                                session_id=session_id,
                            )
                        latency_ms = (time.monotonic() - t_start) * 1000

                        # Normalize result to string
                        if isinstance(tool_result, dict):
                            result_str = json.dumps(tool_result, ensure_ascii=False, default=str)
                        else:
                            result_str = str(tool_result)

                        tool_record["result"] = result_str
                        tool_record["success"] = "error" not in (tool_result if isinstance(tool_result, dict) else {})

                        # ── TrustChain: sign the operation (real Ed25519) ──
                        tool_record["trustchain"] = _tc_sign(
                            tool=tool_name,
                            data={"args": tool_args, "result_preview": result_str[:500]},
                            latency_ms=latency_ms,
                        )

                        task.tool_calls.append(tool_record)

                        # ── TrustChain Pro: Analytics ──
                        if _tc_analytics:
                            try:
                                _tc_analytics.record_operation(
                                    tool_name, latency_ms, tool_record["success"]
                                )
                            except Exception as ex:
                                logger.debug(f"Analytics record failed: {ex}")

                        # ── TrustChain OSS: Metrics (Prometheus counters) ──
                        if _tc_metrics:
                            try:
                                _tc_metrics.signs_total.labels(
                                    tool_id=tool_name,
                                    status="ok" if tool_record["success"] else "error",
                                ).inc()
                                _tc_metrics.sign_latency.labels(
                                    tool_id=tool_name,
                                ).observe(latency_ms / 1000.0)
                            except Exception:
                                pass

                        # ── TrustChain OSS: Events (CloudEvents emission) ──
                        if _tc_events_available and TrustEvent:
                            try:
                                _event = TrustEvent(
                                    source=f"/agent/{session_id}/tool/{tool_name}",
                                    subject=tool_name,
                                    data={"args": tool_args, "result_preview": result_str[:300]},
                                    trustchain_signature=tool_record["trustchain"].get("signature"),
                                    trustchain_nonce=tool_record["trustchain"].get("id"),
                                    trustchain_chain_id=task.task_id,
                                )
                                logger.debug(f"CloudEvent emitted: {_event.id} for {tool_name}")
                            except Exception:
                                pass

                        # ── TrustChain Pro: Execution Graph ──
                        if _tc_graph:
                            try:
                                _tc_graph.add_node(
                                    task.task_id, tool_name,
                                    tool_args, result_str[:500]
                                )
                            except Exception as ex:
                                logger.debug(f"Graph add_node failed: {ex}")

                        status_icon = "✅" if tool_record["success"] else "❌"
                        tc_sig = tool_record['trustchain'].get('signature', '')[:12]
                        logger.info(f"   {status_icon} Result: {result_str[:150]} [sig={tc_sig}…]")
                        _emit(session_id, {"type": "tool_result", "iteration": iteration + 1, "tool": tool_name, "result": result_str[:500], "signature": tool_record['trustchain'].get('signature', ''), "timestamp": datetime.now().isoformat()})

                        # Send result back to LLM
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tc["id"],
                            "content": result_str,
                        })
                else:
                    # No tool calls — agent is done
                    content = msg.get("content", "") or ""
                    logger.info(f"💬 [{session_id}] Agent final response: {content[:200]}")
                    _emit(session_id, {"type": "complete", "message": content[:500], "timestamp": datetime.now().isoformat()})
                    break

        # Complete
        task.result = messages[-1].get("content", "") if isinstance(messages[-1], dict) else ""
        task.status = "completed"
        task.completed_at = datetime.now().isoformat()

        # ── TrustChain Pro: Compliance audit event ──
        if _tc_compliance_cls:
            try:
                report = _tc_compliance_cls("AI_ACT")
                report.record_agent_task(
                    task_id=task.task_id,
                    tool_count=len(task.tool_calls),
                    model=task.model,
                    status=task.status,
                )
            except Exception as ex:
                logger.debug(f"Compliance record failed: {ex}")

        # ── TrustChain Pro: ChainExplorer auto-export ──
        if _tc_chain_explorer_available:
            try:
                from backend.routers.trustchain_api import _tc
                from backend.routers.trustchain_pro_api import _get_operations
                import tempfile

                ops = _get_operations()
                if ops and len(ops) > 0:
                    explorer = _CE_cls(responses=ops, tc=_tc)
                    export_dir = Path(tempfile.gettempdir()) / "trustchain_exports"
                    export_dir.mkdir(exist_ok=True)
                    export_path = export_dir / f"audit_{task.task_id}.html"
                    explorer.export_html(str(export_path))
                    task.chain_export_path = str(export_path)
                    logger.info(f"📄 ChainExplorer: exported audit trail → {export_path}")
            except Exception as ex:
                logger.debug(f"ChainExplorer export failed: {ex}")

        logger.info(f"✅ AGENT COMPLETED | tool_calls={len(task.tool_calls)} | iterations={task.iterations}")

    except Exception as e:
        task.status = "failed"
        task.error = f"{type(e).__name__}: {str(e)}"
        task.completed_at = datetime.now().isoformat()
        logger.error(f"❌ AGENT FAILED: {task.error}")

    return task


def get_current_task(session_id: str = "default") -> Optional[AgentTask]:
    return _active_tasks.get(session_id)


def get_task_history(session_id: str = "default", limit: int = 10) -> list[AgentTask]:
    return _task_histories[session_id][-limit:]

def get_all_tasks() -> list[AgentTask]:
    """Retrieve all tasks across all session IDs."""
    all_tasks = []
    for tasks in _task_histories.values():
        all_tasks.extend(tasks)
    return sorted(all_tasks, key=lambda t: t.started_at or "", reverse=True)
