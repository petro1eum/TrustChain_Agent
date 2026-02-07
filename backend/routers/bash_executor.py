"""
Безопасный API для выполнения bash команд агентом
Включает whitelist/blacklist, timeout, изоляцию рабочей директории
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import subprocess
import os
import shlex
from pathlib import Path
import tempfile
import json

router = APIRouter(prefix="/api/bash", tags=["bash_executor"])

# Рабочая директория агента (изолированная)
AGENT_WORK_DIR = Path(tempfile.gettempdir()) / "agent_workspace"
AGENT_WORK_DIR.mkdir(exist_ok=True, mode=0o700)

# Whitelist разрешенных команд
ALLOWED_COMMANDS = {
    # Базовые команды
    "ls", "pwd", "cd", "cat", "head", "tail", "grep", "find", "wc", "sort", "uniq",
    # Git команды (только чтение)
    "git", "git-status", "git-log", "git-diff", "git-show", "git-branch", "git-tag",
    # Python команды
    "python", "python3", "pip", "pip3",
    # Node команды
    "node", "npm",
    # Системные команды (только чтение)
    "date", "whoami", "id", "env", "echo", "which", "type",
    # Проверка файлов
    "file", "stat", "test",
}

# Blacklist запрещенных паттернов
FORBIDDEN_PATTERNS = [
    r"rm\s+-rf",
    r"rm\s+.*\*",
    r"dd\s+if=",
    r">\s*/dev/",
    r"mkfs",
    r"fdisk",
    r"format",
    r"chmod\s+[0-7]{3,4}",
    r"chown\s+.*root",
    r"sudo\s+.*rm",
    r"sudo\s+.*mkfs",
    r"sudo\s+.*fdisk",
    r"curl\s+.*\|.*sh",
    r"wget\s+.*\|.*sh",
    r"eval\s+",
    r"exec\s+",
    r"\.\s*\.\s*\/",  # ../ для выхода из рабочей директории
]

# Максимальное время выполнения команды (секунды)
MAX_TIMEOUT = 30

# Максимальный размер вывода (байты)
MAX_OUTPUT_SIZE = 1024 * 1024  # 1MB


class BashExecuteRequest(BaseModel):
    command: str = Field(..., description="Команда для выполнения")
    working_dir: Optional[str] = Field(None, description="Рабочая директория (относительно agent_workspace)")
    timeout: Optional[int] = Field(None, ge=1, le=300, description="Таймаут в секундах (1-300)")
    allow_dangerous: bool = Field(False, description="Разрешить опасные команды (только для отладки)")


class BashExecuteResponse(BaseModel):
    success: bool
    stdout: str
    stderr: str
    returncode: int
    execution_time: float
    working_dir: str
    command: str
    error: Optional[str] = None


def validate_command(command: str, allow_dangerous: bool = False) -> tuple[bool, Optional[str]]:
    """
    Валидация команды на безопасность
    
    Returns:
        (is_valid, error_message)
    """
    if not command or not command.strip():
        return False, "Пустая команда"
    
    # Проверка на запрещенные паттерны
    if not allow_dangerous:
        for pattern in FORBIDDEN_PATTERNS:
            import re
            if re.search(pattern, command, re.IGNORECASE):
                return False, f"Запрещенный паттерн: {pattern}"
    
    # Проверка базовой команды (первое слово)
    parts = shlex.split(command)
    if not parts:
        return False, "Не удалось разобрать команду"
    
    base_command = parts[0]
    
    # Для git команд проверяем подкоманду
    if base_command == "git" and len(parts) > 1:
        git_subcommand = parts[1]
        allowed_git_commands = ["status", "log", "diff", "show", "branch", "tag", "rev-parse", "config"]
        if git_subcommand not in allowed_git_commands:
            return False, f"Git подкоманда '{git_subcommand}' не разрешена. Разрешены: {', '.join(allowed_git_commands)}"
    
    # Проверка whitelist (только если не allow_dangerous)
    if not allow_dangerous:
        if base_command not in ALLOWED_COMMANDS:
            return False, f"Команда '{base_command}' не в whitelist. Разрешены: {', '.join(sorted(ALLOWED_COMMANDS))}"
    
    return True, None


def get_working_directory(working_dir: Optional[str] = None) -> Path:
    """
    Получить безопасную рабочую директорию
    
    Args:
        working_dir: Относительный путь от AGENT_WORK_DIR
        
    Returns:
        Path к рабочей директории
    """
    if working_dir:
        # Нормализуем путь и проверяем, что он внутри AGENT_WORK_DIR
        resolved = (AGENT_WORK_DIR / working_dir).resolve()
        if not str(resolved).startswith(str(AGENT_WORK_DIR.resolve())):
            raise HTTPException(status_code=400, detail="Рабочая директория вне разрешенной области")
        return resolved
    return AGENT_WORK_DIR


@router.post("/execute", response_model=BashExecuteResponse)
async def execute_bash_command(request: BashExecuteRequest) -> BashExecuteResponse:
    """
    Выполнить bash команду безопасно
    
    Безопасность:
    - Whitelist разрешенных команд
    - Blacklist опасных паттернов
    - Изоляция рабочей директории
    - Таймаут выполнения
    - Ограничение размера вывода
    """
    import time
    start_time = time.time()
    
    # Валидация команды
    is_valid, error_msg = validate_command(request.command, request.allow_dangerous)
    if not is_valid:
        return BashExecuteResponse(
            success=False,
            stdout="",
            stderr="",
            returncode=-1,
            execution_time=time.time() - start_time,
            working_dir=str(AGENT_WORK_DIR),
            command=request.command,
            error=error_msg
        )
    
    # Получаем рабочую директорию
    try:
        work_dir = get_working_directory(request.working_dir)
        work_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    except Exception as e:
        return BashExecuteResponse(
            success=False,
            stdout="",
            stderr="",
            returncode=-1,
            execution_time=time.time() - start_time,
            working_dir=str(AGENT_WORK_DIR),
            command=request.command,
            error=f"Ошибка создания рабочей директории: {str(e)}"
        )
    
    # Таймаут
    timeout = request.timeout or MAX_TIMEOUT
    
    try:
        # Выполняем команду
        process = subprocess.Popen(
            request.command,
            shell=True,
            cwd=str(work_dir),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            env={**os.environ, "PWD": str(work_dir)}
        )
        
        try:
            stdout, stderr = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate()
            return BashExecuteResponse(
                success=False,
                stdout="",
                stderr="",
                returncode=-1,
                execution_time=time.time() - start_time,
                working_dir=str(work_dir),
                command=request.command,
                error=f"Таймаут выполнения ({timeout} секунд)"
            )
        
        # Ограничение размера вывода
        if len(stdout.encode('utf-8')) > MAX_OUTPUT_SIZE:
            stdout = stdout[:MAX_OUTPUT_SIZE] + "\n... (вывод обрезан, превышен лимит)"
        
        if len(stderr.encode('utf-8')) > MAX_OUTPUT_SIZE:
            stderr = stderr[:MAX_OUTPUT_SIZE] + "\n... (вывод обрезан, превышен лимит)"
        
        execution_time = time.time() - start_time
        
        return BashExecuteResponse(
            success=process.returncode == 0,
            stdout=stdout,
            stderr=stderr,
            returncode=process.returncode,
            execution_time=execution_time,
            working_dir=str(work_dir),
            command=request.command
        )
        
    except Exception as e:
        return BashExecuteResponse(
            success=False,
            stdout="",
            stderr="",
            returncode=-1,
            execution_time=time.time() - start_time,
            working_dir=str(work_dir),
            command=request.command,
            error=f"Ошибка выполнения: {str(e)}"
        )


@router.get("/working-dir")
async def get_working_directory_info() -> Dict[str, Any]:
    """
    Получить информацию о рабочей директории агента
    """
    return {
        "working_dir": str(AGENT_WORK_DIR),
        "exists": AGENT_WORK_DIR.exists(),
        "absolute_path": str(AGENT_WORK_DIR.resolve())
    }


@router.get("/allowed-commands")
async def get_allowed_commands() -> Dict[str, Any]:
    """
    Получить список разрешенных команд
    """
    return {
        "allowed_commands": sorted(ALLOWED_COMMANDS),
        "max_timeout": MAX_TIMEOUT,
        "max_output_size": MAX_OUTPUT_SIZE
    }

