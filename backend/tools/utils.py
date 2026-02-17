"""
Tool utilities — MIME type resolution, file helpers.
"""

import mimetypes
from pathlib import Path

# Ensure common types are registered
mimetypes.init()
_EXTRA_TYPES = {
    ".md": "text/markdown",
    ".yaml": "text/yaml",
    ".yml": "text/yaml",
    ".json": "application/json",
    ".ts": "text/typescript",
    ".tsx": "text/typescript",
    ".jsx": "text/javascript",
    ".py": "text/x-python",
    ".sh": "text/x-shellscript",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}
for ext, mime in _EXTRA_TYPES.items():
    mimetypes.add_type(mime, ext)


def resolve_mime_type(path: str | Path) -> str:
    """Resolve MIME type for a file path."""
    path = Path(path)
    mime, _ = mimetypes.guess_type(str(path))
    return mime or "application/octet-stream"


def human_size(size_bytes: int) -> str:
    """Convert bytes to human-readable size string."""
    for unit in ("B", "KB", "MB", "GB"):
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024  # type: ignore
    return f"{size_bytes:.1f} TB"
