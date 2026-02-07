/**
 * Сервис планирования действий
 * Выделен из smart-ai-agent.ts для улучшения структуры кода
 */

import OpenAI from 'openai';
import type {
  ThoughtProcess,
  ExecutionPlan,
  PlannedStep,
  ChatMessage,
  ProgressEvent,
  DataProcessingContext
} from '../../agents/types';
import { agentDebugService } from '../agentDebugService';
import { ContextAnalyzerService } from './contextAnalyzerService';
import type { AppActions } from '../../agents/types';

export interface PlanningServiceDependencies {
  openai: OpenAI;
  context: DataProcessingContext;
  appActions?: AppActions;
  getApiParams: (params: any) => any;
  getToolsSpecification: () => any[];
  getThinkingSystemPrompt: () => string;
  getPlanningSystemPrompt: () => string;
  saveLogToFile: (content: string, filename: string) => void;
  config: {
    streamingLimits: {
      maxThinkIterations: number;
      maxPlanIterations: number;
    };
  };
  onThinkingIteration?: () => void;
  onConfidenceUpdate?: (confidence: number) => void;
}

export class PlanningService {
  private contextAnalyzer: ContextAnalyzerService;
  private thoughtHistory: ThoughtProcess[] = [];
  private deps: PlanningServiceDependencies;

  constructor(deps: PlanningServiceDependencies) {
    this.deps = deps;
    this.contextAnalyzer = new ContextAnalyzerService({
      appActions: deps.appActions,
      context: deps.context
    });
  }

  getThoughtHistory(): ThoughtProcess[] {
    return this.thoughtHistory;
  }

