/**
 * Умный AI Agent с реальным выполнением инструментов
 * Улучшенная версия с Chain-of-Thought
 */

import { AIAgent } from './base-ai-agent';
import type {
  AIAgentConfig,
  ChatMessage,
  ProgressEvent,
  AppActions,
  ExecutionPlan,
  ThoughtProcess,
  DataProcessingContext
} from './types';
import { agentDebugService } from '../services/agentDebugService';
import {
  ToolHandlersService,
  ResponseGeneratorService,
  MetricsService,
  PlanningService,
  ReflectionService,
  ToolExecutionService,
  ErrorRecoveryService,
  ReActService,
  ConversationMemoryService,
  AnswerValidationService,
  PersistentMemoryService,
  MCPClientService,
  TaskQueueService,
  TestRunnerService,
  AgentOrchestratorService,
  BrowserService,
  EventTriggerService,
} from '../services/agents';
import { getAllSmartAgentTools, UNIVERSAL_TOOLS } from '../tools';
import { pageTools, PAGE_TOOL_NAMES } from '../tools/pageTools';
import { HostBridgeService } from '../services/hostBridgeService';
import { appActionsRegistry } from '../services/appActionsRegistry';
import { SystemPrompts } from './base/systemPrompts';
import { createApiParams } from './config/apiParams';
import { SkillsLoaderService, SkillsMatcher } from '../services/skills';
import { InternalReasoningService } from '../services/reasoning';
import { ResourceManager } from '../services/resources';
import { ObservabilityService } from '../services/observability';
import { getLockedToolIds } from '../tools/toolRegistry';
import { trustchainService } from '../services/trustchainService';
import { getAgentContext, getAgentInstance } from '../services/agentContext';

export class SmartAIAgent extends AIAgent {
  // История последних вызовов инструментов для защиты от зацикливания
  private recentToolCalls: Map<string, Array<{ args: any; result: any; timestamp: number }>> = new Map();
  private executionPlan?: ExecutionPlan;
  private toolExecutionCache: Map<string, any> = new Map();

  // Сервисы (выделены из основного класса)
  private metricsService: MetricsService;
  private responseGenerator: ResponseGeneratorService;
  private planningService: PlanningService;
  private reflectionService: ReflectionService;
  private toolHandlers: ToolHandlersService;
  private toolExecutionService: ToolExecutionService;
  private errorRecoveryService: ErrorRecoveryService;
  private reactService: ReActService;
  private conversationMemoryService: ConversationMemoryService;
  private answerValidationService: AnswerValidationService;
  private persistentMemoryService: PersistentMemoryService;
  private mcpClientService: MCPClientService;
  private _mcpReadyPromise: Promise<any[]> | null = null;
  private taskQueueService: TaskQueueService;
  private testRunnerService: TestRunnerService;
  private agentOrchestrator: AgentOrchestratorService;
  private browserService: BrowserService;
  private eventTriggerService: EventTriggerService;
  private internalReasoningService?: InternalReasoningService;
  private resourceManager?: ResourceManager;
  private observabilityService?: ObservabilityService;

  private appActions?: AppActions;

