/**
 * Сервис обработки ошибок и восстановления
 * Выделен из smart-ai-agent.ts для улучшения структуры кода
 * Расширен с классификацией ошибок и стратегиями восстановления
 */

import type { ThoughtProcess, ProgressEvent } from '../../agents/types';
import { classifyError, type ClassifiedError, type RecoveryStrategy } from './errorRecovery/errorClassification';
import { selectRecoveryStrategy, retryWithBackoff, retrySimple, type RecoveryResult } from './errorRecovery/recoveryStrategies';

export interface ErrorRecoveryServiceDependencies {
  think: (prompt: string, context?: any[], progressCallback?: (event: ProgressEvent) => void) => Promise<ThoughtProcess>;
}

export class ErrorRecoveryService {
  constructor(private deps: ErrorRecoveryServiceDependencies) {}

  /**
   * Интеллектуальное восстановление после ошибок
   * Теперь с классификацией ошибок и выбором стратегии
   */
  async attemptErrorRecovery(errorContext: any): Promise<{ success: boolean; result?: any; strategy?: RecoveryStrategy }> {
    try {
      // Классифицируем ошибку
      const classifiedError = classifyError(errorContext.error || errorContext);
      
      // Выбираем стратегию восстановления
      const strategy = selectRecoveryStrategy(classifiedError);
      
      // Если ошибка критическая - прерываем
      if (strategy === 'abort') {
        return { 
          success: false, 
          strategy: 'abort',
          result: { error: classifiedError.message, severity: classifiedError.severity }
        };
      }
      
      // Интеллектуальное восстановление через thinking
      const recovery = await this.deps.think(
        `Произошла ошибка типа ${classifiedError.type}: ${classifiedError.message}. Как мне восстановиться используя стратегию ${strategy}?`,
        [] // Убираем контекст чтобы избежать ошибок API
      );
      
      if (recovery.confidence > 0.7) {
        return { 
          success: true, 
          result: { recoveryPlan: recovery.action },
          strategy
        };
      }
      
      return { success: false, strategy };
    } catch (error: any) {
      console.error('Ошибка в attemptErrorRecovery:', error);
      return { success: false, strategy: 'abort' };
    }
  }

  /**
   * Попытка альтернативных подходов при ошибке
   */
  async tryAlternativeApproaches(
    alternatives: Array<{ action: { tool: string; args: any } }>,
    executeTool: (tool: string, args: any) => Promise<any>
  ): Promise<{ success: boolean; result?: any; error?: string }> {
    for (const alternative of alternatives) {
      try {
        const result = await executeTool(alternative.action.tool, alternative.action.args);
        return { success: true, result };
      } catch (altError) {
        continue;
      }
    }
    
    return { success: false, error: 'All alternatives failed' };
  }

  /**
   * Классифицирует ошибку
   */
  classifyError(error: any): ClassifiedError {
    return classifyError(error);
  }

  /**
   * Выполняет операцию с retry стратегией
   */
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    strategy: RecoveryStrategy = 'retry',
    config?: any
  ): Promise<RecoveryResult> {
    switch (strategy) {
      case 'retry_with_backoff':
        return retryWithBackoff(fn, config);
      
      case 'retry':
        return retrySimple(fn, config?.maxRetries || 2);
      
      default:
        // Для других стратегий просто пробуем один раз
        try {
          const result = await fn();
          return {
            success: true,
            result,
            strategy,
            attempts: 1
          };
        } catch (error: any) {
          return {
            success: false,
            error: error?.message || 'Operation failed',
            strategy,
            attempts: 1
          };
        }
    }
  }
}