  /**
   * Процесс размышления (Chain-of-Thought) с стримингом
   */
  async think(
    prompt: string,
    _context: any[] = [],
    progressCallback?: (event: ProgressEvent) => void
  ): Promise<ThoughtProcess> {
    // СНАЧАЛА анализируем доступный контекст
    let contextInfo = '';
    try {
      const availableContext = await this.contextAnalyzer.analyzeAvailableContext(prompt);
      contextInfo = `\n\nДОСТУПНЫЕ ДАННЫЕ:\n- ${availableContext.summary}\n- ${availableContext.details}`;

      if (availableContext.canAnswerDirectly) {
        contextInfo += `\nВАЖНО: Данные уже доступны, можно отвечать сразу!`;
      }
    } catch (e) {
      contextInfo = '\n\nДоступные данные: анализ не удался';
    }

    const thinkingPrompt = `
${prompt}
${contextInfo}

Проанализируй запрос и определи оптимальный подход:

1. OBSERVATION - Что я вижу/знаю? (включая доступные данные)
2. REASONING - Какие выводы делаю? 
3. ACTION - Что нужно сделать? (минимум действий)
4. CONFIDENCE - Уверенность 0-1

ВАЖНО - Сам определи сложность:
- Если это простое приветствие/вопрос - можно ответить сразу без планирования
- Если нужен анализ/планирование - укажи это в action
- Если данные уже есть - используй их, не вызывай лишние инструменты

Ответь в JSON:
{
  "observation": "что наблюдаю",
  "reasoning": "мои выводы",
  "action": "что делать (может быть 'ответить сразу' для простых случаев)",
  "confidence": 0.8
}`;

    try {
      const validMessages = [
        { role: 'system' as const, content: this.deps.getThinkingSystemPrompt() },
        { role: 'user' as const, content: thinkingPrompt }
      ];

      progressCallback?.({
        type: 'reasoning_step',
        message: 'Размышляю...',
        reasoning_text: 'Начинаю анализ ситуации'
      });

      const stream: AsyncIterable<any> = await (this.deps.openai.chat.completions.create as any)(
        this.deps.getApiParams({
          messages: validMessages,
          temperature: 0.2,
          responseFormat: { type: "json_object" },
          stream: true
        })
      );

      let fullContent = '';
      let currentThought = '';
      let thinkIterationCount = 0;
      const maxThinkIterations = this.deps.config.streamingLimits.maxThinkIterations;

      try {
        for await (const chunk of stream) {
          thinkIterationCount++;
          this.deps.onThinkingIteration?.();

          if (thinkIterationCount > maxThinkIterations) {
            console.warn('Внимание: Прерван поток мышления - превышено максимальное количество итераций');
            break;
          }

          const content = chunk.choices[0]?.delta?.content || '';
          if (content) {
            fullContent += content;
            currentThought += content;

            if (thinkIterationCount % 5 === 0) {
              progressCallback?.({
                type: 'reasoning_step',
                message: 'Думаю...',
                reasoning_text: `Мысли: ${currentThought.substring(Math.max(0, currentThought.length - 150))}`
              });
            }
          }

          if (chunk.choices[0]?.finish_reason) {
            console.log('Поток мышления завершен:', chunk.choices[0].finish_reason);
            break;
          }
        }
      } catch (streamError) {
        console.error('Ошибка обработки потока мышления:', streamError);
      }

      let thought: any = {};

      try {
        thought = JSON.parse(fullContent || '{}');
      } catch (parseError) {
        console.warn('Внимание: Ошибка парсинга JSON мышления, использую базовые значения. Контент:', fullContent.substring(0, 200));
        thought = {};
      }

      if (!thought.observation || !thought.reasoning || !thought.action) {
        thought = {
          observation: thought.observation || 'Анализирую запрос пользователя',
          reasoning: thought.reasoning || 'Определяю последовательность действий',
          action: thought.action || 'Выполняю анализ',
          confidence: typeof thought.confidence === 'number' ? thought.confidence : 0.7
        };
      }

      progressCallback?.({
        type: 'reasoning_step',
        message: 'Мысль сформирована',
        reasoning_text: `Наблюдение: ${thought.observation}\nРазмышление: ${thought.reasoning}\nДействие: ${thought.action}\nУверенность: ${Math.round(thought.confidence * 100)}%`
      });

      this.deps.onConfidenceUpdate?.(thought.confidence);
      agentDebugService.logThinking(thought, prompt);

      this.thoughtHistory.push(thought);
      return thought;

    } catch (error: any) {
      console.error('Ошибка в процессе размышления:', error);

      const fallbackThought = {
        observation: 'Возникла проблема с анализом, переключаюсь на базовую логику',
        reasoning: 'Буду выполнять действия по стандартному алгоритму',
        action: 'Ищу данные по запросу пользователя',
        confidence: 0.5
      };

      progressCallback?.({
        type: 'reasoning_step',
        message: 'Внимание: Fallback мышление',
        reasoning_text: `Наблюдение: ${fallbackThought.observation}\nРазмышление: ${fallbackThought.reasoning}\nДействие: ${fallbackThought.action}`
      });

      this.thoughtHistory.push(fallbackThought);
      return fallbackThought;
    }
  }

