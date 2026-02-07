/**
 * Процессор для обработки текстового streaming
 * Управляет накоплением и форматированием текстовых дельт
 */

import type { StreamingCallbacks } from './types';

export class TextStreamProcessor {
  private callbacks: StreamingCallbacks;
  private accumulatedText: string = '';
  private buffer: string = '';
  private bufferTimeout: NodeJS.Timeout | null = null;
  private readonly BUFFER_DELAY_MS = 50; // Задержка перед отправкой буфера

  constructor(callbacks: StreamingCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Обрабатывает текстовую дельту
   * 
   * @param delta - Текстовая дельта (токен)
   */
  processDelta(delta: string): void {
    this.accumulatedText += delta;
    this.buffer += delta;

    // Отправляем через буфер для оптимизации (не каждый токен отдельно)
    this.scheduleBufferFlush();
  }

  /**
   * Планирует отправку буфера
   */
  private scheduleBufferFlush(): void {
    if (this.bufferTimeout) {
      clearTimeout(this.bufferTimeout);
    }

    this.bufferTimeout = setTimeout(() => {
      if (this.buffer.length > 0) {
        this.callbacks.onTextDelta?.(this.buffer, this.accumulatedText);
        this.buffer = '';
      }
      this.bufferTimeout = null;
    }, this.BUFFER_DELAY_MS);
  }

  /**
   * Принудительно отправляет буфер
   */
  flush(): void {
    if (this.bufferTimeout) {
      clearTimeout(this.bufferTimeout);
      this.bufferTimeout = null;
    }

    if (this.buffer.length > 0) {
      this.callbacks.onTextDelta?.(this.buffer, this.accumulatedText);
      this.buffer = '';
    }
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
    this.flush();
    this.accumulatedText = '';
    this.buffer = '';
  }
}

