/**
 * AgentCallbacksService — Decoupled bridge between agent tool calls and app-specific operations.
 * Ported from AI Studio pattern: separates agent core from UI concerns.
 * 
 * Register callbacks once at app init; agent invokes them during tool execution
 * without knowing about UI implementation details.
 */

export type ArtifactType = 'report' | 'code' | 'chart' | 'table' | 'document' | 'analytics';

export interface AgentCallback<TArgs = any, TResult = any> {
    name: string;
    description: string;
    handler: (args: TArgs) => Promise<TResult> | TResult;
}

export interface AgentCallbacksConfig {
    /** Called when agent creates a file/artifact — UI should show preview */
    onArtifactCreated?: (artifact: { id: string; title: string; type: ArtifactType; content: string }) => void;
    /** Called when agent wants to switch the active view/panel */
    onViewSwitch?: (view: 'chat' | 'code' | 'data' | 'artifacts') => void;
    /** Called when agent needs to read a file from the user's workspace */
    onFileLoad?: (path: string) => Promise<string | null>;
    /** Called when agent completes a quality check on data */
    onDataQualityReport?: (report: { score: number; issues: string[]; suggestions: string[] }) => void;
    /** Called when a background task changes status */
    onTaskStatusChange?: (taskId: string, status: string, progress: number) => void;
    /** Called when agent wants to notify the user */
    onNotification?: (message: string, severity: 'info' | 'warning' | 'error') => void;
}

class AgentCallbacksServiceImpl {
    private callbacks: AgentCallbacksConfig = {};
    private customCallbacks: Map<string, AgentCallback> = new Map();

    /** Register the full set of app callbacks — called once at app startup */
    configure(config: AgentCallbacksConfig): void {
        this.callbacks = { ...this.callbacks, ...config };
        console.log('[AgentCallbacks] Configured with:', Object.keys(config).filter(k => config[k as keyof AgentCallbacksConfig]));
    }

    /** Register a single custom callback (for plugins / extensions) */
    register(callback: AgentCallback): void {
        this.customCallbacks.set(callback.name, callback);
    }

    /** Unregister a custom callback */
    unregister(name: string): void {
        this.customCallbacks.delete(name);
    }

    // ─── Invoke methods (called from agent services) ───

    notifyArtifactCreated(artifact: { id: string; title: string; type: ArtifactType; content: string }): void {
        this.callbacks.onArtifactCreated?.(artifact);
    }

    requestViewSwitch(view: 'chat' | 'code' | 'data' | 'artifacts'): void {
        this.callbacks.onViewSwitch?.(view);
    }

    async loadFile(path: string): Promise<string | null> {
        return this.callbacks.onFileLoad?.(path) ?? null;
    }

    reportDataQuality(report: { score: number; issues: string[]; suggestions: string[] }): void {
        this.callbacks.onDataQualityReport?.(report);
    }

    notifyTaskStatus(taskId: string, status: string, progress: number): void {
        this.callbacks.onTaskStatusChange?.(taskId, status, progress);
    }

    notify(message: string, severity: 'info' | 'warning' | 'error' = 'info'): void {
        this.callbacks.onNotification?.(message, severity);
    }

    /** Invoke a custom callback by name */
    async invokeCustom<T = any>(name: string, args: any): Promise<T | null> {
        const cb = this.customCallbacks.get(name);
        if (!cb) {
            console.warn(`[AgentCallbacks] Unknown callback: ${name}`);
            return null;
        }
        return cb.handler(args) as T;
    }

    /** List all registered callbacks for introspection */
    listCallbacks(): string[] {
        const builtIn = Object.keys(this.callbacks).filter(k => this.callbacks[k as keyof AgentCallbacksConfig]);
        const custom = Array.from(this.customCallbacks.keys());
        return [...builtIn, ...custom];
    }
}

/** Singleton instance — import and use across the app */
export const agentCallbacksService = new AgentCallbacksServiceImpl();
