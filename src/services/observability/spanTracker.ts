/**
 * Tracing spans для отслеживания выполнения операций
 */

import type { Span } from './types';

export interface SpanTrackerConfig {
  /** Максимальное количество spans в памяти */
  maxSpans?: number;
  
  /** Генерировать trace ID автоматически */
  autoGenerateTraceId?: boolean;
}

export class SpanTracker {
  private spans: Map<string, Span> = new Map();
  private activeSpans: Map<string, Span> = new Map();
  private config: SpanTrackerConfig;
  
  constructor(config: SpanTrackerConfig = {}) {
    this.config = {
      maxSpans: 1000,
      autoGenerateTraceId: true,
      ...config
    };
  }
  
  /**
   * Создать новый span
   */
  startSpan(
    name: string,
    attributes: Record<string, any> = {},
    parentId?: string,
    traceId?: string
  ): Span {
    const spanId = this.generateSpanId();
    const finalTraceId = traceId || (this.config.autoGenerateTraceId ? this.generateTraceId() : '');
    
    const span: Span = {
      id: spanId,
      name,
      parentId,
      traceId: finalTraceId,
      startTime: new Date(),
      attributes: { ...attributes },
      children: [],
      status: 'running',
      complete: () => {
        span.endTime = new Date();
        span.status = 'completed';
        this.activeSpans.delete(spanId);
        
        // Если есть родительский span, добавляем этот span как дочерний
        if (parentId) {
          const parent = this.spans.get(parentId);
          if (parent) {
            parent.children.push(span);
          }
        }
      }
    };
    
    this.spans.set(spanId, span);
    this.activeSpans.set(spanId, span);
    
    // Ограничиваем размер
    if (this.config.maxSpans && this.spans.size > this.config.maxSpans) {
      // Удаляем старые завершенные spans
      const completedSpans = Array.from(this.spans.values())
        .filter(s => s.status === 'completed')
        .sort((a, b) => (a.endTime?.getTime() || 0) - (b.endTime?.getTime() || 0));
      
      const toRemove = Math.floor(completedSpans.length * 0.3);
      completedSpans.slice(0, toRemove).forEach(s => {
        this.spans.delete(s.id);
      });
    }
    
    return span;
  }
  
  /**
   * Завершить span с ошибкой
   */
  endSpanWithError(spanId: string, error: Error): void {
    const span = this.spans.get(spanId);
    if (span) {
      span.endTime = new Date();
      span.status = 'error';
      span.error = error;
      span.attributes.error = {
        message: error.message,
        stack: error.stack,
        name: error.name
      };
      this.activeSpans.delete(spanId);
    }
  }
  
  /**
   * Получить span по ID
   */
  getSpan(spanId: string): Span | undefined {
    return this.spans.get(spanId);
  }
  
  /**
   * Получить все spans для trace
   */
  getSpansByTraceId(traceId: string): Span[] {
    return Array.from(this.spans.values()).filter(s => s.traceId === traceId);
  }
  
  /**
   * Получить активные spans
   */
  getActiveSpans(): Span[] {
    return Array.from(this.activeSpans.values());
  }
  
  /**
   * Получить все spans
   */
  getAllSpans(): Span[] {
    return Array.from(this.spans.values());
  }
  
  /**
   * Очистить spans
   */
  clear(traceId?: string): void {
    if (traceId) {
      const spansToRemove = Array.from(this.spans.values())
        .filter(s => s.traceId === traceId)
        .map(s => s.id);
      
      spansToRemove.forEach(id => {
        this.spans.delete(id);
        this.activeSpans.delete(id);
      });
    } else {
      this.spans.clear();
      this.activeSpans.clear();
    }
  }
  
  /**
   * Экспорт spans в JSON
   */
  exportToJSON(traceId?: string): string {
    const spans = traceId 
      ? this.getSpansByTraceId(traceId)
      : Array.from(this.spans.values());
    
    return JSON.stringify(spans, null, 2);
  }
  
  /**
   * Генерация ID для span
   */
  private generateSpanId(): string {
    return `span_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Генерация ID для trace
   */
  private generateTraceId(): string {
    return `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Обновить конфигурацию
   */
  updateConfig(config: Partial<SpanTrackerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

