/**
 * Основной сервис для Observability (логирование, tracing, метрики)
 */

import type { 
  ObservabilityConfig, 
  AgentEvent, 
  Span, 
  Metric, 
  Dashboard,
  AgentEventType 
} from './types';
import { EventLogger } from './eventLogger';
import { SpanTracker } from './spanTracker';
import { MetricsCollector } from './metricsCollector';

export class ObservabilityService {
  private config: ObservabilityConfig;
  private eventLogger: EventLogger;
  private spanTracker: SpanTracker;
  private metricsCollector: MetricsCollector;
  
  constructor(config: ObservabilityConfig = { enabled: false }) {
    this.config = {
      enabled: false,
      maxEvents: 10000,
      maxSpans: 1000,
      logLevel: 'info',
      structuredLogging: true,
      tracing: true,
      metrics: true,
      exportEvents: false,
      ...config
    };
    
    // Инициализируем компоненты только если включено
    if (this.config.enabled) {
      this.eventLogger = new EventLogger({
        maxEvents: this.config.maxEvents,
        logLevel: this.config.logLevel,
        consoleLogging: this.config.structuredLogging,
        exportCallback: this.config.exportEvents ? (event) => this.handleEventExport(event) : undefined
      });
      
      this.spanTracker = new SpanTracker({
        maxSpans: this.config.maxSpans
      });
      
      this.metricsCollector = new MetricsCollector({
        maxMetrics: 5000
      });
    } else {
      // Создаем пустые компоненты для совместимости API
      this.eventLogger = new EventLogger({ consoleLogging: false });
      this.spanTracker = new SpanTracker();
      this.metricsCollector = new MetricsCollector();
    }
  }
  
  /**
   * Логирование события
   */
  logEvent(event: Omit<AgentEvent, 'timestamp'>): void {
    if (!this.config.enabled) return;
    
    this.eventLogger.log(event);
  }
  
  /**
   * Создать span для tracing
   */
  startSpan(
    name: string,
    attributes: Record<string, any> = {},
    parentId?: string,
    traceId?: string
  ): Span | null {
    if (!this.config.enabled || !this.config.tracing) {
      return null;
    }
    
    return this.spanTracker.startSpan(name, attributes, parentId, traceId);
  }
  
