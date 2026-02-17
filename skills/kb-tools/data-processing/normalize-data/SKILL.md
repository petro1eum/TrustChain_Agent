---
name: normalize-data
description: "Нормализация и стандартизация численных данных. Используй для приведения числовых колонок к единому масштабу: стандартизация (z-score), MinMax, robust scaling, quantile transformation."
---

# Normalize Data Tool

Инструмент для нормализации и стандартизации численных данных.

## Параметры

- `columns` (required, array) - Список колонок для нормализации
- `method` (required, string) - Метод нормализации
- `feature_range` (optional, array) - Диапазон для MinMax нормализации [min, max]

## Доступные методы

- `standard` - Стандартизация (z-score): среднее = 0, стандартное отклонение = 1
- `minmax` - MinMax нормализация: значения в диапазоне [0, 1] или `feature_range`
- `robust` - Robust scaling: использует медиану и межквартильный размах (устойчив к выбросам)
- `quantile` - Quantile transformation: преобразует распределение в равномерное или нормальное

## Примеры

```json
{
  "columns": ["price", "weight"],
  "method": "standard"
}
```

```json
{
  "columns": ["score"],
  "method": "minmax",
  "feature_range": [0, 100]
}
```

## Результат

Возвращает:
- `success` - статус выполнения
- `columns` - обработанные колонки
- `method` - применённый метод
- `feature_range` - использованный диапазон (если применимо)
- `normalized_count` - количество нормализованных строк

