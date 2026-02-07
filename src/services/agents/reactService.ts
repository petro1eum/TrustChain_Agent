/**
 * Сервис ReAct анализа (Reasoning + Acting)
 * Выделен из smart-ai-agent.ts для улучшения структуры кода
 * 
 * Версия 2.1: LLM-based intent classification (Gap #2)
 */

import type OpenAI from 'openai';
import type { ChatMessage, ProgressEvent, ChatAttachment } from '../../agents/types';
import { TaskIntentService, type TaskIntent } from './taskIntentService';
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
    this.taskIntentService = new TaskIntentService();
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

    const systemPrompt = await this.deps.getSystemPrompt(relevantSkillsMetadata);
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
      const continuation = await this.deps.chatWithToolsLoop(messagesForLLM, progressCallback, sharedExecutedToolCalls);

      // Объединяем результаты
      messages = [...messages, ...continuation.messages];
      result = continuation.result;

      continuationAttempts++;
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