  /**
   * Завершить span с ошибкой
   */
  endSpanWithError(spanId: string, error: Error): void {
    if (!this.config.enabled || !this.config.tracing) return;
    
    this.spanTracker.endSpanWithError(spanId, error);
    
    // Логируем ошибку
    this.logEvent({
      type: 'error',
      sessionId: this.getCurrentSessionId(),
      data: {
        spanId,
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name
        }
      },
      level: 'error'
    });
  }
  
  /**
   * Записать метрику
   */
  recordMetric(metric: Omit<Metric, 'timestamp'>): void {
    if (!this.config.enabled || !this.config.metrics) return;
    
    this.metricsCollector.record(metric);
  }
  
  /**
   * Увеличить счетчик
   */
  incrementCounter(name: string, value: number = 1, tags?: Record<string, string>): void {
    if (!this.config.enabled || !this.config.metrics) return;
    
    this.metricsCollector.incrementCounter(name, value, tags);
  }
  
  /**
   * Установить значение gauge
   */
  setGauge(name: string, value: number, tags?: Record<string, string>): void {
    if (!this.config.enabled || !this.config.metrics) return;
    
    this.metricsCollector.setGauge(name, value, tags);
  }
  
  /**
   * Записать histogram значение
   */
  recordHistogram(name: string, value: number, tags?: Record<string, string>): void {
    if (!this.config.enabled || !this.config.metrics) return;
    
    this.metricsCollector.recordHistogram(name, value, tags);
  }
  
  /**
   * Получить дашборд для сессии
   */
  getDashboard(sessionId: string): Dashboard {
    const events = this.eventLogger.getEvents(sessionId);
    const spans = this.spanTracker.getAllSpans().filter(s => 
      s.attributes.sessionId === sessionId
    );
    const metrics = this.metricsCollector.getAllMetrics();
    
    // Вычисляем метрики из событий
    const toolCalls = events.filter(e => e.type === 'tool_call').length;
    const successfulToolCalls = events.filter(e => 
      e.type === 'tool_result' && e.data.success !== false
    ).length;
    const failedToolCalls = toolCalls - successfulToolCalls;
    
    const latencies = events
      .filter(e => e.type === 'tool_result' && e.data.latency)
      .map(e => e.data.latency as number);
    const averageLatency = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;
    
    const totalCost = events
      .filter(e => e.data.cost)
      .reduce((sum, e) => sum + (e.data.cost as number), 0);
    
    const tokensUsed = events
      .filter(e => e.data.tokens)
      .reduce((sum, e) => sum + (e.data.tokens as number), 0);
    
    const sessionStart = events.find(e => e.type === 'session_start');
    const sessionEnd = events.find(e => e.type === 'session_end');
    const totalTime = sessionStart && sessionEnd
      ? sessionEnd.timestamp.getTime() - sessionStart.timestamp.getTime()
      : 0;
    
    return {
      sessionId,
      metrics: {
        totalToolCalls: toolCalls,
        successfulToolCalls,
        failedToolCalls,
        averageLatency,
        totalCost,
        tokensUsed,
        totalTime
      },
      timeline: events,
      spans,
      realtimeMetrics: metrics
    };
  }
  
  /**
   * Получить события по сессии
   */
  getEvents(sessionId?: string): AgentEvent[] {
    return this.eventLogger.getEvents(sessionId);
  }
  
  /**
   * Получить spans по trace ID
   */
  getSpansByTraceId(traceId: string): Span[] {
    return this.spanTracker.getSpansByTraceId(traceId);
  }
  
  /**
   * Получить метрики
   */
  getMetrics(name?: string): Metric[] {
    if (name) {
      return this.metricsCollector.getMetricsByName(name);
    }
    return this.metricsCollector.getAllMetrics();
  }
  
  /**
   * Получить агрегированные метрики
   */
  getAggregatedMetrics(name: string): {
    count: number;
    sum: number;
    avg: number;
    min: number;
    max: number;
  } {
    return this.metricsCollector.getAggregatedMetrics(name);
  }
  
  /**
   * Очистить данные
   */
  clear(sessionId?: string): void {
    this.eventLogger.clear(sessionId);
    this.spanTracker.clear();
    this.metricsCollector.clear();
  }
  
  /**
   * Экспорт данных в JSON
   */
  exportToJSON(sessionId?: string): string {
    const dashboard = sessionId 
      ? this.getDashboard(sessionId)
      : {
          events: this.eventLogger.getEvents(),
          spans: this.spanTracker.getAllSpans(),
          metrics: this.metricsCollector.getAllMetrics()
        };
    
    return JSON.stringify(dashboard, null, 2);
  }
  
  /**
   * Обновить конфигурацию
   */
  updateConfig(config: Partial<ObservabilityConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Обновляем конфигурацию компонентов
    if (this.eventLogger) {
      this.eventLogger.updateConfig({
        maxEvents: this.config.maxEvents,
        logLevel: this.config.logLevel,
        consoleLogging: this.config.structuredLogging
      });
    }
    
    if (this.spanTracker) {
      this.spanTracker.updateConfig({
        maxSpans: this.config.maxSpans
      });
    }
  }
  
  /**
   * Проверить, включен ли observability
   */
  isEnabled(): boolean {
    return this.config.enabled === true;
  }
  
  /**
   * Обработка экспорта событий (для интеграции с внешними системами)
   */
  private handleEventExport(event: AgentEvent): void {
    // Здесь можно добавить интеграцию с OpenTelemetry, DataDog, etc.
    // Пока просто логируем
    if (this.config.exportEvents) {
      console.debug('[Observability] Export event:', event);
    }
  }
  
  /**
   * Получить текущий session ID (из последнего события или генерировать)
   */
  private getCurrentSessionId(): string {
    const events = this.eventLogger.getEvents();
    const lastSessionEvent = events
      .reverse()
      .find(e => e.type === 'session_start' || e.type === 'session_end');
    
    return lastSessionEvent?.sessionId || `session_${Date.now()}`;
  }
}

