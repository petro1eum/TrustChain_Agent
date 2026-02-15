/**
 * Task Intent Service v2.0
 * Gap #2: LLM-based intent classification with regex fallback
 * 
 * Extracts required steps from user query using:
 * 1. LLM classification (primary) — model determines actions & tools
 * 2. Regex patterns (fallback) — deterministic fallback if LLM unavailable
 */

import type OpenAI from 'openai';
// Platform-agnostic: tools come from MCP, no hardcoded platform checks

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

// Build ACTION_PATTERNS — universal, project-agnostic patterns only.
// Platform-specific tools are discovered via MCP, not hardcoded.
function getActionPatterns(): Array<{
    action: TaskAction;
    patterns: RegExp[];
    requiredTools: string[];
}> {
    const patterns: Array<{ action: TaskAction; patterns: RegExp[]; requiredTools: string[] }> = [];

    // Universal: extract from documents
    patterns.push({
        action: 'extract',
        patterns: [
            /извлек|извлечь|вытащ|оцифр|распознай/i,
            /extract|parse|ocr/i,
            /из\s+(pdf|пдф|документ|файл|страниц)/i,
            /со\s+страницы?\s+\d+/i
        ],
        requiredTools: ['extract_table_to_excel', 'view', 'bash_tool']
    });
    // Universal: search
    patterns.push({
        action: 'search',
        patterns: [
            /поиск|поищи|найд|искать/i,
            /search|find|lookup/i,
            /подбер|подобрать/i
        ],
        requiredTools: ['web_search', 'search_files_by_name']
    });

    // Universal patterns — apply in all contexts
    patterns.push(
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
            action: 'analyze',
            patterns: [
                /анализ|проанализируй|изучи/i,
                /analyze|examine|review/i,
                /качеств|статистик/i
            ],
            requiredTools: ['execute_code']
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
    );

    // Universal: compare
    patterns.push({
        action: 'compare',
        patterns: [
            /сравни|сопостав|соотнеси/i,
            /compare|match|correlate/i
        ],
        requiredTools: ['execute_code']
    });

    return patterns;
}

// ============================
// LLM Classification Prompt (generic, project-agnostic)
// ============================

function buildIntentClassificationPrompt(availableToolNames: string[]): string {
    const toolList = availableToolNames.length > 0
        ? availableToolNames.join(', ')
        : 'execute_code, execute_bash, web_search, web_fetch, create_file, create_artifact, view, search_files_by_name';

    return `You are an intent classifier for an AI assistant.
Classify the user query into task steps. Each step has:
- action: one of [extract, search, calculate, create, compare, analyze, transform, navigate, configure, diagnose]
- reasoning: brief explanation why this action is needed
- requiredTools: list of tools from the available set

Available tools: ${toolList}

IMPORTANT: Only use tools from the available set above. Do NOT invent tools.

Respond in JSON: {"steps": [{"action": "...", "reasoning": "...", "requiredTools": ["..."]}]}`;
}