  constructor(apiKey?: string, config?: Partial<AIAgentConfig>, appActions?: AppActions) {
    super(apiKey, config);
    this.appActions = appActions;

    // Инициализация сервисов
    this.metricsService = new MetricsService();
    this.responseGenerator = new ResponseGeneratorService();

    // ContextAnalyzerService создается внутри PlanningService, не нужен здесь

    this.planningService = new PlanningService({
      openai: this.openai,
      context: this.context,
      appActions: this.appActions,
      getApiParams: (params: any) => this.getApiParams(params),
      getToolsSpecification: () => this.getToolsSpecification(),
      getThinkingSystemPrompt: () => this.getThinkingSystemPrompt(),
      getPlanningSystemPrompt: () => this.getPlanningSystemPrompt(),
      saveLogToFile: (content: string, filename: string) => this.saveLogToFile(content, filename),
      config: this.config,
      onThinkingIteration: () => {
        // Используем методы MetricsService (явное приведение типа для обхода проблемы TypeScript)
        (this.metricsService as any).incrementThinkingIterations();
      },
      onConfidenceUpdate: (confidence: number) => {
        (this.metricsService as any).addConfidence(confidence);
      }
    });

    this.reflectionService = new ReflectionService({
      openai: this.openai,
      getApiParams: (params: any) => this.getApiParams(params),
      think: (prompt: string, context?: any[], progressCallback?: (event: ProgressEvent) => void) =>
        this.planningService.think(prompt, context, progressCallback),
      responseGenerator: this.responseGenerator
    });

    this.toolHandlers = new ToolHandlersService({
      appActions: this.appActions,
      context: this.context,
      openai: this.openai,
      normalizeArgs: (args: any, aliases: Record<string, string>) => this.normalizeArgs(args, aliases),
      safeAppAction: async (fn: () => Promise<any>) => {
        try {
          const data = await fn();
          return { success: true, data };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      }
    });

    this.errorRecoveryService = new ErrorRecoveryService({
      think: (prompt: string, context?: any[], progressCallback?: (event: ProgressEvent) => void) =>
        this.planningService.think(prompt, context, progressCallback)
    });

    // reactService будет инициализирован после answerValidationService
    // (перемещён ниже для доступа к answerValidationService)

    // Инициализация ResourceManager (если включен в конфиге)
    const rateLimitConfig = this.config.rateLimitConfig;
    if (rateLimitConfig?.enabled) {
      this.resourceManager = new ResourceManager(rateLimitConfig);
    }

    this.toolExecutionService = new ToolExecutionService({
      metricsService: this.metricsService,
      toolHandlers: this.toolHandlers,
      toolExecutionCache: this.toolExecutionCache,
      recentToolCalls: this.recentToolCalls,
      appActions: this.appActions,
      context: this.context,
      executionPlan: this.executionPlan,
      getApiParams: (params: any) => this.getApiParams(params),
      isNonInformativeResult: (result: any) => this.isNonInformativeResult(result),
      attemptErrorRecovery: (errorContext: any) => this.errorRecoveryService.attemptErrorRecovery(errorContext),
      normalizeArgs: (args: any, aliases: Record<string, string>) => this.normalizeArgs(args, aliases),
      safeAppAction: async (fn: () => Promise<any>) => {
        try {
          const data = await fn();
          return { success: true, data };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
      resourceManager: this.resourceManager,
      currentModel: this.config.defaultModel
    });


    // Инициализация InternalReasoningService (если включен в конфиге)
    const thinkingConfig = this.config.thinkingConfig;
    if (thinkingConfig?.enabled) {
      this.internalReasoningService = new InternalReasoningService({
        openai: this.openai,
        config: thinkingConfig,
        getApiParams: (params: any) => this.getApiParams(params),
        defaultModel: this.config.defaultModel,
        resourceManager: this.resourceManager // Передаем ResourceManager для регистрации использования
      });
    }

    // Инициализация ObservabilityService (если включен в конфиге)
    const observabilityConfig = this.config.observabilityConfig;
    if (observabilityConfig?.enabled) {
      this.observabilityService = new ObservabilityService(observabilityConfig);
    }

    this.conversationMemoryService = new ConversationMemoryService({
      openai: this.openai,
      getApiParams: (params: any) => this.getApiParams(params)
    });

    // Gap A: Persistent memory across sessions
    this.persistentMemoryService = new PersistentMemoryService({
      openai: this.openai,
      getApiParams: (params: any) => this.getApiParams(params)
    });

    // Gap B: MCP Client for dynamic tool discovery
    this.mcpClientService = new MCPClientService();
    // Auto-connect to configured MCP servers (incl. Playwright auto-discovery on :8931)
    // IMPORTANT: Store the promise so analyzeAndProcess can await it before first query
    this._mcpReadyPromise = this.mcpClientService.connectAll().then(connections => {
      const connected = connections.filter(c => c.status === 'connected');
      if (connected.length > 0) {
        console.log(`[SmartAIAgent] MCP connected: ${connected.map(c => `${c.config.name} (${c.tools.length} tools)`).join(', ')}`);
      }
      return connections;
    }).catch(err => {
      console.warn('[SmartAIAgent] MCP connectAll error (non-critical):', err);
      return [] as any[];
    });

    // Gap C: Long-running task queue with checkpoint/resume
    this.taskQueueService = new TaskQueueService();

    // Gap E: Test-driven self-correction after code changes
    this.testRunnerService = new TestRunnerService();

    // Gap F: Multi-agent task decomposition
    this.agentOrchestrator = new AgentOrchestratorService();

    // Gap G: Headless browser for JS-heavy pages
    this.browserService = new BrowserService();

    // Gap H: Event-driven agent triggers
    this.eventTriggerService = new EventTriggerService();

    // Инициализация сервиса валидации ответов
    this.answerValidationService = new AnswerValidationService({
      openai: this.openai,
      getApiParams: (params: any) => this.getApiParams(params)
    });

    // Инициализация ReActService (после answerValidationService для multi-step support)
    // Gap #2: передаём openai + getApiParams для LLM-based intent classification
    this.reactService = new ReActService({
      getSystemPrompt: async (relevantSkillsMetadata?: any[]) => await this.getSystemPrompt(relevantSkillsMetadata),
      chatWithToolsLoop: (messages: any[], progressCallback?: (event: ProgressEvent) => void, sharedExecutedToolCalls?: Map<string, any>) =>
        this.chatWithToolsLoop(messages, progressCallback, undefined, undefined, sharedExecutedToolCalls),
      answerValidationService: this.answerValidationService,
      openai: this.openai,
      getApiParams: (params: any) => this.getApiParams(params)
    });
  }

  /**
   * Переопределяем recordApiUsage для регистрации использования в ResourceManager
   */
  protected recordApiUsage(model: string, usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }): void {
    if (this.resourceManager) {
      this.resourceManager.recordApiUsage(model, usage);
    }
  }

  /**
   * Хелпер для создания параметров API с учётом особенностей GPT-5
   */
  private getApiParams(baseParams: {
    model?: string;
    messages: any[];
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    presencePenalty?: number;
    frequencyPenalty?: number;
    responseFormat?: any;
    stream?: boolean;
  }): any {
    return createApiParams(baseParams, {
      defaultModel: this.config.defaultModel,
      temperature: this.config.temperature,
      topP: this.config.topP,
      presencePenalty: this.config.presencePenalty,
      frequencyPenalty: this.config.frequencyPenalty
    });
  }

  /**
   * Главный метод с настоящим Chain-of-Thought
   */
  async analyzeAndProcess(
    instruction: string,
    chatHistory: ChatMessage[] = [],
    progressCallback?: (event: ProgressEvent) => void,
    attachments?: import('./types').ChatAttachment[]
  ): Promise<{ result: any; messages: ChatMessage[] }> {

    // Генерируем session ID для observability
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Начинаем span для tracing
    const rootSpan = this.observabilityService?.startSpan('analyzeAndProcess', {
      instruction,
      sessionId,
      chatHistoryLength: chatHistory.length
    });

    // Логируем начало сессии
    this.observabilityService?.logEvent({
      type: 'session_start',
      sessionId,
      data: { instruction },
      level: 'info'
    });

    // Сохраняем последнюю инструкцию в контексте для валидации
    this.context.lastInstruction = instruction;
    trustchainService.setCurrentQuery(instruction);
    trustchainService.setExecutionContext({
      instance: getAgentInstance(),
      context: getAgentContext() || undefined,
      document_mode: (typeof window !== 'undefined')
        ? (window as any).__trustchain_document_mode?.mode
        : undefined,
      tenant_id: getAgentInstance() || 'default',
    });
    trustchainService.setDecisionContext({
      provider: 'openai-compatible',
      model: this.config.defaultModel,
      policy_version: 'v1',
      fallback_used: false,
      safety_mode: 'strict',
      context: getAgentContext() || 'unknown',
    });
    this.context.pendingFileRequest = this.detectPendingFileRequest(instruction);
    this.context.source_files = {
      ...this.context.source_files,
      attachments: attachments
        ? attachments.map(att => ({
          id: att.id,
          filename: att.filename,
          mimeType: att.mimeType,
          size: att.size,
          type: att.type
        }))
        : []
    };

    // Начинаем новую сессию отладки
    agentDebugService.startSession(instruction);

    // Сброс метрик для нового выполнения
    this.metricsService.reset();

    const messages: ChatMessage[] = [];

    // Быстрый путь: пользователь спрашивает про доступные инструменты
    const lc = instruction.toLowerCase();
    const asksForTools = /\b(инструмент|tools)\b/.test(lc) && /(какие|список|что.*есть|у\s+тебя)/.test(lc);
    if (asksForTools) {
      const tools = this.listAvailableTools();
      const short = `Доступно ${tools.length} инструментов`;
      const extended = tools
        .map(t => `- ${t.name}${t.description ? ` — ${t.description}` : ''}`)
        .join('\n');
      const content = this.responseGenerator.composeDirectAnswer('Список доступных инструментов', { shortAnswer: short, extendedAnswer: extended } as any);
      messages.push({ role: 'assistant', content, timestamp: new Date() });
      agentDebugService.logFinalResponse(content, this.metricsService.getMetrics());
      return { result: { status: 'success', toolsCount: tools.length }, messages };
    }

    try {
      // Ensure MCP tools are fully discovered before first LLM call
      if (this._mcpReadyPromise) {
        await this._mcpReadyPromise;
        this._mcpReadyPromise = null; // Only wait once
      }
      // Skills Auto-Triggering: загружаем релевантные skills
      progressCallback?.({
        type: 'reasoning_step',
        message: 'Ищу релевантные skills...',
        reasoning_text: 'Загружаю метаданные skills для оптимизации context window'
      });

      let relevantSkillsMetadata: any[] = [];
      try {
        const allSkills = await SkillsLoaderService.loadAllSkillsMetadata();
        const matchResult = SkillsMatcher.findRelevantSkills(instruction, allSkills, 5);
        relevantSkillsMetadata = matchResult.skills;

        if (relevantSkillsMetadata.length > 0) {
          progressCallback?.({
            type: 'reasoning_step',
            message: `Найдено ${relevantSkillsMetadata.length} релевантных skills`,
            reasoning_text: `Skills: ${relevantSkillsMetadata.map(s => s.name).join(', ')}`
          });
        }
      } catch (error) {
        // Игнорируем ошибки загрузки skills - не критично
        console.warn('Ошибка загрузки skills:', error);
      }

      const conversationContext = await this.conversationMemoryService.getConversationContext(
        instruction,
        progressCallback
      );

      if (conversationContext) {
        instruction = `${conversationContext}\n\n=== ТЕКУЩИЙ ЗАПРОС ===\n${instruction}`;
      }

      // Gap A: Load persistent cross-session memory
      try {
        await this.persistentMemoryService.loadMemory();
        const persistentContext = this.persistentMemoryService.formatMemoriesForPrompt(instruction);
        if (persistentContext) {
          instruction = `${persistentContext}\n\n${instruction}`;
        }
      } catch (memError) {
        console.warn('[PersistentMemory] Load error (non-critical):', memError);
      }

      // Internal Reasoning: скрытый анализ перед основным запросом (если включен)
      let internalReasoningResult = null;
      if (this.internalReasoningService) {
        try {
          // Делаем скрытый запрос для internal analysis (не показываем пользователю)
          internalReasoningResult = await this.internalReasoningService.thinkInternally({
            userQuery: instruction,
            chatHistory: chatHistory.slice(-5), // Последние 5 сообщений для контекста
            availableTools: this.getToolsSpecification().map(t => t.function?.name).filter(Boolean) as string[],
            additionalContext: {
              skillsCount: relevantSkillsMetadata.length,
              hasSkills: relevantSkillsMetadata.length > 0
            }
          });

          // Используем результат internal reasoning для улучшения основного запроса
          if (internalReasoningResult) {
            // Добавляем рекомендации из internal reasoning в инструкцию
            if (internalReasoningResult.recommendations.length > 0) {
              const recommendations = internalReasoningResult.recommendations.join('\n- ');
              instruction = `${instruction}\n\n[Внутренний анализ рекомендует:\n- ${recommendations}]`;
            }

            // Добавляем ключевые моменты
            if (internalReasoningResult.keyPoints.length > 0) {
              const keyPoints = internalReasoningResult.keyPoints.join(', ');
              instruction = `${instruction}\n\n[Ключевые моменты: ${keyPoints}]`;
            }
          }
        } catch (error) {
          // Игнорируем ошибки internal reasoning - не критично
          console.warn('[InternalReasoning] Ошибка:', error);
        }
      }

      // === ЭТАП 1: ПЛАНИРОВАНИЕ (Pre-flight check) ===
      // Используем PlanningService для первичного анализа и определения стратегии
      let planningThought: ThoughtProcess | null = null;
      try {
        progressCallback?.({
          type: 'reasoning_step',
          message: 'Анализирую запрос...',
          reasoning_text: 'Определяю оптимальную стратегию выполнения'
        });

        planningThought = await this.planningService.think(
          instruction,
          [],
          progressCallback
        );

        // Если планировщик определил, что нужен расчёт (например, мощности радиатора)
        if (planningThought.action?.toLowerCase().includes('расчёт') ||
          planningThought.action?.toLowerCase().includes('рассчитать')) {
          progressCallback?.({
            type: 'reasoning_step',
            message: 'Планирование: нужен предварительный расчёт',
            reasoning_text: planningThought.reasoning || ''
          });
        }

        // Добавляем результаты планирования к instruction для ReAct
        if (planningThought.reasoning && planningThought.confidence > 0.5) {
          instruction = `${instruction}\n\n[Предварительный анализ: ${planningThought.observation}. Стратегия: ${planningThought.action}]`;

          // Gap D: Explicit plan preview for multi-step tasks
          try {
            const minimalPlan: ExecutionPlan = {
              goal: planningThought.action || planningThought.observation,
              thoughts: [planningThought],
              steps: [],
              adaptations: [],
              learnings: {}
            };
            const planPreview = this.planningService.createUserVisiblePlan(minimalPlan);
            if (planPreview && planPreview.steps.length > 1) {
              const stepsText = planPreview.steps
                .map((s, i) => `${i + 1}. ${s.description}${s.tools.length > 0 ? ` (${s.tools.join(', ')})` : ''}`)
                .join('\n');
              progressCallback?.({
                type: 'reasoning_step',
                message: `📋 План выполнения (${planPreview.steps.length} шагов)`,
                reasoning_text: `${planPreview.goal}\n\n${stepsText}\n\nОжидаемое время: ${planPreview.estimatedTotalTime}s`
              });
            }
          } catch {
            // Plan preview is optional — don't break the flow
          }
        }
      } catch (planningError) {
        console.warn('[Planning] Ошибка планирования (продолжаем без него):', planningError);
      }

      progressCallback?.({
        type: 'reasoning_step',
        message: 'Выполняю план...',
        reasoning_text: internalReasoningResult
          ? `Использую встроенное reasoning модели через function calling (внутренний анализ завершен, уверенность: ${(internalReasoningResult.confidence * 100).toFixed(0)}%)`
          : 'Использую встроенное reasoning модели через function calling'
      });

      // Gap F: Multi-agent decomposition for complex tasks
      try {
        const toolNames = this.getToolsSpecification().map(t => t.function?.name).filter(Boolean) as string[];
        const decomposition = this.agentOrchestrator.decompose(instruction);
        if (decomposition.subTasks.length > 3) {
          // Complex task — enrich instruction with structured decomposition
          const subtaskList = decomposition.subTasks
            .map((st, i) => `${i + 1}. [${st.specialist}] ${st.description}`)
            .join('\n');
          instruction = `${instruction}\n\n[Декомпозиция задачи (${decomposition.subTasks.length} подзадач, стратегия: ${decomposition.strategy}):\n${subtaskList}]`;

          progressCallback?.({
            type: 'reasoning_step',
            message: `🔀 Декомпозиция: ${decomposition.subTasks.length} подзадач (${decomposition.strategy})`,
            reasoning_text: subtaskList
          });
        }
      } catch {
        // Orchestrator decomposition is optional
      }

      // ReAct анализ - модель сама думает, выбирает инструменты и выполняет их
      // Передаем метаданные skills для включения в system prompt
      const hasImageAttachments = !!attachments?.some(att => att.type === 'image' && att.dataUrl);
      const originalModel = this.config.defaultModel;
      if (hasImageAttachments) {
        progressCallback?.({
          type: 'reasoning_step',
          message: 'Использую модель для изображений',
          reasoning_text: 'Переключаюсь на google/gemini-2.5-flash-lite для анализа изображений'
        });
        this.config.defaultModel = 'google/gemini-2.5-flash-lite';
      }

      let result: { result: any; messages: ChatMessage[] };
      const originalInstruction = instruction; // Сохраняем оригинальный вопрос для валидации
      try {
        result = await this.reactService.reactAnalyze(
          instruction,
          chatHistory,
          progressCallback,
          relevantSkillsMetadata,
          attachments
        );
      } finally {
        if (hasImageAttachments) {
          this.config.defaultModel = originalModel;
        }
      }

      // === ЭТАП 3: ВАЛИДАЦИЯ ОТВЕТА (Post-flight check) ===
      // Проверяем, что ответ действительно отвечает на вопрос пользователя
      try {
        const toolResults = result.result?.toolResults || [];
        const validation = await this.answerValidationService.validateAnswer(
          originalInstruction,
          result.messages,
          toolResults,
          progressCallback
        );

        if (!validation.isComplete) {
          progressCallback?.({
            type: 'reasoning_step',
            message: 'Валидация: ответ неполный',
            reasoning_text: `${validation.explanation}. Рекомендация: ${validation.suggestedAction}`
          });

          // Если есть предложение для retry с более широким запросом
          if (validation.suggestedAction === 'retry_broader' && validation.retryQuery) {
            progressCallback?.({
              type: 'reasoning_step',
              message: `Повторный поиск: "${validation.retryQuery}"`,
              reasoning_text: 'Пробую более широкий запрос'
            });

            // Выполняем повторный поиск с более широким запросом
            const retryResult = await this.reactService.reactAnalyze(
              `${originalInstruction}\n\n[ВАЖНО: Предыдущий поиск вернул 0 результатов. Попробуй более широкий поиск: "${validation.retryQuery}". Если опять 0 — предложи альтернативы или уточняющие вопросы.]`,
              chatHistory,
              progressCallback,
              relevantSkillsMetadata,
              attachments
            );
            result = retryResult;
          } else if (validation.suggestedAction === 'calculate_first') {
            // Добавляем сообщение о необходимости расчёта
            const calcMessage: ChatMessage = {
              role: 'assistant',
              content: `⚠️ **Требуется уточнение**\n\n${validation.explanation}\n\nДля точного подбора оборудования мне нужно рассчитать требуемую мощность. Пожалуйста, уточните параметры помещения.`,
              timestamp: new Date()
            };
            result.messages.push(calcMessage);
          }
        }
      } catch (validationError) {
        console.warn('[Validation] Ошибка валидации (игнорируем):', validationError);
      }

      // Логируем финальный ответ и завершаем сессию
      if (result.messages && result.messages.length > 0) {
        const finalMessage = result.messages[result.messages.length - 1];
        if (finalMessage.content) {
          agentDebugService.logFinalResponse(finalMessage.content, this.metricsService.getMetrics());
        }
      }
      agentDebugService.endSession(this.metricsService.getMetrics());

      // Gap #8: Quality evaluation — оценка качества ответа
      try {
        const { ResponseQualityEvaluator } = await import('../services/agents/responseQualityEvaluator');
        const evaluator = new ResponseQualityEvaluator();
        const finalContent = result.messages?.[result.messages.length - 1]?.content || '';
        const toolResults = (result.result?.toolResults || []).map((tr: any) => ({
          tool: tr.tool || tr.name || 'unknown',
          success: tr.success !== false,
          latencyMs: tr.latencyMs || tr.duration || 0
        }));
        const qualityReport = evaluator.evaluate({
          userQuery: originalInstruction,
          agentResponse: finalContent,
          executedTools: toolResults.map((tr: any) => tr.tool),
          toolResults,
          metrics: this.metricsService.getMetrics(),
          reactCycles: result.result?.iterations || 1,
        });
        console.log(evaluator.formatLogLine(qualityReport, originalInstruction));
      } catch (qualityError) {
        // Non-critical — не блокируем ответ
      }

      // Gap A: Auto-extract and save persistent memories from this conversation
      try {
        const allMessages = [...chatHistory, ...result.messages];
        await this.persistentMemoryService.autoExtractMemories(allMessages, sessionId);
      } catch (memError) {
        console.warn('[PersistentMemory] Save error (non-critical):', memError);
      }

      // Завершаем span и логируем конец сессии
      rootSpan?.complete();
      this.observabilityService?.logEvent({
        type: 'session_end',
        sessionId,
        data: {
          messagesCount: result.messages?.length || 0,
          metrics: this.metricsService.getMetrics()
        },
        level: 'info'
      });

      return result;

    } catch (error: any) {
      // Завершаем span с ошибкой
      if (rootSpan) {
        this.observabilityService?.endSpanWithError(rootSpan.id, error);
      }

      // Логируем критическую ошибку
      agentDebugService.logError(`Critical analysis error: ${error.message}`, { instruction, error: error.stack });

      // Логируем ошибку в observability
      this.observabilityService?.logEvent({
        type: 'error',
        sessionId,
        data: {
          error: {
            message: error.message,
            stack: error.stack,
            name: error.name
          },
          instruction
        },
        level: 'error'
      });

      // Умная обработка ошибок
      const errorAnalysis = await this.reflectionService.analyzeFailure(error, instruction);

      messages.push({
        role: 'assistant',
        content: errorAnalysis.userMessage,
        timestamp: new Date()
      });

      // Пытаемся восстановиться
      if (errorAnalysis.recoveryPlan) {
        const recoveryResult = await this.attemptRecovery(
          errorAnalysis.recoveryPlan,
          progressCallback
        );

        if (recoveryResult.success) {
          messages.push({
            role: 'assistant',
            content: recoveryResult.message,
            timestamp: new Date()
          });
        }
      }

      // Завершаем сессию с ошибкой
      agentDebugService.endSession(this.metricsService.getMetrics());

      throw error;
    }
  }

  /**
   * Определяем, запросил ли пользователь создание файла (Excel/PDF/Word)
   */
  private detectPendingFileRequest(instruction: string): DataProcessingContext['pendingFileRequest'] | undefined {
    const normalized = instruction.toLowerCase();
    const patterns: Array<{ type: 'excel' | 'pdf' | 'word'; regex: RegExp }> = [
      { type: 'excel', regex: /(excel|эксел|эксель|xlsx|ксел)/i },
      { type: 'pdf', regex: /\bpdf\b|пдф|п\.д\.ф/i },
      { type: 'word', regex: /\bword\b|ворд|docx?/i }
    ];

    const matched = patterns.find((pattern) => pattern.regex.test(normalized));
    if (!matched) {
      return undefined;
    }

    return {
      type: matched.type,
      requestedAt: Date.now()
    };
  }


  // Возвращает список доступных инструментов (имя + описание) с учетом фильтрации
  private listAvailableTools(): Array<{ name: string; description?: string }> {
    const specs = this.getToolsSpecification();
    const seen = new Set<string>();
    const list: Array<{ name: string; description?: string }> = [];
    for (const spec of specs) {
      const name = spec?.function?.name;
      if (typeof name === 'string' && name && !seen.has(name)) {
        seen.add(name);
        list.push({ name, description: spec?.function?.description });
      }
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Метод reactAnalyze перенесен в ReActService

  // Метод think перенесен в PlanningService - используем planningService.think

  // Метод createDynamicPlan перенесен в PlanningService - используем planningService.createDynamicPlan

  // Методы executeAdaptivePlan и executeStepWithIntelligence перенесены в ExecutionService

  private isNonInformativeResult(result: any): boolean {
    if (!result) return true;
    if (typeof result === 'string') {
      const lower = result.toLowerCase();
      return lower.includes('async pending') ||
        lower.includes('обработка') && lower.includes('ожидание') ||
        lower.trim() === '';
    }
    if (typeof result === 'object') {
      return result.status === 'pending' ||
        result.async === true ||
        (result.success === false && !result.error);
    }
    return false;
  }

  // Методы validateToolResult, tryAlternativeExecution, parseScreenDataFromDOM перенесены в ExecutionService

  // Метод executeToolIntelligently перенесен в ToolExecutionService

  protected async handleToolCall(
    name: string,
    args: any,
    progressCallback?: (event: ProgressEvent) => void
  ): Promise<any> {
    const context: Record<string, any> = this.getContext?.() || {};
    // Валидация выбора инструментов
    if (name === 'search_ui') {
      // Предупреждаем об использовании search_ui и предлагаем альтернативу
      const warning = `⚠️ ВНИМАНИЕ: Инструмент search_ui может не работать. 
Для тестирования поиска категорий используй test_category_search вместо этого.
Если нужна навигация к тестированию, используй navigate_to_tab('testing').`;

      progressCallback?.({
        type: 'reasoning_step',
        message: 'Предупреждение: использование search_ui',
        reasoning_text: warning
      });

      // Если есть categorySlug в контексте или args, предлагаем использовать test_category_search
      const categorySlug = args.categorySlug || context.categorySlug;
      if (categorySlug && args.query) {
        const suggestion = `Рекомендую использовать test_category_search вместо search_ui:
- test_category_search(query="${args.query}", categorySlug="${categorySlug}")`;

        progressCallback?.({
          type: 'reasoning_step',
          message: 'Альтернатива для search_ui',
          reasoning_text: suggestion
        });
      }
    }

    // Gap G: Route browser tools to BrowserService
    const BROWSER_TOOLS = ['browser_navigate', 'browser_screenshot', 'browser_extract'];
    if (BROWSER_TOOLS.includes(name)) {
      try {
        const actionType = name.replace('browser_', '') as 'navigate' | 'screenshot' | 'extract';
        const cmd = this.browserService.generatePlaywrightCommand({
          type: actionType,
          params: args
        });
        // Execute via bash_tool in Docker sandbox
        const bashResult = await this.toolExecutionService.executeToolIntelligently(
          'bash_tool', { command: cmd }, context
        );
        return this.browserService.parseResult(
          typeof bashResult === 'string' ? bashResult : JSON.stringify(bashResult)
        );
      } catch (browserError: any) {
        return { error: `Browser error: ${browserError.message}` };
      }
    }

    // Gap B: Route MCP tools to MCPClientService
    if (this.mcpClientService.isMCPTool(name)) {
      try {
        return await this.mcpClientService.executeMCPTool(name, args);
      } catch (mcpError: any) {
        console.error(`[MCP] Tool ${name} failed:`, mcpError.message);
        const originalName = name.replace(/^mcp_[^_]+_/, '');
        const isMutation = /^(create|update|delete|upsert|write|apply|set)_/.test(originalName);
        if (isMutation) {
          throw new Error(`Fail-closed: мутационный MCP tool отклонен: ${mcpError.message}`);
        }
        return { error: `MCP tool error: ${mcpError.message}` };
      }
    }

    // ── Page Bridge Tools: route to HostBridgeService ──
    if (PAGE_TOOL_NAMES.has(name)) {
      try {
        const bridge = HostBridgeService.getInstance();
        switch (name) {
          case 'page_observe':
            return await bridge.observe();
          case 'page_read':
            return await bridge.read(args.target || '');
          case 'page_interact':
            return await bridge.interact(args.action || 'click', args.target || '');
          default:
            return { error: `Unknown page tool: ${name}` };
        }
      } catch (bridgeError: any) {
        return { error: `Page bridge error: ${bridgeError.message}` };
      }
    }

    // Выполняем инструмент через ToolExecutionService
    const toolResult = await this.toolExecutionService.executeToolIntelligently(name, args, context);

    // Gap E: Auto-run tests after code-modification tools with explicit retry loop
    const CODE_MUTATION_TOOLS = ['create_file', 'str_replace', 'save_tool', 'bash_tool'];
    if (CODE_MUTATION_TOOLS.includes(name) && toolResult && !toolResult.error) {
      try {
        const framework = this.testRunnerService.detectTestFramework();
        if (framework !== 'unknown') {
          const testCmd = this.testRunnerService.getTestCommand(framework);
          // Run tests via bash_tool in Docker sandbox
          const testOutput = await this.toolExecutionService.executeToolIntelligently(
            'bash_tool', { command: testCmd }, context
          );
          const rawOutput = typeof testOutput === 'string' ? testOutput
            : testOutput?.stdout || testOutput?.output || JSON.stringify(testOutput);
          const testResult = this.testRunnerService.parseTestResults(rawOutput, framework);

          if (!testResult.success && testResult.failures.length > 0) {
            const failSummary = testResult.failures.slice(0, 3)
              .map(f => `• ${f.testName}: ${f.message}`)
              .join('\n');

            // Explicit retry: if we can auto-correct, inject correction instructions
            if (this.testRunnerService.canAutoCorrect()) {
              this.testRunnerService.recordCorrectionAttempt();
              const correctionContext = this.testRunnerService.formatFailuresForCorrection(testResult);
              toolResult._testFailures = {
                framework,
                total: testResult.total,
                passed: testResult.passed,
                failed: testResult.failed,
                summary: failSummary,
                correctionInstructions: correctionContext,
                retryBudgetRemaining: 2 - (testResult.failed > 0 ? 1 : 0)
              };
              console.log(`[TestRunner] ${testResult.failures.length} test(s) failed after ${name} — auto-correction attempt`);
            } else {
              toolResult._testFailures = {
                framework,
                total: testResult.total,
                passed: testResult.passed,
                failed: testResult.failed,
                summary: failSummary,
                retryBudgetExhausted: true
              };
              console.log(`[TestRunner] ${testResult.failures.length} test(s) failed — retry budget exhausted`);
            }
          } else if (testResult.success) {
            // Reset correction counter on success
            this.testRunnerService.resetCorrections();
          }
        }
      } catch {
        // Test runner is optional — don't break tool execution
      }
    }

    return toolResult;
  }

  // Все handle* методы перенесены в ToolHandlersService и вызываются через ToolExecutionService

  // === Вспомогательные методы ===

  // Методы analyzeAvailableContext и analyzeContext перенесены в ContextAnalyzerService
  // Методы validateAndEnhancePlan, topologicalSort, areDependenciesReady перенесены в PlanningService

  // Методы prepareArgsWithContext, getValueByPath, analyzeToolResult перенесены в ExecutionService

  // Метод safeAppAction используется через inline функции в конструкторе, не нужен как отдельный метод

  // Нормализация аргументов: snake_case -> camelCase, алиасы
  private normalizeArgs(args: any, aliases: Record<string, string> = {}): any {
    const out: any = {};
    for (const [k, v] of Object.entries(args || {})) {
      const camel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      out[aliases[k] || aliases[camel] || camel] = v;
    }
    return out;
  }

  // Методы estimateComplexity, createMicroPlan, reflectOnExecution, generateInsightfulReport, formatThoughts не используются - удалены

  // Методы tryAlternativeApproaches, adaptPlan, isErrorCritical перенесены в PlanAdaptationService

  // Метод universalFinalReflection перенесен в ReflectionService

  // Методы генерации ответов перенесены в ResponseGeneratorService
  // Методы рефлексии перенесены в ReflectionService

  // Метод analyzeFailure перенесен в ReflectionService

  private async attemptRecovery(recoveryPlan: string, progressCallback?: (event: ProgressEvent) => void): Promise<any> {
    progressCallback?.({
      type: 'reasoning_step',
      message: 'Пытаюсь восстановиться...',
      reasoning_text: recoveryPlan
    });

    try {
      // Классифицируем ошибку и пробуем восстановление через ErrorRecoveryService
      const recoveryResult = await this.errorRecoveryService.attemptErrorRecovery({
        error: new Error(recoveryPlan),
        context: 'smart-ai-agent-recovery'
      });

      if (recoveryResult.success && recoveryResult.result) {
        progressCallback?.({
          type: 'reasoning_step',
          message: `Восстановление успешно (стратегия: ${recoveryResult.strategy})`,
          reasoning_text: JSON.stringify(recoveryResult.result)
        });

        return {
          success: true,
          message: `Восстановление выполнено: ${recoveryResult.result.recoveryPlan || recoveryResult.strategy}`
        };
      }

      return {
        success: false,
        message: `Стратегия ${recoveryResult.strategy || 'unknown'}: восстановление не удалось`
      };
    } catch (error: any) {
      console.error('[SmartAIAgent] attemptRecovery failed:', error.message);
      return {
        success: false,
        message: `Ошибка восстановления: ${error.message}`
      };
    }
  }


  // === Системные промпты ===

  private getThinkingSystemPrompt(): string {
    return SystemPrompts.getThinkingSystemPrompt();
  }

  private getPlanningSystemPrompt(): string {
    return SystemPrompts.getPlanningSystemPrompt();
  }

  // === 3-Tier Tool Architecture ===
  // Tier 1: Universal tools (always loaded, project-agnostic)
  // Tier 2: TrustChain tools (Ed25519, audit — always loaded)
  // Tier 3: Platform tools (from MCP — dynamically discovered, always trusted)
  getToolsSpecification(): any[] {
    // User-managed tool toggles from localStorage
    let enabledTools: Set<string> | null = null;
    let lockedToolIds: Set<string> = getLockedToolIds();
    try {
      const savedTools = localStorage.getItem('agent_enabled_tools');
      if (savedTools) {
        enabledTools = new Set(JSON.parse(savedTools));
        for (const id of lockedToolIds) enabledTools.add(id);
      }
    } catch (e) {
      console.warn('Failed to load enabled tools list');
    }

    const isToolEnabled = (toolId: string): boolean => {
      if (!enabledTools) return true;
      if (lockedToolIds.has(toolId)) return true;
      return enabledTools.has(toolId);
    };

    // Tier 1: Base tools from AIAgent (create_artifact, etc.)
    const baseTools = super.getToolsSpecification();
    // Tier 1: Universal tools (code exec, web, files, browser, code analysis)
    const universalTools = getAllSmartAgentTools();
    // Tier 3: Platform tools from MCP (dynamically discovered, always trusted)
    const mcpTools = this.mcpClientService.convertToOpenAITools();
    // Tier 4: App actions registered via postMessage (client-side tools)
    const appActionTools = appActionsRegistry.getToolDefinitions();

    const allTools = [
      ...baseTools,
      ...universalTools,
      ...mcpTools,
      ...pageTools,  // Tier 1: Universal page interaction tools (always loaded)
      ...appActionTools, // Tier 4: Dynamic app actions from host
    ];

    console.log('[SmartAIAgent] 4-Tier Tools:', {
      baseCount: baseTools.length,
      universalCount: universalTools.length,
      mcpCount: mcpTools.length,
      appActionCount: appActionTools.length,
      totalCount: allTools.length,
    });

    // Deduplicate by name (first occurrence wins)
    const seen = new Set<string>();
    const deduped = allTools.filter(t => {
      const name = t.function?.name;
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    });

    // Filter: universal tools through whitelist, MCP tools always pass
    const curated = deduped.filter(t => {
      const name = t.function?.name;
      if (!name) return false;
      // MCP tools are trusted — they were discovered from project's MCP Server
      if (name.startsWith('mcp_')) return true;
      // Page tools are always allowed (universal frontend bridge)
      if (PAGE_TOOL_NAMES.has(name)) return true;
      // Universal tools checked against whitelist
      return UNIVERSAL_TOOLS.has(name);
    });

    // Remove web_search/web_fetch if model has native grounding
    const supportsNativeSearch = this.checkModelSupportsNativeWebSearch();
    const filtered = supportsNativeSearch
      ? curated.filter(t => {
        const n = t.function?.name;
        return n !== 'web_search' && n !== 'web_fetch';
      })
      : curated;

    // Apply user-managed toggles
    const finalTools = filtered.filter(t => {
      const name = t.function?.name;
      return name ? isToolEnabled(name) : true;
    });

    console.log('[SmartAIAgent] Final tools:', {
      count: finalTools.length,
      names: finalTools.map(t => t.function?.name).filter(Boolean),
    });

    return finalTools;
  }


  // Режим агента для выбора специализированного промпта
  private agentProfileMode: 'general' | 'search_expert' | 'diagnostic' = 'general';

  /**
   * Установить режим агента (специализацию)
   */
  setAgentProfileMode(mode: 'general' | 'search_expert' | 'diagnostic'): void {
    this.agentProfileMode = mode;
    console.log(`[SmartAIAgent] Agent profile mode set to: ${mode}`);
  }

  /**
   * Получить текущий режим агента
   */
  getAgentProfileMode(): 'general' | 'search_expert' | 'diagnostic' {
    return this.agentProfileMode;
  }

  /**
   * Проверяет, поддерживает ли текущая модель нативный web search через OpenRouter
   * Если да - web_search/web_fetch tools будут убраны, модель ищет сама через :online suffix
   */
  private checkModelSupportsNativeWebSearch(): boolean {
    const currentModel = this.config.defaultModel;

    // OpenRouter поддерживает :online для всех основных провайдеров
    const nativeSearchProviders = ['openai/', 'google/', 'anthropic/'];
    const supportsNativeSearch = nativeSearchProviders.some(provider => currentModel.startsWith(provider));

    if (supportsNativeSearch) {
      console.log(`[SmartAIAgent] Model ${currentModel} supports native web search via :online`);
    }

    return supportsNativeSearch;
  }

  override async getSystemPrompt(relevantSkillsMetadata?: any[]): Promise<string> {
    // Загружаем базовый промпт с guidelines из родительского класса
    const basePrompt = await super.getSystemPrompt();

    // Если режим поискового эксперта — используем тот же универсальный промпт,
    // специфика поиска приходит через MCP tools и context prompt.
    if (this.agentProfileMode === 'search_expert') {
      console.log('[SmartAIAgent] Using SEARCH EXPERT system prompt (universal)');
      return SystemPrompts.getSmartAgentSystemPrompt('', basePrompt);
    }

    // Формируем секцию с релевантными skills
    let skillsSection: string = '';
    if (relevantSkillsMetadata && relevantSkillsMetadata.length > 0) {
      skillsSection = `\n# РЕЛЕВАНТНЫЕ SKILLS ДЛЯ ЭТОГО ЗАПРОСА\n\n`;
      skillsSection += `Ниже перечислены skills, которые могут быть полезны для выполнения текущего запроса.\n`;
      skillsSection += `**ОБЯЗАТЕЛЬНО прочитай полное содержимое релевантных skills через view инструмент (БЕЗ view_range!)**\n\n`;

      // КРИТИЧНО: Автоматически загружаем полный контент для top-1 skill
      // Это гарантирует, что агент получает полные инструкции самого релевантного skill
      const topSkill = relevantSkillsMetadata[0];
      let fullSkillContent: string | null = null;

      if (topSkill?.containerPath) {
        try {
          fullSkillContent = await SkillsLoaderService.loadFullSkillContent(topSkill.containerPath);
          if (fullSkillContent) {
            skillsSection += `## 📖 ПОЛНОЕ СОДЕРЖИМОЕ НАИБОЛЕЕ РЕЛЕВАНТНОГО SKILL\n\n`;
            skillsSection += `### ${String(topSkill.name || 'Unknown Skill')}\n\n`;
            skillsSection += `\`\`\`markdown\n${fullSkillContent}\n\`\`\`\n\n`;
            skillsSection += `---\n\n`;
          }
        } catch (error) {
          console.warn(`[SmartAIAgent] Не удалось загрузить полный skill ${topSkill.containerPath}:`, error);
        }
      }

      // Список остальных skills (краткие метаданные)
      if (relevantSkillsMetadata.length > 1 || !fullSkillContent) {
        skillsSection += `## Другие релевантные skills:\n\n`;

        // Если первый skill уже загружен полностью, начинаем со второго
        const startIndex = fullSkillContent ? 1 : 0;

        for (let i = startIndex; i < relevantSkillsMetadata.length; i++) {
          const skill = relevantSkillsMetadata[i];
          // Безопасная обработка данных skill
          const skillName = String(skill?.name || '');
          const skillPath = String(skill?.containerPath || '');
          const skillDescription = String(skill?.description || '');

          skillsSection += `<skill name="${skillName}" path="${skillPath}">\n`;
          skillsSection += `  <description>${skillDescription}</description>\n`;
          if (skill?.category) {
            const category = String(skill.category);
            const subcategory = skill.subcategory ? String(skill.subcategory) : '';
            skillsSection += `  <category>${category}${subcategory ? `/${subcategory}` : ''}</category>\n`;
          }
          skillsSection += `</skill>\n\n`;
        }
      }

      skillsSection += `**ВАЖНО:**\n`;
      skillsSection += `- Используй view инструмент для чтения полного содержимого ДРУГИХ релевантных skills\n`;
      skillsSection += `- НЕ используй view_range - читай весь файл целиком\n`;
      skillsSection += `- Skills содержат важные инструкции и примеры использования инструментов\n`;
      skillsSection += `- После чтения skill используй информацию для выполнения запроса\n\n`;
    }

    // Убеждаемся что skillsSection - это строка
    const safeSkillsSection: string = String(skillsSection || '');

    // Добавляем информацию о native web search для моделей с grounding
    let nativeSearchSection = '';
    if (this.checkModelSupportsNativeWebSearch()) {
      nativeSearchSection = `
# 🌐 NATIVE WEB SEARCH (GROUNDING)

**ВАЖНО:** Ты подключен к интернету через native web search (grounding).
Когда пользователь просит найти информацию в интернете:
- **НЕ используй никакие инструменты** для веб-поиска
- **Просто отвечай напрямую** - ты автоматически получаешь доступ к актуальной информации
- **Включай источники** в свой ответ, цитируя откуда информация

Примеры запросов с native search:
- "кто такой [имя]" → Просто отвечай с информацией из интернета
- "какие новости сегодня" → Просто отвечай с актуальными новостями
- "найди информацию про X" → Просто отвечай с результатами поиска

`;
    }

    try {
      // Gap #4: Динамическая сборка промпта — включает только релевантные секции
      const userQuery = this.context?.lastInstruction || '';
      const baseSystemPrompt = userQuery
        ? SystemPrompts.getSmartAgentSystemPromptDynamic(safeSkillsSection, basePrompt, userQuery)
        : SystemPrompts.getSmartAgentSystemPrompt(safeSkillsSection, basePrompt);
      return nativeSearchSection + baseSystemPrompt;
    } catch (error) {
      console.error('Ошибка формирования системного промпта SmartAIAgent:', {
        message: (error as Error).message,
        stack: (error as Error).stack,
        relevantSkillsCount: relevantSkillsMetadata?.length
      });
      // Фоллбек: возвращаем базовый промпт без секции skills, чтобы не блокировать работу агента
      const fallbackPrompt = `${nativeSearchSection}${basePrompt}

# ⚠️ Skills metadata недоступно
Не удалось сформировать раздел с релевантными skills. Продолжай работу, используя доступные инструменты и общие инструкции.`;
      return fallbackPrompt;
    }
  }

  // === Методы для доступа к состоянию ===

  getExecutionPlan(): ExecutionPlan | undefined {
    return this.executionPlan;
  }

  getThoughtHistory(): ThoughtProcess[] {
    return this.planningService.getThoughtHistory();
  }

  clearCache(): void {
    this.toolExecutionCache.clear();
  }

  getExecutionStats() {
    return this.metricsService.getExecutionStats();
  }

  logExecutionSummary() {
    const s = this.getExecutionStats();
    console.group('🤖 Agent Execution Summary');
    console.log(`⏱️  Total time: ${s.endTime - s.startTime}ms`);
    console.log(`🔧 Tool calls: ${s.toolCalls}`);
    console.log(`✅ Successful steps: ${s.successfulSteps}`);
    console.log(`❌ Failed steps: ${s.failedSteps}`);
    console.log(`🔄 Retries: ${s.retryCount}`);
    console.log(`📊 Success rate: ${s.overallSuccessRate}%`);
    console.log(`💾 Cache hit rate: ${s.cacheHitRatePercent}%`);
    console.log(`✔️  Validation success: ${s.validationSuccessRate}%`);
    if (s.slowestTool) console.log(`🐌 Slowest tool: ${s.slowestTool}`);
    if (s.mostFailedTool) console.log(`⚠️  Most failed tool: ${s.mostFailedTool}`);
    if (s.asyncTimeouts > 0) console.warn(`⏰ Async timeouts: ${s.asyncTimeouts}`);
    if (s.fallbackUsages > 0) console.log(`🔄 Fallback usages: ${s.fallbackUsages}`);
    console.groupEnd();
  }

  /**
   * Получить дашборд observability для текущей сессии
   */
  getObservabilityDashboard(sessionId: string) {
    return this.observabilityService?.getDashboard(sessionId);
  }

  /**
   * Экспорт observability данных в JSON
   */
  exportObservabilityData(sessionId?: string): string | null {
    return this.observabilityService?.exportToJSON(sessionId) || null;
  }

  // === Методы для совместимости ===

  setAppActions(appActions: AppActions): void {
    this.appActions = appActions;
  }

  /**
   * Автоматическое сохранение логов в TXT файл
   */
  private saveLogToFile(content: string, filename: string): void {
    try {
      // Без автоскачивания — кладём в localStorage (коротко) и в консоль
      try {
        const key = `ai_log_${Date.now()}`;
        localStorage.setItem(key, content.slice(0, 50000));
      } catch { }
      console.debug(`[AI LOG:${filename}]`, content.slice(0, 2000));
    } catch (error) {
      console.error('Ошибка сохранения лога:', { message: (error as Error).message, stack: (error as Error).stack });
    }
  }
} 
