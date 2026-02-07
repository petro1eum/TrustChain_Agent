/**
 * Управление бюджетом токенов для Internal Reasoning
 */

import type { ThinkingConfig, InternalReasoningResult } from './types';

export class ReasoningBudget {
  private totalTokensUsed: number = 0;
  private totalCost: number = 0;
  private config: ThinkingConfig;
  
  constructor(config: ThinkingConfig) {
    this.config = config;
  }
  
  /**
   * Проверяет, можно ли использовать internal reasoning в рамках бюджета
   * 
   * @param estimatedTokens - Оценка токенов для запроса
   * @returns true если можно использовать, false если превышен бюджет
   */
  canUseReasoning(estimatedTokens: number = 0): boolean {
    if (!this.config.enabled) {
      return false;
    }
    
    const projectedTotal = this.totalTokensUsed + estimatedTokens;
    return projectedTotal <= this.config.maxTokens;
  }
  
  /**
   * Регистрирует использование токенов
   * 
   * @param result - Результат internal reasoning
   */
  recordUsage(result: InternalReasoningResult): void {
    this.totalTokensUsed += result.tokensUsed;
    if (result.cost) {
      this.totalCost += result.cost;
    }
  }
  
  /**
   * Получить статистику использования
   */
  getStats(): {
    totalTokensUsed: number;
    totalCost: number;
    budgetRemaining: number;
    budgetPercentage: number;
  } {
    return {
      totalTokensUsed: this.totalTokensUsed,
      totalCost: this.totalCost,
      budgetRemaining: Math.max(0, this.config.maxTokens - this.totalTokensUsed),
      budgetPercentage: (this.totalTokensUsed / this.config.maxTokens) * 100
    };
  }
  
  /**
   * Сбросить статистику
   */
  reset(): void {
    this.totalTokensUsed = 0;
    this.totalCost = 0;
  }
  
  /**
   * Оценить сложность запроса (простая эвристика)
   * 
   * @param query - Запрос пользователя
   * @returns Оценка сложности (0-1)
   */
  estimateComplexity(query: string): number {
    if (!query || query.trim().length === 0) {
      return 0;
    }
    
    const lowerQuery = query.toLowerCase();
    let complexity = 0.3; // Базовая сложность
    
    // Увеличиваем сложность для длинных запросов
    if (query.length > 100) complexity += 0.2;
    if (query.length > 300) complexity += 0.2;
    
    // Увеличиваем сложность для запросов с вопросами
    if (lowerQuery.includes('?')) complexity += 0.1;
    
    // Увеличиваем сложность для запросов с техническими терминами
    const technicalTerms = ['анализ', 'проанализируй', 'сравни', 'найди', 'создай', 'настрой', 'исправь'];
    if (technicalTerms.some(term => lowerQuery.includes(term))) {
      complexity += 0.2;
    }
    
    // Увеличиваем сложность для многошаговых задач
    const stepIndicators = ['сначала', 'потом', 'затем', 'после', 'далее'];
    if (stepIndicators.some(indicator => lowerQuery.includes(indicator))) {
      complexity += 0.1;
    }
    
    return Math.min(1.0, complexity);
  }
  
  /**
   * Определяет, нужен ли internal reasoning для запроса
   * 
   * @param query - Запрос пользователя
   * @returns true если нужен internal reasoning
   */
  shouldUseReasoning(query: string): boolean {
    if (!this.config.enabled) {
      return false;
    }
    
    const complexity = this.estimateComplexity(query);
    return complexity >= this.config.minComplexityThreshold;
  }
}

