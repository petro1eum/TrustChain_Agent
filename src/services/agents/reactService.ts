/**
 * Сервис ReAct анализа (Reasoning + Acting)
 * Выделен из smart-ai-agent.ts для улучшения структуры кода
 * 
 * Версия 2.1: LLM-based intent classification (Gap #2)
 */

import type OpenAI from 'openai';
import type { ChatMessage, ProgressEvent, ChatAttachment } from '../../agents/types';
import { TaskIntentService, sharedIntentService, type TaskIntent } from './taskIntentService';
import { AnswerValidationService } from './answerValidationService';

export interface ReActServiceDependencies {
  getSystemPrompt: (relevantSkillsMetadata?: any[]) => Promise<string>;
  chatWithToolsLoop: (messages: any[], progressCallback?: (event: ProgressEvent) => void, sharedExecutedToolCalls?: Map<string, any>) => Promise<{ result: any; messages: ChatMessage[] }>;
  answerValidationService?: AnswerValidationService;
  openai?: OpenAI;
  getApiParams?: (params: any) => any;
}

export class ReActService {
  private deps: ReActServiceDependencies;
  private taskIntentService: TaskIntentService;

  // Maximum continuation attempts to prevent infinite loops
  private readonly MAX_CONTINUATION_ATTEMPTS = 3;

  constructor(deps: ReActServiceDependencies) {
    this.deps = deps;
    this.taskIntentService = sharedIntentService;
  }

