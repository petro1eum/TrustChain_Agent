/**
 * Классификация ошибок для выбора стратегии восстановления
 */

export type ErrorType = 
  | 'network_error'
  | 'api_error'
  | 'tool_error'
  | 'validation_error'
  | 'timeout_error'
  | 'rate_limit_error'
  | 'authentication_error'
  | 'unknown_error';

export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface ClassifiedError {
  type: ErrorType;
  severity: ErrorSeverity;
  message: string;
  originalError: any;
  retryable: boolean;
  suggestedStrategy: RecoveryStrategy;
}

export type RecoveryStrategy = 
  | 'retry'
  | 'retry_with_backoff'
  | 'alternative_tool'
  | 'simplify_request'
  | 'skip_step'
  | 'fallback'
  | 'abort';

/**
 * Классифицирует ошибку и определяет стратегию восстановления
 */
export function classifyError(error: any): ClassifiedError {
  const errorMessage = error?.message || String(error || 'Unknown error');
  const lowerMessage = errorMessage.toLowerCase();

  // Network errors
  if (
    lowerMessage.includes('network') ||
    lowerMessage.includes('fetch') ||
    lowerMessage.includes('connection') ||
    lowerMessage.includes('timeout') ||
    error?.code === 'ECONNREFUSED' ||
    error?.code === 'ETIMEDOUT'
  ) {
    return {
      type: 'network_error',
      severity: 'high',
      message: errorMessage,
      originalError: error,
      retryable: true,
      suggestedStrategy: 'retry_with_backoff'
    };
  }

  // Rate limit errors
  if (
    lowerMessage.includes('rate limit') ||
    lowerMessage.includes('too many requests') ||
    error?.status === 429
  ) {
    return {
      type: 'rate_limit_error',
      severity: 'medium',
      message: errorMessage,
      originalError: error,
      retryable: true,
      suggestedStrategy: 'retry_with_backoff'
    };
  }

  // Authentication errors
  if (
    lowerMessage.includes('unauthorized') ||
    lowerMessage.includes('authentication') ||
    lowerMessage.includes('api key') ||
    error?.status === 401 ||
    error?.status === 403
  ) {
    return {
      type: 'authentication_error',
      severity: 'critical',
      message: errorMessage,
      originalError: error,
      retryable: false,
      suggestedStrategy: 'abort'
    };
  }

  // API errors (4xx, 5xx)
  if (error?.status >= 400 && error?.status < 500) {
    return {
      type: 'api_error',
      severity: error?.status === 404 ? 'low' : 'medium',
      message: errorMessage,
      originalError: error,
      retryable: error?.status === 408 || error?.status === 429, // Timeout or rate limit
      suggestedStrategy: error?.status === 404 ? 'skip_step' : 'retry'
    };
  }

  if (error?.status >= 500) {
    return {
      type: 'api_error',
      severity: 'high',
      message: errorMessage,
      originalError: error,
      retryable: true,
      suggestedStrategy: 'retry_with_backoff'
    };
  }

  // Tool errors
  if (
    lowerMessage.includes('tool') ||
    lowerMessage.includes('instrument') ||
    lowerMessage.includes('function')
  ) {
    return {
      type: 'tool_error',
      severity: 'medium',
      message: errorMessage,
      originalError: error,
      retryable: true,
      suggestedStrategy: 'alternative_tool'
    };
  }

  // Validation errors
  if (
    lowerMessage.includes('validation') ||
    lowerMessage.includes('invalid') ||
    lowerMessage.includes('required') ||
    lowerMessage.includes('missing')
  ) {
    return {
      type: 'validation_error',
      severity: 'low',
      message: errorMessage,
      originalError: error,
      retryable: false,
      suggestedStrategy: 'simplify_request'
    };
  }

  // Timeout errors
  if (
    lowerMessage.includes('timeout') ||
    error?.code === 'ETIMEDOUT'
  ) {
    return {
      type: 'timeout_error',
      severity: 'medium',
      message: errorMessage,
      originalError: error,
      retryable: true,
      suggestedStrategy: 'retry_with_backoff'
    };
  }

  // Unknown errors
  return {
    type: 'unknown_error',
    severity: 'medium',
    message: errorMessage,
    originalError: error,
    retryable: true,
    suggestedStrategy: 'retry'
  };
}

