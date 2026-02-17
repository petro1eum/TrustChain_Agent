---
name: handle-outliers
description: Обнаружение и обработка выбросов в данных. Используй для поиска аномальных значений различными методами (IQR, z-score, Isolation Forest, LOF) и их обработки (удаление, ограничение, трансформация, флагирование).
---

# Handle Outliers Tool

Инструмент для обнаружения и обработки выбросов в данных.

## Параметры

- `columns` (required, array) - Колонки для анализа выбросов
- `method` (required, string) - Метод обнаружения выбросов
- `action` (required, string) - Действие с выбросами
- `threshold` (optional, number) - Порог для определения выбросов

## Методы обнаружения

- `iqr` - Interquartile Range: выбросы за пределами Q1 - 1.5*IQR и Q3 + 1.5*IQR
- `zscore` - Z-score: значения с |z-score| > threshold (обычно 3)
- `isolation_forest` - Isolation Forest: алгоритм машинного обучения для обнаружения аномалий
- `local_outlier_factor` - Local Outlier Factor: локальный метод обнаружения выбросов

## Действия с выбросами

- `remove` - Удалить строки с выбросами
- `cap` - Ограничить значения пороговыми значениями
- `transform` - Трансформировать значения (например, логарифмирование)
- `flag` - Добавить флаг-колонку с индикатором выбросов

## Примеры

```json
{
  "columns": ["price", "volume"],
  "method": "iqr",
  "action": "remove"
}
```

```json
{
  "columns": ["score"],
  "method": "zscore",
  "action": "cap",
  "threshold": 3
}
```

## Результат

Возвращает:
- `success` - статус выполнения
- `columns` - обработанные колонки
- `method` - применённый метод
- `action` - выполненное действие
- `threshold` - использованный порог
- `outliers_found` - количество найденных выбросов
- `outliers_handled` - количество обработанных выбросов

