/**
 * Сервис для отладки и логирования работы AI агента
 */

export interface AgentDebugEntry {
  id: string;
  timestamp: string;
  sessionId: string;
  type: 'user_query' | 'thinking' | 'planning' | 'tool_call' | 'tool_response' | 'final_response' | 'error';

  // Основные данные
  content: string;
  userQuery?: string;

  // Метаданные мышления
  thoughts?: {
    observation: string;
    reasoning: string;
    action: string;
    confidence: number;
  };

  // Метаданные планирования
  plan?: {
    goal: string;
    steps: any[];
    totalSteps: number;
  };

  // Метаданные инструментов
  tool?: {
    name: string;
    args: any;
    result?: any;
    executionTime?: number;
  };

  // Метрики выполнения
  metrics?: {
    toolCalls: number;
    successfulSteps: number;
    failedSteps: number;
    retryCount: number;
    thinkingIterations: number;
    averageConfidence: number;
    totalExecutionTime: number;
  };

  // Дополнительная информация
  agentModel?: string;
  agentType?: string;
  error?: string;
  context?: any;
}

export interface AgentDebugSession {
  sessionId: string;
  startTime: string;
  endTime?: string;
  userQuery: string;
  entries: AgentDebugEntry[];
  summary?: {
    totalEntries: number;
    totalThoughts: number;
    totalToolCalls: number;
    successRate: number;
    averageConfidence: number;
    executionTime: number;
  };
}

class AgentDebugService {
  private currentSessionId: string | null = null;
  private readonly STORAGE_KEY = 'alma_agent_debug_logs';
  private readonly MAX_SESSIONS = 50; // Ограничиваем количество сессий

  /**
   * Начать новую сессию отладки
   */
  startSession(userQuery: string, silent: boolean = false): string {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.currentSessionId = sessionId;

    const session: AgentDebugSession = {
      sessionId,
      startTime: new Date().toISOString(),
      userQuery,
      entries: []
    };

    this.saveSession(session);

    if (!silent) {
      console.log(`🐛 Debug: Начата новая сессия ${sessionId} для запроса: "${userQuery}"`);
    }

    return sessionId;
  }

  /**
   * Завершить текущую сессию
   */
  endSession(metrics?: any): void {
    if (!this.currentSessionId) return;

    const sessions = this.getAllSessions();
    const session = sessions.find(s => s.sessionId === this.currentSessionId);

    if (session) {
      session.endTime = new Date().toISOString();
      session.summary = this.calculateSessionSummary(session, metrics);
      this.saveSession(session);
    }

    this.currentSessionId = null;
  }

