/**
 * Сервис для извлечения релевантного контекста из истории диалогов
 */

import type { ProgressEvent } from '../../agents/types';
import { chatHistoryService } from '../chatHistoryService';

export class ConversationMemoryService {
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

      const hasExplicitReference = /продолжи|обсуждали|говорил|помнишь|тот|та|то|наш|мой|как.*мы|что.*мы/i.test(instruction);
      const hasPastTense = /предлагал|решили|сделали|создали|обсудили|упоминал|говорил/i.test(instruction);
      const hasTemporalRef = /вчера|прошл|недавно|ранее|раньше/i.test(instruction);
      const hasPronounWithoutAntecedent = /^(это|то|этот|тот|оно|она|он)\b/i.test(instruction.trim());
      const hasAssumptiveQuestion = /(помнишь|упоминал|говорил|обсуждали|решали).*\?/i.test(instruction);

      const shouldSearchMemory = hasExplicitReference || hasPastTense || hasTemporalRef || hasPronounWithoutAntecedent || hasAssumptiveQuestion;
      const keywords = this.extractSubstantiveKeywords(instruction);

      if (shouldSearchMemory && keywords.length > 0) {
        progressCallback?.({
          type: 'reasoning_step',
          message: 'Ищу контекст в предыдущих диалогах...',
          reasoning_text: `Триггеры обнаружены, ключевые слова: ${keywords.join(', ')}`
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
          console.log('[ConversationMemory] No triggers detected, skipping memory search');
        } else if (keywords.length === 0) {
          console.log('[ConversationMemory] No substantive keywords, skipping memory search');
        }
      }
    } catch (error) {
      console.warn('[ConversationMemory] Ошибка автоматического поиска:', error);
    }

    return conversationContext;
  }

  private extractSubstantiveKeywords(text: string): string[] {
    const genericWords = /\b(обсуждали|говорил|сделай|создай|покажи|найди|помоги|разговор|чат|вопрос|продолжи|помнишь|тот|та|то|наш|мой|как|мы|что|вчера|прошл|недавно|ранее|раньше|это|этот|оно|она|он|предлагал|решили|сделали|создали|обсудили|упоминал)\b/gi;
    const cleaned = text.replace(genericWords, '');

    const words = cleaned
      .split(/\s+/)
      .filter(w => w.length > 3)
      .filter(w => !/^[а-яё]{1,3}$/i.test(w));

    return words.slice(0, 3);
  }
}