  /**
   * ReAct анализ через function calling
   * Модель сама думает, выбирает инструменты и выполняет их
   * 
   * С версии 2.0: поддержка multi-step tasks с автоматическим продолжением
   */
  async reactAnalyze(
    instruction: string,
    chatHistory: ChatMessage[] = [],
    progressCallback?: (event: ProgressEvent) => void,
    relevantSkillsMetadata?: any[],
    attachments?: ChatAttachment[]
  ): Promise<{ result: any; messages: ChatMessage[] }> {
    // Gap #5: Приоритизированная обрезка контекста вместо тупого .slice(-20)
    const MAX_CONTEXT_MESSAGES = 20;
    const RECENT_KEEP = 5; // Последние N сообщений всегда сохраняем

    // Extract context-specific system prompts from chatHistory (injected by PanelApp)
    const contextSystemMessages = chatHistory
      .filter(m => m.role === 'system')
      .map(m => m.content || '');

    const allHistory = chatHistory
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.content || '' }));

    let recentHistory: Array<{ role: string; content: string }>;
    if (allHistory.length <= MAX_CONTEXT_MESSAGES) {
      recentHistory = allHistory;
    } else {
      // Всегда сохраняем первое сообщение (начальный контекст) и последние RECENT_KEEP
      const first = allHistory[0];
      const recent = allHistory.slice(-RECENT_KEEP);
      const middle = allHistory.slice(1, -RECENT_KEEP);
      // Из середины берём самые короткие (они обычно содержат ключевую суть)
      const middleBudget = MAX_CONTEXT_MESSAGES - 1 - RECENT_KEEP;
      const sortedMiddle = [...middle]
        .map((m, idx) => ({ ...m, _origIdx: idx }))
        .sort((a, b) => a.content.length - b.content.length)
        .slice(0, middleBudget)
        .sort((a, b) => a._origIdx - b._origIdx)
        .map(({ _origIdx, ...m }) => m);
      recentHistory = [first, ...sortedMiddle, ...recent];
    }

    // Анализируем intent до начала выполнения (LLM-based с regex fallback)
    const intentDeps = this.deps.openai && this.deps.getApiParams
      ? { openai: this.deps.openai, getApiParams: this.deps.getApiParams }
      : undefined;
    const intent = await this.taskIntentService.analyzeIntentAsync(instruction, intentDeps);

    if (intent.classifiedBy === 'llm') {
      console.log(`[ReActService] Intent classified by LLM: ${intent.steps.map(s => `${s.action}(${s.reasoning})`).join(' → ')}`);
    }

    if (intent.isMultiStep) {
      progressCallback?.({
        type: 'reasoning_step',
        message: `Обнаружена многошаговая задача (${intent.steps.length} шагов)`,
        reasoning_text: `Шаги: ${intent.steps.map(s => s.action).join(' → ')}`
      });
    }

    // Build system prompt: context-aware
    // When PanelApp injects a context-specific system message (e.g., ЛОМ risk management),
    // use it as the PRIMARY prompt — the default internal prompt is only a fallback.
    // This ensures the agent behaves according to its embedding context.
    let systemPrompt: string;
    if (contextSystemMessages.length > 0) {
      const contextBlock = contextSystemMessages.join('\n\n');
      // Use the context prompt as the base, with only lightweight agent capabilities appended
      const agentCapabilities = `

---

# AGENT CAPABILITIES

Ты — мульти-платформенный AI-ассистент TrustChain с криптографической подписью действий.

## ПРАВИЛА ВЫЗОВА ИНСТРУМЕНТОВ:
- Для работы с данными платформы используй function calling (tool_calls) — НЕ пиши код, НЕ генерируй print() или default_api.
- ВСЕГДА вызывай инструменты через встроенный механизм function calling, а не через текстовый ответ.
- Каждый вызов инструмента автоматически подписывается Ed25519 для аудита.
- **КРИТИЧЕСКИ ВАЖНО**: НИКОГДА не отвечай на вопросы о данных из истории диалогов или из памяти. ВСЕГДА вызывай соответствующий MCP-инструмент заново, даже если похожий вопрос уже задавался. Каждый ответ ДОЛЖЕН быть подкреплён свежим вызовом инструмента с криптографической подписью. Ответ без tool_call — это нарушение цепочки доверия TrustChain.

## КЛЮЧЕВЫЕ ПРИНЦИПЫ:
1. При ЛЮБОМ запросе данных — ОБЯЗАТЕЛЬНО вызывай MCP-инструмент через function call. Не используй данные из предыдущих сообщений.
2. Минимизируй количество шагов до цели
3. Отвечай на основе фактических результатов инструментов, не фантазируй
4. Формат ответа: markdown с конкретными цифрами и данными из результатов tools

Если пользователь спрашивает "что ты видишь" — используй describe_current_page или MCP-инструмент вида mcp_<server>_list_documents (если доступен).`;



      systemPrompt = `${contextBlock}${agentCapabilities}`;
    } else {
      // Standalone mode — use full internal system prompt (KB Catalog, etc.)
      systemPrompt = await this.deps.getSystemPrompt(relevantSkillsMetadata);
    }

    const userContent = this.buildUserContent(instruction, attachments);
    let messagesForLLM: any[] = [
      { role: 'system', content: systemPrompt },
      ...recentHistory,
      { role: 'user', content: userContent }
    ];


    progressCallback?.({
      type: 'reasoning_step',
      message: 'Выполняю запрос...',
      reasoning_text: ''
    });

    // Общий кэш dedup между ReAct-итерациями
    const sharedExecutedToolCalls = new Map<string, any>();

    // Первый проход
    let { result, messages } = await this.deps.chatWithToolsLoop(messagesForLLM, progressCallback, sharedExecutedToolCalls);

    // Если задача не multi-step или нет сервиса валидации — возвращаем как есть
    if (!intent.isMultiStep || !this.deps.answerValidationService) {
      return { result, messages };
    }

    // Multi-step completion loop
    let continuationAttempts = 0;
    while (continuationAttempts < this.MAX_CONTINUATION_ATTEMPTS) {
      // Собираем список выполненных инструментов из сообщений
      const executedTools = this.extractExecutedTools(messages);

      // Проверяем завершённость задачи
      const completion = this.deps.answerValidationService.validateTaskCompletion(
        intent,
        executedTools,
        messages.filter(m => m.role === 'tool_response')
      );

      // Логируем для TrustChain аудита
      console.log('[ReActService] Task Completion Audit:', JSON.stringify(completion.trustchainAudit, null, 2));

      // Guard: if no tools were executed at all, don't loop — the model chose not to call tools
      // (tool_choice: required should have forced it; if it still didn't, continuation won't help)
      if (executedTools.length === 0) {
        console.warn('[ReActService] No tools executed — skipping continuation loop');
        break;
      }

      // Guard: skip 'calculate' steps if compute tools already ran — prevents duplicate computation
      // But allow 'create' steps to re-trigger for artifact refinement
      const computeToolsList = ['bash_tool', 'execute_code', 'execute_bash'];
      const computeAlreadyDone = executedTools.some(t => computeToolsList.includes(t));
      if (computeAlreadyDone) {
        completion.missingSteps = completion.missingSteps.filter(
          step => step.action !== 'calculate'
        );
        if (completion.missingSteps.length === 0) {
          completion.isComplete = true;
        }
      }

      if (completion.isComplete) {
        progressCallback?.({
          type: 'reasoning_step',
          message: `Все шаги выполнены ✓`,
          reasoning_text: `Завершено: ${completion.completedSteps.map(s => s.action).join(', ')}`
        });
        break;
      }

      // Есть невыполненные шаги — продолжаем
      const pendingStep = completion.missingSteps[0];
      const lastToolResult = this.getLastToolResult(messages);

      progressCallback?.({
        type: 'reasoning_step',
        message: `Продолжаю: ${pendingStep.action}`,
        reasoning_text: `Следующий шаг: использовать ${completion.suggestedNextTool}`
      });

      // Генерируем hint-сообщение для модели
      const continuationPrompt = this.taskIntentService.generateContinuationPrompt(pendingStep, lastToolResult);

      // Добавляем hint к сообщениям для следующего прохода
      messagesForLLM = [
        ...messagesForLLM,
        ...messages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: continuationPrompt }
      ];

      // Повторный вызов chatWithToolsLoop — переиспользуем dedup кэш
      const dedupSizeBefore = sharedExecutedToolCalls.size;
      const continuation = await this.deps.chatWithToolsLoop(messagesForLLM, progressCallback, sharedExecutedToolCalls);

      // Объединяем результаты
      messages = [...messages, ...continuation.messages];
      result = continuation.result;

      continuationAttempts++;

      // If no NEW tool calls happened (all were dedup'd), stop looping.
      // The model is just repeating itself and won't produce new data.
      const newToolCalls = this.extractExecutedTools(continuation.messages);
      const dedupSizeAfter = sharedExecutedToolCalls.size;
      if (newToolCalls.length === 0 || dedupSizeAfter === dedupSizeBefore) {
        console.log('[ReActService] No new tool calls in continuation — stopping loop');
        break;
      }
    }

    if (continuationAttempts >= this.MAX_CONTINUATION_ATTEMPTS) {
      console.warn('[ReActService] Reached max continuation attempts for multi-step task');
    }

    return { result, messages };
  }

  /**
   * Извлекает список выполненных инструментов из сообщений
   */
  private extractExecutedTools(messages: ChatMessage[]): string[] {
    const tools: string[] = [];

    for (const msg of messages) {
      // Из tool_call сообщений
      if ((msg as any).tool_calls) {
        for (const tc of (msg as any).tool_calls) {
          if (tc.function?.name) {
            tools.push(tc.function.name);
          }
        }
      }
      // Из tool response сообщений
      if (msg.role === 'tool_response' && (msg as any).name) {
        tools.push((msg as any).name);
      }
    }

    return [...new Set(tools)]; // Unique tools
  }

  /**
   * Получает результат последнего инструмента
   */
  private getLastToolResult(messages: ChatMessage[]): any {
    const toolMessages = messages.filter(m => m.role === 'tool_response');
    if (toolMessages.length === 0) return null;

    const lastTool = toolMessages[toolMessages.length - 1];
    try {
      return JSON.parse((lastTool as any).content || '{}');
    } catch {
      return { raw: (lastTool as any).content };
    }
  }

  private buildUserContent(instruction: string, attachments?: ChatAttachment[]): any {
    if (!attachments || attachments.length === 0) {
      return instruction;
    }

    const contentParts: any[] = [];
    if (instruction.trim()) {
      contentParts.push({ type: 'text', text: instruction });
    } else {
      contentParts.push({ type: 'text', text: 'Проанализируй изображение.' });
    }

    for (const attachment of attachments) {
      if (attachment.type === 'image' && attachment.dataUrl) {
        contentParts.push({
          type: 'image_url',
          image_url: { url: attachment.dataUrl }
        });
      }
    }

    return contentParts;
  }
}

