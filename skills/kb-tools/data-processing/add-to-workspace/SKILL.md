---
name: add-to-workspace
description: Добавление данных в workspace. Используй для загрузки данных из различных источников в рабочее пространство с операциями замены, добавления или объединения.
---

# Add to Workspace Tool

Инструмент для добавления данных в workspace.

## Параметры

- `data_source` (required, string) - Источник данных (имя файла или идентификатор)
- `operation` (required, string) - Тип операции с данными

## Доступные операции

- `replace` - Заменить текущие данные в workspace
- `append` - Добавить данные к существующим (конкатенация)
- `merge` - Объединить данные (inner join по общим колонкам)

## Примеры

```json
{
  "data_source": "products.csv",
  "operation": "replace"
}
```

```json
{
  "data_source": "new_orders.csv",
  "operation": "append"
}
```

## Результат

Возвращает:
- `success` - статус выполнения
- `operation` - выполненная операция
- `data_source` - источник данных
- `workspace_size` - размер workspace после операции