  /**
   * Добавить запись в текущую сессию
   */
  addEntry(entry: Partial<AgentDebugEntry>): void {
    if (!this.currentSessionId) {
      console.warn('🐛 Debug: Нет активной сессии для записи');
      return;
    }

    const fullEntry: AgentDebugEntry = {
      id: `entry_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      timestamp: new Date().toISOString(),
      sessionId: this.currentSessionId,
      type: entry.type || 'thinking',
      content: entry.content || '',
      ...entry
    };

    const sessions = this.getAllSessions();
    const session = sessions.find(s => s.sessionId === this.currentSessionId);

    if (session) {
      session.entries.push(fullEntry);
      this.saveSession(session);
    }
  }

  /**
   * Логирование мыслей агента
   */
  logThinking(thoughts: any, userQuery?: string): void {
    this.addEntry({
      type: 'thinking',
      content: `Мысль: ${thoughts.reasoning}`,
      thoughts: {
        observation: thoughts.observation || '',
        reasoning: thoughts.reasoning || '',
        action: thoughts.action || '',
        confidence: thoughts.confidence || 0
      },
      userQuery
    });
  }

  /**
   * Логирование планирования
   */
  logPlanning(plan: any): void {
    this.addEntry({
      type: 'planning',
      content: `План создан: ${plan.goal}`,
      plan: {
        goal: plan.goal || '',
        steps: plan.steps || [],
        totalSteps: plan.steps?.length || 0
      }
    });
  }

  /**
   * Логирование вызова инструментов
   */
  logToolCall(toolName: string, args: any): void {
    this.addEntry({
      type: 'tool_call',
      content: `Вызов инструмента: ${toolName}`,
      tool: {
        name: toolName,
        args: args
      }
    });
  }

  /**
   * Логирование результата инструмента
   */
  logToolResponse(toolName: string, result: any, executionTime?: number, args?: any): void {
    this.addEntry({
      type: 'tool_response',
      content: `Результат: ${toolName}`,
      tool: {
        name: toolName,
        args: args || {},
        result: result,
        executionTime
      }
    });
  }

  /**
   * Логирование финального ответа
   */
  logFinalResponse(response: string, metrics?: any): void {
    this.addEntry({
      type: 'final_response',
      content: response,
      metrics: metrics
    });
  }

  /**
   * Логирование ошибок
   */
  logError(error: string, context?: any): void {
    this.addEntry({
      type: 'error',
      content: `Ошибка: ${error}`,
      error: error,
      context: context
    });
  }

  /**
   * Получить все сессии
   */
  getAllSessions(): AgentDebugSession[] {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Ошибка чтения сессий отладки:', error);
      return [];
    }
  }

  /**
   * Получить конкретную сессию
   */
  getSession(sessionId: string): AgentDebugSession | null {
    const sessions = this.getAllSessions();
    return sessions.find(s => s.sessionId === sessionId) || null;
  }

  /**
   * Получить последние N сессий
   */
  getRecentSessions(limit: number = 10): AgentDebugSession[] {
    const sessions = this.getAllSessions();
    return sessions
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
      .slice(0, limit);
  }

  /**
   * Экспорт всех данных в JSON
   */
  exportAllData(): string {
    const sessions = this.getAllSessions();
    const exportData = {
      exportedAt: new Date().toISOString(),
      totalSessions: sessions.length,
      sessions: sessions
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Экспорт конкретной сессии
   */
  exportSession(sessionId: string): string | null {
    const session = this.getSession(sessionId);
    if (!session) return null;

    const exportData = {
      exportedAt: new Date().toISOString(),
      session: session
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Скачать данные как файл
   */
  downloadData(filename: string = 'agent_debug_logs.json'): void {
    const data = this.exportAllData();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();

    URL.revokeObjectURL(url);
    console.log(`🐛 Debug: Данные экспортированы в ${filename}`);
  }

  /**
   * Очистить старые сессии
   */
  cleanupOldSessions(): void {
    const sessions = this.getAllSessions();
    if (sessions.length <= this.MAX_SESSIONS) return;

    const sortedSessions = sessions
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
      .slice(0, this.MAX_SESSIONS);

    this.saveAllSessions(sortedSessions);
    console.log(`🐛 Debug: Очищены старые сессии, оставлено ${this.MAX_SESSIONS}`);
  }

  /**
   * Очистить все данные
   */
  clearAllData(): void {
    localStorage.removeItem(this.STORAGE_KEY);
    this.currentSessionId = null;
    console.log('🐛 Debug: Все данные отладки очищены');
  }

  /**
   * Получить статистику
   */
  getStatistics(): any {
    const sessions = this.getAllSessions();
    const totalEntries = sessions.reduce((sum, s) => sum + s.entries.length, 0);
    const totalThoughts = sessions.reduce((sum, s) =>
      sum + s.entries.filter(e => e.type === 'thinking').length, 0);
    const totalToolCalls = sessions.reduce((sum, s) =>
      sum + s.entries.filter(e => e.type === 'tool_call').length, 0);

    const avgConfidence = sessions.reduce((sum, s) => {
      const thoughtEntries = s.entries.filter(e => e.type === 'thinking' && e.thoughts);
      const sessionAvg = thoughtEntries.reduce((tSum, e) =>
        tSum + (e.thoughts?.confidence || 0), 0) / Math.max(thoughtEntries.length, 1);
      return sum + sessionAvg;
    }, 0) / Math.max(sessions.length, 1);

    return {
      totalSessions: sessions.length,
      totalEntries,
      totalThoughts,
      totalToolCalls,
      averageConfidence: avgConfidence,
      storageSize: this.getStorageSize()
    };
  }

  private saveSession(session: AgentDebugSession): void {
    const sessions = this.getAllSessions();
    const index = sessions.findIndex(s => s.sessionId === session.sessionId);

    if (index >= 0) {
      sessions[index] = session;
    } else {
      sessions.push(session);
    }

    this.saveAllSessions(sessions);
  }

  private saveAllSessions(sessions: AgentDebugSession[]): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(sessions));
    } catch (error: any) {
      console.error('Ошибка сохранения сессий отладки:', error);
      // Если переполнение - очищаем старые данные
      if (error?.name === 'QuotaExceededError') {
        this.cleanupOldSessions();
      }
    }
  }

  private calculateSessionSummary(session: AgentDebugSession, metrics?: any): any {
    const entries = session.entries;
    const thoughts = entries.filter(e => e.type === 'thinking');
    const toolCalls = entries.filter(e => e.type === 'tool_call');
    const errors = entries.filter(e => e.type === 'error');

    const avgConfidence = thoughts.reduce((sum, e) =>
      sum + (e.thoughts?.confidence || 0), 0) / Math.max(thoughts.length, 1);

    const startTime = new Date(session.startTime).getTime();
    const endTime = session.endTime ? new Date(session.endTime).getTime() : Date.now();
    const executionTime = (endTime - startTime) / 1000;

    return {
      totalEntries: entries.length,
      totalThoughts: thoughts.length,
      totalToolCalls: toolCalls.length,
      errorCount: errors.length,
      successRate: toolCalls.length > 0 ? ((toolCalls.length - errors.length) / toolCalls.length) * 100 : 100,
      averageConfidence: avgConfidence,
      executionTime: executionTime,
      metrics: metrics || null
    };
  }

  private getStorageSize(): string {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      const sizeInBytes = new Blob([data || '']).size;

      if (sizeInBytes < 1024) return `${sizeInBytes} B`;
      if (sizeInBytes < 1024 * 1024) return `${(sizeInBytes / 1024).toFixed(1)} KB`;
      return `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`;
    } catch {
      return 'Неизвестно';
    }
  }
}

// Экспортируем singleton
export const agentDebugService = new AgentDebugService(); 