  /**
   * Создание динамического плана без хардкода
   */
  async createDynamicPlan(
    instruction: string,
    initialThought: ThoughtProcess,
    _chatHistory: ChatMessage[],
    progressCallback?: (event: ProgressEvent) => void
  ): Promise<ExecutionPlan> {

    try {
      const availableTools = this.deps.getToolsSpecification();
      const availableContext = await this.contextAnalyzer.analyzeAvailableContext(instruction);

      if (availableContext.canAnswerDirectly) {
        progressCallback?.({
          type: 'reasoning_step',
          message: 'Обнаружил данные в контексте!',
          reasoning_text: `${availableContext.summary}\n${availableContext.details}\n\nСоздаю упрощенный план для прямого ответа`
        });

        return {
          goal: instruction,
          thoughts: [{
            observation: availableContext.summary,
            reasoning: 'Данные уже доступны в контексте приложения',
            action: 'Использую имеющиеся данные без дополнительных инструментов',
            confidence: 0.95
          }],
          steps: [{
            id: 'direct_answer',
            thought: 'Отвечаю на основе доступных данных',
            action: {
              tool: 'get_file_metadata',
              args: { fileName: 'Cable.mdb' },
              reasoning: 'Получаю структуру из уже загруженного файла'
            },
            dependencies: [],
            expectedResult: 'Список таблиц и полей из доступного файла',
            alternativeApproaches: [],
            executed: false
          }],
          adaptations: ['Используется прямой доступ к данным'],
          learnings: {}
        };
      }

      const contextAnalysis = this.contextAnalyzer.analyzeContext();

      const planningPrompt = `
На основе запроса создай оптимальный план действий.

ЗАПРОС: ${instruction}
ПЕРВИЧНЫЙ АНАЛИЗ: ${JSON.stringify(initialThought)}

ДОСТУПНЫЕ ДАННЫЕ (ВАЖНО!):
${availableContext.summary}
Детали: ${availableContext.details}

ОБЩИЙ КОНТЕКСТ: ${JSON.stringify(contextAnalysis)}

ДОСТУПНЫЕ ИНСТРУМЕНТЫ:
${availableTools.map(t => `- ${t.function.name}: ${t.function.description}`).join('\n')}

ВАЖНЫЕ ПРИНЦИПЫ:
1. СНАЧАЛА проверь доступные данные - возможно ответ уже есть!
2. Не вызывай инструменты если данные уже доступны
3. Используй минимум действий для достижения цели
4. Учитывай зависимости между действиями
5. Адаптируйся под контекст

Создай план, который:
1. Достигает цели наиболее эффективным путем
2. Учитывает уже доступные данные
3. Имеет альтернативные подходы для критических шагов
4. Минимизирует количество вызовов инструментов

Ответь СТРОГО в JSON формате:
{
  "goal": "четкая формулировка цели",
  "thoughts": [
    {
      "observation": "что я наблюдаю (включая доступные данные)",
      "reasoning": "мои выводы с учетом контекста", 
      "action": "что планирую делать",
      "confidence": 0.8
    }
  ],
  "steps": [
    {
      "id": "step_1",
      "thought": "описание шага",
      "action": {
        "tool": "название_инструмента",
        "args": {"param": "value"},
        "reasoning": "обоснование необходимости этого инструмента"
      },
      "dependencies": [],
      "expectedResult": "ожидаемый результат",
      "alternativeApproaches": []
    }
  ]
}`;

      progressCallback?.({
        type: 'reasoning_step',
        message: 'Создаю план действий...',
        reasoning_text: 'Анализирую доступные инструменты и создаю оптимальную последовательность действий'
      });

      const stream: AsyncIterable<any> = await (this.deps.openai.chat.completions.create as any)(
        this.deps.getApiParams({
          messages: [
            { role: 'system' as const, content: this.deps.getPlanningSystemPrompt() },
            { role: 'user' as const, content: planningPrompt }
          ],
          temperature: 0.3,
          maxTokens: 4000,
          responseFormat: { type: "json_object" },
          stream: true
        })
      );

      let fullPlanContent = '';
      let currentPlanText = '';
      let iterationCount = 0;
      const maxIterations = this.deps.config.streamingLimits.maxPlanIterations * 3;

      try {
        for await (const chunk of stream) {
          iterationCount++;

          if (iterationCount > maxIterations) {
            console.warn('Внимание: Прерван поток планирования - превышено максимальное количество итераций');
            break;
          }

          const content = chunk.choices[0]?.delta?.content || '';
          if (content) {
            fullPlanContent += content;
            currentPlanText += content;

            if (iterationCount % 10 === 0) {
              progressCallback?.({
                type: 'reasoning_step',
                message: 'Планирую действия...',
                reasoning_text: `Создание плана: ${currentPlanText.substring(Math.max(0, currentPlanText.length - 100))}`
              });
            }
          }

          if (chunk.choices[0]?.finish_reason) {
            console.log('Поток планирования завершен:', chunk.choices[0].finish_reason);
            break;
          }
        }
      } catch (streamError) {
        console.error('Ошибка обработки потока:', streamError);
      }

      const timestamp = new Date().toISOString();
      const logData = `
=== PLANNING LOG ${timestamp} ===
ЗАПРОС: ${instruction}
ПРОМПТ ДЛИНА: ${planningPrompt.length}
ОТВЕТ ДЛИНА: ${fullPlanContent.length}
ИТЕРАЦИЙ: ${iterationCount}

ПРОМПТ:
${planningPrompt}

ОТВЕТ OPENAI:
${fullPlanContent}
`;

      try {
        this.deps.saveLogToFile(logData, `planning_${Date.now()}.txt`);
      } catch (writeError) {
        // Тихо игнорируем ошибки сохранения
      }

      let planData: any = {};
      try {
        if (fullPlanContent.trim()) {
          let jsonContent = fullPlanContent.trim();

          // Базовые исправления для неполного JSON
          if (!jsonContent.endsWith('}')) {
            jsonContent += '}';
          }
          if (!jsonContent.startsWith('{')) {
            const firstBrace = jsonContent.indexOf('{');
            if (firstBrace > 0) {
              jsonContent = jsonContent.substring(firstBrace);
            }
          }

          planData = JSON.parse(jsonContent);
        }
      } catch (parseError: any) {
        console.error('Ошибка парсинга плана:', parseError);
        console.error('Содержимое:', fullPlanContent.substring(0, 500));

        // Fallback план
        planData = {
          goal: instruction,
          thoughts: [initialThought],
          steps: [{
            id: 'fallback_step',
            thought: 'Выполняю базовый план из-за ошибки парсинга',
            action: {
              tool: 'get_file_metadata',
              args: {},
              reasoning: 'Fallback действие'
            },
            dependencies: [],
            expectedResult: 'Результат выполнения',
            alternativeApproaches: []
          }]
        };
      }

      // Валидация и нормализация плана
      const validatedPlan = this.validateAndEnhancePlan(planData, instruction);

      progressCallback?.({
        type: 'reasoning_step',
        message: 'План создан',
        reasoning_text: `Создано шагов: ${validatedPlan.steps.length}\nЦель: ${validatedPlan.goal}`
      });

      return validatedPlan;

    } catch (error: any) {
      console.error('Ошибка создания плана:', error);

      // Fallback план
      return {
        goal: instruction,
        thoughts: [initialThought],
        steps: [{
          id: 'error_fallback',
          thought: 'Создаю упрощенный план из-за ошибки',
          action: {
            tool: 'get_file_metadata',
            args: {},
            reasoning: 'Базовое действие при ошибке планирования'
          },
          dependencies: [],
          expectedResult: 'Результат выполнения',
          alternativeApproaches: []
        }],
        adaptations: ['Использован упрощенный план из-за ошибки'],
        learnings: {}
      };
    }
  }

