/**
 * Общие типы для AI агентов
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

export interface AIAgentConfig {
  defaultModel: string;
  fallbackModel: string;
  temperature: number;
  maxTokens: number;
  topP?: number;  // Nucleus sampling (0-1)
  presencePenalty?: number;  // Penalty for new tokens based on presence (-2 to 2)
  frequencyPenalty?: number;  // Penalty for new tokens based on frequency (-2 to 2)
  maxProcessingSteps: number;
  chatHistoryLimit: number;
  batchSizeThreshold: number;
  defaultFuzzyThreshold: number;
  defaultTimeIntervalHours: number;
  /** Таймаут выполнения инструментов в миллисекундах (по умолчанию 35000) */
  toolExecutionTimeout?: number;
  streamingLimits: {
    maxThinkIterations: number;
    maxPlanIterations: number;
  };
  /** Конфигурация Internal Reasoning */
  thinkingConfig?: ThinkingConfig;
  /** Конфигурация Rate Limiting & Quotas */
  rateLimitConfig?: import('../services/resources').RateLimitConfig;
  /** Конфигурация Observability */
  observabilityConfig?: import('../services/observability').ObservabilityConfig;
}

export interface ThinkingBlock {
  id: string;
  timestamp: Date;
  reasoning: string;
  observation?: string;
  action?: string;
  confidence?: number;
}

export interface ToolCallBlock {
  id: string;
  timestamp: Date;
  tool: string;
  args: any;
  result?: any;
  error?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
}

// События сообщения в порядке появления
export type MessageEvent =
  | ThinkingEvent
  | ToolCallEvent
  | ToolResultEvent;

export interface ThinkingEvent {
  type: 'thinking';
  id: string;
  content: string;
  title?: string;
  summary?: string;
  observation?: string;
  reasoning?: string;
  action?: string;
  confidence?: number;
  isExpanded: boolean;
  isStreaming: boolean;
  timestamp: Date;
}

export interface ToolCallEvent {
  type: 'tool_call';
  id: string;
  name: string;
  arguments: any;
  timestamp: Date;
  status?: 'pending' | 'running' | 'completed' | 'error';
}

export interface ToolResultEvent {
  type: 'tool_result';
  id: string;
  toolCallId: string;
  result: any;
  error?: string;
  timestamp: Date;
  // TrustChain verification
  signature?: string;
  certificate?: {
    owner: string;
    organization: string;
    role: string;
    tier: 'community' | 'pro' | 'enterprise';
  };
}

export type ChatAttachmentType = 'image' | 'file';

export interface ChatAttachment {
  id: string;
  type: ChatAttachmentType;
  filename: string;
  mimeType: string;
  size: number;
  dataUrl?: string; // Только для текущей сессии (не сохранять в историю)
  previewText?: string;
  previewImageUrl?: string;
  previewTable?: string[][];
}

export interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant' | 'tool_call' | 'tool_response' | 'typing_indicator' | 'assistant_temp' | 'system';
  content?: string;  // Финальный ответ (в самом конце!)
  name?: string;
  args?: any;
  type?: string;
  event_data?: any;
  timestamp?: Date;
  // Дополнительные поля для истории чата
  agentId?: string;
  agentName?: string;
  model?: string;
  sessionId?: string;
  // События в порядке появления (thinking → tool_call → tool_result → thinking → ...)
  events?: MessageEvent[];
  // Вложения (например, изображения)
  attachments?: ChatAttachment[];
  // DEPRECATED: Используйте events вместо этого
  thinkingBlocks?: ThinkingBlock[];
  toolCalls?: ToolCallBlock[];
}

export interface ProgressEvent {
  type: 'start' | 'api_call' | 'tool_call' | 'tool_response' | 'rule_start' | 'rule_step_start' |
  'rule_step_complete' | 'rule_complete' | 'completion' | 'error' | 'finished' | 'reasoning_step' |
  'text_delta' | 'streaming_text'; // Новые типы для streaming
  message: string;
  rule_id?: string;
  rule_name?: string;
  step_number?: number;
  total_steps?: number;
  step_type?: string;
  instruction?: string;
  step_log?: string;
  event_data?: any;
  reasoning_text?: string;
  /** Текущий текст при streaming */
  streamingContent?: string;
}

