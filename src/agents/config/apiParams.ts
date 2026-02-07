/**
 * Утилиты для создания параметров API с учётом особенностей моделей
 */

export interface ApiParamsConfig {
  defaultModel: string;
  temperature?: number;
  topP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  maxTokens?: number;
  responseFormat?: any;
  stream?: boolean;
}

export interface ApiParams {
  model: string;
  messages: any[];
  temperature?: number;
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  response_format?: any;
  stream?: boolean;
}

/**
 * Создать параметры API с учётом особенностей GPT-5
 */
export function createApiParams(
  baseParams: {
    model?: string;
    messages: any[];
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    presencePenalty?: number;
    frequencyPenalty?: number;
    responseFormat?: any;
    stream?: boolean;
  },
  config: {
    defaultModel: string;
    temperature: number;
    topP?: number;
    presencePenalty?: number;
    frequencyPenalty?: number;
  }
): ApiParams {
  const model = baseParams.model || config.defaultModel;
  const isGPT5 = model.includes('gpt-5');

  const params: ApiParams = {
    model,
    messages: baseParams.messages,
    temperature: isGPT5 ? 1 : (baseParams.temperature ?? config.temperature),
    stream: baseParams.stream ?? false
  };

  // top_p (nucleus sampling) - 0 to 1
  if (baseParams.topP !== undefined || config.topP !== undefined) {
    params.top_p = baseParams.topP ?? config.topP;
  }

  // presence_penalty - penalize new tokens based on presence (-2 to 2)
  if (baseParams.presencePenalty !== undefined || config.presencePenalty !== undefined) {
    params.presence_penalty = baseParams.presencePenalty ?? config.presencePenalty;
  }

  // frequency_penalty - penalize new tokens based on frequency (-2 to 2)
  if (baseParams.frequencyPenalty !== undefined || config.frequencyPenalty !== undefined) {
    params.frequency_penalty = baseParams.frequencyPenalty ?? config.frequencyPenalty;
  }

  if (baseParams.responseFormat) {
    params.response_format = baseParams.responseFormat;
  }

  // GPT-5 использует max_completion_tokens, остальные - max_tokens
  if (baseParams.maxTokens) {
    if (isGPT5) {
      params.max_completion_tokens = baseParams.maxTokens;
    } else {
      params.max_tokens = baseParams.maxTokens;
    }
  }

  return params;
}



/**
 * Получить ID модели с поддержкой native web search
 * 
 * OpenRouter поддерживает native web search ТОЛЬКО для:
 * - OpenAI
 * - Anthropic
 * - Perplexity
 * - xAI
 * 
 * Google/Gemini НЕ поддерживает native search через OpenRouter!
 * Для Google используется Exa (сторонний поиск), который работает хуже.
 * 
 * @param modelId - Исходный ID модели (например, 'openai/gpt-5.2')
 * @param enableWebSearch - Включить web search (по умолчанию true)
 * @returns Model ID с :online суффиксом если модель поддерживает native search
 */
export function getModelWithWebSearch(modelId: string, enableWebSearch: boolean = true): string {
  if (!enableWebSearch) {
    return modelId;
  }

  // Если уже есть :online суффикс - возвращаем как есть
  if (modelId.endsWith(':online')) {
    return modelId;
  }

  // ТОЛЬКО эти провайдеры поддерживают NATIVE web search в OpenRouter
  // Google/Gemini НЕ поддерживает native search - вместо этого используется Exa
  const nativeSearchProviders = ['openai/', 'anthropic/', 'perplexity/', 'x-ai/'];
  const supportsNativeSearch = nativeSearchProviders.some(provider => modelId.startsWith(provider));

  if (supportsNativeSearch) {
    console.log(`[getModelWithWebSearch] Enabling native web search for ${modelId} -> ${modelId}:online`);
    return `${modelId}:online`;
  }

  // Для Google/Gemini - НЕ добавляем :online, используем инструменты web_search/web_fetch
  if (modelId.startsWith('google/')) {
    console.log(`[getModelWithWebSearch] Google/Gemini does NOT support native search - use web_search tool instead`);
  }

  return modelId;
}
