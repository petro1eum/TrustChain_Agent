"""
PresentFiles — Return file metadata and serve files from Docker container outputs.
Adapted from agency-swarm PresentFiles.
"""

from pathlib import Path
from typing import Optional

import docker
from pydantic import Field

from backend.tools.base_tool import BaseTool, ToolContext
from backend.tools.utils import resolve_mime_type, human_size

CONTAINER_NAME = "trustchain-agent-container"
OUTPUT_DIR = "/mnt/user-data/outputs"
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100 MB


class PresentFiles(BaseTool):
    """
    Return metadata for files inside the Docker container and make them available for download.
    Use when showing generated/processed files to the user.
    """

    files: list[str] = Field(..., description="List of file paths inside the container")

    async def run(self, context: Optional[ToolContext] = None) -> dict:
        if not self.files:
            return {"files": [], "errors": ["No files provided."]}

        try:
            client = docker.from_env()
            container = client.containers.get(CONTAINER_NAME)
        except Exception as e:
            return {"files": [], "errors": [f"Docker error: {e}"]}

        results = []
        errors = []

        for file_path in self.files:
            # Check if file exists and get size
            check = container.exec_run(f"stat --format='%s' {file_path}")
            if check.exit_code != 0:
                errors.append(f"File not found: {file_path}")
                continue

            try:
                size = int(check.output.decode().strip())
            except ValueError:
                errors.append(f"Cannot read size: {file_path}")
                continue

            if size > MAX_FILE_SIZE:
                errors.append(f"File too large ({human_size(size)}): {file_path}")
                continue

            name = Path(file_path).name
            results.append({
                "name": name,
                "path": file_path,
                "mime_type": resolve_mime_type(name),
                "size_bytes": size,
                "size_human": human_size(size),
            })

        return {"files": results, "errors": errors}
