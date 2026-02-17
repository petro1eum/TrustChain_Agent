---
name: execute-pandas-operation
description: Выполнение кастомного pandas кода для обработки данных. Используй для сложных преобразований данных, которые невозможно выполнить стандартными инструментами.
---

# Execute Pandas Operation Tool

Инструмент для выполнения произвольного Python кода с pandas для обработки данных.

## Параметры

- `code` (required, string) - Python код с операциями pandas
- `description` (required, string) - Описание того, что делает код

## Использование

Код выполняется в контексте workspace данных. Доступны стандартные библиотеки Python и pandas.

## Примеры

```json
{
  "code": "df['total'] = df['price'] * df['quantity']",
  "description": "Вычисляю общую стоимость как произведение цены и количества"
}
```

```json
{
  "code": "df = df.groupby('category').agg({'price': 'mean', 'quantity': 'sum'})",
  "description": "Группирую по категориям и вычисляю среднюю цену и сумму количества"
}
```

## Важно

- Всегда указывай `description` для понимания цели операции
- Код должен работать с данными в workspace
- Результат должен быть совместим с форматом workspace

## Результат

Возвращает:
- `success` - статус выполнения
- `description` - описание операции
- `code_executed` - выполненный код
- `rows_affected` - количество затронутых строк
- `execution_time` - время выполнения

