/**
 * Типы для Observability системы
 */

/**
 * Уровни логирования
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Типы событий агента
 */
export type AgentEventType =
  | 'tool_call'
  | 'tool_result'
  | 'thinking'
  | 'error'
  | 'warn'
  | 'plan_created'
  | 'plan_adapted'
  | 'api_call'
  | 'streaming_start'
  | 'streaming_delta'
  | 'streaming_complete'
  | 'rate_limit_check'
  | 'rate_limit_exceeded'
  | 'session_start'
  | 'session_end';

/**
 * Событие агента для логирования
 */
export interface AgentEvent {
  /** Тип события */
  type: AgentEventType;

  /** ID сессии */
  sessionId: string;

  /** Временная метка */
  timestamp: Date;

  /** Данные события */
  data: Record<string, any>;

  /** Метаданные (опционально) */
  metadata?: Record<string, any>;

  /** Уровень логирования */
  level?: LogLevel;
}

/**
 * Span для tracing
 */
export interface Span {
  /** Имя span */
  name: string;

  /** ID span */
  id: string;

  /** ID родительского span (опционально) */
  parentId?: string;

  /** ID trace */
  traceId: string;

  /** Время начала */
  startTime: Date;

  /** Время окончания (если завершен) */
  endTime?: Date;

  /** Атрибуты span */
  attributes: Record<string, any>;

  /** Дочерние spans */
  children: Span[];

  /** Статус span */
  status: 'pending' | 'running' | 'completed' | 'error';

  /** Ошибка (если есть) */
  error?: Error;

  /** Завершить span */
  complete: () => void;
}

/**
 * Метрика для сбора
 */
export interface Metric {
  /** Имя метрики */
  name: string;

  /** Значение */
  value: number;

  /** Единица измерения */
  unit?: string;

  /** Временная метка */
  timestamp: Date;

  /** Теги для группировки */
  tags?: Record<string, string>;

  /** Тип метрики */
  type: 'counter' | 'gauge' | 'histogram' | 'summary';
}

/**
 * Конфигурация Observability
 */
export interface ObservabilityConfig {
  /** Включить observability */
  enabled: boolean;

  /** Максимальное количество событий в памяти */
  maxEvents?: number;

  /** Максимальное количество spans в памяти */
  maxSpans?: number;

  /** Уровень логирования */
  logLevel?: LogLevel;

  /** Включить structured logging */
  structuredLogging?: boolean;

  /** Включить tracing */
  tracing?: boolean;

  /** Включить сбор метрик */
  metrics?: boolean;

  /** Экспортировать события (например, в OpenTelemetry) */
  exportEvents?: boolean;
}

/**
 * Дашборд для анализа производительности
 */
export interface Dashboard {
  /** ID сессии */
  sessionId: string;

  /** Метрики */
  metrics: {
    totalToolCalls: number;
    successfulToolCalls: number;
    failedToolCalls: number;
    averageLatency: number;
    totalCost: number;
    tokensUsed: number;
    totalTime: number;
  };

  /** Timeline событий */
  timeline: AgentEvent[];

  /** Spans для tracing */
  spans: Span[];

  /** Метрики в реальном времени */
  realtimeMetrics: Metric[];
}

