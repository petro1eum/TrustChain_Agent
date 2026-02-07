"""
API для управления Docker контейнерами агента
Использует Docker API для создания и управления изолированными контейнерами с gVisor
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import docker
import subprocess
import os
import json
import time
import shlex
from pathlib import Path
import tempfile
import atexit
import shutil
from dotenv import load_dotenv

# Load environment variables from ai_studio/.env
_ai_studio_env = Path(__file__).parent.parent.parent / "ai_studio" / "app" / ".env"
if _ai_studio_env.exists():
    load_dotenv(_ai_studio_env)


router = APIRouter(prefix="/api/docker-agent", tags=["docker_agent"])

# --- Temp-директории: трекинг и автоочистка ---
_temp_dirs: list[str] = []


def _cleanup_temp_dirs() -> None:
    """Удаляет все зарегистрированные temp-директории при завершении процесса."""
    for d in _temp_dirs:
        try:
            shutil.rmtree(d, ignore_errors=True)
        except Exception:
            pass


atexit.register(_cleanup_temp_dirs)


def _tracked_mkdtemp(prefix: str) -> str:
    """Создает temp-директорию и регистрирует для авто-очистки."""
    d = tempfile.mkdtemp(prefix=prefix)
    _temp_dirs.append(d)
    return d


# Имя контейнера агента
AGENT_CONTAINER_NAME = "kb-agent-container"
AGENT_IMAGE_NAME = "kb-agent:latest"

# Структура директорий в контейнере
CONTAINER_PATHS = {
    "home": "/home/kb",
    "workspace": "/mnt/workspace",
    "uploads": "/mnt/user-data/uploads",
    "outputs": "/mnt/user-data/outputs",
    "skills": "/mnt/skills",
    "transcripts": "/mnt/transcripts"
}

# Инициализация Docker клиента
try:
    docker_client = docker.from_env()
except Exception as e:
    docker_client = None
    print(f"Warning: Docker client initialization failed: {e}")


class DockerCommandRequest(BaseModel):
    command: str = Field(..., description="Команда для выполнения в контейнере")
    description: str = Field(..., description="Описание зачем выполняется команда")
    working_dir: Optional[str] = Field(None, description="Рабочая директория в контейнере")
    timeout: Optional[int] = Field(30, ge=1, le=300, description="Таймаут в секундах")


class DockerCommandResponse(BaseModel):
    success: bool
    stdout: str
    stderr: str
    returncode: int
    execution_time: float
    command: str
    container_id: Optional[str] = None
    error: Optional[str] = None


class ViewFileRequest(BaseModel):
    path: str = Field(..., description="Путь к файлу в контейнере")
    view_range: Optional[List[int]] = Field(None, description="Диапазон строк [start, end]")
    description: str = Field(..., description="Зачем просматриваю файл")


class CreateFileRequest(BaseModel):
    description: str = Field(..., description="Зачем создаю файл")
    path: str = Field(..., description="Путь к файлу в контейнере")
    file_text: str = Field(..., description="Содержимое файла")


class StrReplaceRequest(BaseModel):
    path: str = Field(..., description="Путь к файлу в контейнере")
    old_str: str = Field(..., description="Строка для замены")
    new_str: str = Field("", description="Новая строка")
    description: str = Field(..., description="Зачем делаю замену")


def ensure_container_exists() -> docker.models.containers.Container:
    """
    Убедиться что контейнер агента существует и запущен
    Автоматически пересоздает контейнер если workspace не смонтирован
    """
    if not docker_client:
        raise HTTPException(status_code=500, detail="Docker client не инициализирован")
    
    try:
        # Проверяем существующий контейнер
        try:
            container = docker_client.containers.get(AGENT_CONTAINER_NAME)
            
            # Проверяем наличие workspace volume
            # Если контейнер был создан до добавления workspace, нужно пересоздать
            container_mounts = container.attrs.get("Mounts", [])
            has_workspace = any(
                mount.get("Destination") == CONTAINER_PATHS["workspace"] 
                for mount in container_mounts
            )
            
            if not has_workspace:
                print(f"⚠️  Контейнер {AGENT_CONTAINER_NAME} не имеет workspace volume, пересоздаем...")
                try:
                    container.stop()
                    container.remove()
                except Exception as e:
                    print(f"⚠️  Ошибка при удалении старого контейнера: {e}")
                # Создаем новый контейнер с правильными volumes
                return create_agent_container()
            
            if container.status != "running":
                container.start()
            return container
        except docker.errors.NotFound:
            # Создаем новый контейнер
            return create_agent_container()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка работы с контейнером: {str(e)}")


def create_agent_container() -> docker.models.containers.Container:
    """
    Создать новый контейнер агента
    """
    if not docker_client:
        raise HTTPException(status_code=500, detail="Docker client не инициализирован")
    
    try:
        # Проверяем наличие образа
        try:
            docker_client.images.get(AGENT_IMAGE_NAME)
        except docker.errors.ImageNotFound:
            # Собираем образ
            build_agent_image()
        
        # Создаем volumes для монтирования
        # Определяем корень проекта (4 уровня вверх от docker_agent.py)
        project_root = Path(__file__).parent.parent.parent.parent
        
        volumes = {
            # Монтируем весь проект в workspace (read-only)
            str(project_root): {
                "bind": CONTAINER_PATHS["workspace"],
                "mode": "ro"
            },
            # Монтируем skills из agent-tools
            str(project_root / "admin_app_backend" / "ai_studio" / "app" / "src" / "agent-tools" / "skills"): {
                "bind": CONTAINER_PATHS["skills"],
                "mode": "ro"
            },
            # Создаем временную директорию для outputs (с авто-очисткой при выходе)
            _tracked_mkdtemp("kb_agent_outputs_"): {
                "bind": CONTAINER_PATHS["outputs"],
                "mode": "rw"
            }
        }
        
        # Проверяем доступность gVisor runtime
        # Если недоступен, используем стандартный Docker runtime
        runtime = None
        try:
            # Проверяем доступность runsc через Docker info
            docker_info = docker_client.info()
            runtimes = docker_info.get("Runtimes", {})
            
            if "runsc" in runtimes:
                runtime = "runsc"
                print(f"✅ gVisor runtime (runsc) доступен, используем для изоляции контейнера")
            else:
                print(f"ℹ️  gVisor runtime (runsc) недоступен, используем стандартный Docker runtime")
                print(f"   Доступные runtimes: {', '.join(runtimes.keys()) if runtimes else 'none'}")
        except Exception as e:
            # Если проверка не удалась, используем стандартный runtime
            print(f"⚠️  Ошибка проверки gVisor runtime: {e}, используем стандартный runtime")
            runtime = None
        
        # Создаем контейнер (с gVisor если доступен, иначе стандартный)
        container_config = {
            "image": AGENT_IMAGE_NAME,
            "name": AGENT_CONTAINER_NAME,
            "volumes": volumes,
            "working_dir": CONTAINER_PATHS["home"],
            "detach": True,
            "tty": True,
            "stdin_open": True,
            "environment": {
                "HOME": CONTAINER_PATHS["home"],
                "PATH": f"{CONTAINER_PATHS['home']}/.local/bin:/usr/local/bin:/usr/bin:/bin"
            }
        }
        
        # Добавляем runtime только если доступен
        if runtime:
            container_config["runtime"] = runtime
        
        container = docker_client.containers.create(**container_config)
        
        container.start()
        
        # Убеждаемся что директория outputs существует и доступна для записи
        # Это важно, потому что volume может перезаписать директорию из образа
        container.exec_run(
            f"mkdir -p {CONTAINER_PATHS['outputs']} && chmod 755 {CONTAINER_PATHS['outputs']}",
            workdir=CONTAINER_PATHS["home"]
        )
        
        return container
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка создания контейнера: {str(e)}")


def build_agent_image():
    """
    Собрать Docker образ агента
    """
    if not docker_client:
        raise HTTPException(status_code=500, detail="Docker client не инициализирован")
    
    dockerfile_path = Path(__file__).parent.parent.parent / "Dockerfile.agent"
    if not dockerfile_path.exists():
        raise HTTPException(status_code=404, detail="Dockerfile.agent не найден")
    
    try:
        docker_client.images.build(
            path=str(dockerfile_path.parent),
            dockerfile="Dockerfile.agent",
            tag=AGENT_IMAGE_NAME,
            rm=True
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка сборки образа: {str(e)}")


@router.post("/bash_tool", response_model=DockerCommandResponse)
async def bash_tool(request: DockerCommandRequest) -> DockerCommandResponse:
    """
    Выполнить bash команду в контейнере агента (аналог bash_tool)
    """
    start_time = time.time()
    
    try:
        container = ensure_container_exists()
        
        # Определяем рабочую директорию
        work_dir = request.working_dir or CONTAINER_PATHS["home"]
        
        # Определяем таймаут (exec_run не поддерживает timeout напрямую)
        # Используем timeout через команду timeout если доступен, или оборачиваем в threading
        timeout_seconds = request.timeout or 30
        
        # Выполняем команду с таймаутом через команду timeout
        # Если команда timeout доступна в контейнере, используем её
        command_with_timeout = f"timeout {timeout_seconds} bash -c {shlex.quote(request.command)}"
        
        try:
            exec_result = container.exec_run(
                command_with_timeout,
                workdir=work_dir,
                stdout=True,
                stderr=True,
                demux=True
            )
        except Exception as timeout_error:
            # Если timeout команда не работает, пробуем без неё
            # и используем threading для таймаута
            import threading
            exec_result_ref = [None]
            exception_ref = [None]
            
            def run_command():
                try:
                    exec_result_ref[0] = container.exec_run(
                        request.command,
                        workdir=work_dir,
                        stdout=True,
                        stderr=True,
                        demux=True
                    )
                except Exception as e:
                    exception_ref[0] = e
            
            thread = threading.Thread(target=run_command)
            thread.daemon = True
            thread.start()
            thread.join(timeout=timeout_seconds)
            
            if thread.is_alive():
                # Таймаут - команда не завершилась
                raise HTTPException(
                    status_code=408,
                    detail=f"Таймаут выполнения команды ({timeout_seconds} секунд)"
                )
            
            if exception_ref[0]:
                raise exception_ref[0]
            
            exec_result = exec_result_ref[0]
        
        stdout, stderr = exec_result.output if isinstance(exec_result.output, tuple) else (exec_result.output, b"")
        
        execution_time = time.time() - start_time
        
        return DockerCommandResponse(
            success=exec_result.exit_code == 0,
            stdout=stdout.decode('utf-8', errors='replace') if stdout else "",
            stderr=stderr.decode('utf-8', errors='replace') if stderr else "",
            returncode=exec_result.exit_code,
            execution_time=execution_time,
            command=request.command,
            container_id=container.id
        )
        
    except Exception as e:
        return DockerCommandResponse(
            success=False,
            stdout="",
            stderr="",
            returncode=-1,
            execution_time=time.time() - start_time,
            command=request.command,
            error=str(e)
        )


@router.post("/view", response_model=Dict[str, Any])
async def view_file(request: ViewFileRequest) -> Dict[str, Any]:
    """
    Просмотреть файл или директорию в контейнере (аналог view)
    """
    try:
        container = ensure_container_exists()
        safe_path = shlex.quote(request.path)
        
        # Проверяем существование пути
        check_result = container.exec_run(
            f"test -e {safe_path}",
            workdir=CONTAINER_PATHS["home"]
        )
        
        if check_result.exit_code != 0:
            raise HTTPException(status_code=404, detail=f"Путь не найден: {request.path}")
        
        # Проверяем тип (файл или директория)
        type_result = container.exec_run(
            f"test -d {safe_path} && echo 'directory' || echo 'file'",
            workdir=CONTAINER_PATHS["home"]
        )
        is_directory = "directory" in type_result.output.decode('utf-8')
        
        if is_directory:
            # Список директории (до 2 уровней)
            ls_result = container.exec_run(
                f"find {safe_path} -maxdepth 2 -type f -o -type d | head -100",
                workdir=CONTAINER_PATHS["home"]
            )
            return {
                "type": "directory",
                "path": request.path,
                "content": ls_result.output.decode('utf-8', errors='replace'),
                "lines": None
            }
        else:
            # Читаем файл
            if request.view_range:
                start, end = request.view_range[0], request.view_range[1]
                if end == -1:
                    # До конца файла
                    cat_result = container.exec_run(
                        f"tail -n +{int(start)} {safe_path}",
                        workdir=CONTAINER_PATHS["home"]
                    )
                else:
                    # Диапазон строк
                    cat_result = container.exec_run(
                        f"sed -n '{int(start)},{int(end)}p' {safe_path}",
                        workdir=CONTAINER_PATHS["home"]
                    )
            else:
                # Весь файл
                cat_result = container.exec_run(
                    f"cat {safe_path}",
                    workdir=CONTAINER_PATHS["home"]
                )
            
            content = cat_result.output.decode('utf-8', errors='replace')
            lines = content.split('\n')
            
            return {
                "type": "file",
                "path": request.path,
                "content": content,
                "lines": len(lines),
                "view_range": request.view_range
            }
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка чтения файла: {str(e)}")


@router.post("/create_file", response_model=Dict[str, Any])
async def create_file(request: CreateFileRequest) -> Dict[str, Any]:
    """
    Создать новый файл в контейнере (аналог create_file)
    Поддерживает как текстовые, так и бинарные файлы (Excel, PDF, Word)
    """
    try:
        container = ensure_container_exists()
        safe_path = shlex.quote(request.path)
        path_json = json.dumps(request.path)  # Безопасное экранирование для Python-строк
        
        # Создаем директорию если нужно
        dir_path = os.path.dirname(request.path)
        if dir_path:
            container.exec_run(
                f"mkdir -p {shlex.quote(dir_path)}",
                workdir=CONTAINER_PATHS["home"]
            )
        
        # Определяем тип файла по расширению
        file_ext = os.path.splitext(request.path)[1].lower()
        binary_extensions = {'.xlsx', '.xls', '.xlsm', '.pdf', '.docx', '.doc', '.zip', '.png', '.jpg', '.jpeg', '.gif', '.bmp'}
        is_binary = file_ext in binary_extensions
        
        import base64
        
        if is_binary:
            # Для бинарных файлов ожидаем base64 строку в file_text
            # Декодируем base64 и записываем как бинарные данные
            try:
                # Проверяем, является ли содержимое валидным base64
                binary_data = base64.b64decode(request.file_text)
                
                # Кодируем бинарные данные в base64 для передачи через командную строку
                encoded_content = base64.b64encode(binary_data).decode('utf-8')
                
                # Записываем бинарный файл (путь через json.dumps для безопасности)
                python_cmd = (
                    f"import base64; import os; import json; "
                    f"data = base64.b64decode('{encoded_content}'); "
                    f"p = {path_json}; "
                    f"os.makedirs(os.path.dirname(p), exist_ok=True); "
                    f"open(p, 'wb').write(data)"
                )
                
                result = container.exec_run(
                    f"python3 -c {shlex.quote(python_cmd)}",
                    workdir=CONTAINER_PATHS["home"]
                )
                
                if result.exit_code != 0:
                    raise HTTPException(
                        status_code=500, 
                        detail=f"Ошибка создания бинарного файла: {result.output.decode('utf-8', errors='replace')}"
                    )
                
                file_size = len(binary_data)
            except Exception as e:
                raise HTTPException(
                    status_code=400, 
                    detail=f"Ошибка декодирования base64 для бинарного файла: {str(e)}"
                )
        else:
            # Для текстовых файлов записываем как UTF-8
            encoded_content = base64.b64encode(request.file_text.encode('utf-8')).decode('utf-8')
            
            python_cmd = (
                f"import base64; import os; import json; "
                f"content = base64.b64decode('{encoded_content}').decode('utf-8'); "
                f"p = {path_json}; "
                f"os.makedirs(os.path.dirname(p), exist_ok=True); "
                f"open(p, 'w', encoding='utf-8').write(content)"
            )
            
            result = container.exec_run(
                f"python3 -c {shlex.quote(python_cmd)}",
                workdir=CONTAINER_PATHS["home"]
            )
            
            if result.exit_code != 0:
                raise HTTPException(
                    status_code=500, 
                    detail=f"Ошибка создания текстового файла: {result.output.decode('utf-8', errors='replace')}"
                )
            
            file_size = len(request.file_text.encode('utf-8'))
        
        return {
            "success": True,
            "path": request.path,
            "size": file_size,
            "message": "Файл успешно создан"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка создания файла: {str(e)}")


@router.post("/str_replace", response_model=Dict[str, Any])
async def str_replace(request: StrReplaceRequest) -> Dict[str, Any]:
    """
    Заменить строку в файле (аналог str_replace)
    """
    try:
        container = ensure_container_exists()
        safe_path = shlex.quote(request.path)
        
        # Проверяем что файл существует
        check_result = container.exec_run(
            f"test -f {safe_path}",
            workdir=CONTAINER_PATHS["home"]
        )
        if check_result.exit_code != 0:
            raise HTTPException(status_code=404, detail=f"Файл не найден: {request.path}")
        
        # Используем Python для замены — безопаснее чем sed с пользовательскими строками
        path_json = json.dumps(request.path)
        old_json = json.dumps(request.old_str)
        new_json = json.dumps(request.new_str)
        
        # Проверяем что old_str встречается ровно один раз
        count_cmd = (
            f"import json; "
            f"text = open({path_json}, 'r', encoding='utf-8').read(); "
            f"print(text.count({old_json}))"
        )
        count_result = container.exec_run(
            f"python3 -c {shlex.quote(count_cmd)}",
            workdir=CONTAINER_PATHS["home"]
        )
        count = int(count_result.output.decode('utf-8').strip())
        
        if count == 0:
            raise HTTPException(status_code=400, detail="Строка для замены не найдена в файле")
        if count > 1:
            raise HTTPException(status_code=400, detail=f"Строка встречается {count} раз, должна быть уникальной")
        
        # Выполняем замену через Python (безопасно для любых символов)
        replace_cmd = (
            f"import json; "
            f"text = open({path_json}, 'r', encoding='utf-8').read(); "
            f"text = text.replace({old_json}, {new_json}, 1); "
            f"open({path_json}, 'w', encoding='utf-8').write(text)"
        )
        result = container.exec_run(
            f"python3 -c {shlex.quote(replace_cmd)}",
            workdir=CONTAINER_PATHS["home"]
        )
        
        if result.exit_code != 0:
            raise HTTPException(status_code=500, detail=f"Ошибка замены: {result.output.decode('utf-8')}")
        
        return {
            "success": True,
            "path": request.path,
            "old_str": request.old_str,
            "new_str": request.new_str,
            "message": "Замена выполнена успешно"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка замены строки: {str(e)}")


@router.get("/container/status")
async def get_container_status() -> Dict[str, Any]:
    """
    Получить статус контейнера агента
    """
    if not docker_client:
        return {"available": False, "error": "Docker client не инициализирован"}
    
    try:
        container = docker_client.containers.get(AGENT_CONTAINER_NAME)
        return {
            "available": True,
            "container_id": container.id,
            "status": container.status,
            "image": container.image.tags[0] if container.image.tags else "unknown"
        }
    except docker.errors.NotFound:
        return {
            "available": False,
            "status": "not_found",
            "message": "Контейнер не найден"
        }
    except Exception as e:
        return {
            "available": False,
            "error": str(e)
        }


@router.post("/container/create")
async def create_container() -> Dict[str, Any]:
    """
    Создать контейнер агента
    """
    try:
        container = create_agent_container()
        return {
            "success": True,
            "container_id": container.id,
            "status": container.status,
            "message": "Контейнер успешно создан"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка создания контейнера: {str(e)}")


@router.post("/container/start")
async def start_container() -> Dict[str, Any]:
    """
    Запустить контейнер агента
    """
    if not docker_client:
        raise HTTPException(status_code=500, detail="Docker client не инициализирован")
    
    try:
        container = docker_client.containers.get(AGENT_CONTAINER_NAME)
        container.start()
        return {
            "success": True,
            "status": container.status,
            "message": "Контейнер запущен"
        }
    except docker.errors.NotFound:
        raise HTTPException(status_code=404, detail="Контейнер не найден")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка запуска контейнера: {str(e)}")


@router.post("/container/stop")
async def stop_container() -> Dict[str, Any]:
    """
    Остановить контейнер агента
    """
    if not docker_client:
        raise HTTPException(status_code=500, detail="Docker client не инициализирован")
    
    try:
        container = docker_client.containers.get(AGENT_CONTAINER_NAME)
        container.stop()
        return {
            "success": True,
            "status": container.status,
            "message": "Контейнер остановлен"
        }
    except docker.errors.NotFound:
        raise HTTPException(status_code=404, detail="Контейнер не найден")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка остановки контейнера: {str(e)}")


@router.post("/container/remove")
async def remove_container() -> Dict[str, Any]:
    """
    Удалить контейнер агента (будет автоматически пересоздан при следующем запросе)
    """
    if not docker_client:
        raise HTTPException(status_code=500, detail="Docker client не инициализирован")
    
    try:
        container = docker_client.containers.get(AGENT_CONTAINER_NAME)
        
        # Останавливаем если запущен
        if container.status == "running":
            container.stop()
        
        # Удаляем контейнер
        container.remove()
        
        return {
            "success": True,
            "message": "Контейнер удален. Будет автоматически пересоздан при следующем запросе с правильными volumes."
        }
    except docker.errors.NotFound:
        return {
            "success": True,
            "message": "Контейнер не найден. Будет создан автоматически при следующем запросе."
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка удаления контейнера: {str(e)}")


# ============================================================================
# PDF Table Extraction with Vision API
# ============================================================================

class ExtractTableRequest(BaseModel):
    """Запрос на извлечение таблицы из PDF"""
    filename: str = Field(..., description="Имя PDF файла в /mnt/user-data/outputs")
    page_start: int = Field(..., ge=1, description="Начальная страница")
    page_end: int = Field(..., ge=1, description="Конечная страница")
    user_query: Optional[str] = Field(None, description="Дополнительные инструкции пользователя")
    sheet_name: Optional[str] = Field("Товары", description="Название листа Excel")


@router.post("/extract_table")
async def extract_table(request: ExtractTableRequest) -> Dict[str, Any]:
    """
    Извлечь таблицу из PDF страниц с использованием Vision API.
    
    Workflow:
    1. Рендерит PDF страницы в изображения (pdftoppm в контейнере)
    2. Отправляет на Vision API (Gemini) для извлечения данных
    3. Парсит JSON → Excel
    4. Возвращает base64 Excel + TrustChain signature
    """
    import base64
    import io
    
    start_time = time.time()
    
    # Валидация параметров
    page_start = min(request.page_start, request.page_end)
    page_end = max(request.page_start, request.page_end)
    max_pages = 6
    
    if page_end - page_start + 1 > max_pages:
        raise HTTPException(
            status_code=400,
            detail=f"Диапазон слишком большой. Максимум страниц: {max_pages}"
        )
    
    # Безопасное имя файла
    safe_name = os.path.basename(request.filename.replace("\\", "/"))
    pdf_path = f"{CONTAINER_PATHS['outputs']}/{safe_name}"
    
    try:
        container = ensure_container_exists()
        
        # Step 1: Проверяем существование PDF
        check_result = container.exec_run(f"test -f {pdf_path}")
        if check_result.exit_code != 0:
            raise HTTPException(status_code=404, detail=f"PDF файл не найден: {safe_name}")
        
        # Step 2: Рендерим PDF страницы в PNG
        output_prefix = f"/tmp/pdfvis_{int(time.time())}_{os.urandom(4).hex()}"
        render_cmd = f"""
