/**
 * Базовый AI Agent
 * 
 * Предоставляет базовую функциональность для работы с OpenAI API:
 * - Инициализация OpenAI клиента
 * - Базовые методы для работы с инструментами (function calling)
 * - Управление контекстом выполнения
 * 
 * Дочерние классы (например, SmartAIAgent) переопределяют методы для расширенной функциональности.
 */

import OpenAI from 'openai';
import type {
  AIAgentConfig,
  ChatMessage,
  ChatAttachment,
  ProgressEvent,
  DataProcessingContext
} from './types';
import { basicTools } from './base/toolsSpecification';
import { t } from '../i18n/t';
import { buildBaseSystemPrompt, type LoadedSkill } from './base/systemPromptBuilder';
import { formatToolOutput } from './base/toolOutputFormatter';
import { getDefaultAgentConfig } from './base/defaultConfig';
import { getModelWithWebSearch } from './config/apiParams';

/**
 * Хелпер для retry с экспоненциальным backoff
 * Используется для устойчивости к временным ошибкам API
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; baseDelay?: number; maxDelay?: number } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelay = 1000, maxDelay = 10000 } = options;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Не ретраим клиентские ошибки (400, 401, 403, 404)
      const status = error.status || error.statusCode;
      if (status && status >= 400 && status < 500 && status !== 429) {
        throw error;
      }

      // Ретраим только: 429 (rate limit), 5xx (server errors), network errors
      if (attempt < maxRetries) {
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        console.warn(`[retryWithBackoff] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`, error.message);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

export class AIAgent {
  protected config: AIAgentConfig;
  protected openai: OpenAI;
  protected context: DataProcessingContext;

  /**
   * Создает новый экземпляр AI Agent
   * 
   * @param apiKey - OpenAI API ключ (опционально, можно получить из env)
   * @param config - Конфигурация агента (опционально)
   */
  constructor(apiKey?: string, config?: Partial<AIAgentConfig>) {
    const _env = typeof process !== 'undefined' ? process.env : {} as Record<string, string | undefined>;
    const openaiKey = apiKey
      || (typeof import.meta !== 'undefined' && import.meta.env?.VITE_OPENAI_API_KEY)
      || _env.VITE_OPENAI_API_KEY;
    const baseURL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_OPENAI_BASE_URL)
      || _env.VITE_OPENAI_BASE_URL;

    if (!openaiKey) {
      console.warn('Внимание: OpenAI API ключ не найден. Используется режим демонстрации.');
    }

    // Инициализация OpenAI клиента
    const openaiConfig: any = {
      apiKey: openaiKey || 'demo-key',
      dangerouslyAllowBrowser: true
    };

    // Настройка кастомного baseURL (например, для OpenRouter)
    if (baseURL) {
      openaiConfig.baseURL = baseURL;
      if (baseURL.includes('openrouter.ai')) {
        // КРИТИЧНО: Проверяем наличие window для Node.js окружения (тесты)
        const origin = typeof window !== 'undefined' && window.location
          ? window.location.origin
          : 'http://localhost:5173';
        openaiConfig.defaultHeaders = {
          'HTTP-Referer': origin,
          'X-Title': 'KB Catalog Admin'
        };
      }
    }

    this.openai = new OpenAI(openaiConfig);

    // Конфигурация по умолчанию
    this.config = {
      ...getDefaultAgentConfig(),
      ...config // Переопределяем значениями из параметра
    };

    // Инициализация контекста
    this.context = {
      source_files: {},
      workspace_df: null,
      history_stack: [],
      redo_stack: [],
      loaded_files: []
    };
  }

  // ============================================================================
  // Публичные методы для переопределения в дочерних классах
  // ============================================================================

  /**
   * Получить спецификацию доступных инструментов
   * 
   * @returns Массив спецификаций инструментов в формате OpenAI function calling
   * 
   * @note Дочерние классы должны переопределить этот метод для добавления своих инструментов
   */
  getToolsSpecification(): any[] {
    return basicTools;
  }

  /**
   * Получить системный промпт для модели
   * 
   * @param activeSkills - Массив загруженных skills с полным содержимым (опционально)
   * @returns Системный промпт в виде строки
   * 
   * @note Дочерние классы должны переопределить этот метод для кастомизации поведения
   */
  async getSystemPrompt(activeSkills?: LoadedSkill[]): Promise<string> {
    return buildBaseSystemPrompt(activeSkills);
  }

  /**
   * Основной метод анализа и обработки запроса пользователя
   * 
   * @param instruction - Инструкция от пользователя
   * @param chatHistory - История предыдущих сообщений (опционально)
   * @param progressCallback - Callback для отслеживания прогресса (опционально)
   * @returns Результат обработки и массив сообщений
   * 
   * @note Дочерние классы (например, SmartAIAgent) переопределяют этот метод
   *       для реализации более сложной логики обработки
   */
  async analyzeAndProcess(
    instruction: string,
    chatHistory: ChatMessage[] = [],
    progressCallback?: (event: ProgressEvent) => void,
    attachments?: ChatAttachment[]
  ): Promise<{ result: any; messages: ChatMessage[] }> {
    const messages: ChatMessage[] = [];

    try {
      progressCallback?.({
        type: 'start',
        message: 'Начинаю анализ задачи...'
      });

      const openaiMessages = await this.prepareMessages(instruction, chatHistory, attachments);
      const response = await this.callOpenAI(openaiMessages, progressCallback);

      messages.push(...response.messages);

      progressCallback?.({
        type: 'finished',
        message: 'Анализ завершен'
      });

      return {
        result: response.result,
        messages
      };

    } catch (error: any) {
      const errorMessage = `Ошибка при обработке: ${error.message}`;

      messages.push({
        role: 'assistant',
        content: errorMessage,
        timestamp: new Date()
      });

      progressCallback?.({
        type: 'error',
        message: errorMessage,
        event_data: { error: error.message }
      });

      throw error;
    }
  }

  // ============================================================================
  // Приватные вспомогательные методы
  // ============================================================================

  /**
   * Подготовка сообщений для OpenAI API
   * 
   * @param instruction - Текущая инструкция пользователя
   * @param chatHistory - История предыдущих сообщений
   * @returns Массив сообщений в формате OpenAI API
   */
  private async prepareMessages(
    instruction: string,
    chatHistory: ChatMessage[],
    attachments?: ChatAttachment[]
  ): Promise<any[]> {
    const systemPrompt = await this.getSystemPrompt();
    const messages: any[] = [
      { role: 'system', content: systemPrompt }
    ];

    // Добавляем историю чата (последние N сообщений)
    const recentHistory = chatHistory
      .filter(msg => msg.role === 'user' || msg.role === 'assistant')
      .slice(-this.config.chatHistoryLimit)
      .map(msg => ({
        role: msg.role,
        content: msg.content || ''
      }));

    messages.push(...recentHistory);

    // Добавляем текущую инструкцию
    if (attachments && attachments.length > 0) {
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
      messages.push({ role: 'user', content: contentParts });
    } else {
      messages.push({ role: 'user', content: instruction });
    }

    return messages;
  }

  /**
   * Вызов OpenAI API с поддержкой function calling
   * 
   * @param messages - Подготовленные сообщения для API
   * @param progressCallback - Callback для отслеживания прогресса
   * @returns Результат выполнения и массив сообщений
   */
  protected async callOpenAI(
    messages: any[],
    progressCallback?: (event: ProgressEvent) => void
  ): Promise<{ result: any; messages: ChatMessage[] }> {
    progressCallback?.({ type: 'api_call', message: 'Обращаюсь к ИИ...' });
    return this.chatWithToolsLoop(messages, progressCallback);
  }

  /**
   * Единый метод выполнения одного tool call:
   * dedup → progressCallback(tool_call) → execute+timeout → progressCallback(tool_response) → cache
   *
   * Возвращает output инструмента.
   */
  private async executeSingleToolCall(params: {
    toolName: string;
    args: any;
    toolCallId: string;
    progressCallback?: (event: ProgressEvent) => void;
    executedToolCalls: Map<string, any>;
    loopMessages: any[];
    resultMessages: ChatMessage[];
  }): Promise<{ output: any; cached: boolean }> {
    const { toolName, args, toolCallId, progressCallback, executedToolCalls, loopMessages, resultMessages } = params;

    // Dedup check
    const dedupKey = `${toolName}::${JSON.stringify(args || {}, Object.keys(args || {}).sort())}`;
    const cachedResult = executedToolCalls.get(dedupKey);
    if (cachedResult !== undefined) {
      console.log(`[BaseAIAgent] DEDUP: Skipping duplicate call ${toolName}`, { args });
      loopMessages.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: typeof cachedResult === 'string' ? cachedResult : JSON.stringify(cachedResult)
      });
      resultMessages.push({
        role: 'tool_response',
        content: this.formatToolOutput(cachedResult),
        name: toolName,
        timestamp: new Date()
      });
      return { output: cachedResult, cached: true };
    }

    // Emit tool_call event
    progressCallback?.({
      type: 'tool_call',
      message: t('agent.executingTool', { toolName }),
      event_data: { name: toolName, args: args || {} }
    });

    let output: any;
    let error: any = null;
    // session_spawn tools await sub-agent completion — need up to 5 min
    const isSessionTool = toolName.startsWith('session_');
    const toolExecutionTimeout = isSessionTool
      ? 5 * 60 * 1000
      : (this.config.toolExecutionTimeout || 35000);
    let timeoutId: NodeJS.Timeout | undefined;

    try {
      const executionPromise = this.handleToolCall(toolName, args, progressCallback);
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          console.error(`[BaseAIAgent] TIMEOUT: Tool ${toolName} превысил ${toolExecutionTimeout}ms`);
          reject(new Error(`Tool execution timeout after ${toolExecutionTimeout}ms`));
        }, toolExecutionTimeout);
      });

      output = await Promise.race([executionPromise, timeoutPromise]);
      if (timeoutId) clearTimeout(timeoutId);

      console.log(`[BaseAIAgent] Tool ${toolName} completed successfully`, {
        hasOutput: !!output,
        outputType: typeof output,
        outputKeys: output && typeof output === 'object' ? Object.keys(output) : []
      });
    } catch (err: any) {
      if (timeoutId) clearTimeout(timeoutId);
      console.error(`[BaseAIAgent] Tool ${toolName} FAILED`, {
        error: err.message,
        stack: err.stack,
        tool: toolName,
        args
      });
      error = err;
      output = { error: err.message || String(err) };
    } finally {
      try {
        progressCallback?.({
          type: 'tool_response',
          message: error ? `Ошибка выполнения ${toolName}` : `Выполнено: ${toolName}`,
          event_data: {
            name: toolName,
            content: output,
            result: output,
            error: error ? (error.message || String(error)) : undefined,
            // TrustChain Ed25519 signature — toolExecutionService uses __tc_signature
            signature: output?.__tc_signature || output?.signature,
            certificate: output?.__tc_envelope?.certificate || output?.certificate,
          }
        });
      } catch (callbackError: any) {
        console.error(`[BaseAIAgent] ERROR sending tool_response:`, callbackError);
      }
    }

    // Cache + push messages
    executedToolCalls.set(dedupKey, output);
    loopMessages.push({
      role: 'tool',
      tool_call_id: toolCallId,
      content: typeof output === 'string' ? output : JSON.stringify(output)
    });
    resultMessages.push({
      role: 'tool_response',
      content: this.formatToolOutput(output),
      name: toolName,
      timestamp: new Date()
    });

    // ⚡ After successful bash_tool/execute_code — inject artifact creation hint
    // BUT ONLY if create_artifact was NOT already called in this loop
    const computeTools = ['bash_tool', 'execute_code', 'execute_bash'];
    if (computeTools.includes(toolName) && !error && output && typeof output !== 'string') {
      const hasData = output.stdout || output.result || output.output;
      // Check if create_artifact was already called in this session
      const artifactAlreadyCreated = loopMessages.some(
        (m: any) => m.role === 'tool' && m.name === 'create_artifact'
      ) || loopMessages.some(
        (m: any) => m.content && typeof m.content === 'string' && m.content.includes('✅ Артефакт')
      );
      if (hasData && !artifactAlreadyCreated) {
        loopMessages.push({
          role: 'system',
          content: '⚡ ВАЖНО: Ты получил результат вычисления. Теперь ОБЯЗАТЕЛЬНО вызови create_artifact для создания красивой HTML-страницы с этим результатом. НЕ пиши текстовый ответ — вызови create_artifact СЕЙЧАС!'
        });
      }
    }

    // ⚡ After create_artifact — agent feedback: evaluate and decide
    if (toolName === 'create_artifact' && !error) {
      const filename = output?.filename || output?.path || 'artifact';
      loopMessages.push({
        role: 'system',
        content: `✅ Артефакт "${filename}" создан и рендерится LIVE в панели пользователя. Оцени результат: если артефакт качественный и полный — заверши ответ кратким резюме. Если нужны улучшения — вызови create_artifact повторно с исправленным кодом. НЕ вызывай bash_tool/execute_code повторно — вычисление уже выполнено.`
      });
    }

    return { output, cached: false };
  }

  /**
   * Универсальный цикл function calling с поддержкой streaming
   * 
   * Вызывает инструменты, добавляет их вывод и повторяет, пока модель не перестанет просить tools.
   * Поддерживает streaming для токен-за-токеном обновления ответов.
   * 
   * @param initialMessages - Начальные сообщения для API
   * @param progressCallback - Callback для отслеживания прогресса
   * @param maxIterations - Максимальное количество итераций (по умолчанию 5)
   * @param enableStreaming - Включить streaming (по умолчанию true)
   * @param sharedExecutedToolCalls - Общий кэш dedup между ReAct-итерациями
   * @returns Результат выполнения и массив сообщений
   */
  protected async chatWithToolsLoop(
    initialMessages: any[],
    progressCallback?: (event: ProgressEvent) => void,
    maxIterations?: number,
    enableStreaming: boolean = true,
    sharedExecutedToolCalls?: Map<string, any>
  ): Promise<{ result: any; messages: ChatMessage[] }> {
    const resultMessages: ChatMessage[] = [];
    const toolsSpec = this.getToolsSpecification();
    let loopMessages = [...initialMessages];

    // Защита от дублирования tool calls: переиспользуем между ReAct-итерациями
    const executedToolCalls = sharedExecutedToolCalls || new Map<string, any>();

    // Gap #9 + Gap C: Адаптивный лимит итераций — больше инструментов = больше шагов
    // Gap C: maxIterations может быть передан от TaskQueueService (до 25 для background tasks)
    const effectiveMaxIterations = maxIterations ?? Math.min(Math.max(3, toolsSpec.length > 10 ? 6 : 4), 8);

    for (let i = 0; i < effectiveMaxIterations; i++) {
      // Yield to event loop between iterations so React can re-render
      if (i > 0) await new Promise<void>(r => setTimeout(r, 0));

      // Показываем reasoning перед каждым запросом к модели
      if (i === 0) {
        progressCallback?.({
          type: 'reasoning_step',
          message: 'Анализирую запрос и выбираю инструменты...',
          reasoning_text: 'Модель думает о том, какие инструменты нужны для решения задачи'
        });
      } else {
        progressCallback?.({
          type: 'reasoning_step',
          message: `Итерация ${i + 1}: Анализирую результаты и планирую следующие шаги...`,
          reasoning_text: 'Обрабатываю результаты предыдущих инструментов и определяю дальнейшие действия'
        });
      }

      // Используем streaming если включен
      if (enableStreaming) {
        const streamingResult = await this.chatWithToolsLoopStreaming(
          loopMessages,
          toolsSpec,
          progressCallback,
          i  // pass iteration index for tool_choice strategy
        );

        if (streamingResult.toolCalls.length > 0) {
          // Выполняем tool calls параллельно (Promise.allSettled)
          await Promise.allSettled(
            streamingResult.toolCalls.map(toolCall =>
              this.executeSingleToolCall({
                toolName: toolCall.name,
                args: toolCall.args,
                toolCallId: toolCall.id,
                progressCallback,
                executedToolCalls,
                loopMessages,
                resultMessages
              })
            )
          );

          // Добавляем assistant message с tool calls
          loopMessages.push({
            role: 'assistant',
            content: streamingResult.content || null,
            tool_calls: streamingResult.toolCalls.map(tc => ({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.args)
              }
            }))
          });

          continue; // Переходим к следующей итерации
        } else {
          // FALLBACK: Gemini sometimes generates print(default_api.mcp_...) text instead of a real function call
          // Detect and parse this pattern, then execute the tool call manually
          const codeCallMatch = (streamingResult.content || '').match(
            /(?:print\()?default_api[.\s]*(\w+)\((.*?)\)\)?/s
          );
          if (codeCallMatch && codeCallMatch[1]?.startsWith('mcp_')) {
            const toolName = codeCallMatch[1];
            const argsStr = codeCallMatch[2] || '';
            // Parse keyword arguments: key = "value", key = "value"
            const args: Record<string, any> = {};
            const argMatches = argsStr.matchAll(/(\w+)\s*=\s*"([^"]*)"/g);
            for (const m of argMatches) {
              args[m[1]] = m[2];
            }
            console.warn(`[BaseAIAgent] FALLBACK: Model generated code text instead of tool call. Parsing: ${toolName}(${JSON.stringify(args)})`);

            const syntheticId = `fallback_${Date.now()}`;
            // Execute the parsed tool call
            await this.executeSingleToolCall({
              toolName,
              args,
              toolCallId: syntheticId,
              progressCallback,
              executedToolCalls,
              loopMessages,
              resultMessages
            });

            // Add the synthetic tool call to messages and continue loop for LLM to synthesize response
            loopMessages.push({
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: syntheticId,
                type: 'function',
                function: {
                  name: toolName,
                  arguments: JSON.stringify(args)
                }
              }]
            });
            continue; // Let the LLM synthesize the final response from tool results
          }

          // Нет tool calls - завершаем
          const finalText = (streamingResult.content || '').trim();
          let looksEmpty = !finalText || /^готово\.?$/i.test(finalText) || /^done\.?$/i.test(finalText);
          if (!looksEmpty && finalText) {
            const trimmed = finalText.trim();
            if (trimmed === '{}' || trimmed === '[]' || trimmed === 'null') {
              looksEmpty = true;
            } else if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
              try {
                const parsed = JSON.parse(trimmed);
                if (parsed === null) {
                  looksEmpty = true;
                } else if (Array.isArray(parsed) && parsed.length === 0) {
                  looksEmpty = true;
                } else if (parsed && typeof parsed === 'object') {
                  const keys = Object.keys(parsed);
                  if (keys.length === 0) {
                    looksEmpty = true;
                  } else if (keys.length === 1 && keys[0] === 'success') {
                    looksEmpty = true;
                  }
                }
              } catch {
                // ignore JSON parse errors
              }
            }
          }

          if (!looksEmpty && finalText) {
            resultMessages.push({
              role: 'assistant',
              content: streamingResult.content,
              timestamp: new Date()
            });
          } else {
            // Модель не синтезировала ответ — используем общий метод
            await this.ensureFinalResponse(resultMessages, loopMessages, progressCallback);
          }

          return { result: { status: 'success' }, messages: resultMessages };
        }
      } else {
        // Fallback на не-streaming версию с retry
        const response = await retryWithBackoff(() => this.openai.chat.completions.create({
          model: getModelWithWebSearch(this.config.defaultModel),
          messages: loopMessages,
          tools: toolsSpec,
          tool_choice: 'auto',
          temperature: this.config.temperature,
          max_tokens: Math.min(this.config.maxTokens || 8000, 32000),
          stream: false
        }));

        const choice = response.choices[0];
        const message = choice.message;

        // Регистрируем использование токенов из API response
        if (response.usage) {
          this.recordApiUsage(this.config.defaultModel, response.usage);
        }

        const toolCalls = message.tool_calls || [];

        if (toolCalls.length > 0) {
          // НЕ добавляем промежуточный assistant content в resultMessages при наличии tool_calls.
          // Промежуточный текст модели — это не финальный ответ, его не показываем пользователю.
          const toolNames = toolCalls.map(tc => {
            const func = 'function' in tc ? tc.function : (tc as any).function;
            return func?.name || 'unknown';
          }).join(', ');
          progressCallback?.({
            type: 'reasoning_step',
            message: `Выбрал инструменты: ${toolNames}`,
            reasoning_text: `Модель решила использовать: ${toolNames}. Это поможет решить задачу эффективнее.`
          });
        }

        if (!toolCalls.length) {
          // Финальный ответ без tool calls — добавляем assistant message
          if (message.content) {
            resultMessages.push({ role: 'assistant', content: message.content, timestamp: new Date() });
          }
          const finalText = (message.content || '').trim();
          let looksEmpty = !finalText || /^готово\.?$/i.test(finalText) || /^done\.?$/i.test(finalText);
          if (!looksEmpty && finalText) {
            const trimmed = finalText.trim();
            if (trimmed === '{}' || trimmed === '[]' || trimmed === 'null') {
              looksEmpty = true;
            } else if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
              try {
                const parsed = JSON.parse(trimmed);
                if (parsed === null) {
                  looksEmpty = true;
                } else if (Array.isArray(parsed) && parsed.length === 0) {
                  looksEmpty = true;
                } else if (parsed && typeof parsed === 'object') {
                  const keys = Object.keys(parsed);
                  if (keys.length === 0) {
                    looksEmpty = true;
                  } else if (keys.length === 1 && keys[0] === 'success') {
                    looksEmpty = true;
                  }
                }
              } catch {
                // ignore JSON parse errors
              }
            }
          }

          if (looksEmpty) {
            // Используем общий метод вместо дублирования
            await this.ensureFinalResponse(resultMessages, loopMessages, progressCallback);
          }

          return { result: { status: 'success' }, messages: resultMessages };
        }

        // Выполняем tool calls параллельно (Promise.allSettled)
        await Promise.allSettled(
          toolCalls.map(toolCall => {
            const func = 'function' in toolCall ? toolCall.function : (toolCall as any).function;
            const toolName = func?.name || 'unknown';
            const toolArgs = func?.arguments || '{}';

            let args: any = {};
            try {
              args = JSON.parse(toolArgs);
            } catch {
              // Игнорируем ошибки парсинга
            }

            return this.executeSingleToolCall({
              toolName,
              args,
              toolCallId: toolCall.id,
              progressCallback,
              executedToolCalls,
              loopMessages,
              resultMessages
            });
          })
        );

        loopMessages.push(message);
      }
    }

    // Гарантируем наличие финального ответа (устраняем дублирование)
    await this.ensureFinalResponse(resultMessages, loopMessages, progressCallback);

    return { result: { status: 'max_tool_iterations' }, messages: resultMessages };
  }

  /**
   * Streaming версия chatWithToolsLoop
   * Обрабатывает stream events и обновляет UI токен за токеном
   */
  private async chatWithToolsLoopStreaming(
    messages: any[],
    toolsSpec: any[],
    progressCallback?: (event: ProgressEvent) => void,
    iteration: number = 0
  ): Promise<{
    content: string;
    toolCalls: Array<{ id: string; name: string; args: any }>;
  }> {
    const { StreamEventProcessor } = await import('../services/streaming');

    let accumulatedContent = '';
    const toolCalls: Array<{ id: string; name: string; args: any }> = [];
    const toolCallAccumulators: Map<string, { name: string; args: string }> = new Map();

    const processor = new StreamEventProcessor({
      onTextDelta: (_delta: string, accumulated: string) => {
        accumulatedContent = accumulated;
        progressCallback?.({
          type: 'text_delta',
          message: 'Генерирую ответ...',
          streamingContent: accumulated
        });
      },
      onToolUseStart: (toolCallId: string, toolName: string) => {
        toolCallAccumulators.set(toolCallId, { name: toolName, args: '' });
        // NOTE: Don't emit tool_call here — executeSingleToolCall already emits it with args.
        // Instead, emit a reasoning_step to show the model's intent.
        progressCallback?.({
          type: 'reasoning_step',
          message: `Выбираю инструмент: ${toolName}`,
        });
      },
      onToolUseDelta: (toolCallId: string, argsDelta: string) => {
        const accumulator = toolCallAccumulators.get(toolCallId);
        if (accumulator) {
          accumulator.args += argsDelta || '';
        }
      },
      onToolResult: (toolCallId: string, _result: any, _status: 'success' | 'error') => {
        const accumulator = toolCallAccumulators.get(toolCallId);
        if (accumulator) {
          let args: any = {};
          try {
            args = JSON.parse(accumulator.args);
          } catch {
            // Игнорируем ошибки парсинга
          }
          toolCalls.push({ id: toolCallId, name: accumulator.name, args });
          toolCallAccumulators.delete(toolCallId);
        }
      },
      onComplete: (finalContent: string) => {
        accumulatedContent = finalContent;
      },
      onError: (error: Error) => {
        console.error('[Streaming] Ошибка:', { message: error.message, stack: error.stack });
      }
    });

    // ДИАГНОСТИКА: Логируем инструменты перед отправкой в API
    console.log('[BaseAIAgent] Sending to OpenAI API:', {
      toolsCount: toolsSpec.length,
      toolNames: toolsSpec.map(t => t.function?.name).filter(Boolean),
      hasCreateArtifact: toolsSpec.some(t => t.function?.name === 'create_artifact'),
      hasCreateCategoryIndex: toolsSpec.some(t => t.function?.name === 'create_category_index'),
      uniqueToolNames: [...new Set(toolsSpec.map(t => t.function?.name).filter(Boolean))]
    });

    try {
      const modelWithSearch = getModelWithWebSearch(this.config.defaultModel);
      console.log('[BaseAIAgent] 🔍 API call with model:', {
        originalModel: this.config.defaultModel,
        modelWithSearch,
        hasOnlineSuffix: modelWithSearch.endsWith(':online')
      });

      // On first iteration with MCP tools, force tool usage to prevent
      // the model from answering from memory instead of calling data tools
      const hasMcpTools = toolsSpec.some(t => t.function?.name?.startsWith('mcp_'));
      const toolChoice = (iteration === 0 && hasMcpTools) ? 'required' as const : 'auto' as const;
      console.log('[BaseAIAgent] tool_choice strategy:', { iteration, hasMcpTools, toolChoice });

      const stream = await this.openai.chat.completions.create({
        model: modelWithSearch,
        messages,
        tools: toolsSpec,
        tool_choice: toolChoice,
        temperature: this.config.temperature,
        max_tokens: Math.min(this.config.maxTokens || 8000, 32000),
        stream: true
      });

      // Сохраняем finish_reason для возможного использования (пока не используется)
      let finishReason: string | null = null;

      for await (const chunk of stream) {
        processor.processOpenAIChunk(chunk);

        // Сохраняем finish_reason из последнего chunk
        const choice = chunk.choices?.[0];
        if (choice?.finish_reason) {
          finishReason = choice.finish_reason;
        }
      }

      // finishReason сохранен, но не используется напрямую
      // Используем void чтобы подавить предупреждение линтера
      void finishReason;

      // КРИТИЧНО: Всегда извлекаем tool calls из accumulators, не только при finishReason === 'tool_calls'
      // Потому что tool calls могут быть собраны до завершения streaming
      for (const [toolCallId, accumulator] of toolCallAccumulators.entries()) {
        if (accumulator.name && accumulator.args) {
          let args: any = {};
          try {
            args = JSON.parse(accumulator.args);
          } catch {
            // Игнорируем ошибки парсинга
          }

          // Добавляем только если еще не добавлен
          if (!toolCalls.find(tc => tc.id === toolCallId)) {
            toolCalls.push({ id: toolCallId, name: accumulator.name, args });
          }
        }
      }

      // Завершаем обработку streaming и получаем финальный контент
      processor.complete(accumulatedContent);

      // Оцениваем использование токенов для streaming (OpenAI не возвращает usage в stream)
      // Gap #7: Кириллица ~3 символа/токен, латиница ~4 символа/токен
      const inputSize = JSON.stringify(messages).length;
      const outputSize = accumulatedContent.length;
      const hasCyrillic = /[\u0400-\u04FF]/.test(accumulatedContent);
      const charsPerToken = hasCyrillic ? 3 : 4;
      const estimatedInputTokens = Math.ceil(inputSize / charsPerToken);
      const estimatedOutputTokens = Math.ceil(outputSize / charsPerToken);
      const estimatedTotalTokens = estimatedInputTokens + estimatedOutputTokens;

      // Регистрируем использование токенов (оценка)
      this.recordApiUsage(this.config.defaultModel, {
        prompt_tokens: estimatedInputTokens,
        completion_tokens: estimatedOutputTokens,
        total_tokens: estimatedTotalTokens
      });

      // Отправляем финальный контент через progressCallback
      if (accumulatedContent && progressCallback) {
        progressCallback({
          type: 'text_delta',
          message: 'Завершено',
          streamingContent: accumulatedContent
        });
      }

      return {
        content: accumulatedContent,
        toolCalls
      };
    } catch (error: any) {
      console.error('[Streaming] Ошибка создания stream:', {
        message: error.message,
        stack: error.stack,
        model: this.config.defaultModel,
        status: error.status || error.statusCode
      });
      // Fallback на не-streaming версию
      throw error;
    }
  }

  /**
   * Регистрирует использование токенов из API response
   * Может быть переопределен в дочерних классах для интеграции с ResourceManager
   * 
   * @param model - Модель
   * @param usage - Usage объект от OpenAI API
   */
  protected recordApiUsage(_model: string, _usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }): void {
    // По умолчанию ничего не делаем
    // SmartAIAgent переопределит этот метод для регистрации в ResourceManager
    // Параметры с префиксом _ чтобы избежать предупреждений линтера
  }

  /**
   * Форматирование вывода инструмента для отображения пользователю
   * 
   * @param output - Результат выполнения инструмента
   * @returns Отформатированная строка для отображения
   */
  private formatToolOutput(output: any): string {
    return formatToolOutput(output);
  }

  /**
   * Гарантирует наличие финального ответа в сообщениях
   * 
   * Если нет assistant-ответа, пытается синтезировать ответ на основе tool results.
   * Используется для устранения дублирования fallback-логики.
   * 
   * @param resultMessages - Массив сообщений для проверки/дополнения
   * @param loopMessages - История сообщений для синтеза (опционально)
   * @param progressCallback - Callback для отслеживания прогресса
   */
  private async ensureFinalResponse(
    resultMessages: ChatMessage[],
    loopMessages?: any[],
    progressCallback?: (event: ProgressEvent) => void
  ): Promise<void> {
    const hasAssistant = resultMessages.some(m => m.role === 'assistant');
    if (hasAssistant) return;

    const lastToolMsg = [...resultMessages].reverse().find(m => (m as any).role === 'tool_response');

    if (!lastToolMsg || !(lastToolMsg as any).content) {
      resultMessages.push({
        role: 'assistant',
        content: t('agent.noResponse'),
        timestamp: new Date()
      });
      return;
    }

    // Если есть loopMessages — пытаемся синтезировать ответ
    if (loopMessages && loopMessages.length > 0) {
      progressCallback?.({
        type: 'reasoning_step',
        message: t('agent.synthesizing'),
        reasoning_text: t('agent.synthesisStep')
      });

      try {
        const synthesisMessages = [
          ...loopMessages,
          {
            role: 'user' as const,
            content: `На основе результатов инструментов выше, дай РАЗВЁРНУТЫЙ ОТВЕТ пользователю.

СТРОГИЕ ПРАВИЛА:
1. Используй ТОЛЬКО данные из результатов инструментов — ничего не придумывай
2. Для каждого утверждения укажи ИСТОЧНИК (название инструмента или поле данных)
3. Структурируй ответ: краткий вывод, затем детали
4. Если данных недостаточно для полного ответа — укажи что именно не хватает
5. Дай конкретную рекомендацию или следующий шаг

НЕ добавляй информацию, которой нет в результатах инструментов!`
          }
        ];

        const synthesisResponse = await retryWithBackoff(() => this.openai.chat.completions.create({
          model: getModelWithWebSearch(this.config.defaultModel),
          messages: synthesisMessages,
          temperature: 0.3,
          max_tokens: 2000,
          stream: false
        }));

        const synthesizedContent = synthesisResponse.choices[0]?.message?.content;
        if (synthesizedContent && synthesizedContent.trim()) {
          resultMessages.push({
            role: 'assistant',
            content: synthesizedContent,
            timestamp: new Date()
          });
          return;
        }
      } catch (synthesisError: any) {
        console.error('[BaseAIAgent] Synthesis failed:', {
          message: synthesisError.message,
          stack: synthesisError.stack,
          model: this.config.defaultModel,
          toolResultsCount: resultMessages.filter(m => m.role === 'tool_response').length
        });
      }
    }

    // Fallback: возвращаем raw tool output
    resultMessages.push({
      role: 'assistant',
      content: (lastToolMsg as any).content,
      timestamp: new Date()
    });
  }

  // ============================================================================
  // Методы для переопределения в дочерних классах
  // ============================================================================

  /**
   * Базовое выполнение инструментов
   * 
   * @param name - Имя инструмента
   * @param args - Аргументы инструмента
   * @param progressCallback - Callback для отслеживания прогресса
   * @returns Результат выполнения инструмента
   * 
   * @note Дочерние классы должны переопределить handleToolCall для реализации
   *       реальной логики выполнения инструментов
   */
  protected async executeBaseTool(
    name: string,
    args: any,
    progressCallback?: (event: ProgressEvent) => void
  ): Promise<string> {
    // NOTE: Don't emit tool_call here — executeSingleToolCall already handles it.
    return `Базовый обработчик для ${name} выполнен с аргументами: ${JSON.stringify(args)}`;
  }

  /**
   * Обработчик вызова инструмента
   * 
   * Точка расширения для дочерних агентов - здесь должна быть реализована
   * логика вызова конкретных инструментов.
   * 
   * @param name - Имя инструмента
   * @param args - Аргументы инструмента
   * @param progressCallback - Callback для отслеживания прогресса
   * @returns Результат выполнения инструмента
   * 
   * @note Дочерние классы должны переопределить этот метод для реализации
   *       реальной логики выполнения инструментов
   */
  protected async handleToolCall(
    name: string,
    args: any,
    progressCallback?: (event: ProgressEvent) => void
  ): Promise<any> {
    return this.executeBaseTool(name, args, progressCallback);
  }

  // ============================================================================
  // Управление контекстом
  // ============================================================================

  /**
   * Установить контекст выполнения
   * 
   * @param context - Частичный контекст для обновления
   */
  setContext(context: Partial<DataProcessingContext>): void {
    this.context = { ...this.context, ...context };
  }

  /**
   * Получить текущий контекст выполнения
   * 
   * @returns Текущий контекст выполнения
   */
  getContext(): DataProcessingContext {
    return this.context;
  }
} 