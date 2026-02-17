"""
PersistentShellTool — Execute shell commands inside Docker container.
Adapted from agency-swarm PersistentShellTool for Docker-first execution.
Persistent cwd tracked per agent session.
"""

from typing import Optional

import docker
from pydantic import Field

from backend.tools.base_tool import BaseTool, ToolContext

CONTAINER_NAME = "trustchain-agent-container"
EXEC_TIMEOUT = 300  # 5 minutes


class PersistentShellTool(BaseTool):
    """
    Execute shell commands in the Docker sandbox with persistent working directory.
    The working directory persists across commands within the same session.
    """

    command: str = Field(..., description="Shell command to execute (e.g., 'ls -la', 'cat file.txt')")
    timeout: int = Field(EXEC_TIMEOUT, ge=1, le=600, description="Timeout in seconds")

    async def run(self, context: Optional[ToolContext] = None) -> str:
        try:
            client = docker.from_env()
            container = client.containers.get(CONTAINER_NAME)
        except docker.errors.NotFound:
            return f"❌ Container '{CONTAINER_NAME}' not found. Run start.sh first."
        except docker.errors.DockerException as e:
            return f"❌ Docker error: {e}"

        # Get persistent cwd from context
        cwd = "/home/kb"
        agent_name = "default"
        if context:
            agent_name = context.agent_name
            cwds = context.get("shell_cwds", {})
            cwd = cwds.get(agent_name, cwd)

        # Handle cd commands by updating persistent cwd
        cmd_stripped = self.command.strip()
        cd_warning = None

        if cmd_stripped.startswith("cd ") and not any(op in self.command for op in ["&&", "||", ";", "|"]):
            new_dir = cmd_stripped[3:].strip().strip("'\"")
            # Resolve path inside container
            check_result = container.exec_run(
                f"bash -c 'cd {cwd} && cd {new_dir} && pwd'",
                workdir=cwd,
            )
            if check_result.exit_code == 0:
                resolved = check_result.output.decode().strip()
                if context:
                    cwds = context.get("shell_cwds", {})
                    cwds[agent_name] = resolved
                    context.set("shell_cwds", cwds)
                return f"✅ Changed directory to `{resolved}`"
            else:
                return f"❌ cd failed: {check_result.output.decode().strip()}"
        elif cmd_stripped.startswith("cd "):
            cd_warning = "Warning: cd in chained command not persisted. Use separate cd command."

        # Execute command in container
        try:
            result = container.exec_run(
                f"bash -c {self.command!r}",
                workdir=cwd,
                demux=True,
            )
        except Exception as e:
            return f"❌ Execution error: {e}"

        stdout, stderr = result.output or (b"", b"")
        stdout_str = (stdout or b"").decode(errors="replace").strip()
        stderr_str = (stderr or b"").decode(errors="replace").strip()

        parts = []
        if stdout_str:
            parts.append(f"**Output:**\n```\n{stdout_str}\n```")
        if stderr_str:
            parts.append(f"**Stderr:**\n```\n{stderr_str}\n```")
        if result.exit_code != 0:
            parts.append(f"**Exit Code:** {result.exit_code}")
        if not parts:
            parts.append("✅ Command executed successfully (no output)")
        if cd_warning:
            parts.append(f"**{cd_warning}**")

        parts.append(f"**Working Directory:** `{cwd}`")
        return "\n\n".join(parts)
