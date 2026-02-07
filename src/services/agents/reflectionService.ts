/**
 * Сервис рефлексии и анализа результатов
 * Выделен из smart-ai-agent.ts для улучшения структуры кода
 */

import OpenAI from 'openai';
import type {
  ThoughtProcess,
  ExecutionPlan,
  PlannedStep,
  ProgressEvent
} from '../../agents/types';
import { ResponseGeneratorService } from './responseGeneratorService';

export interface ReflectionServiceDependencies {
  openai: OpenAI;
  getApiParams: (params: any) => any;
  think: (prompt: string, context?: any[], progressCallback?: (event: ProgressEvent) => void) => Promise<ThoughtProcess>;
  responseGenerator: ResponseGeneratorService;
}

export class ReflectionService {
  private deps: ReflectionServiceDependencies;

  constructor(deps: ReflectionServiceDependencies) {
    this.deps = deps;
  }

  /**
   * Рефлексия по выполнению
   */
  async reflectOnExecution(
    instruction: string,
    _plan: ExecutionPlan,
    _executionResult: any,
    progressCallback?: (event: ProgressEvent) => void
  ): Promise<any> {
    const reflection = await this.deps.think(
      `Я выполнил задачу "${instruction}". Что я узнал и что можно улучшить?`,
      [],
      progressCallback
    );

    return {
      learnings: reflection.reasoning,
      improvements: [],
      confidence: reflection.confidence
    };
  }

  /**
   * УНИВЕРСАЛЬНАЯ финальная рефлексия - работает с ЛЮБЫМИ данными!
   */
  async universalFinalReflection(
    userQuestion: string,
    executedSteps: PlannedStep[],
    _plan: ExecutionPlan
  ): Promise<string> {
    try {
      // Собираем ВСЕ данные из всех выполненных шагов
      const allResults = executedSteps.map(step => ({
        tool: step.action.tool,
        thought: step.thought,
        success: step.result?.success !== false,
        data: step.result
      }));

      const reflectionPrompt = `Ты - экспертный AI помощник. Ответ должен быть ПОЛЕЗНЫМ и ПРЯМЫМ без внутренних инструкций. Перед тобой реальный вопрос пользователя и результаты операций.

ВОПРОС ПОЛЬЗОВАТЕЛЯ: "${userQuestion}"

ВЫПОЛНЕННЫЕ ОПЕРАЦИИ И ИХ РЕЗУЛЬТАТЫ:
${JSON.stringify(allResults, null, 2).substring(0, 4000)}...

ТВОЯ ЗАДАЧА:
1. Чётко понять запрос.
2. Коротко обобщить доступные данные (если уместно).
3. Дать ПРЯМОЙ ответ.
4. Если уместно — дать расшифровку/детали во второй секции.

ВАРИАНТЫ ОТВЕТА:
- direct: короткий и расширенный ответ текстом
- markdown: структурированныйmarkdown
- pandas: если явно просят код/обработку данных
- report: если нужен отчёт

ПРИНЦИПЫ:
- Отвечай ТОЧНО на вопрос пользователя
- Используй РЕАЛЬНЫЕ данные из результатов
- Предложи ЛУЧШИЙ способ решения задачи
- Будь ПРАКТИЧНЫМ и ПОЛЕЗНЫМ
- Если данные подходят для pandas - предложи код!

Ответь в JSON БЕЗ внутренних инструкций и без служебных комментариев:
{
  "userWants": "что хочет пользователь простыми словами",
  "dataAnalysis": "какие данные у меня есть",
  "bestApproach": "лучший способ ответить",
  "outputFormat": "markdown|pandas|report|direct|custom",
  "reasoning": "почему этот формат лучший",
  "pandasSuitable": true/false,
  "alternativeOptions": ["другие варианты"],
  "shortAnswer": "короткий прямой ответ (обязателен)",
  "extendedAnswer": "расширенный ответ с деталями (обязателен)"
}`;

      const reflection = await this.deps.openai.chat.completions.create(
        this.deps.getApiParams({
          model: "google/gemini-flash-1.5",
          messages: [{ role: "user", content: reflectionPrompt }],
          maxTokens: 1500,
          temperature: 0.2,
          responseFormat: { type: "json_object" }
        })
      );

      const thoughtResult = JSON.parse(reflection.choices[0]?.message?.content || '{}');

      // На основе рефлексии выбираем формат ответа
      switch (thoughtResult.outputFormat) {
        case 'pandas':
          return this.deps.responseGenerator.generateUniversalPandasSolution(userQuestion, allResults, thoughtResult);

        case 'markdown':
          if (thoughtResult.shortAnswer || thoughtResult.extendedAnswer) {
            return this.deps.responseGenerator.composeDirectAnswer(userQuestion, thoughtResult);
          }
          return this.deps.responseGenerator.generateUniversalMarkdown(userQuestion, allResults, thoughtResult);

        case 'direct':
          return this.deps.responseGenerator.generateDirectAnswer(userQuestion, allResults, thoughtResult);

        case 'custom':
          return this.deps.responseGenerator.generateUniversalCustomAnswer(userQuestion, allResults, thoughtResult);

        default:
          if (thoughtResult.shortAnswer || thoughtResult.extendedAnswer) {
            return this.deps.responseGenerator.composeDirectAnswer(userQuestion, thoughtResult);
          }
          return this.deps.responseGenerator.generateUniversalReport(userQuestion, allResults, thoughtResult);
      }

    } catch (error: any) {
      console.error('Ошибка в универсальной рефлексии:', error);
      return this.deps.responseGenerator.generateSimpleAnalysis(executedSteps, userQuestion);
    }
  }

