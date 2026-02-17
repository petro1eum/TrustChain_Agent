---
name: bash-tool
description: "Выполнить bash команду в изолированном Docker контейнере. Используй для выполнения любых команд в безопасном окружении: установка пакетов, работа с файлами, запуск скриптов, системные операции."
---

# Bash Tool

Инструмент для выполнения bash команд в изолированном Docker контейнере.

## Параметры

- `command` (required, string) - Bash команда для выполнения
- `description` (required, string) - Объяснение зачем выполняется эта команда (ОБЯЗАТЕЛЬНО)
- `working_dir` (optional, string) - Рабочая директория в контейнере (по умолчанию /home/kb)
- `timeout` (optional, number) - Таймаут выполнения в секундах (1-300, по умолчанию 30)

## Окружение

- Ubuntu 24.04.3 LTS
- gVisor sandbox (runsc)
- Изолированный контейнер
- Рабочая директория: /home/kb (по умолчанию)

## Важные правила

1. **ВСЕГДА указывай `description`** - это помогает понять логику работы
2. **pip install требует флаг `--break-system-packages`**:
   ```bash
   pip install pandas --break-system-packages
   ```
3. **Проверяй результаты** перед следующим шагом
4. **Опасные команды могут быть заблокированы** (rm, mkfs, sudo и т.д.)

## Примеры

```json
{
  "command": "pip install pandas --break-system-packages",
  "description": "Устанавливаю pandas для анализа данных"
}
```

```json
{
  "command": "ls -la /mnt/user-data/uploads",
  "description": "Проверяю список загруженных файлов пользователя"
}
```

```json
{
  "command": "pandoc document.docx -o output.md",
  "description": "Конвертирую Word документ в markdown",
  "working_dir": "/mnt/user-data/uploads",
  "timeout": 60
}
```

## Результат

Возвращает:
- `success` - статус выполнения
- `stdout` - стандартный вывод команды
- `stderr` - стандартный поток ошибок
- `returncode` - код возврата (0 = успех)
- `execution_time` - время выполнения
- `command` - выполненная команда
- `error` - сообщение об ошибке (если есть)

