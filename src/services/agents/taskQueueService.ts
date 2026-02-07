/**
 * Gap C: Task Queue Service — Long-Running Background Tasks
 * 
 * Позволяет агенту выполнять длительные задачи с checkpoint/resume,
 * прогресс-трекингом и устойчивостью к сбоям.
 */

import type { ChatMessage, ProgressEvent, ChatAttachment } from '../../agents/types';

// ─── Типы ───

export type TaskStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface TaskCheckpoint {
    iteration: number;
    messages: ChatMessage[];
    toolResults: Map<string, any>;
    intermediateState: any;
    savedAt: number;
}

export interface BackgroundTask {
    id: string;
    instruction: string;
    chatHistory: ChatMessage[];
    attachments?: ChatAttachment[];
    status: TaskStatus;
    progress: number;          // 0-100
    currentStep: string;       // Human-readable status
    checkpoint?: TaskCheckpoint;
    result?: { result: any; messages: ChatMessage[] };
    error?: string;
    createdAt: number;
    updatedAt: number;
    completedAt?: number;
    maxIterations: number;     // Raised limit for background tasks
}

export interface TaskQueueConfig {
    maxConcurrentTasks: number;
    defaultMaxIterations: number;    // 25 for background tasks (vs 8 for interactive)
    checkpointInterval: number;      // Save checkpoint every N iterations
    taskTimeout: number;             // Max total runtime in ms
}

// ─── Константы ───

const DEFAULT_CONFIG: TaskQueueConfig = {
    maxConcurrentTasks: 2,
    defaultMaxIterations: 25,
    checkpointInterval: 3,
    taskTimeout: 30 * 60 * 1000 // 30 минут
};

const STORAGE_KEY = 'kb_agent_task_queue';

// ─── Сервис ───

export class TaskQueueService {
    private tasks: Map<string, BackgroundTask> = new Map();
    private config: TaskQueueConfig;
    private progressCallbacks: Map<string, (event: ProgressEvent) => void> = new Map();

    constructor(config?: Partial<TaskQueueConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.loadTasks();
    }

    // ──────────────────────────────────────────────
    // Task Lifecycle
    // ──────────────────────────────────────────────

    /**
     * Ставит задачу в очередь
     */
    enqueueTask(
        instruction: string,
        chatHistory: ChatMessage[] = [],
        attachments?: ChatAttachment[],
        options?: { maxIterations?: number }
    ): BackgroundTask {
        const task: BackgroundTask = {
            id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            instruction,
            chatHistory,
            attachments,
            status: 'queued',
            progress: 0,
            currentStep: 'В очереди',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            maxIterations: options?.maxIterations || this.config.defaultMaxIterations
        };

        this.tasks.set(task.id, task);
        this.saveTasks();
        console.log(`[TaskQueue] Enqueued task ${task.id}: "${instruction.slice(0, 50)}..."`);

        return task;
    }

    /**
     * Обновляет прогресс задачи
     */
    updateProgress(taskId: string, progress: number, currentStep: string): void {
        const task = this.tasks.get(taskId);
        if (!task) return;

        task.progress = Math.min(100, Math.max(0, progress));
        task.currentStep = currentStep;
        task.updatedAt = Date.now();

        // Уведомляем подписчика
        const callback = this.progressCallbacks.get(taskId);
        callback?.({
            type: 'reasoning_step',
            message: `[${task.progress}%] ${currentStep}`,
            reasoning_text: `Задача ${taskId}: прогресс ${task.progress}%`
        });
    }

    /**
     * Сохраняет checkpoint (промежуточное состояние)
     */
    saveCheckpoint(
        taskId: string,
        iteration: number,
        messages: ChatMessage[],
        toolResults: Map<string, any>,
        intermediateState?: any
    ): void {
        const task = this.tasks.get(taskId);
        if (!task) return;

        task.checkpoint = {
            iteration,
            messages: [...messages],
            toolResults: new Map(toolResults),
            intermediateState,
            savedAt: Date.now()
        };
        task.updatedAt = Date.now();

        this.saveTasks();
        console.log(`[TaskQueue] Checkpoint saved for task ${taskId} at iteration ${iteration}`);
    }

    /**
     * Завершает задачу с результатом
     */
    completeTask(
        taskId: string,
        result: { result: any; messages: ChatMessage[] }
    ): void {
        const task = this.tasks.get(taskId);
        if (!task) return;

        task.status = 'completed';
        task.progress = 100;
        task.currentStep = 'Завершено';
        task.result = result;
        task.completedAt = Date.now();
        task.updatedAt = Date.now();

        this.saveTasks();
        console.log(`[TaskQueue] Task ${taskId} completed`);
    }

    /**
     * Отмечает задачу как проваленную
     */
    failTask(taskId: string, error: string): void {
        const task = this.tasks.get(taskId);
        if (!task) return;

        task.status = 'failed';
        task.currentStep = `Ошибка: ${error}`;
        task.error = error;
        task.updatedAt = Date.now();

        this.saveTasks();
        console.log(`[TaskQueue] Task ${taskId} failed: ${error}`);
    }

    /**
     * Приостанавливает задачу
     */
    pauseTask(taskId: string): void {
        const task = this.tasks.get(taskId);
        if (!task || task.status !== 'running') return;

        task.status = 'paused';
        task.currentStep = 'Приостановлено';
        task.updatedAt = Date.now();
        this.saveTasks();
    }

