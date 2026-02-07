/**
 * Стратегии восстановления после ошибок
 */

import type { ClassifiedError, RecoveryStrategy } from './errorClassification';

export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  backoffType: 'linear' | 'exponential';
}

export interface RecoveryResult {
  success: boolean;
  result?: any;
  error?: string;
  strategy: RecoveryStrategy;
  attempts: number;
}

/**
 * Стратегия retry с exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2,
    backoffType: 'exponential'
  }
): Promise<RecoveryResult> {
  let lastError: any;
  let delay = config.initialDelay;

  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    try {
      const result = await fn();
      return {
        success: true,
        result,
        strategy: 'retry_with_backoff',
        attempts: attempt + 1
      };
    } catch (error) {
      lastError = error;
      
      if (attempt < config.maxRetries - 1) {
        // Ждем перед следующей попыткой
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Увеличиваем задержку
        if (config.backoffType === 'exponential') {
          delay = Math.min(delay * config.backoffMultiplier, config.maxDelay);
        } else {
          delay = Math.min(delay + config.initialDelay, config.maxDelay);
        }
      }
    }
  }

  return {
    success: false,
    error: lastError?.message || 'All retries failed',
    strategy: 'retry_with_backoff',
    attempts: config.maxRetries
  };
}

/**
 * Стратегия retry без backoff
 */
export async function retrySimple<T>(
  fn: () => Promise<T>,
  maxRetries: number = 2
): Promise<RecoveryResult> {
  let lastError: any;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await fn();
      return {
        success: true,
        result,
        strategy: 'retry',
        attempts: attempt + 1
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    success: false,
    error: lastError?.message || 'All retries failed',
    strategy: 'retry',
    attempts: maxRetries
  };
}

/**
 * Выбирает стратегию восстановления на основе классификации ошибки
 */
export function selectRecoveryStrategy(error: ClassifiedError): RecoveryStrategy {
  // Если ошибка критическая - прерываем
  if (error.severity === 'critical' || !error.retryable) {
    return 'abort';
  }

  // Используем предложенную стратегию
  return error.suggestedStrategy;
}

