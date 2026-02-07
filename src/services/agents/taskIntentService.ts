/**
 * Task Intent Service v2.0
 * Gap #2: LLM-based intent classification with regex fallback
 * 
 * Extracts required steps from user query using:
 * 1. LLM classification (primary) — model determines actions & tools
 * 2. Regex patterns (fallback) — deterministic fallback if LLM unavailable
 */

import type OpenAI from 'openai';

export type TaskAction = 'extract' | 'search' | 'calculate' | 'create' | 'compare' | 'analyze' | 'transform' | 'navigate' | 'configure' | 'diagnose';

export interface TaskStep {
    action: TaskAction;
    keywords: string[];
    requiredTools: string[];
    reasoning?: string; // LLM's reasoning for this step
}

export interface TaskIntent {
    steps: TaskStep[];
    isMultiStep: boolean;
    originalQuery: string;
    classifiedBy: 'llm' | 'regex'; // Для аудита
}

export interface IntentClassificationDeps {
    openai: OpenAI;
    getApiParams: (params: any) => any;
}

// ============================
// Regex Fallback (legacy patterns)
// ============================

const ACTION_PATTERNS: Array<{
    action: TaskAction;
    patterns: RegExp[];
    requiredTools: string[];
}> = [
        {
            action: 'extract',
            patterns: [
                /извлек|извлечь|вытащ|оцифр|распознай/i,
                /extract|parse|ocr/i,
                /из\s+(pdf|пдф|документ|файл|страниц)/i,
                /со\s+страницы?\s+\d+/i
            ],
            requiredTools: ['extract_table_to_excel', 'match_specification_to_catalog', 'view', 'bash_tool']
        },
        {
            action: 'search',
            patterns: [
                /поиск|поищи|найд|искать/i,
                /в\s+каталог|в\s+базе?|у\s+нас/i,
                /search|find|lookup/i,
                /подбер|подобрать/i
            ],
            requiredTools: ['expert_search', 'category_search', 'match_specification_to_catalog', 'search_files_by_name']
        },
        {
            action: 'calculate',
            patterns: [
                /рассчитай|расчёт|расчет|вычисли/i,
                /calculate|compute/i,
                /мощност|площад|объём|объем/i
            ],
            requiredTools: ['execute_code', 'execute_bash', 'bash_tool']
        },
        {
            action: 'create',
            patterns: [
                /создай|сделай|сформируй|генерируй/i,
                /create|generate|make/i,
                /excel|pdf|word|график|отчёт|отчет/i
            ],
            requiredTools: ['create_file', 'create_artifact', 'extract_table_to_excel']
        },
        {
            action: 'compare',
            patterns: [
                /сравни|сопостав|соотнеси/i,
                /compare|match|correlate/i
            ],
            requiredTools: ['compare_products', 'search_products']
        },
        {
            action: 'analyze',
            patterns: [
                /анализ|проанализируй|изучи/i,
                /analyze|examine|review/i,
                /качеств|статистик/i
            ],
            requiredTools: ['analyze_search_params', 'execute_code']
        },
        {
            action: 'transform',
            patterns: [
                /преобраз|конверт|перевед/i,
                /transform|convert/i,
                /нормализ|очист/i
            ],
            requiredTools: ['execute_code', 'bash_tool']
        }
    ];

// ============================
// LLM Classification Prompt
// ============================

const INTENT_CLASSIFICATION_PROMPT = `You are an intent classifier for an industrial product catalog AI agent.
Classify the user query into task steps. Each step has:
- action: one of [extract, search, calculate, create, compare, analyze, transform, navigate, configure, diagnose]
- reasoning: brief explanation why this action is needed
- requiredTools: list of tools from the available set

Available tools:
- search_products, quick_search, compare_products, analyze_search_params (product search)
- match_specification_to_catalog (PDF → catalog matching, full pipeline)
- extract_table_to_excel (PDF/image table extraction)
- export_search_to_excel, advanced_export_to_excel (Excel export)
- execute_code, execute_bash, bash_tool (code execution)
- create_file, create_artifact (file/artifact creation)
- web_search, web_fetch (web search)
- view, search_files_by_name, read_project_file (file operations)
- get_category_info, get_category_config, run_category_diagnostic (diagnostics)
- navigate_to_tab, get_current_screen (UI navigation)

IMPORTANT: For "extract from PDF + search in catalog" → use SINGLE step with match_specification_to_catalog.

Respond in JSON: {"steps": [{"action": "...", "reasoning": "...", "requiredTools": ["..."]}]}`;

