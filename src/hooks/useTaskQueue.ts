/**
 * useTaskQueue — React hook for UI integration of TaskQueueService.
 * Provides background task state, progress tracking, and actions.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { TaskQueueService } from '../services/agents/taskQueueService';
import type { ChatMessage } from '../agents/types';

export interface TaskView {
    id: string;
    instruction: string;
    status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
    progress: number;
    currentStep: string;
    error?: string;
    createdAt: number;
    completedAt?: number;
}

export interface UseTaskQueueReturn {
    tasks: TaskView[];
    activeTasks: TaskView[];
    canEnqueue: boolean;
    /** Submit a long-running task to run in background */
    submitTask: (
        instruction: string,
        executor: (updateProgress: (pct: number, step: string) => void) => Promise<{ result: any; messages: ChatMessage[] }>,
        chatHistory?: ChatMessage[],
    ) => string;
    /** Cancel a running/queued task */
    cancelTask: (taskId: string) => void;
    /** Pause a running task */
    pauseTask: (taskId: string) => void;
    /** Clear completed/failed tasks from the list */
    clearCompleted: () => void;
    /** Refresh task list from the service */
    refresh: () => void;
}

// Singleton service instance
const taskQueueService = new TaskQueueService();

export function useTaskQueue(): UseTaskQueueReturn {
    const [tasks, setTasks] = useState<TaskView[]>([]);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    /** Map raw tasks to UI-friendly view objects */
    const refreshTasks = useCallback(() => {
        const all = taskQueueService.getAllTasks().map(t => ({
            id: t.id,
            instruction: t.instruction,
            status: t.status,
            progress: t.progress,
            currentStep: t.currentStep,
            error: t.error,
            createdAt: t.createdAt,
            completedAt: t.completedAt,
        }));
        // Sort: running first, then queued, then completed
        all.sort((a, b) => {
            const order = { running: 0, queued: 1, paused: 2, failed: 3, completed: 4, cancelled: 5 };
            return (order[a.status] ?? 9) - (order[b.status] ?? 9);
        });
        setTasks(all);
    }, []);

    // Poll for updates every 2 seconds when there are active tasks
    useEffect(() => {
        refreshTasks();
        pollRef.current = setInterval(refreshTasks, 2000);
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [refreshTasks]);

    const activeTasks = tasks.filter(t => t.status === 'running' || t.status === 'queued');
    const canEnqueue = taskQueueService.canEnqueueMore();

    const submitTask = useCallback((
        instruction: string,
        executor: (updateProgress: (pct: number, step: string) => void) => Promise<{ result: any; messages: ChatMessage[] }>,
        chatHistory: ChatMessage[] = [],
    ): string => {
        const taskId = taskQueueService.runInBackground(
            instruction,
            (_task, updateProgress) => executor(updateProgress),
            chatHistory,
        );
        refreshTasks();
        return taskId;
    }, [refreshTasks]);

    const cancelTask = useCallback((taskId: string) => {
        taskQueueService.cancelTask(taskId);
        refreshTasks();
    }, [refreshTasks]);

    const pauseTask = useCallback((taskId: string) => {
        taskQueueService.pauseTask(taskId);
        refreshTasks();
    }, [refreshTasks]);

    const clearCompleted = useCallback(() => {
        taskQueueService.cleanup(0);
        refreshTasks();
    }, [refreshTasks]);

    return {
        tasks,
        activeTasks,
        canEnqueue,
        submitTask,
        cancelTask,
        pauseTask,
        clearCompleted,
        refresh: refreshTasks,
    };
}
