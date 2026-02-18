/**
 * Session Spawn Service — Isolated Sub-Agent Sessions
 * 
 * Inspired by OpenClaw's `session_spawn` pattern.
 * Each sub-agent runs in its own LLM session with:
 *   - Own system prompt and tool whitelist
 *   - TrustChain X.509 certificate (via Platform MCP register_agent)
 *   - Background execution via TaskQueueService
 *   - Signed results returned to main agent
 * 
 * Key difference from OpenClaw: every sub-agent is cryptographically isolated
 * with its own X.509 cert — audit log shows full chain:
 *   main_agent → sub_agent_1 → tool_X
 */

import type { ChatMessage, ProgressEvent, ChatAttachment } from '../../agents/types';

// ─── Types ───

export type SessionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type SessionPriority = 'low' | 'normal' | 'high';

/** Configuration for spawning a new sub-agent session. */
export interface SpawnConfig {
    /** Human-readable name for the session (e.g. "code-review", "web-research") */
    name: string;
    /** Task instruction for the sub-agent */
    instruction: string;
    /** Custom system prompt (optional — uses default if not set) */
    systemPrompt?: string;
    /** Tool whitelist — only these tools are available to the sub-agent */
    tools?: string[];
    /** LLM model override (uses main agent's model if not set) */
    model?: string;
    /** Parent agent ID for PKI chain */
    parentAgentId?: string;
    /** Max ReAct iterations */
    maxIterations?: number;
    /** Timeout in milliseconds (default: 5 min) */
    timeout?: number;
    /** Execution priority */
    priority?: SessionPriority;
    /** Chat history context to pass to sub-agent */
    context?: ChatMessage[];
    /** File attachments for the sub-agent */
    attachments?: ChatAttachment[];
}

/** A spawned sub-agent session with its runtime state. */
export interface SpawnedSession {
    /** Unique run ID */
    runId: string;
    /** Human-readable session name */
    name: string;
    /** Task instruction */
    instruction: string;
    /** Current status */
    status: SessionStatus;
    /** Progress 0-100 */
    progress: number;
    /** Current step description */
    currentStep: string;
    /** Priority */
    priority: SessionPriority;
    /** Result (set when completed) */
    result?: string;
    /** Error message (set when failed) */
    error?: string;
    /** Ed25519 signature of the result */
    signature?: string;
    /** X.509 certificate serial number of the sub-agent */
    certificateSerial?: string;
    /** Number of signed operations performed */
    signedOpsCount: number;
    /** ID of the background task in TaskQueueService */
    taskId?: string;
    /** Timestamps */
    createdAt: number;
    startedAt?: number;
    completedAt?: number;
    /** Elapsed time in ms */
    elapsedMs?: number;
    /** Tools used by this session */
    toolsUsed: string[];
}

/** Event emitted when a session changes state. */
export interface SessionEvent {
    type: 'spawned' | 'started' | 'progress' | 'completed' | 'failed' | 'cancelled';
    session: SpawnedSession;
    timestamp: number;
}

export interface SessionSpawnConfig {
    /** Max concurrent sub-agent sessions (default: 3) */
    maxConcurrentSessions: number;
    /** Default timeout per session in ms (default: 5 min) */
    defaultTimeout: number;
    /** Default max ReAct iterations (default: 15) */
    defaultMaxIterations: number;
    /** Auto-decommission sub-agent after completion (default: true) */
    autoDecommission: boolean;
}

// ─── Constants ───

const DEFAULT_CONFIG: SessionSpawnConfig = {
    maxConcurrentSessions: 3,
    defaultTimeout: 5 * 60 * 1000,  // 5 minutes
    defaultMaxIterations: 15,
    autoDecommission: true,
};

const STORAGE_KEY = 'trustchain_spawn_sessions';

// ─── Service ───

export class SessionSpawnService {
    private sessions: Map<string, SpawnedSession> = new Map();
    private config: SessionSpawnConfig;
    private eventListeners: Map<string, Set<(event: SessionEvent) => void>> = new Map();
    private globalListeners: Set<(event: SessionEvent) => void> = new Set();

    constructor(config?: Partial<SessionSpawnConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.loadSessions();
    }

    // ─── Spawn ───