    /**
     * Отменяет задачу
     */
    cancelTask(taskId: string): void {
        const task = this.tasks.get(taskId);
        if (!task) return;

        task.status = 'cancelled';
        task.currentStep = 'Отменено';
        task.updatedAt = Date.now();
        this.saveTasks();
    }

    // ──────────────────────────────────────────────
    // Resume from checkpoint
    // ──────────────────────────────────────────────

    /**
     * Возвращает данные для возобновления задачи с checkpoint
     */
    getResumeData(taskId: string): {
        instruction: string;
        chatHistory: ChatMessage[];
        checkpoint: TaskCheckpoint;
        remainingIterations: number;
    } | null {
        const task = this.tasks.get(taskId);
        if (!task || !task.checkpoint) return null;

        task.status = 'running';
        task.updatedAt = Date.now();
        this.saveTasks();

        return {
            instruction: task.instruction,
            chatHistory: task.chatHistory,
            checkpoint: task.checkpoint,
            remainingIterations: task.maxIterations - task.checkpoint.iteration
        };
    }

    // ──────────────────────────────────────────────
    // Query
    // ──────────────────────────────────────────────

    getTask(taskId: string): BackgroundTask | undefined {
        return this.tasks.get(taskId);
    }

    getActiveTasks(): BackgroundTask[] {
        return [...this.tasks.values()].filter(
            t => t.status === 'running' || t.status === 'queued'
        );
    }

    getAllTasks(): BackgroundTask[] {
        return [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
    }

    getQueuedTasks(): BackgroundTask[] {
        return [...this.tasks.values()].filter(t => t.status === 'queued');
    }

    /**
     * Подписка на прогресс задачи
     */
    onProgress(taskId: string, callback: (event: ProgressEvent) => void): void {
        this.progressCallbacks.set(taskId, callback);
    }

    /**
     * Проверяет, есть ли место для новых задач
     */
    canEnqueueMore(): boolean {
        return this.getActiveTasks().length < this.config.maxConcurrentTasks;
    }

    /**
     * Проверяет, следует ли задачу считать background (по сложности)
     */
    shouldRunAsBackground(instruction: string, estimatedSteps: number): boolean {
        return estimatedSteps > 5 || instruction.length > 500;
    }

    /**
     * Gap C: Запускает задачу в фоне (async, неблокирующий).
     * 
     * @returns taskId для последующего отслеживания
     */
    runInBackground(
        instruction: string,
        executor: (task: BackgroundTask, updateProgress: (pct: number, step: string) => void) => Promise<{ result: any; messages: ChatMessage[] }>,
        chatHistory: ChatMessage[] = [],
        attachments?: ChatAttachment[]
    ): string {
        if (!this.canEnqueueMore()) {
            throw new Error(`Очередь заполнена (${this.config.maxConcurrentTasks} задач). Дождитесь завершения текущих задач.`);
        }

        const task = this.enqueueTask(instruction, chatHistory, attachments);
        task.status = 'running';
        task.currentStep = 'Запущено в фоне';
        this.saveTasks();

        // Fire-and-forget execution with timeout
        const timeoutId = setTimeout(() => {
            if (task.status === 'running') {
                this.failTask(task.id, `Таймаут (${this.config.taskTimeout / 60000} мин)`);
            }
        }, this.config.taskTimeout);

        Promise.resolve().then(async () => {
            let iterationCount = 0;

            const updateProgress = (pct: number, step: string) => {
                iterationCount++;
                this.updateProgress(task.id, pct, step);

                // Auto-checkpoint at intervals
                if (iterationCount % this.config.checkpointInterval === 0) {
                    this.saveCheckpoint(task.id, iterationCount, [], new Map(), { progress: pct, step });
                }
            };

            try {
                const result = await executor(task, updateProgress);
                this.completeTask(task.id, result);
            } catch (err: any) {
                if (task.status === 'running') {
                    this.failTask(task.id, err.message || 'Unknown error');
                }
            } finally {
                clearTimeout(timeoutId);
            }
        });

        return task.id;
    }

    // ──────────────────────────────────────────────
    // Persistence
    // ──────────────────────────────────────────────

    private saveTasks(): void {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                const serializable = [...this.tasks.entries()].map(([id, task]) => ({
                    ...task,
                    checkpoint: task.checkpoint ? {
                        ...task.checkpoint,
                        toolResults: Object.fromEntries(task.checkpoint.toolResults)
                    } : undefined
                }));
                localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
            }
        } catch {
            // ignore
        }
    }

    private loadTasks(): void {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    for (const task of parsed) {
                        if (task.checkpoint?.toolResults) {
                            task.checkpoint.toolResults = new Map(Object.entries(task.checkpoint.toolResults));
                        }
                        this.tasks.set(task.id, task);
                    }
                }
            }
        } catch {
            // ignore
        }
    }

    /**
     * Очищает завершённые задачи старше N часов
     */
    cleanup(maxAgeHours: number = 24): number {
        const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
        let removed = 0;

        for (const [id, task] of this.tasks) {
            if ((task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') &&
                task.updatedAt < cutoff) {
                this.tasks.delete(id);
                removed++;
            }
        }

        if (removed > 0) this.saveTasks();
        return removed;
    }
}
