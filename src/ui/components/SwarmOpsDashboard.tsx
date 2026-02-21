/**
 * SwarmOpsDashboard.tsx — Enterprise Swarm Command Center
 *
 * Real-time via Server-Sent Events (SSE) — zero polling during idle.
 * The backend pushes events only when a task status actually changes.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    Activity, RefreshCw, AlertTriangle, CheckCircle2,
    Clock, Loader2, Trash2, RotateCcw, ChevronDown,
    ChevronUp, Webhook, Shield, XCircle, Wifi, WifiOff
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface QueueTask {
    id: string;
    task_slug: string;
    status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
    payload: unknown;
    result?: unknown;
    error?: string;
    created_at: string;
    updated_at: string;
}

interface QueueStats {
    PENDING: number;
    RUNNING: number;
    SUCCESS: number;
    FAILED: number;
    total: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BACKEND_URL = (() => {
    const fromEnv = (import.meta as { env: Record<string, string> }).env.VITE_BACKEND_URL;
    if (fromEnv) return fromEnv.replace(/\/$/, '');
    return `${window.location.protocol}//${window.location.hostname}:9742`;
})();

function StatusBadge({ status }: { status: QueueTask['status'] }) {
    const cfgMap = {
        PENDING: { icon: Clock, color: 'text-amber-400 bg-amber-500/10 border-amber-500/30', label: 'Pending' },
        RUNNING: { icon: Loader2, color: 'text-blue-400 bg-blue-500/10 border-blue-500/30', label: 'Running' },
        SUCCESS: { icon: CheckCircle2, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30', label: 'Success' },
        FAILED: { icon: XCircle, color: 'text-red-400 bg-red-500/10 border-red-500/30', label: 'Failed' },
    } as const;

    const cfg = cfgMap[status] ?? { icon: Clock, color: 'text-gray-400 bg-gray-500/10 border-gray-500/30', label: status };
    const Icon = cfg.icon;

    return (
        <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border ${cfg.color}`}>
            <Icon size={9} className={status === 'RUNNING' ? 'animate-spin' : undefined} />
            {cfg.label}
        </span>
    );
}

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
    return (
        <div className={`flex flex-col items-center justify-center px-3 py-2 rounded-lg border ${color}`}>
            <span className="text-lg font-bold leading-tight">{value}</span>
            <span className="text-[9px] uppercase tracking-wider opacity-60">{label}</span>
        </div>
    );
}

function timeAgo(dateStr: string): string {
    const d = new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z');
    const diff = Date.now() - d.getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    return `${Math.floor(m / 60)}h ago`;
}

// ─── TaskRow ──────────────────────────────────────────────────────────────────

interface TaskRowProps {
    task: QueueTask;
    onRetry: (id: string) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
}

function TaskRow({ task, onRetry, onDelete }: TaskRowProps) {
    const [expanded, setExpanded] = useState(false);
    const [retrying, setRetrying] = useState(false);
    const slug = task.task_slug || task.id;

    const handleRetry = async () => {
        setRetrying(true);
        try { await onRetry(task.id); } finally { setRetrying(false); }
    };

    return (
        <>
            <tr className="border-b tc-border hover:bg-white/[0.02] transition-colors">
                <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                        <Webhook size={12} className="text-indigo-400 shrink-0" />
                        <span className="text-xs font-mono tc-text truncate max-w-[100px]" title={slug}>{slug}</span>
                    </div>
                    <div className="text-[9px] tc-text-muted font-mono mt-0.5 pl-5 truncate max-w-[140px]" title={task.id}>{task.id}</div>
                </td>
                <td className="px-2 py-2"><StatusBadge status={task.status} /></td>
                <td className="px-2 py-2">
                    <span className="text-[9px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                        <Shield size={7} />WebhookExecutor
                    </span>
                </td>
                <td className="px-2 py-2 text-[10px] tc-text-muted whitespace-nowrap">{timeAgo(task.created_at)}</td>
                <td className="px-2 py-2">
                    <div className="flex items-center gap-0.5">
                        <button
                            onClick={() => setExpanded(v => !v)}
                            className="p-1 rounded hover:bg-white/10 tc-text-muted hover:tc-text transition"
                            title="Details"
                        >
                            {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                        </button>
                        {task.status === 'FAILED' && (
                            <button
                                onClick={() => void handleRetry()}
                                disabled={retrying}
                                className="p-1 rounded hover:bg-emerald-500/20 text-emerald-400 transition disabled:opacity-50"
                                title="Retry Task"
                            >
                                <RotateCcw size={11} className={retrying ? 'animate-spin' : undefined} />
                            </button>
                        )}
                        <button
                            onClick={() => void onDelete(task.id)}
                            className="p-1 rounded hover:bg-white/10 tc-text-muted hover:tc-text transition"
                            title="Delete"
                        >
                            <Trash2 size={11} />
                        </button>
                    </div>
                </td>
            </tr>
            {expanded && (
                <tr className="border-b tc-border bg-black/20">
                    <td colSpan={5} className="px-4 py-3">
                        {task.error ? (
                            <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3">
                                <div className="text-[10px] font-semibold text-amber-400 mb-1 flex items-center gap-1">
                                    <AlertTriangle size={10} /> Dead Letter Queue — Traceback
                                </div>
                                <pre className="text-[9px] text-amber-200/70 overflow-auto max-h-40 font-mono whitespace-pre-wrap">{task.error}</pre>
                            </div>
                        ) : task.result ? (
                            <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-3">
                                <div className="text-[10px] font-semibold text-emerald-400 mb-1">Agent Execution Result</div>
                                <pre className="text-[9px] text-emerald-200/70 overflow-auto max-h-40 font-mono whitespace-pre-wrap">
                                    {JSON.stringify(task.result, null, 2)}
                                </pre>
                            </div>
                        ) : (
                            <div className="text-[10px] tc-text-muted italic">No output yet…</div>
                        )}
                    </td>
                </tr>
            )}
        </>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const FILTERS = ['ALL', 'PENDING', 'RUNNING', 'SUCCESS', 'FAILED'] as const;
type Filter = typeof FILTERS[number];

export const SwarmOpsDashboard: React.FC = () => {
    const [tasks, setTasks] = useState<QueueTask[]>([]);
    const [stats, setStats] = useState<QueueStats>({ PENDING: 0, RUNNING: 0, SUCCESS: 0, FAILED: 0, total: 0 });
    const [filter, setFilter] = useState<Filter>('ALL');
    const [connected, setConnected] = useState(false);
    const [lastEvent, setLastEvent] = useState<Date | null>(null);

    // Stable refs so SSE handlers can call fetch without stale closures
    const fetchTasksRef = useRef<(f?: Filter) => Promise<void>>(async () => undefined);
    const fetchStatsRef = useRef<() => Promise<void>>(async () => undefined);

    const fetchTasks = useCallback(async (statusFilter: Filter = filter) => {
        const statusParam = statusFilter !== 'ALL' ? `?status=${statusFilter}` : '';
        try {
            const res = await fetch(`${BACKEND_URL}/api/v1/swarm/tasks${statusParam}`);
            if (res.ok) {
                const data = (await res.json()) as { tasks: QueueTask[] };
                setTasks(data.tasks ?? []);
            }
        } catch (_err) {
            // Network error — silently ignore, SSE will recover
        }
    }, [filter]);

    const fetchStats = useCallback(async () => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/v1/swarm/stats`);
            if (res.ok) setStats(await res.json() as QueueStats);
        } catch (_err) {
            // Network error — silently ignore
        }
    }, []);

    // Keep refs stable for SSE closures
    useEffect(() => { fetchTasksRef.current = fetchTasks; }, [fetchTasks]);
    useEffect(() => { fetchStatsRef.current = fetchStats; }, [fetchStats]);

    // ── SSE Connection (created once) ────────────────────────────────────────

    useEffect(() => {
        void fetchTasksRef.current();
        void fetchStatsRef.current();

        const es = new EventSource(`${BACKEND_URL}/api/v1/swarm/stream`);

        es.onopen = () => setConnected(true);

        es.addEventListener('stats', (e: MessageEvent<string>) => {
            try {
                setStats(JSON.parse(e.data) as QueueStats);
                setLastEvent(new Date());
            } catch (_) { /* ignore malformed */ }
        });

        es.addEventListener('task_update', (e: MessageEvent<string>) => {
            try {
                const update = JSON.parse(e.data) as { task_id: string; status: QueueTask['status'] };
                setLastEvent(new Date());

                setTasks(prev => {
                    const idx = prev.findIndex(t => t.id === update.task_id);
                    if (idx === -1) {
                        void fetchTasksRef.current();
                        void fetchStatsRef.current();
                        return prev;
                    }
                    const updated = [...prev];
                    updated[idx] = { ...updated[idx], status: update.status };
                    return updated;
                });

                void fetchStatsRef.current();
            } catch (_) { /* ignore malformed */ }
        });

        es.onerror = () => setConnected(false);

        return () => {
            es.close();
            setConnected(false);
        };
    }, []); // intentionally empty — SSE reconnects automatically via browser

    // Re-fetch when filter tab changes
    useEffect(() => { void fetchTasks(filter); }, [filter, fetchTasks]);

    // ── Actions ──────────────────────────────────────────────────────────────

    const handleRetry = async (id: string): Promise<void> => {
        await fetch(`${BACKEND_URL}/api/v1/swarm/tasks/${id}/retry`, { method: 'POST' });
        // SSE will push the PENDING status change automatically
    };

    const handleDelete = async (id: string): Promise<void> => {
        await fetch(`${BACKEND_URL}/api/v1/swarm/tasks/${id}`, { method: 'DELETE' });
        setTasks(prev => prev.filter(t => t.id !== id));
        await fetchStats();
    };

    // ── Render ───────────────────────────────────────────────────────────────

    return (
        <div className="flex flex-col h-full bg-transparent">
            {/* Header */}
            <div className="px-4 pt-4 pb-3 border-b tc-border shrink-0">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <Activity size={16} className="text-indigo-400" />
                        <span className="text-sm font-semibold tc-text">Swarm Command Center</span>
                        {(stats.PENDING > 0 || stats.RUNNING > 0) && (
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" title="Active tasks" />
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {connected
                            ? <span title="SSE Live"><Wifi size={12} className="text-emerald-400" /></span>
                            : <span title="SSE Reconnecting…"><WifiOff size={12} className="text-amber-400" /></span>
                        }
                        <button
                            onClick={() => { void fetchTasks(filter); void fetchStats(); }}
                            className="p-1.5 rounded-lg tc-btn-hover tc-text-muted hover:tc-text transition"
                            title="Refresh"
                        >
                            <RefreshCw size={13} />
                        </button>
                    </div>
                </div>

                {/* Stats Pills */}
                <div className="grid grid-cols-4 gap-2 mb-3">
                    <StatPill label="Pending" value={stats.PENDING} color="text-amber-400 border-amber-500/20 bg-amber-500/5" />
                    <StatPill label="Running" value={stats.RUNNING} color="text-blue-400 border-blue-500/20 bg-blue-500/5" />
                    <StatPill label="Success" value={stats.SUCCESS} color="text-emerald-400 border-emerald-500/20 bg-emerald-500/5" />
                    <StatPill label="Failed" value={stats.FAILED} color="text-amber-600 border-amber-600/20 bg-amber-600/5" />
                </div>

                {/* Filter Tabs */}
                <div className="flex gap-1">
                    {FILTERS.map(f => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`text-[10px] px-2 py-1 rounded-lg border transition-all font-medium ${filter === f
                                ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300'
                                : 'tc-text-muted border-transparent hover:bg-white/5 hover:tc-text'
                                }`}
                        >
                            {f}
                        </button>
                    ))}
                </div>
            </div>

            {/* Task Table */}
            <div className="flex-1 overflow-y-auto">
                {tasks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 gap-3 tc-text-muted">
                        <Webhook size={28} className="opacity-30" />
                        <div className="text-xs">
                            {filter === 'ALL' ? 'No webhook tasks yet. Send a trigger!' : `No ${filter} tasks.`}
                        </div>
                    </div>
                ) : (
                    <table className="w-full border-collapse text-xs">
                        <thead>
                            <tr className="border-b tc-border tc-surface-alt sticky top-0 z-10">
                                <th className="text-left px-3 py-2 text-[10px] font-semibold tc-text-muted uppercase tracking-wider">Task</th>
                                <th className="text-left px-2 py-2 text-[10px] font-semibold tc-text-muted uppercase tracking-wider">Status</th>
                                <th className="text-left px-2 py-2 text-[10px] font-semibold tc-text-muted uppercase tracking-wider">Role</th>
                                <th className="text-left px-2 py-2 text-[10px] font-semibold tc-text-muted uppercase tracking-wider">Age</th>
                                <th className="px-2 py-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {tasks.map(task => (
                                <TaskRow
                                    key={task.id}
                                    task={task}
                                    onRetry={handleRetry}
                                    onDelete={handleDelete}
                                />
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Footer */}
            <div className="px-4 py-2 border-t tc-border shrink-0 flex items-center justify-between">
                <span className="text-[9px] tc-text-muted">{stats.total} total · SSE live stream</span>
                {lastEvent && (
                    <span className="text-[9px] tc-text-muted">Last event {lastEvent.toLocaleTimeString()}</span>
                )}
            </div>
        </div>
    );
};
