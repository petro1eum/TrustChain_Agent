"""
TrustChain Agent — Tool Framework
Vendored & adapted from agency-swarm (https://github.com/VRSEN/agency-swarm)
Standalone implementation — no external dependencies beyond pydantic.
"""

from backend.tools.base_tool import BaseTool
from backend.tools.tool_registry import ToolRegistry

__all__ = ["BaseTool", "ToolRegistry"]
