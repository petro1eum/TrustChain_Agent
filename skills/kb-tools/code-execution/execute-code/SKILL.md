---
name: execute-code
description: Выполнить TypeScript/JavaScript код в безопасной изолированной среде. Код имеет доступ к переменным из предыдущих выполнений через _get(name), может сохранять переменные через _save(name, value), логировать через _log(message). Возвращает результат выполнения.
---

# Execute Code Tool

Инструмент для выполнения TypeScript/JavaScript кода в безопасной изолированной среде.

## Параметры

- `code` (required, string) - Код для выполнения (TypeScript/JavaScript)
- `context` (optional, object) - Дополнительный контекст (переменные) для выполнения кода
- `timeout` (optional, number) - Таймаут выполнения в миллисекундах (по умолчанию 5000)

## Доступные функции

- `_get(name)` - Получить переменную из предыдущих выполнений
- `_save(name, value)` - Сохранить переменную для следующих выполнений
- `_log(message)` - Логировать сообщение

## Использование

Используй для:
- Выполнения произвольного кода
- Обработки данных
- Создания утилит и функций
- Тестирования логики

## Примеры

```json
{
  "code": "const result = [1, 2, 3].map(x => x * 2);\n_log('Result: ' + JSON.stringify(result));\nreturn result;"
}
```

```json
{
  "code": "const prev = _get('previous_result');\nconst newResult = prev ? prev + 10 : 10;\n_save('previous_result', newResult);\nreturn newResult;",
  "timeout": 10000
}
```

## Результат

Возвращает результат выполнения кода.

