# Skill Creator Scripts

Утилиты для создания и управления skills.

## Скрипты

### 1. `init_skill.py` - Создание нового skill

Создаёт новый skill из шаблона с правильной структурой.

**Использование:**
```bash
python scripts/init_skill.py <skill-name> --path <output-directory>
```

**Примеры:**
```bash
# Создать skill в kb-tools
python scripts/init_skill.py my-new-tool --path ../../kb-tools

# Создать skill в examples
python scripts/init_skill.py my-example --path ../../examples
```

**Что делает:**
- Создаёт директорию skill
- Генерирует SKILL.md с шаблоном
- Создаёт директории scripts/, references/, assets/ с примерами

### 2. `quick_validate.py` - Валидация skill

Проверяет корректность skill перед упаковкой.

**Использование:**
```bash
python scripts/quick_validate.py <skill-directory>
```

**Пример:**
```bash
python scripts/quick_validate.py ../../kb-tools/data-processing/text-processing
```

**Что проверяет:**
- Наличие SKILL.md
- Корректность YAML frontmatter
- Наличие обязательных полей (name, description)
- Соответствие naming conventions

### 3. `package_skill.py` - Упаковка skill

Упаковывает skill в .skill файл (zip архив) для распространения.

**Использование:**
```bash
python scripts/package_skill.py <path/to/skill-folder> [output-directory]
```

**Примеры:**
```bash
# Упаковать skill в текущую директорию
python scripts/package_skill.py ../../kb-tools/data-processing/text-processing

# Упаковать skill в указанную директорию
python scripts/package_skill.py ../../kb-tools/data-processing/text-processing ./dist
```

**Что делает:**
1. Валидирует skill (использует quick_validate.py)
2. Создаёт .skill файл (zip архив) со всеми файлами skill
3. Сохраняет структуру директорий

## Зависимости

Скрипты требуют:
- Python 3.6+
- Библиотека `pyyaml` (для quick_validate.py)

Установка зависимостей:
```bash
pip install pyyaml
```

## Важно

1. **package_skill.py импортирует quick_validate.py** - оба файла должны быть в одной директории или в PYTHONPATH
2. **Пути относительные** - запускай скрипты из директории `scripts/` или используй абсолютные пути
3. **Права на выполнение** - скрипты имеют shebang `#!/usr/bin/env python3`, можно сделать исполняемыми:
   ```bash
   chmod +x scripts/*.py
   ```

## Примеры использования

### Создание нового skill для KB tools

```bash
cd admin_app_backend/ai_studio/app/src/agent-tools/skills/examples/skill-creator/scripts

# Создать новый tool skill
python init_skill.py my-new-tool --path ../../../kb-tools/my-category

# Отредактировать SKILL.md
# ...

# Валидировать
python quick_validate.py ../../../kb-tools/my-category/my-new-tool

# Упаковать
python package_skill.py ../../../kb-tools/my-category/my-new-tool
```

### Валидация всех существующих skills

```bash
cd admin_app_backend/ai_studio/app/src/agent-tools/skills

# Валидировать все skills в kb-tools
for skill in kb-tools/*/*/; do
    python examples/skill-creator/scripts/quick_validate.py "$skill"
done
```

