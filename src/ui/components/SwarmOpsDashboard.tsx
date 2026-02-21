/**
 * SwarmOpsDashboard.tsx
 * 
 * Real-time Swarm Command Center: visualizes the Durable Task Queue
 * from tasks.db — shows all PENDING / RUNNING / SUCCESS / FAILED webhook jobs.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
    Activity, RefreshCw, AlertTriangle, CheckCircle2,
    Clock, Loader2, Trash2, RotateCcw, ChevronDown,
    ChevronUp, Webhook, Shield, XCircle
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface QueueTask {
    id: string;
    task_slug: string;
    status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
    payload: any;
    result?: any;
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

const BACKEND_URL = (() => {
    const fromEnv = import.meta.env.VITE_BACKEND_URL;
    if (fromEnv) return fromEnv.replace(/\/$/, '');
    return `${window.location.protocol}//${window.location.hostname}:9742`;
})();

function StatusBadge({ status }: { status: QueueTask['status'] }) {
    const cfg = {
        PENDING: { icon: Clock, color: 'text-amber-400 bg-amber-500/10 border-amber-500/30', label: 'Pending' },
        RUNNING: { icon: Loader2, color: 'text-blue-400 bg-blue-500/10 border-blue-500/30', label: 'Running' },
        SUCCESS: { icon: CheckCircle2, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30', label: 'Success' },
        FAILED: { icon: XCircle, color: 'text-red-400 bg-red-500/10 border-red-500/30', label: 'Failed' },
    }[status] ?? { icon: Clock, color: 'text-gray-400 bg-gray-500/10 border-gray-500/30', label: status };

    const Icon = cfg.icon;
    return (
        <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border ${cfg.color}`}>
            <Icon size={9} className={status === 'RUNNING' ? 'animate-spin' : ''} />
            {cfg.label}
        </span>
    );
}

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
    return (
        <div className={`flex flex-col items-center justify-center px-3 py-2 rounded-lg border ${color} gap-0`}>
            <span className="text-lg font-bold leading-tight">{value}</span>
            <span className="text-[9px] uppercase tracking-wider opacity-60">{label}</span>
        </div>
    );
}

function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr + 'Z').getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return `${h}h ago`;
}

// ─── TaskRow ─────────────────────────────────────────────────────────────────

function TaskRow({ task, onRetry, onDelete }: {
    task: QueueTask;
    onRetry: (id: string) => void;
    onDelete: (id: string) => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const slug = task.task_slug || task.id;

    return (
        <>
            <tr className="border-b tc-border hover:bg-white/[0.02] transition-colors">
                <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                        <Webhook size={12} className="text-indigo-400 shrink-0" />
                        <span className="text-xs font-mono tc-text truncate max-w-[120px]" title={slug}>{slug}</span>
                    </div>
                    <div className="text-[10px] tc-text-muted font-mono mt-0.5 pl-5 truncate max-w-[150px]">{task.id}</div>
                </td>
                <td className="px-3 py-2">
                    <StatusBadge status={task.status} />
                </td>
                <td className="px-3 py-2">
                    <span className="text-[10px] inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                        <Shield size={8} />
                        WebhookExecutor
                    </span>
                </td>
                <td className="px-3 py-2 text-[10px] tc-text-muted whitespace-nowrap">
                    {timeAgo(task.created_at)}
                </td>
                <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setExpanded(v => !v)}
                            className="p-1 rounded hover:bg-white/10 tc-text-muted hover:tc-text transition"
                            title="Details"
                        >
                            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>
                        {task.status === 'FAILED' && (
                            <button
                                onClick={() => onRetry(task.id)}
                                className="p-1 rounded hover:bg-emerald-500/20 text-emerald-400 transition"
                                title="Retry Task"
                            >
                                <RotateCcw size={12} />
                            </button>
                        )}
                        <button
                            onClick={() => onDelete(task.id)}
                            className="p-1 rounded hover:bg-red-500/20 text-red-400 transition"
                            title="Delete"
                        >
                            <Trash2 size={12} />
                        </button>
                    </div>
                </td>
            </tr>
            {expanded && (
                <tr className="border-b tc-border bg-black/20">
                    <td colSpan={5} className="px-4 py-3">
                        {task.error ? (
                            <div className="rounded-lg bg-red-500/5 border border-red-500/20 p-3">
                                <div className="text-[10px] font-semibold text-red-400 mb-1 flex items-center gap-1">
                                    <AlertTriangle size={10} /> Dead Letter Queue — Error Trace
                                </div>
                                <pre className="text-[9px] text-red-300/80 overflow-auto max-h-40 font-mono whitespace-pre-wrap">
                                    {task.error}
                                </pre>
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

export const SwarmOpsDashboard: React.FC = () => {
    const [tasks, setTasks] = useState<QueueTask[]>([]);
    const [stats, setStats] = useState<QueueStats>({ PENDING: 0, RUNNING: 0, SUCCESS: 0, FAILED: 0, total: 0 });
    const [filter, setFilter] = useState<string>('ALL');
    const [loading, setLoading] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const statusParam = filter !== 'ALL' ? `?status=${filter}` : '';
            const [tasksRes, statsRes] = await Promise.all([
                fetch(`${BACKEND_URL}/api/v1/swarm/tasks${statusParam}`),
                fetch(`${BACKEND_URL}/api/v1/swarm/stats`)
            ]);
            if (tasksRes.ok) {
                const data = await tasksRes.json();
                setTasks(data.tasks ?? []);
            }
            if (statsRes.ok) {
                const s = await statsRes.json();
                setStats(s);
            }
            setLastUpdated(new Date());
        } catch (e) {
            console.error('SwarmOps fetch failed:', e);
        } finally {
            setLoading(false);
        }
    }, [filter]);

    // Auto-refresh every 3 seconds
    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 3000);
        return () => clearInterval(interval);
    }, [fetchData]);

    const handleRetry = async (id: string) => {
        try {
            await fetch(`${BACKEND_URL}/api/v1/swarm/tasks/${id}/retry`, { method: 'POST' });
            fetchData();
        } catch (e) { console.error(e); }
    };

    const handleDelete = async (id: string) => {
        try {
            await fetch(`${BACKEND_URL}/api/v1/swarm/tasks/${id}`, { method: 'DELETE' });
            setTasks(prev => prev.filter(t => t.id !== id));
            fetchData();
        } catch (e) { console.error(e); }
    };

    const filters = ['ALL', 'PENDING', 'RUNNING', 'SUCCESS', 'FAILED'];

    return (
        <div className="flex flex-col h-full bg-transparent">
            {/* Header */}
            <div className="px-4 pt-4 pb-3 border-b tc-border shrink-0">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <Activity size={16} className="text-indigo-400" />
                        <span className="text-sm font-semibold tc-text">Swarm Command Center</span>
                        {(stats.PENDING > 0 || stats.RUNNING > 0) && (
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        )}
                    </div>
                    <button
                        onClick={fetchData}
                        className={`p-1.5 rounded-lg tc-btn-hover tc-text-muted hover:tc-text transition ${loading ? 'animate-spin' : ''}`}
                        title="Refresh"
                    >
                        <RefreshCw size={14} />
                    </button>
                </div>

                {/* Stats Pills */}
                <div className="grid grid-cols-4 gap-2 mb-3">
                    <StatPill label="Pending" value={stats.PENDING} color="text-amber-400 border-amber-500/20 bg-amber-500/5" />
                    <StatPill label="Running" value={stats.RUNNING} color="text-blue-400 border-blue-500/20 bg-blue-500/5" />
                    <StatPill label="Success" value={stats.SUCCESS} color="text-emerald-400 border-emerald-500/20 bg-emerald-500/5" />
                    <StatPill label="Failed" value={stats.FAILED} color="text-red-400 border-red-500/20 bg-red-500/5" />
                </div>

                {/* Filter Tabs */}
                <div className="flex gap-1">
                    {filters.map(f => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`text-[10px] px-2.5 py-1 rounded-lg border transition-all font-medium ${filter === f
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
                            <tr className="border-b tc-border tc-surface-alt sticky top-0">
                                <th className="text-left px-3 py-2 text-[10px] font-semibold tc-text-muted uppercase tracking-wider">Task</th>
                                <th className="text-left px-3 py-2 text-[10px] font-semibold tc-text-muted uppercase tracking-wider">Status</th>
                                <th className="text-left px-3 py-2 text-[10px] font-semibold tc-text-muted uppercase tracking-wider">Role</th>
                                <th className="text-left px-3 py-2 text-[10px] font-semibold tc-text-muted uppercase tracking-wider">Age</th>
                                <th className="px-3 py-2"></th>
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
            {lastUpdated && (
                <div className="px-4 py-2 border-t tc-border shrink-0 flex items-center justify-between">
                    <span className="text-[9px] tc-text-muted">
                        {stats.total} total tasks · Auto-refreshes every 3s
                    </span>
                    <span className="text-[9px] tc-text-muted">
                        Updated {lastUpdated.toLocaleTimeString()}
                    </span>
                </div>
            )}
        </div>
    );
};
