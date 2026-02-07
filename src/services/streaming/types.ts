/**
 * Типы для Response Streaming системы
 */

export interface StreamEvent {
  /** Тип события */
  type: 'text_delta' | 'thinking_delta' | 'tool_use_start' | 'tool_use_delta' | 'tool_result' | 'content_block_start' | 'content_block_stop' | 'message_start' | 'message_stop' | 'message_delta';
  
  /** Данные события */
  data: any;
  
  /** Временная метка */
  timestamp: Date;
}

export interface TextDeltaEvent extends StreamEvent {
  type: 'text_delta';
  data: {
    /** Текстовая дельта (токен) */
    delta: string;
    /** Накопленный текст */
    accumulated: string;
    /** Индекс блока контента */
    contentIndex?: number;
  };
}

export interface ThinkingDeltaEvent extends StreamEvent {
  type: 'thinking_delta';
  data: {
    /** Дельта мышления */
    delta: string;
    /** Накопленное мышление */
    accumulated: string;
  };
}

export interface ToolUseStartEvent extends StreamEvent {
  type: 'tool_use_start';
  data: {
    /** ID вызова инструмента */
    toolCallId: string;
    /** Имя инструмента */
    toolName: string;
    /** Аргументы (если уже известны) */
    args?: any;
  };
}

export interface ToolUseDeltaEvent extends StreamEvent {
  type: 'tool_use_delta';
  data: {
    /** ID вызова инструмента */
    toolCallId: string;
    /** Дельта аргументов (JSON строка) */
    argsDelta: string;
  };
}

export interface ToolResultEvent extends StreamEvent {
  type: 'tool_result';
  data: {
    /** ID вызова инструмента */
    toolCallId: string;
    /** Результат выполнения */
    result: any;
    /** Статус выполнения */
    status: 'success' | 'error';
  };
}

export interface StreamingCallbacks {
  /** Callback для текстовых дельт (токен за токеном) */
  onTextDelta?: (delta: string, accumulated: string) => void;
  
  /** Callback для дельт мышления */
  onThinkingDelta?: (delta: string, accumulated: string) => void;
  
  /** Callback при начале вызова инструмента */
  onToolUseStart?: (toolCallId: string, toolName: string, args?: any) => void;
  
  /** Callback при дельте аргументов инструмента */
  onToolUseDelta?: (toolCallId: string, argsDelta: string) => void;
  
  /** Callback при завершении вызова инструмента */
  onToolResult?: (toolCallId: string, result: any, status: 'success' | 'error') => void;
  
  /** Callback при завершении стриминга */
  onComplete?: (finalContent: string) => void;
  
  /** Callback при ошибке */
  onError?: (error: Error) => void;
}

export interface StreamingConfig {
  /** Максимальное количество итераций */
  maxIterations?: number;
  
  /** Включить streaming для thinking */
  enableThinkingStream?: boolean;
  
  /** Включить streaming для content */
  enableContentStream?: boolean;
}

