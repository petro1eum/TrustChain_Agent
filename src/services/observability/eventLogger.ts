/**
 * Structured logging для событий агента
 */

import type { AgentEvent, LogLevel, AgentEventType } from './types';

export interface EventLoggerConfig {
  /** Максимальное количество событий в памяти */
  maxEvents?: number;

  /** Уровень логирования */
  logLevel?: LogLevel;

  /** Включить structured logging в консоль */
  consoleLogging?: boolean;

  /** Callback для экспорта событий */
  exportCallback?: (event: AgentEvent) => void;
}

export class EventLogger {
  private events: AgentEvent[] = [];
  private config: EventLoggerConfig;

  constructor(config: EventLoggerConfig = {}) {
    this.config = {
      maxEvents: 10000,
      logLevel: 'info',
      consoleLogging: true,
      ...config
    };
  }

  /**
   * Логирование события
   */
  log(event: Omit<AgentEvent, 'timestamp'>): void {
    const fullEvent: AgentEvent = {
      ...event,
      timestamp: new Date(),
      level: event.level || this.getDefaultLevel(event.type)
    };

    // Фильтруем по уровню логирования
    if (!this.shouldLog(fullEvent.level || 'info')) {
      return;
    }

    // Добавляем в массив событий
    this.events.push(fullEvent);

    // Ограничиваем размер массива
    if (this.config.maxEvents && this.events.length > this.config.maxEvents) {
      this.events = this.events.slice(-Math.floor(this.config.maxEvents * 0.5));
    }

    // Structured logging в консоль
    if (this.config.consoleLogging) {
      this.logToConsole(fullEvent);
    }

    // Экспорт события
    if (this.config.exportCallback) {
      try {
        this.config.exportCallback(fullEvent);
      } catch (error) {
        console.error('[EventLogger] Ошибка экспорта события:', error);
      }
    }
  }

  /**
   * Логирование в консоль с structured форматированием
   */
  private logToConsole(event: AgentEvent): void {
    const logEntry = {
      level: event.level,
      type: event.type,
      sessionId: event.sessionId,
      timestamp: event.timestamp.toISOString(),
      data: event.data,
      ...(event.metadata && { metadata: event.metadata })
    };

    const logMethod = this.getConsoleMethod(event.level || 'info');
    logMethod(`[Observability] ${event.type}`, logEntry);
  }

  /**
   * Определяет метод консоли по уровню
   */
  private getConsoleMethod(level: LogLevel): typeof console.log {
    switch (level) {
      case 'debug':
        return console.debug;
      case 'info':
        return console.info;
      case 'warn':
        return console.warn;
      case 'error':
        return console.error;
      default:
        return console.log;
    }
  }

  /**
   * Определяет уровень логирования по типу события
   */
  private getDefaultLevel(type: AgentEventType): LogLevel {
    switch (type) {
      case 'error':
      case 'rate_limit_exceeded':
        return 'error';
      case 'warn':
        return 'warn';
      case 'tool_call':
      case 'tool_result':
      case 'api_call':
        return 'info';
      case 'thinking':
      case 'streaming_delta':
        return 'debug';
      default:
        return 'info';
    }
  }

  /**
   * Проверяет, нужно ли логировать событие по уровню
   */
  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    const configLevelIndex = levels.indexOf(this.config.logLevel || 'info');
    const eventLevelIndex = levels.indexOf(level);

    return eventLevelIndex >= configLevelIndex;
  }

  /**
   * Получить все события
   */
  getEvents(sessionId?: string): AgentEvent[] {
    if (sessionId) {
      return this.events.filter(e => e.sessionId === sessionId);
    }
    return [...this.events];
  }

  /**
   * Получить события по типу
   */
  getEventsByType(type: AgentEventType, sessionId?: string): AgentEvent[] {
    const events = sessionId
      ? this.events.filter(e => e.sessionId === sessionId)
      : this.events;

    return events.filter(e => e.type === type);
  }

  /**
   * Очистить события
   */
  clear(sessionId?: string): void {
    if (sessionId) {
      this.events = this.events.filter(e => e.sessionId !== sessionId);
    } else {
      this.events = [];
    }
  }

  /**
   * Экспорт событий в JSON
   */
  exportToJSON(sessionId?: string): string {
    const events = sessionId
      ? this.events.filter(e => e.sessionId === sessionId)
      : this.events;

    return JSON.stringify(events, null, 2);
  }

  /**
   * Обновить конфигурацию
   */
  updateConfig(config: Partial<EventLoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