set -e
pdftoppm -r 300 -f {page_start} -l {page_end} -png "{pdf_path}" "{output_prefix}"
echo "RENDER_DONE"
for p in $(seq {page_start} {page_end}); do
    file="{output_prefix}-$p.png"
    if [ -f "$file" ]; then
        echo "IMAGE:$file"
    fi
done
"""
        render_result = container.exec_run(
            f"bash -c {shlex.quote(render_cmd)}",
            workdir=CONTAINER_PATHS["home"]
        )
        
        if render_result.exit_code != 0:
            raise HTTPException(
                status_code=500,
                detail=f"Ошибка рендеринга PDF: {render_result.output.decode('utf-8', errors='replace')}"
            )
        
        # Парсим пути к изображениям
        output = render_result.output.decode('utf-8', errors='replace')
        image_paths = [
            line.replace("IMAGE:", "").strip()
            for line in output.split("\n")
            if line.startswith("IMAGE:")
        ]
        
        if not image_paths:
            raise HTTPException(status_code=500, detail="Не удалось получить изображения страниц")
        
        # Step 3: Читаем изображения как base64
        images_data = []
        for img_path in image_paths[:max_pages]:
            cat_result = container.exec_run(f"base64 -w 0 {img_path}")
            if cat_result.exit_code == 0:
                img_base64 = cat_result.output.decode('utf-8', errors='replace').strip()
                images_data.append({
                    "path": img_path,
                    "base64": img_base64
                })
            # Удаляем временные файлы
            container.exec_run(f"rm -f {img_path}")
        
        if not images_data:
            raise HTTPException(status_code=500, detail="Не удалось прочитать изображения")
        
        # Step 4: Вызываем Vision API
        from openai import OpenAI
        
        # Prioritize VITE_ keys (OpenRouter) over system OPENAI_API_KEY (may be OpenAI native key)
        api_key = os.getenv("VITE_OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY")
        base_url = os.getenv("VITE_OPENAI_BASE_URL") or os.getenv("OPENAI_BASE_URL") or "https://openrouter.ai/api/v1"
        
        if not api_key:
            raise HTTPException(status_code=500, detail="OPENAI_API_KEY не настроен")
        
        openai_client = OpenAI(api_key=api_key, base_url=base_url)
        
        # Подготавливаем контент для Vision API
        content_parts = []
        
        user_query = request.user_query or "Извлеки все строки из таблицы. Для каждой строки верни объект с полями: позиция, наименование, тип/марка, количество, единица. Верни JSON массив объектов."
        content_parts.append({"type": "text", "text": user_query})
        
        for img_data in images_data:
            content_parts.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{img_data['base64']}"}
            })
        
        # Пробуем модели по очереди
        vision_models = [
            "google/gemini-flash-1.5",
            "google/gemini-2.5-flash",
            "google/gemini-flash-1.5-exp"
        ]
        
        response = None
        last_error = None
        
        for model in vision_models:
            try:
                response = openai_client.chat.completions.create(
                    model=model,
                    messages=[{"role": "user", "content": content_parts}],
                    response_format={"type": "json_object"},
                    temperature=0
                )
                break
            except Exception as e:
                last_error = e
                error_msg = str(e)
                if "No endpoints found" in error_msg or "Model not found" in error_msg or "404" in error_msg:
                    continue
                break
        
        if not response:
            raise HTTPException(
                status_code=500,
                detail=f"Ошибка Vision API: {str(last_error) if last_error else 'unknown'}"
            )
        
        # Step 5: Парсим ответ
        raw_content = response.choices[0].message.content or ""
        clean_json = raw_content.strip()
        
        # Убираем markdown если есть
        if clean_json.startswith("```"):
            lines = clean_json.split("\n")
            clean_json = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])
        
        parsed = None
        try:
            parsed = json.loads(clean_json)
        except json.JSONDecodeError:
            # Пробуем извлечь JSON из текста
            obj_start = clean_json.find("{")
            obj_end = clean_json.rfind("}")
            arr_start = clean_json.find("[")
            arr_end = clean_json.rfind("]")
            
            for start, end in [(obj_start, obj_end), (arr_start, arr_end)]:
                if start != -1 and end != -1 and end > start:
                    try:
                        parsed = json.loads(clean_json[start:end+1])
                        break
                    except:
                        pass
        
        if not parsed:
            raise HTTPException(status_code=500, detail="Не удалось распарсить ответ Vision API")
        
        # Извлекаем rows
        rows = None
        if isinstance(parsed, list):
            rows = parsed
        elif isinstance(parsed, dict):
            for key in ['rows', 'items', 'data', 'result', 'table']:
                if isinstance(parsed.get(key), list):
                    rows = parsed[key]
                    break
        
        if not rows:
            raise HTTPException(status_code=500, detail="Vision API вернул пустой список строк")
        
        # Нормализуем rows
        normalized_rows = []
        for row in rows:
            if isinstance(row, dict):
                normalized_rows.append(row)
            elif isinstance(row, list):
                obj = {f"колонка_{i+1}": str(cell or "") for i, cell in enumerate(row)}
                normalized_rows.append(obj)
            else:
                normalized_rows.append({"значение": str(row or "")})
        
        # Фильтруем пустые строки
        normalized_rows = [
            row for row in normalized_rows
            if any(str(v).strip() for v in row.values())
        ]
        
        if not normalized_rows:
            raise HTTPException(status_code=500, detail="После обработки не осталось строк")
        
        # Step 6: Создаём Excel
        import pandas as pd
        
        df = pd.DataFrame(normalized_rows)
        
        excel_buffer = io.BytesIO()
        sheet_name = (request.sheet_name or "Товары")[:31]
        df.to_excel(excel_buffer, sheet_name=sheet_name, index=False, engine='openpyxl')
        excel_buffer.seek(0)
        
        excel_base64 = base64.b64encode(excel_buffer.read()).decode('utf-8')
        
        # Генерируем имя файла
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        output_filename = f"{safe_name.rsplit('.', 1)[0]}_p{page_start}-{page_end}_{timestamp}.xlsx"
        
        execution_time = time.time() - start_time
        
        return {
            "success": True,
            "filename": output_filename,
            "rows_count": len(normalized_rows),
            "content_base64": excel_base64,
            "content_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "execution_time": execution_time,
            "diagnostics": {
                "pages": {"start": page_start, "end": page_end, "count": page_end - page_start + 1},
                "images_processed": len(images_data),
                "vision_model": vision_models[0]
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка извлечения таблицы: {str(e)}")