  /**
   * Валидация и улучшение плана
   */
  private validateAndEnhancePlan(planData: any, instruction: string): ExecutionPlan {
    if (!planData.goal) {
      planData.goal = instruction;
    }

    if (!Array.isArray(planData.steps)) {
      planData.steps = [];
    }

    if (!Array.isArray(planData.thoughts)) {
      planData.thoughts = [];
    }

    // Нормализуем шаги
    planData.steps = planData.steps.map((step: any, index: number) => {
      if (!step.id) {
        step.id = `step_${index + 1}`;
      }
      if (!step.thought) {
        step.thought = step.action?.reasoning || 'Выполняю действие';
      }
      if (!step.action) {
        step.action = { tool: 'none', args: {}, reasoning: 'Не указано действие' };
      }
      if (!step.dependencies) {
        step.dependencies = [];
      }
      if (!step.expectedResult) {
        step.expectedResult = 'Результат выполнения';
      }
      if (!step.alternativeApproaches) {
        step.alternativeApproaches = [];
      }
      return step;
    });

    if (!planData.adaptations) {
      planData.adaptations = [];
    }

    if (!planData.learnings) {
      planData.learnings = {};
    }

    return planData as ExecutionPlan;
  }

  /**
   * Топологическая сортировка шагов по зависимостям
   */
  topologicalSort(steps: PlannedStep[]): PlannedStep[] {
    const sorted: PlannedStep[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (step: PlannedStep) => {
      if (visiting.has(step.id)) {
        console.warn(`Обнаружен цикл зависимостей для шага ${step.id}`);
        return;
      }
      if (visited.has(step.id)) {
        return;
      }

      visiting.add(step.id);

      for (const depId of step.dependencies) {
        const depStep = steps.find(s => s.id === depId);
        if (depStep) {
          visit(depStep);
        }
      }

      visiting.delete(step.id);
      visited.add(step.id);
      sorted.push(step);
    };

    for (const step of steps) {
      if (!visited.has(step.id)) {
        visit(step);
      }
    }

    return sorted;
  }

  /**
   * Проверка готовности зависимостей шага
   */
  areDependenciesReady(step: PlannedStep, allSteps: PlannedStep[]): boolean {
    return step.dependencies.every(depId => {
      const depStep = allSteps.find(s => s.id === depId);
      return depStep?.executed === true;
    });
  }

  // ──────────────────────────────────────────────
  // Gap D: User-Visible Plan Preview
  // ──────────────────────────────────────────────

  /**
   * Создаёт структурированный план для показа пользователю перед выполнением.
   * Для сложных задач (>2 шагов) показывается UI-карточка с кнопками Confirm/Modify.
   */
  createUserVisiblePlan(plan: ExecutionPlan): PlanPreview {
    const steps: PlanPreviewStep[] = plan.steps.map((step, idx) => ({
      index: idx + 1,
      description: step.thought || step.action?.reasoning || `Шаг ${idx + 1}`,
      tools: step.action?.tool ? [step.action.tool] : [],
      estimatedTime: this.estimateStepTime(step),
      status: 'pending' as const
    }));

    const complexity = steps.length <= 2 ? 'low' : steps.length <= 5 ? 'medium' : 'high';

    return {
      goal: plan.goal,
      steps,
      totalSteps: steps.length,
      complexity,
      estimatedTotalTime: steps.reduce((sum, s) => sum + s.estimatedTime, 0),
      requiresConfirmation: steps.length > 2 || complexity === 'high'
    };
  }

  /**
   * Оценивает время выполнения шага (в секундах)
   */
  private estimateStepTime(step: PlannedStep): number {
    const tool = step.action?.tool || '';

    // Эвристика основана на типе инструмента
    if (tool.includes('search') || tool.includes('fetch')) return 5;
    if (tool.includes('bash') || tool.includes('docker')) return 10;
    if (tool.includes('create') || tool.includes('write')) return 3;
    if (tool.includes('analyze') || tool.includes('calculate')) return 8;
    return 5; // default
  }

  /**
   * Определяет, нужно ли показывать план пользователю
   */
  shouldShowPlanPreview(plan: ExecutionPlan): boolean {
    return plan.steps.length > 2;
  }
}

// ─── Gap D: План для отображения пользователю ───

export interface PlanPreviewStep {
  index: number;
  description: string;
  tools: string[];
  estimatedTime: number; // секунды
  status: 'pending' | 'running' | 'completed' | 'failed';
}

export interface PlanPreview {
  goal: string;
  steps: PlanPreviewStep[];
  totalSteps: number;
  complexity: 'low' | 'medium' | 'high';
  estimatedTotalTime: number; // секунды
  requiresConfirmation: boolean;
}
