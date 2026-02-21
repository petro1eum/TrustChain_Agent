"""
BaseTool — Pydantic-based abstract tool class.
Adapted from agency-swarm BaseTool, stripped of external dependencies.
Each tool is a Pydantic model with typed fields + a run() method.
"""

from abc import ABC, abstractmethod
from typing import Any, Optional

from pydantic import BaseModel


class BaseTool(BaseModel, ABC):
    """
    Base class for all TrustChain Agent tools.

    Subclass this and define:
      - Pydantic fields for parameters
      - A docstring describing the tool (used as description in OpenAI schema)
      - A run() method that executes the tool logic

    Example:
        class MyTool(BaseTool):
            '''Search the web for a query.'''
            query: str = Field(..., description="Search query")

            async def run(self, context: ToolContext) -> str:
                return f"Results for {self.query}"
    """

    model_config = {"arbitrary_types_allowed": True}

    class ToolConfig:
        """Per-tool configuration."""
        # If True, only one invocation at a time per agent
        one_call_at_a_time: bool = False
        # If True, enforce strict OpenAI schema (additionalProperties: false)
        strict: bool = False

    # ── OpenAI Function-calling Schema ──

    @classmethod
    def openai_schema(cls) -> dict[str, Any]:
        """
        Generate OpenAI function-calling compatible JSON schema.
        Uses the class docstring as description.
        """
        schema = cls.model_json_schema()
        description = (cls.__doc__ or "").strip().split("\n")[0] or f"{cls.__name__} tool"

        parameters = {k: v for k, v in schema.items() if k not in ("title", "description")}
        parameters["required"] = sorted(
            k for k, v in parameters.get("properties", {}).items()
            if "default" not in v
        )

        result = {
            "name": schema.get("title", cls.__name__),
            "description": description,
            "parameters": parameters,
        }

        if getattr(cls.ToolConfig, "strict", False):
            result["strict"] = True
            result["parameters"]["additionalProperties"] = False

        return result

    # ── Execution ──

    @abstractmethod
    async def run(self, context: Optional["ToolContext"] = None) -> Any:
        """Execute the tool. Override this in subclasses."""
        ...


class ToolContext:
    """
    Shared execution context passed to tools.
    Holds persistent state (cwd, variables) per agent session.
    """

    def __init__(self, session_id: str = "default"):
        self.session_id = session_id
        self._state: dict[str, Any] = {}

    def get(self, key: str, default: Any = None) -> Any:
        return self._state.get(key, default)

    def set(self, key: str, value: Any) -> None:
        self._state[key] = value

    def clear(self) -> None:
        self._state.clear()
