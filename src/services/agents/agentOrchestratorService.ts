/**
 * Gap F: Agent Orchestrator Service — Multi-Agent Decomposition
 *
 * Паттерн "Orchestrator" для декомпозиции сложных задач
 * и распределения между специализированными sub-агентами.
 */

import type { ChatMessage, ProgressEvent, ChatAttachment } from '../../agents/types';

// ─── Типы ───

export type AgentSpecialty =
    | 'search-specialist'     // Поиск по каталогу и OpenSearch
    | 'code-specialist'       // Анализ кода и скриптов
    | 'analysis-specialist'   // Аналитика и расчёты
    | 'data-specialist'       // Обработка данных и Excel
    | 'general';              // Общие задачи

export interface SubTask {
    id: string;
    description: string;
    specialist: AgentSpecialty;
    dependencies: string[];
    priority: number;
    status: 'pending' | 'running' | 'completed' | 'failed';
    result?: any;
}

export interface DecompositionResult {
    originalInstruction: string;
    subTasks: SubTask[];
    strategy: 'sequential' | 'parallel' | 'mixed';
    estimatedComplexity: number; // 1-10
}

export interface OrchestratorConfig {
    maxParallelAgents: number;
    enableDecomposition: boolean;
    decompositionThreshold: number; // Minimum complexity to decompose
}

// ─── Константы ───

const DEFAULT_CONFIG: OrchestratorConfig = {
    maxParallelAgents: 3,
    enableDecomposition: true,
    decompositionThreshold: 5   // Tasks with complexity >= 5 get decomposed
};

// ─── Сервис ───

export class AgentOrchestratorService {
    private config: OrchestratorConfig;
    private activeSubTasks: Map<string, SubTask> = new Map();

    constructor(config?: Partial<OrchestratorConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Анализирует запрос и определяет нужна ли декомпозиция
     */
    analyzeComplexity(instruction: string): number {
        let complexity = 1;

        // Длина запроса
        if (instruction.length > 200) complexity += 1;
        if (instruction.length > 500) complexity += 1;

        // Количество задач (по маркерам)
        const taskMarkers = instruction.match(/(\d+\)|\d+\.|\bи\b.*\bи\b|\bтакже\b|\bещё\b)/gi);
        if (taskMarkers) complexity += Math.min(taskMarkers.length, 3);

        // Мультидоменность
        const domains = [
            /поиск|найди|search/i,
            /код|скрипт|функци|code|script/i,
            /анализ|рассчитай|статистик|analyz/i,
            /данные|таблиц|excel|csv|data/i
        ];
        const domainCount = domains.filter(d => d.test(instruction)).length;
        if (domainCount >= 2) complexity += 2;

        // Явные маркеры сложности
        if (/сложн|complex|multi-step/i.test(instruction)) complexity += 1;

        return Math.min(10, complexity);
    }

    /**
     * Декомпозирует задачу на подзадачи
     */
    decompose(instruction: string): DecompositionResult {
        const complexity = this.analyzeComplexity(instruction);

        if (complexity < this.config.decompositionThreshold) {
            // Простая задача — не декомпозируем
            return {
                originalInstruction: instruction,
                subTasks: [{
                    id: 'main',
                    description: instruction,
                    specialist: this.detectSpecialty(instruction),
                    dependencies: [],
                    priority: 1,
                    status: 'pending'
                }],
                strategy: 'sequential',
                estimatedComplexity: complexity
            };
        }

        // Декомпозируем по паттернам
        const subTasks = this.extractSubTasks(instruction);
        const strategy = this.determineStrategy(subTasks);

        return {
            originalInstruction: instruction,
            subTasks,
            strategy,
            estimatedComplexity: complexity
        };
    }

    /**
     * Определяет специализацию агента для задачи
     */
    detectSpecialty(text: string): AgentSpecialty {
        const lower = text.toLowerCase();

        if (/поиск|найди|каталог|search|opensearch|индекс/i.test(lower)) return 'search-specialist';
        if (/код|скрипт|функци|баг|ошибк|code|debug|refactor/i.test(lower)) return 'code-specialist';
        if (/анализ|рассчитай|статистик|метрик|analyz|calculat/i.test(lower)) return 'analysis-specialist';
        if (/данные|таблиц|excel|csv|json|обработ|data|import|export/i.test(lower)) return 'data-specialist';

        return 'general';
    }