// Intent cache to avoid re-classification
const intentCache = new Map<string, { intent: TaskIntent; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Custom intent pattern that projects can inject via postMessage (trustchain:intent_patterns).
 * Patterns are RegExp-serialized as strings and converted at injection time.
 */
export interface CustomIntentPattern {
    action: TaskAction;
    patterns: string[];   // Regex patterns as strings, e.g. ["поиск.*документ", "find.*doc"]
    requiredTools: string[];
}

export class TaskIntentService {
    // Extensibility: projects can inject their own patterns and domain hints
    private customPatterns: Array<{ action: TaskAction; patterns: RegExp[]; requiredTools: string[] }> = [];
    private domainHints: string = '';

    /**
     * Inject custom intent patterns from integrating project.
     * Called when receiving `trustchain:intent_patterns` postMessage.
     */
    setCustomPatterns(patterns: CustomIntentPattern[]): void {
        this.customPatterns = patterns.map(p => ({
            action: p.action,
            patterns: p.patterns.map(s => new RegExp(s, 'i')),
            requiredTools: p.requiredTools,
        }));
        // Clear cache — patterns changed
        intentCache.clear();
        console.log(`[TaskIntentService] Loaded ${this.customPatterns.length} custom intent patterns`);
    }

    /**
     * Inject domain-specific hints for LLM classifier.
     * E.g., "This is a document management system. Users may ask about documents, tasks, meetings."
     */
    setDomainHints(hints: string): void {
        this.domainHints = hints;
        intentCache.clear();
    }

    /**
     * Async LLM-based intent analysis with regex fallback
     */
    async analyzeIntentAsync(
        query: string,
        deps?: IntentClassificationDeps,
        availableToolNames?: string[]
    ): Promise<TaskIntent> {
        // Check cache first
        const cacheKey = query.trim().toLowerCase().slice(0, 200);
        const cached = intentCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
            return cached.intent;
        }

        // Deterministic path for explicit workflow prompts:
        // - "Обязательные инструменты: a, b, c"
        // - numbered steps like "1. list_tasks(...)".
        const explicitTools = this.extractExplicitToolSequence(query);
        if (explicitTools.length > 0) {
            const explicitIntent: TaskIntent = {
                steps: explicitTools.map((tool) => ({
                    action: this.inferActionFromTool(tool),
                    keywords: [tool],
                    requiredTools: [tool],
                    reasoning: 'explicit workflow tool requirement from user prompt',
                })),
                isMultiStep: explicitTools.length > 1,
                originalQuery: query,
                classifiedBy: 'regex',
            };
            intentCache.set(cacheKey, { intent: explicitIntent, timestamp: Date.now() });
            return explicitIntent;
        }

        // Try LLM classification
        if (deps?.openai) {
            try {
                const llmIntent = await this.classifyWithLLM(query, deps, availableToolNames || []);
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

    private inferActionFromTool(toolName: string): TaskAction {
        const n = String(toolName || '').toLowerCase();
        if (/^(create_|update_|delete_|set_|apply_)/.test(n)) return 'create';
        if (n.includes('stats') || n.includes('analy') || n.includes('report')) return 'analyze';
        if (n.includes('navigate') || n.includes('page_')) return 'navigate';
        if (n.includes('compare') || n.includes('match')) return 'compare';
        return 'search';
    }

    private extractExplicitToolSequence(query: string): string[] {
        const out: string[] = [];
        const seen = new Set<string>();
        const push = (value: string) => {
            const tool = String(value || '').trim();
            if (!tool) return;
            if (!/^[a-z][a-z0-9_]*$/i.test(tool)) return;
            // Deduplicate: if we already have a longer mcp_ variant, skip the short one.
            // e.g. skip "list_tasks" if "mcp_panel_onaidocs_list_tasks" is already in.
            if (seen.has(tool)) return;
            // Check if a fully-qualified variant is already present
            if (!tool.startsWith('mcp_') && [...seen].some(t => t.endsWith(`_${tool}`))) return;
            seen.add(tool);
            out.push(tool);
        };

        // 1) Header with required tools (these are usually fully-qualified mcp_ names)
        const reqMatch = query.match(/обязательные\s+инструменты\s*:\s*([^\n]+)/i);
        if (reqMatch?.[1]) {
            reqMatch[1].split(',').forEach((part) => push(part));
        }

        // 2) Numbered steps with function-like calls (these are usually short names)
        const stepRegex = /^\s*\d+\.\s*([a-z][a-z0-9_]*)\s*\(/gim;
        let m: RegExpExecArray | null = null;
        while ((m = stepRegex.exec(query)) !== null) {
            push(m[1]);
        }

        return out;
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
        deps: IntentClassificationDeps,
        availableToolNames: string[]
    ): Promise<TaskIntent> {
        const prompt = buildIntentClassificationPrompt(availableToolNames)
            + (this.domainHints ? `\n\nDomain context: ${this.domainHints}` : '');
        const response = await deps.openai.chat.completions.create(
            deps.getApiParams({
                model: 'google/gemini-2.5-flash-lite', // Быстрая модель для классификации
                messages: [
                    { role: 'system', content: prompt },
                    { role: 'user', content: query }
                ],
                response_format: { type: 'json_object' },
                max_tokens: 500,
                temperature: 0.1 // Детерминизм
            })
        );

        const content = response.choices[0]?.message?.content || '{}';
        const parsed = this.parseJsonObject(content);

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
     * Устойчивый парсинг JSON-ответа от LLM:
     * - поддержка ```json ... ```
     * - извлечение первого валидного JSON-объекта из текста
     */
    private parseJsonObject(raw: string): any {
        const normalized = (raw || '')
            .trim()
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();

        if (!normalized) {
            throw new Error('Empty JSON payload');
        }

        try {
            return JSON.parse(normalized);
        } catch {
            // Попытка извлечь JSON-объект из окружного текста
            const firstBrace = normalized.indexOf('{');
            const lastBrace = normalized.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                const candidate = normalized.slice(firstBrace, lastBrace + 1);
                return JSON.parse(candidate);
            }
            throw new Error(`Invalid JSON from classifier: ${normalized.slice(0, 160)}`);
        }
    }

    /**
     * Regex-based classification (fallback)
     */
    private analyzeIntentRegex(query: string): TaskIntent {
        const detectedSteps: TaskStep[] = [];
        const queryLower = query.toLowerCase();

        // Universal patterns + project-injected custom patterns
        const allPatterns = [...getActionPatterns(), ...this.customPatterns];
        for (const actionDef of allPatterns) {
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

        return {
            steps: detectedSteps,
            isMultiStep: detectedSteps.length > 1,
            originalQuery: query,
            classifiedBy: 'regex'
        };
    }

    /**
     * Checks if a specific step's required tools were executed.
     * Handles prefix matching: if step requires "list_tasks",
     * and "mcp_panel_onaidocs_list_tasks" was executed, that counts.
     */
    isStepCompleted(step: TaskStep, executedTools: string[]): boolean {
        return step.requiredTools.some(requiredTool => {
            if (executedTools.includes(requiredTool)) return true;
            // Fuzzy match: short name matches if any executed tool ends with _<shortName>
            if (!requiredTool.startsWith('mcp_')) {
                return executedTools.some(t => t.endsWith(`_${requiredTool}`));
            }
            return false;
        });
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
            search: 'найти данные через MCP-инструменты',
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

/**
 * Shared singleton — used by ReActService and PanelApp postMessage handler.
 * Projects inject custom patterns via `trustchain:intent_patterns` postMessage.
 */
export const sharedIntentService = new TaskIntentService();
