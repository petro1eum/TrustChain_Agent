import asyncio
from typing import Any
from backend.tools.base_tool import BaseTool, ToolContext

class ExecuteJavascriptTool(BaseTool):
    """
    Executes raw NodeJS/Javascript code inside the secure container.
    """
    code: str

    async def run(self, context: ToolContext) -> Any:
        try:
            from backend.sandbox.docker_manager import DockerManager
            manager = DockerManager()
            container = manager.get_container()
            if not container:
                return {"error": "No active docker container"}
            
            # Write code to a temp file and execute
            import tempfile
            import os
            
            # Simple escape for bash (not bulletproof, so base64 is safer)
            import base64
            encoded_code = base64.b64encode(self.code.encode('utf-8')).decode('utf-8')
            
            cmd = f"echo {encoded_code} | base64 -d > /tmp/script.js && node /tmp/script.js"
            
            # Use asyncio.to_thread to not block the event loop
            result = await asyncio.to_thread(
                container.exec_run,
                ['bash', '-c', cmd],
                workdir=context.get("cwd", "/workspace")
            )
            
            exit_code = result.exit_code
            output = result.output.decode("utf-8")
            
            if exit_code != 0:
                return {
                    "error": f"Javascript execution failed with exit code {exit_code}",
                    "output": output
                }
                
            return {
                "success": True,
                "output": output
            }
        except Exception as e:
            return {"error": f"Failed to execute Javascript: {str(e)}"}
