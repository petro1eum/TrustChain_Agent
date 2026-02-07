/**
 * Сбор метрик в реальном времени
 */

import type { Metric } from './types';

export interface MetricsCollectorConfig {
  /** Максимальное количество метрик в памяти */
  maxMetrics?: number;
  
  /** Интервал агрегации метрик (в миллисекундах) */
  aggregationInterval?: number;
}

export class MetricsCollector {
  private metrics: Metric[] = [];
  private config: MetricsCollectorConfig;
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  
  constructor(config: MetricsCollectorConfig = {}) {
    this.config = {
      maxMetrics: 5000,
      aggregationInterval: 60000, // 1 минута
      ...config
    };
  }
  
  /**
   * Записать метрику
   */
  record(metric: Omit<Metric, 'timestamp'>): void {
    const fullMetric: Metric = {
      ...metric,
      timestamp: new Date()
    };
    
    this.metrics.push(fullMetric);
    
    // Обновляем счетчики и gauges
    if (metric.type === 'counter') {
      const current = this.counters.get(metric.name) || 0;
      this.counters.set(metric.name, current + metric.value);
    } else if (metric.type === 'gauge') {
      this.gauges.set(metric.name, metric.value);
    }
    
    // Ограничиваем размер массива
    if (this.config.maxMetrics && this.metrics.length > this.config.maxMetrics) {
      this.metrics = this.metrics.slice(-Math.floor(this.config.maxMetrics * 0.5));
    }
  }
  
  /**
   * Увеличить счетчик
   */
  incrementCounter(name: string, value: number = 1, tags?: Record<string, string>): void {
    this.record({
      name,
      value,
      type: 'counter',
      tags
    });
  }
  
  /**
   * Установить значение gauge
   */
  setGauge(name: string, value: number, tags?: Record<string, string>): void {
    this.record({
      name,
      value,
      type: 'gauge',
      tags
    });
  }
  
  /**
   * Записать histogram значение
   */
  recordHistogram(name: string, value: number, tags?: Record<string, string>): void {
    this.record({
      name,
      value,
      type: 'histogram',
      tags
    });
  }
  
  /**
   * Получить текущее значение счетчика
   */
  getCounterValue(name: string): number {
    return this.counters.get(name) || 0;
  }
  
  /**
   * Получить текущее значение gauge
   */
  getGaugeValue(name: string): number {
    return this.gauges.get(name) || 0;
  }
  
  /**
   * Получить метрики по имени
   */
  getMetricsByName(name: string): Metric[] {
    return this.metrics.filter(m => m.name === name);
  }
  
  /**
   * Получить метрики по типу
   */
  getMetricsByType(type: Metric['type']): Metric[] {
    return this.metrics.filter(m => m.type === type);
  }
  
  /**
   * Получить все метрики
   */
  getAllMetrics(): Metric[] {
    return [...this.metrics];
  }
  
  /**
   * Получить агрегированные метрики (средние, суммы и т.д.)
   */
  getAggregatedMetrics(name: string): {
    count: number;
    sum: number;
    avg: number;
    min: number;
    max: number;
  } {
    const metrics = this.getMetricsByName(name);
    
    if (metrics.length === 0) {
      return { count: 0, sum: 0, avg: 0, min: 0, max: 0 };
    }
    
    const values = metrics.map(m => m.value);
    const sum = values.reduce((a, b) => a + b, 0);
    const avg = sum / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    
    return { count: metrics.length, sum, avg, min, max };
  }
  
  /**
   * Очистить метрики
   */
  clear(name?: string): void {
    if (name) {
      this.metrics = this.metrics.filter(m => m.name !== name);
      this.counters.delete(name);
      this.gauges.delete(name);
    } else {
      this.metrics = [];
      this.counters.clear();
      this.gauges.clear();
    }
  }
  
  /**
   * Экспорт метрик в JSON
   */
  exportToJSON(name?: string): string {
    const metrics = name 
      ? this.getMetricsByName(name)
      : this.metrics;
    
    return JSON.stringify(metrics, null, 2);
  }
  
  /**
   * Обновить конфигурацию
   */
  updateConfig(config: Partial<MetricsCollectorConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

