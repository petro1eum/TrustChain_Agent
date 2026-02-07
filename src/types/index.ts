// Типы данных
export interface Client {
  id: number;
  name: string;
  dataFiles: number;
  lastUpdate: string;
  status: 'active' | 'inactive' | 'pending';
  email?: string;
  phone?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DataFile {
  id: number;
  name: string;
  size: string;
  rows: number;
  uploaded: string;
  clientId?: number;
  content?: {
    type: 'table' | 'text' | 'json';
    data: any;
    columns?: string[];
    originalSize?: number;
    excelInfo?: {
      fileId: string;
      fileInfo: any;
      isMdbFile: boolean;
      hasMultipleSheets: boolean;
    };
  };
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
}

export type ViewType = 'dashboard' | 'clients' | 'analysis' | 'rules' | 'execution' | 'builder' | 'postgres';
export type AiModeType = 'assistant' | 'analyzer' | 'builder';

// AI Agent Configuration Types
export interface AIModelConfig {
  provider: 'openai' | 'anthropic' | 'local' | 'custom';
  model: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
  systemPrompt: string;
  contextWindow: number;
  streamResponse: boolean;
}

export interface AgentPersonality {
  id: string;
  name: string;
  description: string;
  role: string;
  expertise: string[];
  communicationStyle: 'formal' | 'casual' | 'technical' | 'friendly' | 'analytical';
  responseFormat: 'markdown' | 'json' | 'text' | 'structured';
  thinkingMode: 'visible' | 'hidden' | 'summary';
  criticalThinking: boolean;
  selfReflection: boolean;
  multiStep: boolean;
}

// ChatMessage перемещен в agents/types.ts для единообразия
// Используйте: import type { ChatMessage } from '../agents/types';
import type { ChatMessage } from '../agents/types';

export interface AgentMemory {
  shortTerm: Record<string, any>;
  longTerm: Record<string, any>;
  conversationHistory: ChatMessage[];
  learnings: string[];
  preferences: Record<string, any>;
}

export interface AgentTools {
  enabled: string[];
  config: Record<string, any>;
  customTools: Record<string, any>;
  permissions: string[];
}

export interface AgentWorkflow {
  id: string;
  name: string;
  steps: WorkflowStep[];
  triggers: string[];
  conditions: Record<string, any>;
}

export interface WorkflowStep {
  id: string;
  type: 'think' | 'analyze' | 'generate' | 'validate' | 'execute' | 'reflect';
  action: string;
  params: Record<string, any>;
  nextStep?: string;
  conditions?: Record<string, any>;
}

export interface AIAgentProfile {
  id: string;
  name: string;
  description: string;
  created: Date;
  lastModified: Date;
  isActive: boolean;

  // Core Configuration
  modelConfig: AIModelConfig;
  personality: AgentPersonality;
  memory: AgentMemory;
  tools: AgentTools;
  workflows: AgentWorkflow[];

  // Behavior Settings
  autonomyLevel: 'manual' | 'guided' | 'autonomous';
  collaborationMode: 'solo' | 'team' | 'leader' | 'follower';
  learningEnabled: boolean;
  memoryPersistence: boolean;

  // Performance Monitoring
  metrics: {
    totalInteractions: number;
    successRate: number;
    averageResponseTime: number;
    userSatisfaction: number;
    lastPerformanceReview: Date;
  };