// Intent cache to avoid re-classification
const intentCache = new Map<string, { intent: TaskIntent; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class TaskIntentService {
    /**
     * Async LLM-based intent analysis with regex fallback
     */
    async analyzeIntentAsync(
        query: string,
        deps?: IntentClassificationDeps
    ): Promise<TaskIntent> {
        // Check cache first
        const cacheKey = query.trim().toLowerCase().slice(0, 200);
        const cached = intentCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
            return cached.intent;
        }

        // Try LLM classification
        if (deps?.openai) {
            try {
                const llmIntent = await this.classifyWithLLM(query, deps);
                intentCache.set(cacheKey, { intent: llmIntent, timestamp: Date.now() });
                return llmIntent;
            } catch (error: any) {
                console.warn('[TaskIntentService] LLM classification failed, falling back to regex:', error.message);
            }
        }

        // Fallback to regex
        const regexIntent = this.analyzeIntentRegex(query);
        intentCache.set(cacheKey, { intent: regexIntent, timestamp: Date.now() });
        return regexIntent;
    }

    /**
     * Synchronous regex-only analysis (backward compatibility)
     */
    analyzeIntent(query: string): TaskIntent {
        return this.analyzeIntentRegex(query);
    }

    /**
     * LLM-based classification
     */
    private async classifyWithLLM(
        query: string,
        deps: IntentClassificationDeps
    ): Promise<TaskIntent> {
        const response = await deps.openai.chat.completions.create(
            deps.getApiParams({
                model: 'google/gemini-2.5-flash-lite', // Быстрая модель для классификации
                messages: [
                    { role: 'system', content: INTENT_CLASSIFICATION_PROMPT },
                    { role: 'user', content: query }
                ],
                response_format: { type: 'json_object' },
                max_tokens: 500,
                temperature: 0.1 // Детерминизм
            })
        );

        const content = response.choices[0]?.message?.content || '{}';
        const parsed = JSON.parse(content);

        if (!parsed.steps || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
            throw new Error('LLM returned no steps');
        }

        const validActions = new Set<string>([
            'extract', 'search', 'calculate', 'create', 'compare',
            'analyze', 'transform', 'navigate', 'configure', 'diagnose'
        ]);

        const steps: TaskStep[] = parsed.steps
            .filter((s: any) => s.action && validActions.has(s.action))
            .map((s: any) => ({
                action: s.action as TaskAction,
                keywords: [s.reasoning || s.action],
                requiredTools: Array.isArray(s.requiredTools) ? s.requiredTools : [],
                reasoning: s.reasoning || ''
            }));

        if (steps.length === 0) {
            throw new Error('No valid steps from LLM');
        }

        return {
            steps,
            isMultiStep: steps.length > 1,
            originalQuery: query,
            classifiedBy: 'llm'
        };
    }

    /**
     * Regex-based classification (fallback)
     */
    private analyzeIntentRegex(query: string): TaskIntent {
        const detectedSteps: TaskStep[] = [];
        const queryLower = query.toLowerCase();

        for (const actionDef of ACTION_PATTERNS) {
            const matchingPatterns = actionDef.patterns.filter(p => p.test(queryLower));

            if (matchingPatterns.length > 0) {
                detectedSteps.push({
                    action: actionDef.action,
                    keywords: matchingPatterns.map(p => {
                        const match = queryLower.match(p);
                        return match ? match[0] : '';
                    }).filter(Boolean),
                    requiredTools: actionDef.requiredTools
                });
            }
        }

        // Special case: "X со страницы Y в каталоге" pattern
        const hasPdfPages = /со\s+страницы?\s+\d+/i.test(query) || /из\s+(pdf|пдф)/i.test(query);
        const hasCatalog = /в\s+каталог|у\s+нас|jde|аналог|подбор|сматч|подбер/i.test(query);
        if (hasPdfPages && hasCatalog) {
            return {
                steps: [{
                    action: 'search',
                    keywords: ['со страницы', 'в каталоге'],
                    requiredTools: ['match_specification_to_catalog']
                }],
                isMultiStep: false,
                originalQuery: query,
                classifiedBy: 'regex'
            };
        }

        return {
            steps: detectedSteps,
            isMultiStep: detectedSteps.length > 1,
            originalQuery: query,
            classifiedBy: 'regex'
        };
    }

    /**
     * Checks if a specific step's required tools were executed
     */
    isStepCompleted(step: TaskStep, executedTools: string[]): boolean {
        return step.requiredTools.some(tool => executedTools.includes(tool));
    }

    /**
     * Gets the next step that needs to be executed
     */
    getNextPendingStep(intent: TaskIntent, executedTools: string[]): TaskStep | null {
        for (const step of intent.steps) {
            if (!this.isStepCompleted(step, executedTools)) {
                return step;
            }
        }
        return null;
    }

    /**
     * Generates a continuation prompt to hint the model about next step
     */
    generateContinuationPrompt(pendingStep: TaskStep, lastToolResult: any): string {
        const actionDescriptions: Record<TaskAction, string> = {
            extract: 'извлечь данные',
            search: 'найти товары в каталоге',
            calculate: 'выполнить расчёт',
            create: 'создать файл/отчёт',
            compare: 'сравнить данные',
            analyze: 'проанализировать',
            transform: 'преобразовать данные',
            navigate: 'перейти к нужной секции',
            configure: 'настроить конфигурацию',
            diagnose: 'провести диагностику'
        };

        const actionDesc = actionDescriptions[pendingStep.action] || pendingStep.action;
        const suggestedTool = pendingStep.requiredTools[0];

        let dataContext = '';
        if (lastToolResult?.rows_count) {
            dataContext = `Извлечено ${lastToolResult.rows_count} строк данных. `;
        }

        // Если есть reasoning от LLM — используем его для более точного промпта
        const reasoningHint = pendingStep.reasoning
            ? ` (${pendingStep.reasoning})`
            : '';

        return `ПРОДОЛЖАЙ ВЫПОЛНЕНИЕ: ${dataContext}Следующий шаг — ${actionDesc}${reasoningHint}. Используй инструмент \`${suggestedTool}\` с данными из предыдущего шага.`;
    }

    /**
     * Clear intent cache (for testing)
     */
    clearCache(): void {
        intentCache.clear();
    }
}
