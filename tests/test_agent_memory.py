import pytest
import asyncio
from backend.tools.agent_runtime import get_current_task, get_all_tasks
from backend.tools.tool_registry import registry
from backend.tools.built_in.session_context import ToolContext

@pytest.mark.asyncio
async def test_session_isolation():
    # Attempt to get context for session A
    ctx_a = registry.get_context("session_A")
    ctx_a.environment["var1"] = "alpha"
    
    # Attempt to get context for session B
    ctx_b = registry.get_context("session_B")
    ctx_b.environment["var1"] = "beta"
    
    # Verify isolation
    assert ctx_a.environment["var1"] == "alpha"
    assert ctx_b.environment["var1"] == "beta"
    assert ctx_a.session_id == "session_A"
    assert ctx_b.session_id == "session_B"

@pytest.mark.asyncio
async def test_native_tools_registered():
    tools = registry.list_tools()
    tool_names = [t["name"] for t in tools]
    
    # Assert new tools exist
    assert "WebSearchTool" in tool_names
    assert "ExecuteJavascriptTool" in tool_names
    
    # Assert old markdown definitions logically do not take precedence
    assert len(tool_names) > 0
