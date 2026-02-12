/**
 * Сервис для извлечения релевантного контекста из истории диалогов
 */

import type { ProgressEvent } from '../../agents/types';
import { chatHistoryService } from '../chatHistoryService';
import OpenAI from 'openai';

interface ConversationMemoryServiceDependencies {
  openai?: OpenAI;
  getApiParams?: (params: any) => any;
}

interface MemorySearchDecision {
  shouldSearchMemory: boolean;
  query: string;
  reason: string;
}

export class ConversationMemoryService {
  constructor(private deps: ConversationMemoryServiceDependencies = {}) {}

  async getConversationContext(
    instruction: string,
    progressCallback?: (event: ProgressEvent) => void
  ): Promise<string> {
    let conversationContext = '';

    try {
      const allSessions = chatHistoryService.getAllSessions();
      const currentSession = chatHistoryService.getCurrentSession();
      const currentSessionId = currentSession?.sessionId;

      const hasHistory = allSessions.some(s =>
        s.sessionId !== currentSessionId && s.messages.length > 0
      ) || (currentSession && currentSession.messages.length > 0);

      if (!hasHistory) {
        return '';
      }

      progressCallback?.({
        type: 'reasoning_step',
        message: 'Оцениваю, нужен ли контекст прошлых диалогов...',
        reasoning_text: 'Использую лёгкую LLM-проверку для принятия решения'
      });

      const decision = await this.decideMemorySearch(instruction);
      const shouldSearchMemory = decision.shouldSearchMemory;
      const keywords = this.extractSubstantiveKeywords(decision.query || instruction);

      if (shouldSearchMemory && keywords.length > 0) {
        progressCallback?.({
          type: 'reasoning_step',
          message: 'Ищу контекст в предыдущих диалогах...',
          reasoning_text: `Ключевые слова: ${keywords.join(', ')}. Причина: ${decision.reason || 'нет'}`
        });

        const relevantMessages = chatHistoryService.searchMessages(
          keywords.join(' ')
        );

        if (relevantMessages && relevantMessages.length > 0) {
          // searchMessages already excludes current session, so just filter by keywords
          const relevantFiltered = relevantMessages.filter(msg => {
            const msgLower = (msg.content || '').toLowerCase();
            return keywords.some(kw => msgLower.includes(kw.toLowerCase()));
          });

          if (relevantFiltered.length > 0) {
            const topMessages = relevantFiltered.slice(0, 3);
            const contextParts: string[] = [];
            contextParts.push('=== КОНТЕКСТ ИЗ ПРЕДЫДУЩИХ ДИАЛОГОВ ===');

            topMessages.forEach((msg, idx) => {
              const roleLabel = msg.role === 'user' ? 'Пользователь' : 'Ассистент';
              const timestamp = msg.timestamp ? new Date(msg.timestamp).toLocaleString('ru-RU') : 'неизвестно';
              contextParts.push(`\n[${idx + 1}] ${roleLabel} (${timestamp}):`);
              contextParts.push(msg.content || '');
            });

            conversationContext = contextParts.join('\n');

            progressCallback?.({
              type: 'reasoning_step',
              message: `Найдено ${topMessages.length} релевантных сообщений из предыдущих диалогов`,
              reasoning_text: `Триггеры: ${shouldSearchMemory}, Ключевые слова: ${keywords.join(', ')}`
            });
          }
        }
      } else {
        if (!shouldSearchMemory) {
          console.log('[ConversationMemory] Решение LLM: контекст прошлых диалогов не требуется');
        } else if (keywords.length === 0) {
          console.log('[ConversationMemory] No substantive keywords, skipping memory search');
        }
      }
    } catch (error) {
      console.warn('[ConversationMemory] Ошибка автоматического поиска:', error);
    }

    return conversationContext;
  }

  private async decideMemorySearch(instruction: string): Promise<MemorySearchDecision> {
    if (!this.deps.openai || !this.deps.getApiParams) {
      return this.fallbackDecision(instruction);
    }

    const prompt = `Определи, нужно ли подключать контекст прошлых диалогов для запроса.

Запрос пользователя:
"${instruction}"

Правила:
1) shouldSearchMemory=true ТОЛЬКО если есть явная ссылка на прошлый диалог/решение
   (например: "продолжи", "как мы обсуждали", "помнишь", "что ты предлагал").
2) Для новых самостоятельных запросов всегда shouldSearchMemory=false.
3) query должен содержать 2-4 ключевых слова для поиска по истории.
4) Верни только JSON.

Формат:
{
  "shouldSearchMemory": true/false,
  "query": "строка для поиска",
  "reason": "кратко почему"
}`;

    try {
      const response = await this.deps.openai.chat.completions.create(
        this.deps.getApiParams({
          model: 'google/gemini-2.5-flash-lite',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.0,
          maxTokens: 250,
          responseFormat: { type: 'json_object' }
        })
      );

      const raw = response.choices?.[0]?.message?.content || '{}';
      const parsed = JSON.parse(raw);
      const query = String(parsed.query || '').trim();

      return {
        shouldSearchMemory: Boolean(parsed.shouldSearchMemory),
        query: query || instruction,
        reason: String(parsed.reason || '').trim() || 'LLM-оценка',
      };
    } catch (error) {
      console.warn('[ConversationMemory] Ошибка LLM-оценки, применяю fallback:', error);
      return this.fallbackDecision(instruction);
    }
  }

  private fallbackDecision(instruction: string): MemorySearchDecision {
    const isExplicitReference =
      /\b(продолжи|обсуждали|помнишь|как\s+мы|что\s+мы|упоминал)\b/i.test(instruction);

    return {
      shouldSearchMemory: isExplicitReference,
      query: instruction,
      reason: isExplicitReference ? 'Резервное правило: явная ссылка на прошлый диалог' : 'Резервное правило: новый запрос'
    };
  }

  private extractSubstantiveKeywords(text: string): string[] {
    const normalized = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const stopWords = new Set([
      'обсуждали', 'говорил', 'сделай', 'создай', 'покажи', 'найди', 'помоги',
      'разговор', 'чат', 'вопрос', 'продолжи', 'помнишь', 'как', 'мы', 'что',
      'вчера', 'недавно', 'ранее', 'раньше', 'это', 'этот', 'оно', 'она', 'он',
      'предлагал', 'решили', 'сделали', 'создали', 'обсудили', 'упоминал',
      'тот', 'та', 'то', 'наш', 'мой'
    ]);

    const words = normalized
      .split(' ')
      .filter(w => w.length > 3)
      .filter(w => !stopWords.has(w));

    return words.slice(0, 3);
  }
}
