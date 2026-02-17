"""
LoadFileAttachment — Read uploaded files from Docker container.
"""

from typing import Optional

import docker
from pydantic import Field

from backend.tools.base_tool import BaseTool, ToolContext

CONTAINER_NAME = "trustchain-agent-container"
UPLOADS_DIR = "/mnt/user-data/uploads"
MAX_READ_BYTES = 10 * 1024 * 1024  # 10 MB for text reading


class LoadFileAttachment(BaseTool):
    """
    Read file content from the uploads directory in the Docker container.
    Returns text content for text files, metadata for binary files.
    """

    file_path: str = Field(..., description="Path to file inside container (relative to uploads or absolute)")
    max_lines: int = Field(200, ge=1, le=5000, description="Max lines to return for text files")

    async def run(self, context: Optional[ToolContext] = None) -> dict:
        try:
            client = docker.from_env()
            container = client.containers.get(CONTAINER_NAME)
        except Exception as e:
            return {"error": f"Docker error: {e}"}

        # Resolve path
        path = self.file_path
        if not path.startswith("/"):
            path = f"{UPLOADS_DIR}/{path}"

        # Check existence
        check = container.exec_run(f"test -f {path} && echo exists")
        if check.exit_code != 0:
            return {"error": f"File not found: {path}"}

        # Get file info
        info = container.exec_run(f"file -b {path}")
        file_type = info.output.decode(errors="replace").strip()

        # Get size
        size_check = container.exec_run(f"stat --format='%s' {path}")
        size = int(size_check.output.decode().strip()) if size_check.exit_code == 0 else 0

        # For text files, read content
        is_text = any(kw in file_type.lower() for kw in ["text", "ascii", "utf", "json", "xml", "script"])
        if is_text and size <= MAX_READ_BYTES:
            result = container.exec_run(f"head -n {self.max_lines} {path}")
            content = result.output.decode(errors="replace")
            return {
                "path": path,
                "type": file_type,
                "size_bytes": size,
                "content": content,
                "truncated": size > MAX_READ_BYTES,
            }

        return {
            "path": path,
            "type": file_type,
            "size_bytes": size,
            "content": None,
            "message": "Binary file — use PresentFiles to share with user",
        }