    /**
     * Spawn a new sub-agent session.
     * Returns the session immediately — execution happens in background.
     *
     * The `executor` callback should create a new SmartAIAgent instance with
     * the given config and run its ReAct loop.
     */
    spawn(
        spawnConfig: SpawnConfig,
        executor: (
            session: SpawnedSession,
            config: SpawnConfig,
            onProgress: (progress: number, step: string) => void
        ) => Promise<{ result: string; signature?: string; toolsUsed?: string[] }>,
    ): SpawnedSession {
        // Check capacity
        const activeSessions = this.getActiveSessions();
        if (activeSessions.length >= this.config.maxConcurrentSessions) {
            throw new Error(
                `Max concurrent sessions reached (${this.config.maxConcurrentSessions}). ` +
                `Active: ${activeSessions.map(s => s.name).join(', ')}`
            );
        }

        // Create session
        const runId = `spawn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const session: SpawnedSession = {
            runId,
            name: spawnConfig.name,
            instruction: spawnConfig.instruction,
            status: 'pending',
            progress: 0,
            currentStep: 'Initializing...',
            priority: spawnConfig.priority || 'normal',
            signedOpsCount: 0,
            createdAt: Date.now(),
            toolsUsed: [],
        };

        this.sessions.set(runId, session);
        this.emit(runId, { type: 'spawned', session, timestamp: Date.now() });
        this.saveSessions();

        // Fire-and-forget background execution
        const timeout = spawnConfig.timeout || this.config.defaultTimeout;
        const timeoutId = setTimeout(() => {
            if (session.status === 'running') {
                this.failSession(runId, `Timeout (${timeout / 1000}s)`);
            }
        }, timeout);

        Promise.resolve().then(async () => {
            try {
                // Mark as running
                session.status = 'running';
                session.startedAt = Date.now();
                session.currentStep = 'Starting sub-agent...';
                this.emit(runId, { type: 'started', session, timestamp: Date.now() });
                this.saveSessions();

                // Execute
                const onProgress = (progress: number, step: string) => {
                    session.progress = Math.min(progress, 99); // 100 only on complete
                    session.currentStep = step;
                    session.elapsedMs = Date.now() - (session.startedAt || session.createdAt);
                    this.emit(runId, { type: 'progress', session, timestamp: Date.now() });
                    this.saveSessions();
                };

                const { result, signature, toolsUsed } = await executor(session, spawnConfig, onProgress);

                // Complete
                session.status = 'completed';
                session.progress = 100;
                session.currentStep = 'Done';
                session.result = result;
                session.signature = signature;
                session.toolsUsed = toolsUsed || [];
                session.completedAt = Date.now();
                session.elapsedMs = session.completedAt - (session.startedAt || session.createdAt);
                this.emit(runId, { type: 'completed', session, timestamp: Date.now() });
                this.saveSessions();

                console.log(`[SessionSpawn] Session "${session.name}" (${runId}) completed in ${session.elapsedMs}ms`);
            } catch (err: any) {
                if (session.status === 'running') {
                    this.failSession(runId, err.message || 'Unknown error');
                }
            } finally {
                clearTimeout(timeoutId);
            }
        });

        console.log(`[SessionSpawn] Spawned "${session.name}" → ${runId}`);
        return session;
    }

    // ─── Session Management ───

    /** Cancel a running session. */
    cancel(runId: string): boolean {
        const session = this.sessions.get(runId);
        if (!session || session.status !== 'running') return false;

        session.status = 'cancelled';
        session.completedAt = Date.now();
        session.elapsedMs = session.completedAt - (session.startedAt || session.createdAt);
        session.currentStep = 'Cancelled';
        this.emit(runId, { type: 'cancelled', session, timestamp: Date.now() });
        this.saveSessions();
        return true;
    }

    /**
     * Await session completion (or timeout). Returns the final session state.
     * Used by session_spawn tool to synchronously wait for sub-agent results.
     */
    async awaitCompletion(runId: string, timeoutMs: number = 5 * 60 * 1000): Promise<SpawnedSession> {
        const session = this.sessions.get(runId);
        if (!session) throw new Error(`Session not found: ${runId}`);

        // Already terminal?
        if (['completed', 'failed', 'cancelled'].includes(session.status)) {
            return session;
        }

        return new Promise<SpawnedSession>((resolve) => {
            const timer = setTimeout(() => {
                unsub();
                this.failSession(runId, `Await timeout (${timeoutMs / 1000}s)`);
                resolve(this.sessions.get(runId)!);
            }, timeoutMs);

            const unsub = this.on(runId, (event) => {
                if (['completed', 'failed', 'cancelled'].includes(event.type)) {
                    clearTimeout(timer);
                    unsub();
                    resolve(event.session);
                }
            });
        });
    }

    /** Get a session by run ID. */
    getSession(runId: string): SpawnedSession | undefined {
        return this.sessions.get(runId);
    }

    /** Get all sessions. */
    getAllSessions(): SpawnedSession[] {
        return Array.from(this.sessions.values())
            .sort((a, b) => b.createdAt - a.createdAt);
    }

    /** Get currently active (pending + running) sessions. */
    getActiveSessions(): SpawnedSession[] {
        return Array.from(this.sessions.values())
            .filter(s => s.status === 'pending' || s.status === 'running');
    }

    /** Get completed sessions with results. */
    getCompletedSessions(): SpawnedSession[] {
        return Array.from(this.sessions.values())
            .filter(s => s.status === 'completed')
            .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
    }

    /** Check if there's capacity to spawn more sessions. */
    canSpawnMore(): boolean {
        return this.getActiveSessions().length < this.config.maxConcurrentSessions;
    }

    /** Get summary of all sessions (for display in main agent context). */
    getSummary(): string {
        const sessions = this.getAllSessions();
        if (sessions.length === 0) return 'No active sub-agent sessions.';

        const lines = sessions.slice(0, 10).map(s => {
            const status = s.status === 'completed' ? 'DONE' :
                s.status === 'failed' ? 'FAIL' :
                    s.status === 'running' ? `${s.progress}%` :
                        s.status.toUpperCase();
            const elapsed = s.elapsedMs ? ` (${(s.elapsedMs / 1000).toFixed(1)}s)` : '';
            const sig = s.signature ? ' [signed]' : '';
            return `  [${status}] ${s.name}${elapsed}${sig} — ${s.currentStep}`;
        });

        return `Sub-agent sessions (${sessions.length}):\n${lines.join('\n')}`;
    }

    /** Cleanup completed/failed sessions older than N hours. */
    cleanup(maxAgeHours: number = 24): number {
        const cutoff = Date.now() - (maxAgeHours * 60 * 60 * 1000);
        let removed = 0;
        for (const [id, session] of this.sessions) {
            if (
                (session.status === 'completed' || session.status === 'failed' || session.status === 'cancelled') &&
                (session.completedAt || session.createdAt) < cutoff
            ) {
                this.sessions.delete(id);
                removed++;
            }
        }
        if (removed > 0) this.saveSessions();
        return removed;
    }

    // ─── Events ───

    /** Subscribe to events for a specific session. */
    on(runId: string, callback: (event: SessionEvent) => void): () => void {
        if (!this.eventListeners.has(runId)) {
            this.eventListeners.set(runId, new Set());
        }
        this.eventListeners.get(runId)!.add(callback);
        return () => this.eventListeners.get(runId)?.delete(callback);
    }

    /** Subscribe to all session events. */
    onAny(callback: (event: SessionEvent) => void): () => void {
        this.globalListeners.add(callback);
        return () => this.globalListeners.delete(callback);
    }

    // ─── Private ───

    private failSession(runId: string, error: string): void {
        const session = this.sessions.get(runId);
        if (!session) return;
        session.status = 'failed';
        session.error = error;
        session.completedAt = Date.now();
        session.elapsedMs = session.completedAt - (session.startedAt || session.createdAt);
        session.currentStep = `Failed: ${error}`;
        this.emit(runId, { type: 'failed', session, timestamp: Date.now() });
        this.saveSessions();
        console.error(`[SessionSpawn] Session "${session.name}" (${runId}) failed: ${error}`);
    }

    private emit(runId: string, event: SessionEvent): void {
        // Per-session listeners
        const listeners = this.eventListeners.get(runId);
        if (listeners) {
            for (const cb of listeners) {
                try { cb(event); } catch (e) { console.error('[SessionSpawn] Event listener error:', e); }
            }
        }
        // Global listeners
        for (const cb of this.globalListeners) {
            try { cb(event); } catch (e) { console.error('[SessionSpawn] Global listener error:', e); }
        }
    }

    private saveSessions(): void {
        try {
            const data = Array.from(this.sessions.entries()).map(([id, s]) => ({
                ...s,
                // Don't persist result contents to localStorage (too large)
                result: s.status === 'completed' ? (s.result?.slice(0, 200) + '...') : undefined,
            }));
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch { /* localStorage quota */ }
    }

    private loadSessions(): void {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const data: SpawnedSession[] = JSON.parse(raw);
            for (const s of data) {
                // Mark any previously-running sessions as failed (browser reload)
                if (s.status === 'running' || s.status === 'pending') {
                    s.status = 'failed';
                    s.error = 'Session interrupted (page reload)';
                    s.currentStep = 'Interrupted';
                }
                this.sessions.set(s.runId, s);
            }
        } catch { /* corrupt data */ }
    }
}

// ─── Singleton ───

export const sessionSpawnService = new SessionSpawnService();
