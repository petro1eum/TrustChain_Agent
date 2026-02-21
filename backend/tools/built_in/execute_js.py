from typing import Optional, Any
from pydantic import Field
import asyncio
import base64

import docker

from backend.tools.base_tool import BaseTool, ToolContext
from backend.tools.built_in.persistent_shell import CONTAINER_NAME

class ExecuteJavascriptTool(BaseTool):
    """
    Execute TypeScript/JavaScript code in the sandbox environment.
    Use this when you need programming logic, data processing, formatting, or custom scripts.
    Console logs will be returned as the result.
    """
    
    code: str = Field(..., description="The JavaScript code to execute. Can use console.log to output results.")
    timeout: int = Field(10, description="Execution timeout in seconds.")

    async def run(self, context: Optional[ToolContext] = None) -> Any:
        try:
            client = docker.from_env()
            container = client.containers.get(CONTAINER_NAME)
        except docker.errors.NotFound:
            return {"error": f"Container '{CONTAINER_NAME}' not found. Run start.sh first."}
        except docker.errors.DockerException as e:
            return {"error": f"Docker error: {e}"}

        cwd = "/home/kb"
        if context:
            cwds = context.get("shell_cwds", {})
            session_id = context.session_id
            cwd = cwds.get(session_id, cwd)

        # Base64 encode code to avoid bash quote escaping nightmares
        b64_code = base64.b64encode(self.code.encode("utf-8")).decode("utf-8")
        bash_cmd = f"echo '{b64_code}' | base64 -d | node"
        
        try:
            result = await asyncio.to_thread(
                container.exec_run,
                f"bash -c {bash_cmd!r}",
                workdir=cwd,
                demux=True,
            )
        except Exception as e:
            return {"error": f"Execution failed: {e}"}

        stdout, stderr = result.output or (b"", b"")
        stdout_str = (stdout or b"").decode(errors="replace").strip()
        stderr_str = (stderr or b"").decode(errors="replace").strip()

        if result.exit_code != 0:
            return {"error": f"Exit Code {result.exit_code}\\nStderr: {stderr_str}\\nStdout: {stdout_str}"}
            
        return stdout_str if stdout_str else "(No console output)"