    /**
     * Извлекает подзадачи из instruction
     */
    private extractSubTasks(instruction: string): SubTask[] {
        const tasks: SubTask[] = [];

        // Разбиваем по нумерованным спискам
        const numbered = instruction.match(/\d+[.)]\s*([^\n]+)/g);
        if (numbered && numbered.length >= 2) {
            for (let i = 0; i < numbered.length; i++) {
                const desc = numbered[i].replace(/^\d+[.)]\s*/, '').trim();
                tasks.push({
                    id: `sub_${i + 1}`,
                    description: desc,
                    specialist: this.detectSpecialty(desc),
                    dependencies: i > 0 ? [`sub_${i}`] : [], // Sequential by default
                    priority: i + 1,
                    status: 'pending'
                });
            }
            return tasks;
        }

        // Разбиваем по "и", "также", "потом"
        const parts = instruction.split(/\s*(?:,\s+и\s+|;\s+|\.\s+(?:Также|Потом|Затем)\s+)/i);
        if (parts.length >= 2) {
            for (let i = 0; i < parts.length; i++) {
                const desc = parts[i].trim();
                if (desc.length < 10) continue; // Skip short fragments
                tasks.push({
                    id: `sub_${i + 1}`,
                    description: desc,
                    specialist: this.detectSpecialty(desc),
                    dependencies: [],
                    priority: i + 1,
                    status: 'pending'
                });
            }
            return tasks;
        }

        // Не удалось декомпозировать — возвращаем как одну задачу
        tasks.push({
            id: 'main',
            description: instruction,
            specialist: this.detectSpecialty(instruction),
            dependencies: [],
            priority: 1,
            status: 'pending'
        });

        return tasks;
    }

    /**
     * Определяет стратегию выполнения
     */
    private determineStrategy(subTasks: SubTask[]): 'sequential' | 'parallel' | 'mixed' {
        const hasDeps = subTasks.some(t => t.dependencies.length > 0);
        if (!hasDeps) return 'parallel';
        if (subTasks.every(t => t.dependencies.length > 0 || t.id === subTasks[0].id)) return 'sequential';
        return 'mixed';
    }

    /**
     * Выполняет подзадачи параллельно с учётом зависимостей.
     * 
     * @param decomposition - результат декомпозиции
     * @param executor - функция, получающая instruction и возвращающая результат
     * @param progressCallback - колбэк прогресса
     */
    async executeParallel(
        decomposition: DecompositionResult,
        executor: (instruction: string) => Promise<string>,
        progressCallback?: (event: ProgressEvent) => void
    ): Promise<string> {
        const { subTasks, strategy } = decomposition;

        // Track in activeSubTasks
        for (const st of subTasks) {
            this.activeSubTasks.set(st.id, st);
        }

        if (strategy === 'sequential') {
            // Sequential: execute one by one
            for (const st of subTasks) {
                st.status = 'running';
                progressCallback?.({
                    type: 'reasoning_step',
                    message: `▶️ Подзадача: ${st.description}`,
                    reasoning_text: `Специалист: ${st.specialist}`
                });
                try {
                    st.result = await executor(st.description);
                    st.status = 'completed';
                } catch (err: any) {
                    st.status = 'failed';
                    st.result = `Ошибка: ${err.message}`;
                }
            }
        } else {
            // Parallel/Mixed: execute in waves based on dependencies
            const completed = new Set<string>();
            const maxWaves = 10;
            let wave = 0;

            while (completed.size < subTasks.length && wave < maxWaves) {
                wave++;
                // Find tasks whose dependencies are all completed
                const ready = subTasks.filter(
                    st => st.status === 'pending' &&
                        st.dependencies.every(d => completed.has(d))
                );

                if (ready.length === 0) break; // Deadlock or done

                // Limit parallelism
                const batch = ready.slice(0, this.config.maxParallelAgents);
                for (const st of batch) st.status = 'running';

                progressCallback?.({
                    type: 'reasoning_step',
                    message: `🔄 Волна ${wave}: ${batch.length} подзадач параллельно`,
                    reasoning_text: batch.map(st => st.description).join('\n')
                });

                // Execute batch in parallel
                const results = await Promise.allSettled(
                    batch.map(st => executor(st.description))
                );

                for (let i = 0; i < batch.length; i++) {
                    const st = batch[i];
                    const res = results[i];
                    if (res.status === 'fulfilled') {
                        st.result = res.value;
                        st.status = 'completed';
                    } else {
                        st.result = `Ошибка: ${res.reason?.message || 'unknown'}`;
                        st.status = 'failed';
                    }
                    completed.add(st.id);
                }
            }
        }

        return this.mergeResults(subTasks);
    }

    /**
     * Объединяет результаты подзадач
     */
    mergeResults(subTasks: SubTask[]): string {
        const completed = subTasks.filter(t => t.status === 'completed' && t.result);

        if (completed.length === 0) return 'Не удалось получить результаты подзадач';
        if (completed.length === 1) return String(completed[0].result);

        const sections = completed.map(t =>
            `### ${t.description}\n${String(t.result)}`
        );

        return sections.join('\n\n---\n\n');
    }

    /**
     * Возвращает статус всех подзадач
     */
    getStatus(): SubTask[] {
        return [...this.activeSubTasks.values()];
    }
}