export interface DataProcessingContext {
  source_files: Record<string, any>;
  workspace_df: any;
  history_stack: any[];
  redo_stack: any[];
  filter_mask?: any;
  loaded_files: string[];
  lastInstruction?: string; // Последняя инструкция пользователя для валидации инструментов
  pendingFileRequest?: {
    type: 'excel' | 'pdf' | 'word';
    requestedAt: number;
    query?: string;
    categorySlug?: string;
    items?: any[];
    fileCreated?: boolean;
  };
  internalReasoning?: { // Результаты Internal Reasoning (скрытый анализ)
    analysis: string;
    recommendations: string[];
    keyPoints: string[];
  };
}

export interface RuleExecutionContext {
  loadedFiles: string[];
  filterMask?: any;
  [key: string]: any;
}

// Расширенные типы для умного планирования
export interface ThoughtProcess {
  observation: string;
  reasoning: string;
  action: string;
  confidence: number;
}

export interface ExecutionPlan {
  goal: string;
  thoughts: ThoughtProcess[];
  steps: PlannedStep[];
  adaptations: string[];
  learnings: Record<string, any>;
}

export interface PlannedStep {
  id: string;
  thought: string;
  action: {
    tool: string;
    args: any;
    reasoning: string;
  };
  dependencies: string[];
  expectedResult: string;
  alternativeApproaches: AlternativeApproach[];
  executed?: boolean;
  result?: any;
  error?: string;
}

export interface AlternativeApproach {
  condition: string;
  action: {
    tool: string;
    args: any;
  };
  reasoning: string;
}

/**
 * @deprecated Use AppActionsRegistry (src/services/appActionsRegistry.ts) instead.
 * Host apps should register actions dynamically via postMessage:
 *   postMessage({ type: 'trustchain:register_actions', actions: [...] })
 *
 * This interface is kept for backward compatibility with existing code
 * that still references appActions directly. It will be removed in a future version.
 */
export interface AppActions {
  loadFileFromPath: (filePath: string, clientName?: string) => Promise<boolean>;
  switchView: (view: string) => void;
  selectClient: (clientId: string) => boolean;
  selectFile: (fileId: string) => boolean;
  loadFileContent: (fileId: string) => Promise<any>;
  getAvailableFiles: () => any[];
  getAvailableClients: () => any[];

  // Расширенные методы для агента "Общий"
  dataQualityCheck: (fileId: string) => Promise<string>;
  fuzzyMatching: (data: any, config: any) => Promise<string>;
  createDataReport: (fileId: string, format: string) => Promise<string>;
  createRule: (ruleName: string, ruleData: any) => Promise<boolean>;
  executeRule: (ruleId: string, fileId: string) => Promise<string>;
  validateRule: (ruleData: any) => Promise<string>;
  exportData: (fileId: string, format: string) => Promise<string>;
  backupSystem: () => Promise<string>;
  systemStatus: () => string;

  // Методы для работы с данными трансформации проекта
  getTransformationData: () => Promise<any>;
  searchTransformationData: (query: string) => Promise<any>;
  getFileMetadata: (fileName: string) => Promise<any>;
  [key: string]: (...args: any[]) => any; // Allow dynamic methods
}

export interface Rule {
  rule_id: string;
  название_правила: string;
  краткое_описание: string;
  приоритет: number;
  активно: boolean;
  категория: string;
  сложность: string;
  статистика: {
    успешных: number;
    ошибок: number;
    среднее_время: string;
  };
  [key: string]: any; // Для шагов правил
}

export interface RuleStep {
  stepType: string;
  stepNumber: number;
  instruction: string;
  data: any;
} 