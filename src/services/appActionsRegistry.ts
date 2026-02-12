/**
 * AppActionsRegistry — Universal dynamic registry for host app actions.
 *
 * Host applications register their client-side actions at runtime via postMessage:
 *   postMessage({ type: 'trustchain:register_actions', actions: [...] })
 *
 * The agent discovers them as LLM tools and executes them via:
 *   postMessage({ type: 'trustchain:call_action', requestId, name, arguments })
 *
 * Host responds with:
 *   postMessage({ type: 'trustchain:action_result', requestId, success, data })
 */

// ── Types ──

export interface RegisteredAction {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, {
            type: string;
            description?: string;
            enum?: string[];
            default?: any;
        }>;
        required?: string[];
    };
    category?: string; // Optional grouping: "navigation", "data", "system"
}

interface PendingCall {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timer: ReturnType<typeof setTimeout>;
}

// ── Registry ──

class AppActionsRegistry {
    private actions = new Map<string, RegisteredAction>();
    private pending = new Map<string, PendingCall>();
    private listenerAttached = false;

    /**
     * Register actions from host app.
     * Can be called multiple times — new actions are merged, existing are updated.
     */
    registerActions(actions: RegisteredAction[]): void {
        for (const action of actions) {
            if (!action.name || !action.description) {
                console.warn('[AppActionsRegistry] Skipping action without name/description:', action);
                continue;
            }
            this.actions.set(action.name, action);
        }
        console.log(`[AppActionsRegistry] Registered ${actions.length} actions. Total: ${this.actions.size}`);
    }

    /**
     * Clear all registered actions (e.g. when host app changes context/page).
     */
    clear(): void {
        this.actions.clear();
        console.log('[AppActionsRegistry] Cleared all actions');
    }

    /**
     * Check if an action is registered.
     */
    has(name: string): boolean {
        return this.actions.has(name);
    }

    /**
     * Get all registered action names.
     */
    getActionNames(): string[] {
        return Array.from(this.actions.keys());
    }

    /**
     * Get tool definitions in OpenAI function-calling format for LLM.
     */
    getToolDefinitions(): Array<{ type: 'function'; function: { name: string; description: string; parameters: object } }> {
        return Array.from(this.actions.values()).map(action => ({
            type: 'function' as const,
            function: {
                name: action.name,
                description: action.description,
                parameters: action.parameters,
            },
        }));
    }

    /**
     * Execute a registered action by sending postMessage to host and awaiting result.
     * @param name Action name
     * @param args Arguments to pass
     * @param timeoutMs Timeout in ms (default 10s)
     */
    async callAction(name: string, args: Record<string, any>, timeoutMs = 10000): Promise<any> {
        if (!this.actions.has(name)) {
            throw new Error(`App action "${name}" is not registered. Available: ${this.getActionNames().join(', ')}`);
        }

        this.ensureListener();

        const requestId = `action_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                resolve({
                    success: false,
                    error: `Host did not respond to action "${name}" within ${timeoutMs}ms`,
                });
            }, timeoutMs);

            this.pending.set(requestId, { resolve, reject, timer });

            try {
                window.parent.postMessage({
                    type: 'trustchain:call_action',
                    requestId,
                    name,
                    arguments: args,
                }, '*');
                console.log(`[AppActionsRegistry] Called action: ${name}`, args);
            } catch (err) {
                clearTimeout(timer);
                this.pending.delete(requestId);
                resolve({
                    success: false,
                    error: `Failed to send postMessage for action "${name}": ${err}`,
                });
            }
        });
    }

    /**
     * Handle response from host app.
     */
    handleResult(data: { requestId: string; success: boolean; data?: any; error?: string }): void {
        const pending = this.pending.get(data.requestId);
        if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(data.requestId);

            if (data.success) {
                pending.resolve(data.data ?? { success: true });
            } else {
                pending.resolve({ success: false, error: data.error || 'Action failed' });
            }
            console.log(`[AppActionsRegistry] Action result received:`, data.requestId, data.success);
        }
    }

    /**
     * Attach postMessage listener for action results (idempotent).
     */
    private ensureListener(): void {
        if (this.listenerAttached) return;
        window.addEventListener('message', (e: MessageEvent) => {
            if (e.data?.type === 'trustchain:action_result') {
                this.handleResult(e.data);
            }
        });
        this.listenerAttached = true;
    }
}

// ── Singleton ──
export const appActionsRegistry = new AppActionsRegistry();
