"""
API для работы с Skills системой агента
Загружает метаданные skills (frontmatter) с хоста для auto-triggering
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from pathlib import Path
import re
import yaml

router = APIRouter(prefix="/api/skills", tags=["skills"])

# Путь к skills на хосте
SKILLS_PATH = Path(__file__).parent.parent.parent / "ai_studio" / "app" / "src" / "agent-tools" / "skills"

# Тестовый endpoint для проверки загрузки модуля
@router.get("/test")
async def test_skills_endpoint():
    """Тестовый endpoint для проверки работы router"""
    return {"status": "ok", "message": "Skills router is working", "skills_path": str(SKILLS_PATH)}


class SkillMetadata(BaseModel):
    name: str
    description: str
    location: str  # Путь в контейнере (/mnt/skills/...)
    license: Optional[str] = None


def scan_directory_for_skills(dir_path: Path, base_path: Path) -> List[SkillMetadata]:
    """
    Рекурсивно сканирует директорию на наличие SKILL.md файлов
    """
    skills: List[SkillMetadata] = []
    
    if not dir_path.exists() or not dir_path.is_dir():
        return skills
    
    try:
        for entry in dir_path.iterdir():
            if entry.is_dir():
                # Проверяем наличие SKILL.md в директории
                skill_md = entry / "SKILL.md"
                if skill_md.exists() and skill_md.is_file():
                    try:
                        metadata = parse_frontmatter(skill_md)
                        # Конвертируем путь хоста в путь контейнера
                        container_path = convert_to_container_path(skill_md, base_path)
                        skills.append(SkillMetadata(
                            name=metadata.get("name", ""),
                            description=metadata.get("description", ""),
                            location=container_path,
                            license=metadata.get("license")
                        ))
                    except Exception as e:
                        # Пропускаем файлы с ошибками парсинга
                        print(f"Warning: Failed to parse {skill_md}: {e}")
                        continue
                else:
                    # Рекурсивно ищем в поддиректориях
                    sub_skills = scan_directory_for_skills(entry, base_path)
                    skills.extend(sub_skills)
    except Exception as e:
        print(f"Error scanning directory {dir_path}: {e}")
    
    return skills


def parse_frontmatter(file_path: Path) -> Dict[str, Any]:
    """
    Парсит YAML frontmatter из SKILL.md файла
    Читает только первые 50 строк для оптимизации
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            # Читаем первые 50 строк (достаточно для frontmatter)
            lines = []
            for i, line in enumerate(f):
                if i >= 50:
                    break
                lines.append(line)
            content = ''.join(lines)
        
        # Ищем YAML frontmatter (между --- и ---)
        frontmatter_match = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
        if not frontmatter_match:
            raise ValueError(f"No frontmatter found in {file_path}")
        
        frontmatter_text = frontmatter_match.group(1)
        frontmatter = yaml.safe_load(frontmatter_text)
        
        if not isinstance(frontmatter, dict):
            raise ValueError(f"Frontmatter must be a dictionary in {file_path}")
        
        # Проверяем обязательные поля
        if 'name' not in frontmatter:
            raise ValueError(f"Missing 'name' in frontmatter of {file_path}")
        if 'description' not in frontmatter:
            raise ValueError(f"Missing 'description' in frontmatter of {file_path}")
        
        return frontmatter
        
    except Exception as e:
        raise ValueError(f"Failed to parse frontmatter from {file_path}: {e}")


def convert_to_container_path(file_path: Path, base_path: Path) -> str:
    """
    Конвертирует путь на хосте в путь в контейнере
    Например: /path/to/skills/public/docx/SKILL.md -> /mnt/skills/public/docx/SKILL.md
    """
    try:
        # Получаем относительный путь от base_path
        relative_path = file_path.relative_to(base_path)
        # Конвертируем в путь контейнера
        container_path = f"/mnt/skills/{relative_path.as_posix()}"
        return container_path
    except Exception:
        # Fallback: используем имя файла
        return f"/mnt/skills/{file_path.name}"


@router.get("/metadata", response_model=List[SkillMetadata])
async def get_all_skills_metadata() -> List[SkillMetadata]:
    """
    Загружает метаданные всех skills (только frontmatter)
    Вызывается при старте для инициализации SkillsLoaderService
    """
    if not SKILLS_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Skills directory not found: {SKILLS_PATH}"
        )
    
    all_skills: List[SkillMetadata] = []
    
    # Сканируем основные директории
    directories_to_scan = ['public', 'examples', 'kb-tools']
    
    for dir_name in directories_to_scan:
        dir_path = SKILLS_PATH / dir_name
        if dir_path.exists():
            skills = scan_directory_for_skills(dir_path, SKILLS_PATH)
            all_skills.extend(skills)
    
    return all_skills


@router.get("/metadata/{skill_name}", response_model=SkillMetadata)
async def get_skill_metadata(skill_name: str) -> SkillMetadata:
    """
    Получить метаданные конкретного skill по имени
    """
    all_skills = await get_all_skills_metadata()
    
    for skill in all_skills:
        if skill.name == skill_name:
            return skill
    
    raise HTTPException(
        status_code=404,
        detail=f"Skill '{skill_name}' not found"
    )

