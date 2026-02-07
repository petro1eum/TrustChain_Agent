/**
 * Конфигурация по умолчанию для AI Agent
 */

import type { AIAgentConfig } from '../types';

export function getDefaultAgentConfig(): AIAgentConfig {
  return {
    defaultModel: 'google/gemini-3-flash-preview',
    fallbackModel: 'google/gemini-2.5-flash',
    temperature: 0.1,
    maxTokens: 8000,
    maxProcessingSteps: 5,
    chatHistoryLimit: 20,
    batchSizeThreshold: 1000,
    defaultFuzzyThreshold: 0.95,
    defaultTimeIntervalHours: 1,
    toolExecutionTimeout: 35000, // 35 секунд по умолчанию
    streamingLimits: {
      maxThinkIterations: 2000,
      maxPlanIterations: 5000
    },
    thinkingConfig: {
      enabled: false, // По умолчанию выключен (можно включить через config)
      maxTokens: 2000, // Бюджет токенов для internal reasoning
      minComplexityThreshold: 0.5, // Минимальная сложность для использования
      model: undefined, // Использует defaultModel если не указано
      temperature: 0.3 // Низкая temperature для анализа
    },
    rateLimitConfig: {
      enabled: false, // По умолчанию выключен (можно включить через config)
      maxTokensPerMinute: 100000,
      maxRequestsPerMinute: 60,
      defaultLimits: {
        maxToolCalls: 1000, // Максимум tool calls за период
        maxTokens: 1000000, // Максимум токенов за период (1M)
        maxCost: 10.0, // Максимальная стоимость за период ($10)
        maxApiRequests: 500, // Максимум API запросов за период
        periodMs: 60 * 60 * 1000 // Период: 1 час
      }
    },
    observabilityConfig: {
      enabled: false, // По умолчанию выключен (можно включить через config)
      maxEvents: 10000,
      maxSpans: 1000,
      logLevel: 'info',
      structuredLogging: true,
      tracing: true,
      metrics: true,
      exportEvents: false
    }
  };
}

