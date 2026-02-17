/**
 * Сервис для Internal Reasoning (скрытый анализ перед основным запросом)
 * Делает отдельный запрос к модели для анализа запроса без показа пользователю
 */

import OpenAI from 'openai';
import type {
  ThinkingConfig,
  InternalReasoningResult,
  InternalReasoningContext
} from './types';
import { ReasoningBudget } from './reasoningBudget';
import type { ResourceManager } from '../resources';

export interface InternalReasoningServiceDependencies {
  openai: OpenAI;
  config: ThinkingConfig;
  getApiParams: (params: any) => any;
  defaultModel?: string;
  resourceManager?: ResourceManager; // Опциональный ResourceManager для rate limiting
}

export class InternalReasoningService {
  private deps: InternalReasoningServiceDependencies;
  private budget: ReasoningBudget;

  constructor(deps: InternalReasoningServiceDependencies) {
    this.deps = deps;
    this.budget = new ReasoningBudget(deps.config);
  }

  /**
   * Выполнить internal reasoning (скрытый анализ)
   * 
   * @param context - Контекст для анализа
   * @returns Результат анализа или null если reasoning не нужен/недоступен
   */
  async thinkInternally(
    context: InternalReasoningContext
  ): Promise<InternalReasoningResult | null> {
    // Проверяем, нужен ли reasoning
    if (!this.budget.shouldUseReasoning(context.userQuery)) {
      return null;
    }

    // Проверяем бюджет
    const estimatedTokens = context.userQuery.length / 4; // Примерная оценка
    if (!this.budget.canUseReasoning(estimatedTokens)) {
      console.warn('[InternalReasoning] Бюджет токенов исчерпан, пропускаем reasoning');
      return null;
    }

    try {
      // Формируем промпт для internal analysis
      const analysisPrompt = this.buildAnalysisPrompt(context);

      // Делаем скрытый запрос к модели
      const model = this.deps.config.model || this.deps.defaultModel || 'google/gemini-3-flash-preview';
      const temperature = this.deps.config.temperature ?? 0.3; // Низкая temperature для анализа

      const apiParams = this.deps.getApiParams({
        model,
        messages: [
          {
            role: 'system',
            content: `Ты - эксперт по анализу запросов. Твоя задача - проанализировать запрос пользователя и определить КАКИЕ ИНСТРУМЕНТЫ ИСПОЛЬЗОВАТЬ для его выполнения.

⛔ КРИТИЧЕСКОЕ ПРАВИЛО: НИКОГДА не говори что задачу нельзя выполнить. У нас ЕСТЬ все инструменты:
- bash_tool = полноценный Linux + Python с numpy, scipy, sympy, matplotlib, pandas. Можно решать ЛЮБЫЕ вычислительные задачи: математика, физика, химия, статистика, машинное обучение.
- create_artifact = создание HTML/JS/CSS визуализаций, интерактивных страниц, графиков (Chart.js, D3.js), React компонентов. Artifact отображается прямо в интерфейсе пользователя.
- web_search = поиск информации в интернете
- create_file = создание файлов в контейнере

АНАЛИЗИРУЙ:
1. Что именно хочет пользователь?
2. КАКИЕ инструменты использовать? (bash_tool для вычислений, create_artifact для визуализаций)
3. Какой конкретный план действий?

⚡ КЛЮЧЕВОЕ: Если задача включает вычисления/данные — ВСЕГДА рекомендуй ДВА инструмента:
   1) bash_tool — для вычислений
   2) create_artifact — для представления результата как красивый HTML с визуализацией
Это ОБЯЗАТЕЛЬНАЯ последовательность: bash_tool → create_artifact. Не останавливайся после bash_tool!

ВСЕГДА рекомендуй конкретные инструменты. НИКОГДА не говори "нет подходящих инструментов".

Ответь в JSON формате:
{
  "analysis": "детальный анализ запроса",
  "recommendations": ["конкретный инструмент и как его использовать"],
  "keyPoints": ["ключевой момент"],
  "confidence": 0.9
}`
          },
          {
            role: 'user',
            content: analysisPrompt
          }
        ],
        temperature,
        max_tokens: Math.min(this.deps.config.maxTokens, 1000), // Ограничиваем размер ответа
        response_format: { type: 'json_object' }
      });

      const response = await this.deps.openai.chat.completions.create(apiParams);

      const choice = response.choices[0];
      const content = choice.message.content || '{}';

      // Парсим JSON ответ
      let parsed: any;
      try {
        parsed = JSON.parse(content);
      } catch (e) {
        // Если не JSON, пытаемся извлечь информацию из текста
        parsed = {
          analysis: content,
          recommendations: [],
          keyPoints: [],
          confidence: 0.7
        };
      }

      // Подсчитываем использованные токены
      const tokensUsed = response.usage?.total_tokens || estimatedTokens;

      // Оцениваем стоимость (примерно, зависит от модели)
      const cost = this.estimateCost(tokensUsed, model);

      const result: InternalReasoningResult = {
        analysis: parsed.analysis || content,
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
        keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
        tokensUsed,
        cost
      };

      // Регистрируем использование в бюджете
      this.budget.recordUsage(result);

      // Регистрируем использование в ResourceManager (если доступен)
      if (this.deps.resourceManager && response.usage) {
        this.deps.resourceManager.recordApiUsage(model, response.usage);
      }

      return result;
    } catch (error: any) {
      console.error('[InternalReasoning] Ошибка выполнения reasoning:', error);
      // Не падаем при ошибке, просто возвращаем null
      return null;
    }
  }

  /**
   * Формирует промпт для анализа
   */
  private buildAnalysisPrompt(context: InternalReasoningContext): string {
    let prompt = `ЗАПРОС ПОЛЬЗОВАТЕЛЯ:\n${context.userQuery}\n\n`;

    if (context.availableTools && context.availableTools.length > 0) {
      prompt += `ДОСТУПНЫЕ ИНСТРУМЕНТЫ:\n${context.availableTools.slice(0, 10).join(', ')}\n\n`;
    }

    if (context.chatHistory && context.chatHistory.length > 0) {
      const recentHistory = context.chatHistory.slice(-3);
      prompt += `КОНТЕКСТ ИЗ ПРЕДЫДУЩИХ СООБЩЕНИЙ:\n`;
      recentHistory.forEach((msg: any, idx: number) => {
        const role = msg.role || 'user';
        const content = (msg.content || '').substring(0, 200);
        prompt += `${idx + 1}. [${role}]: ${content}\n`;
      });
      prompt += '\n';
    }

    if (context.additionalContext) {
      prompt += `ДОПОЛНИТЕЛЬНЫЙ КОНТЕКСТ:\n${JSON.stringify(context.additionalContext, null, 2)}\n\n`;
    }

    prompt += `ПРОАНАЛИЗИРУЙ запрос и дай рекомендации по оптимальному подходу к его выполнению.`;

    return prompt;
  }

  /**
   * Оценивает стоимость запроса (примерно)
   */
  private estimateCost(tokens: number, model: string): number {
    // Примерные цены за 1K токенов (input + output)
    const prices: Record<string, number> = {
      'gpt-4o': 0.005, // $5 per 1M tokens
      'gpt-4-turbo': 0.01,
      'gpt-3.5-turbo': 0.0005,
    };

    const pricePer1K = prices[model] || 0.005;
    return (tokens / 1000) * pricePer1K;
  }

  /**
   * Получить статистику бюджета
   */
  getBudgetStats() {
    return this.budget.getStats();
  }

  /**
   * Сбросить бюджет
   */
  resetBudget() {
    this.budget.reset();
  }
}