  /**
   * Анализ собственных результатов
   */
  async analyzeOwnResults(executedSteps: PlannedStep[], instruction: string): Promise<string> {
    try {
      const compactStepsData = executedSteps.map(step => {
        let compactResult = step.result;

        if (step.result && typeof step.result === 'object') {
          const resultString = JSON.stringify(step.result);
          if (resultString.length > 1000) {
            compactResult = {
              success: step.result.success,
              summary: resultString.substring(0, 500) + "...[обрезано]",
              dataSize: step.result.data ? `[${Array.isArray(step.result.data) ? step.result.data.length : 'объект'}]` : 'нет данных'
            };
          }
        }

        return {
          action: step.action.tool,
          thought: step.thought?.substring(0, 200) + (step.thought?.length > 200 ? "..." : ""),
          result: compactResult,
          success: step.result?.success !== false
        };
      });

      const prompt = `Ты - аналитический ИИ агент. Проанализируй результаты своей работы и создай детальный отчет.

ИСХОДНОЕ ЗАДАНИЕ: ${instruction.substring(0, 500)}${instruction.length > 500 ? "..." : ""}

ВЫПОЛНЕННЫЕ ШАГИ И ИХ РЕЗУЛЬТАТЫ:
${JSON.stringify(compactStepsData, null, 2)}

ТРЕБОВАНИЯ К ОТЧЕТУ:
1. Анализируй РЕАЛЬНЫЕ данные из результатов, не придумывай цифры
2. Если в результатах есть конкретные числа - используй их
3. Если нашел проблемы - опиши их конкретно
4. Создай структурированный отчет с разделами:
   - РЕЗУЛЬТАТЫ ПО ЭТАПАМ (что конкретно сделано на каждом этапе)
   - ИТОГОВЫЕ РЕЗУЛЬТАТЫ (общие показатели)
   - КЛЮЧЕВЫЕ ВЫВОДЫ (что обнаружено)
   - ПРАКТИЧЕСКИЕ РЕКОМЕНДАЦИИ (что делать дальше)

ВАЖНО: Используй только РЕАЛЬНЫЕ данные из результатов. Если данных нет - так и напиши.`;

      const analysisResult = await this.deps.openai.chat.completions.create(
        this.deps.getApiParams({
          model: "google/gemini-flash-1.5",
          messages: [{ role: "user", content: prompt }],
          maxTokens: 2000,
          temperature: 0.3
        })
      );

      return analysisResult.choices[0]?.message?.content || "## ОШИБКА АНАЛИЗА\nНе удалось проанализировать результаты.";

    } catch (error: any) {
      console.error("Ошибка анализа результатов:", error);
      return this.deps.responseGenerator.generateSimpleAnalysis(executedSteps, instruction);
    }
  }

  /**
   * Анализ ошибки
   */
  async analyzeFailure(error: Error, instruction: string): Promise<any> {
    try {
      const analysis = await this.deps.think(
        `Задача "${instruction}" не удалась с ошибкой: ${error.message}. Что пошло не так и как исправить?`,
        []
      );

      return {
        userMessage: `К сожалению, не удалось выполнить задачу.\n\n**Причина:** ${analysis.observation}\n\n**Рекомендация:** ${analysis.action}`,
        recoveryPlan: analysis.confidence > 0.7 ? analysis.action : null
      };
    } catch (thinkError) {
      console.error('Ошибка в analyzeFailure:', thinkError);
      return {
        userMessage: `К сожалению, не удалось выполнить задачу.\n\n**Причина:** ${error.message}\n\n**Рекомендация:** Попробуйте перефразировать запрос или выберите другую модель.`,
        recoveryPlan: null
      };
    }
  }

  /**
   * Попытка восстановления
   */
  async attemptRecovery(recoveryPlan: string, progressCallback?: (event: ProgressEvent) => void): Promise<any> {
    progressCallback?.({
      type: 'reasoning_step',
      message: 'Пытаюсь восстановиться...',
      reasoning_text: recoveryPlan
    });

    return {
      success: false,
      message: 'Восстановление в процессе разработки'
    };
  }
}

