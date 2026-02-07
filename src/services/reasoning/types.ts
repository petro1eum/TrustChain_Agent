/**
 * Типы для Internal Reasoning системы
 */

/**
 * Конфигурация для Internal Reasoning
 */
export interface ThinkingConfig {
  /** Включить Internal Reasoning */
  enabled: boolean;
  
  /** Максимальный бюджет токенов для internal reasoning */
  maxTokens: number;
  
  /** Минимальная сложность запроса для использования internal reasoning */
  minComplexityThreshold: number;
  
  /** Модель для internal reasoning (может отличаться от основной) */
  model?: string;
  
  /** Temperature для internal reasoning */
  temperature?: number;
}

/**
 * Результат Internal Reasoning
 */
export interface InternalReasoningResult {
  /** Анализ запроса */
  analysis: string;
  
  /** Рекомендации по подходу */
  recommendations: string[];
  
  /** Ключевые моменты для учета */
  keyPoints: string[];
  
  /** Уверенность в анализе (0-1) */
  confidence: number;
  
  /** Использовано токенов */
  tokensUsed: number;
  
  /** Стоимость запроса (если доступна) */
  cost?: number;
}

/**
 * Контекст для Internal Reasoning
 */
export interface InternalReasoningContext {
  /** Исходный запрос пользователя */
  userQuery: string;
  
  /** История предыдущих сообщений (опционально) */
  chatHistory?: any[];
  
  /** Доступные инструменты */
  availableTools?: string[];
  
  /** Дополнительный контекст */
  additionalContext?: Record<string, any>;
}