  // Multi-Agent Coordination
  canInteractWith: string[]; // Other agent IDs
  sharedMemory: boolean;
  conflictResolution: 'priority' | 'consensus' | 'escalate';
}

export interface AgentInteraction {
  id: string;
  fromAgent: string;
  toAgent: string;
  type: 'request' | 'response' | 'notification' | 'collaboration';
  content: any;
  timestamp: Date;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

export interface MultiAgentSession {
  id: string;
  name: string;
  description: string;
  participants: string[]; // Agent IDs
  coordinator?: string; // Agent ID of coordinator
  sharedContext: Record<string, any>;
  interactions: AgentInteraction[];
  status: 'active' | 'paused' | 'completed';
  created: Date;
}

// Доступные модели через OpenRouter (январь 2026)
// supportsWebSearch - модели с нативным web search через OpenRouter (:online suffix)
export const AVAILABLE_MODELS = {
  openai: [
    // GPT-5.2 серия (декабрь 2025) - поддерживают native search
    { id: 'openai/gpt-5.2-pro', name: 'GPT-5.2 Pro', description: 'Флагман OpenAI, agentic coding', maxTokens: 256000, category: 'latest', supportsWebSearch: true },
    { id: 'openai/gpt-5.2', name: 'GPT-5.2', description: 'Frontier-grade, adaptive reasoning', maxTokens: 128000, category: 'latest', supportsWebSearch: true },
    { id: 'openai/gpt-5.2-codex', name: 'GPT-5.2 Codex', description: 'Для software engineering', maxTokens: 128000, category: 'coding', supportsWebSearch: true },
    // o-серия (reasoning) - native search
    { id: 'openai/o4-mini', name: 'o4 Mini', description: 'Быстрый reasoning', maxTokens: 128000, category: 'reasoning', supportsWebSearch: true },
  ],
  google: [
    // Gemini 3 серия (декабрь 2025) - native Google Search grounding
    { id: 'google/gemini-3-pro', name: 'Gemini 3 Pro', description: 'Флагман Google', maxTokens: 1000000, category: 'latest', supportsWebSearch: true },
    { id: 'google/gemini-3-flash-preview', name: 'Gemini 3 Flash', description: 'Быстрая и дешевая', maxTokens: 1000000, category: 'recommended', supportsWebSearch: true },
    // Gemini 2.5 (стабильные) - native Google Search grounding
    { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Стабильная версия с thinking', maxTokens: 1000000, category: 'stable', supportsWebSearch: true },
    { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Быстрая стабильная', maxTokens: 1000000, category: 'fast', supportsWebSearch: true },
  ],
  anthropic: [
    // Claude 4.5 серия (ноябрь 2025) - native search через OpenRouter
    { id: 'anthropic/claude-opus-4.5', name: 'Claude Opus 4.5', description: 'Флагман Anthropic', maxTokens: 200000, category: 'latest', supportsWebSearch: true },
    { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', description: 'Баланс цена/качество', maxTokens: 200000, category: 'recommended', supportsWebSearch: true },
    // Claude 4 (май 2025) - native search через OpenRouter
    { id: 'anthropic/claude-opus-4', name: 'Claude Opus 4', description: 'Отличный для кода', maxTokens: 200000, category: 'coding', supportsWebSearch: true },
    { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', description: 'Для high-volume задач', maxTokens: 200000, category: 'fast', supportsWebSearch: true },
  ],
  other: [
    // DeepSeek и Meta - ограниченная поддержка search
    { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', description: 'Reasoning модель', maxTokens: 64000, category: 'reasoning', supportsWebSearch: false },
    { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', description: 'Открытая модель Meta', maxTokens: 128000, category: 'open', supportsWebSearch: false },
  ]
} as const;



// Расширенный интерфейс для агента с веб-поиском
export interface WebSearchCapability {
  enabled: boolean;
  provider: 'tavily' | 'serpapi' | 'google' | 'bing';
  maxResults: number;
  includeSources: boolean;
  realTimeSearch: boolean;
}

export interface AgentProfile {
  id: string;
  name: string;
  description: string;
  provider: 'openai' | 'anthropic' | 'local' | 'custom';
  model: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  systemPrompt: string;
  role: string;
  style: 'formal' | 'casual' | 'technical' | 'friendly' | 'analytical';
  thinkingMode: 'visible' | 'hidden' | 'summary';
  criticalThinking: boolean;
  selfReflection: boolean;
  multiStep: boolean;
  tools: string[];
  permissions: string[];
  isActive: boolean;
  webSearch?: WebSearchCapability; // Новое поле для веб-поиска
} 