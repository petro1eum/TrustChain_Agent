"""
ToolRegistry — Discover, register, and invoke tools.
"""

from typing import Any, Optional

from backend.tools.base_tool import BaseTool, ToolContext

# Import built-in tools
from backend.tools.built_in.persistent_shell import PersistentShellTool
from backend.tools.built_in.present_files import PresentFiles
from backend.tools.built_in.load_file import LoadFileAttachment

# TrustChain built-in tools (LLM auto-invokes via openai_schema)
from backend.tools.built_in.trustchain_tools import (
    TrustChainVerify,
    TrustChainAuditReport,
    TrustChainComplianceCheck,
    TrustChainChainStatus,
    TrustChainExecutionGraph,
    TrustChainAnalyticsSnapshot,
)


class ToolRegistry:
    """
    Central registry for all available tools.
    Discovers built-in tools and allows dynamic registration.
    """

    def __init__(self):
        self._tools: dict[str, type[BaseTool]] = {}
        self._contexts: dict[str, ToolContext] = {}  # per agent_name
        self._register_builtins()

    def _register_builtins(self):
        """Register all built-in tools."""
        for tool_cls in [
            PersistentShellTool,
            PresentFiles,
            LoadFileAttachment,
            # TrustChain audit & compliance tools
            TrustChainVerify,
            TrustChainAuditReport,
            TrustChainComplianceCheck,
            TrustChainChainStatus,
            TrustChainExecutionGraph,
            TrustChainAnalyticsSnapshot,
        ]:
            self.register(tool_cls)

    def register(self, tool_cls: type[BaseTool]) -> None:
        """Register a tool class."""
        name = tool_cls.__name__
        self._tools[name] = tool_cls

    def unregister(self, name: str) -> None:
        """Remove a tool from the registry."""
        self._tools.pop(name, None)

    def list_tools(self) -> list[dict[str, Any]]:
        """Return schema info for all registered tools."""
        result = []
        for name, cls in self._tools.items():
            schema = cls.openai_schema()
            result.append({
                "name": name,
                "description": schema.get("description", ""),
                "parameters": schema.get("parameters", {}),
            })
        return result

    def get_tool_class(self, name: str) -> Optional[type[BaseTool]]:
        """Get tool class by name."""
        return self._tools.get(name)

    def get_context(self, agent_name: str = "default") -> ToolContext:
        """Get or create context for an agent."""
        if agent_name not in self._contexts:
            self._contexts[agent_name] = ToolContext(agent_name=agent_name)
        return self._contexts[agent_name]

    async def run_tool(
        self,
        tool_name: str,
        params: dict[str, Any],
        agent_name: str = "default",
    ) -> Any:
        """
        Instantiate and run a tool by name.

        Args:
            tool_name: Name of the registered tool
            params: Parameters to pass to the tool (Pydantic field values)
            agent_name: Agent session name for context isolation

        Returns:
            Tool execution result
        """
        cls = self._tools.get(tool_name)
        if cls is None:
            return {"error": f"Tool '{tool_name}' not found", "available": list(self._tools.keys())}

        try:
            tool_instance = cls(**params)
        except Exception as e:
            return {"error": f"Invalid parameters for '{tool_name}': {e}"}

        context = self.get_context(agent_name)
        try:
            result = await tool_instance.run(context=context)
            return result
        except Exception as e:
            return {"error": f"Tool execution failed: {e}"}


# Singleton instance
registry = ToolRegistry()
