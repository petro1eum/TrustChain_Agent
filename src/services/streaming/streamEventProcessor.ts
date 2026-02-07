/**
 * Процессор stream events от OpenAI/Anthropic API
 * Обрабатывает различные типы событий из streaming API
 */

import type { StreamEvent, StreamingCallbacks, TextDeltaEvent, ThinkingDeltaEvent, ToolUseStartEvent, ToolUseDeltaEvent, ToolResultEvent } from './types';

export class StreamEventProcessor {
  private callbacks: StreamingCallbacks;
  private accumulatedText: string = '';
  private accumulatedThinking: string = '';
  private currentToolCalls: Map<string, { name: string; argsBuffer: string }> = new Map();
  // КРИТИЧНО: Маппинг индекса на реальный ID для правильного связывания chunks
  private indexToIdMap: Map<number, string> = new Map();

  constructor(callbacks: StreamingCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Обрабатывает chunk от OpenAI streaming API
   * 
   * @param chunk - Chunk от OpenAI API
   */
  processOpenAIChunk(chunk: any): void {
    const choice = chunk.choices?.[0];
    if (!choice) return;

    const delta = choice.delta;
    if (!delta) return;

    // Обработка текстового контента
    if (delta.content) {
      this.accumulatedText += delta.content;
      this.callbacks.onTextDelta?.(delta.content, this.accumulatedText);
    }

    // Обработка tool calls
    if (delta.tool_calls) {
      for (const toolCallDelta of delta.tool_calls) {
        const toolCallIndex = toolCallDelta.index ?? 0;
        
        // КРИТИЧНО: Определяем toolCallId
        // 1. Если есть реальный ID - используем его и сохраняем маппинг индекс -> ID
        // 2. Если ID отсутствует - используем сохраненный маппинг по индексу
        // 3. Если маппинга нет - создаем временный ID
        let toolCallId = toolCallDelta.id;
        
        if (toolCallId) {
          // Сохраняем маппинг индекс -> реальный ID
          this.indexToIdMap.set(toolCallIndex, toolCallId);
        } else {
          // Используем сохраненный маппинг
          toolCallId = this.indexToIdMap.get(toolCallIndex);
          if (!toolCallId) {
            // Создаем временный ID только если маппинга нет
            toolCallId = `tool_${toolCallIndex}_${Date.now()}`;
            this.indexToIdMap.set(toolCallIndex, toolCallId);
          }
        }
        
        // Начало нового tool call (когда приходит name)
        if (toolCallDelta.type === 'function' && toolCallDelta.function?.name) {
          if (!this.currentToolCalls.has(toolCallId)) {
            this.currentToolCalls.set(toolCallId, {
              name: toolCallDelta.function.name,
              argsBuffer: ''
            });
            
            this.callbacks.onToolUseStart?.(
              toolCallId,
              toolCallDelta.function.name
            );
          }
        }

        // Дельта аргументов (может приходить в нескольких chunks)
        if (toolCallDelta.function?.arguments) {
          // Если tool call еще не создан, создаем его
          if (!this.currentToolCalls.has(toolCallId)) {
            this.currentToolCalls.set(toolCallId, {
              name: toolCallDelta.function.name || '',
              argsBuffer: ''
            });
            // Вызываем onToolUseStart если имя есть
            if (toolCallDelta.function.name) {
              this.callbacks.onToolUseStart?.(toolCallId, toolCallDelta.function.name);
            }
          }
          
          const toolCall = this.currentToolCalls.get(toolCallId);
          if (toolCall) {
            toolCall.argsBuffer += toolCallDelta.function.arguments;
            this.callbacks.onToolUseDelta?.(toolCallId, toolCallDelta.function.arguments);
          }
        }
      }
    }

    // Завершение tool call (когда finish_reason === 'tool_calls')
    if (choice.finish_reason === 'tool_calls') {
      // Tool calls будут обработаны после выполнения
      // Здесь мы только отмечаем что они завершены
    }
  }

  /**
   * Обрабатывает результат выполнения tool call
   * 
   * @param toolCallId - ID вызова инструмента
   * @param result - Результат выполнения
   * @param status - Статус выполнения
   */
  processToolResult(toolCallId: string, result: any, status: 'success' | 'error' = 'success'): void {
    const toolCall = this.currentToolCalls.get(toolCallId);
    if (toolCall) {
      // Парсим аргументы из буфера
      let args: any = {};
      try {
        args = JSON.parse(toolCall.argsBuffer);
      } catch {
        // Игнорируем ошибки парсинга
      }

      this.callbacks.onToolResult?.(toolCallId, result, status);
      this.currentToolCalls.delete(toolCallId);
    }
  }

  /**
   * Обрабатывает chunk от Anthropic streaming API (если используется)
   * 
   * @param chunk - Chunk от Anthropic API
   */
  processAnthropicChunk(chunk: any): void {
    // Anthropic использует другой формат событий
    // Пока не реализовано, так как используется OpenAI
    // Можно добавить позже если понадобится
  }

  /**
   * Завершает обработку стриминга
   */
  complete(finalContent?: string): void {
    const content = finalContent || this.accumulatedText;
    this.callbacks.onComplete?.(content);
    
    // Очищаем состояние
    this.accumulatedText = '';
    this.accumulatedThinking = '';
    this.currentToolCalls.clear();
  }

  /**
   * Обрабатывает ошибку
   */
  handleError(error: Error): void {
    this.callbacks.onError?.(error);
  }

  /**
   * Получает накопленный текст
   */
  getAccumulatedText(): string {
    return this.accumulatedText;
  }

  /**
   * Сбрасывает состояние процессора
   */
  reset(): void {
    this.accumulatedText = '';
    this.accumulatedThinking = '';
    this.currentToolCalls.clear();
  }
}

