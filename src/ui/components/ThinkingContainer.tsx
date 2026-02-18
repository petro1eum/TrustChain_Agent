import React, { useState, useCallback, useEffect } from 'react';
import { Zap, ChevronRight, Sparkles, FileText, CheckCircle, Download, Bot } from 'lucide-react';
import type { ExecutionStep, Artifact } from './types';
import { ARTIFACT_META, TierBadge } from './constants';
import { normalizeTrustChainMarkup, renderInline } from './MarkdownRenderer';
import {
    sessionSpawnService,
    type SpawnedSession,
} from '../../services/agents/sessionSpawnService';

/**
 * Downloads the execution trace as a JSON file.
 * MUST be synchronous and called directly from a click handler
 * so the browser preserves the user-gesture context (critical for iframes).
 */
function downloadTrace(steps: ExecutionStep[]): void {
    const trace = {
        exportedAt: new Date().toISOString(),
        totalSteps: steps.length,
        toolCalls: steps.filter(s => s.type === 'tool').length,
        signedCalls: steps.filter(s => s.signed).length,
        steps: steps.map(s => ({
            id: s.id,
            type: s.type,
            label: s.label,
            ...(s.toolName && { toolName: s.toolName }),
            ...(s.args && Object.keys(s.args).length > 0 && { args: s.args }),
            ...(s.result && { result: s.result }),
            ...(s.detail && { detail: s.detail }),
            ...(s.signature && { signature: s.signature }),
            signed: !!s.signed,
            ...(s.latencyMs && s.latencyMs > 0 && { latencyMs: s.latencyMs }),
            ...(s.artifactIds && { artifactIds: s.artifactIds }),
        })),
    };
    const jsonStr = JSON.stringify(trace, null, 2);
    const traceFilename = `agent-trace-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;

    // In a cross-origin iframe, Chrome blocks ALL download navigations
    // (blob URLs, data URLs, a.click()) from the iframe document.
    // Delegate to the parent window via postMessage.
    if (window.parent !== window) {
        try {
            window.parent.postMessage({
                type: 'trustchain:download',
                version: 1,
                data: jsonStr,
                filename: traceFilename,
                mimeType: 'application/json',
                requestId: `dl-${Date.now()}`,
            }, '*');
            return;
        } catch {
            // postMessage failed — fall through to direct download
        }
    }

    // Top-level context (not in iframe) — download directly
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = traceFilename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 200);
}

/**
 * ThinkingContainer — Rich visualization of agent execution timeline.
 * Shows planning steps, tool calls, and artifact generation in an expandable UI.
 */
export const ThinkingContainer: React.FC<{
    steps: ExecutionStep[];
    onOpenArtifact: (id: string) => void;
    allArtifacts?: Record<string, Artifact>;
}> = ({ steps, onOpenArtifact, allArtifacts }) => {
    const [expanded, setExpanded] = useState(true);
    const totalMs = steps.reduce((s, st) => s + (st.latencyMs || 0), 0);
    const toolSteps = steps.filter(s => s.type === 'tool');
    const signedCount = toolSteps.filter(s => s.signed).length;
    const traceHeadId = steps[0]?.id || '';

    // Auto-expand for each new response trace so thoughts are visible by default.
    useEffect(() => {
        setExpanded(true);
    }, [traceHeadId]);

    const handleDownload = useCallback((e: React.MouseEvent) => {
        e.stopPropagation(); // don't toggle accordion
        downloadTrace(steps);
    }, [steps]);

    return (
        <div className="mb-2.5 tc-thinking-container rounded-xl border tc-border-light overflow-hidden">
            {/* Header */}
            <div
                role="button"
                tabIndex={0}
                onClick={() => setExpanded(!expanded)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setExpanded(v => !v);
                    }
                }}
                className="w-full flex items-center gap-2 px-3 py-2 tc-surface-hover transition-colors"
                style={{ cursor: 'pointer' }}
            >
                <div className="flex items-center gap-2 text-left flex-1 min-w-0">
                    <div className="w-5 h-5 rounded-md bg-violet-500/10 flex items-center justify-center">
                        <Zap size={11} className="text-violet-500" />
                    </div>
                    <span className="text-[11px] font-medium tc-text flex-1">
                        Agent Execution
                    </span>
                    <span className="text-[10px] tc-text-muted">
                        {steps.length} steps{totalMs > 0 ? ` · ${totalMs}ms` : ''} · {signedCount}/{toolSteps.length} signed
                    </span>
                    <ChevronRight size={12} className={`tc-text-muted transition-transform ${expanded ? 'rotate-90' : ''}`} />
                </div>
                <button
                    type="button"
                    title="Скачать trace (JSON)"
                    onClick={handleDownload}
                    className="p-1 rounded hover:bg-white/10 transition-colors"
                    style={{ cursor: 'pointer', background: 'transparent', border: 'none' }}
                >
                    <Download size={11} className="tc-text-muted" />
                </button>
            </div>

            {/* Steps */}
            {expanded && (
                <div className="border-t tc-border-light">
                    {steps.map((step, idx) => (
                        <StepRow key={step.id} step={step} index={idx + 1} onOpenArtifact={onOpenArtifact} allArtifacts={allArtifacts} />
                    ))}
                </div>
            )}
        </div>
    );
};

/**
 * StepRow — Individual step in the execution timeline.
 */
const StepRow: React.FC<{
    step: ExecutionStep;
    index: number;
    onOpenArtifact: (id: string) => void;
    allArtifacts?: Record<string, Artifact>;
}> = ({ step, index, onOpenArtifact, allArtifacts }) => {
    const [open, setOpen] = useState(false);

    if (step.type === 'planning') {
        return (
            <div className="px-3 py-2 border-b tc-border-light tc-surface">
                <div className="flex items-center gap-2">
                    <span className="text-[10px] tc-text-muted w-4 text-right">{index}.</span>
                    <div className="w-4 h-4 rounded bg-amber-500/10 flex items-center justify-center">
                        <Sparkles size={10} className="text-amber-500" />
                    </div>
                    <span className="text-[11px] tc-text font-medium flex-1">{step.label}</span>
                    {step.latencyMs != null && step.latencyMs > 0 && <span className="text-[10px] tc-text-muted">{step.latencyMs}ms</span>}
                </div>
                {step.detail && (
                    <div
                        className="ml-10 mt-1 text-[11px] tc-text-secondary font-mono"
                        style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}
                    >
                        {renderInline(normalizeTrustChainMarkup(step.detail))}
                    </div>
                )}
            </div>
        );
    }

    if (step.type === 'artifacts') {
        return (
            <div className="px-3 py-2 tc-surface">
                <div className="flex items-center gap-2">
                    <span className="text-[10px] tc-text-muted w-4 text-right">{index}.</span>
                    <div className="w-4 h-4 rounded bg-cyan-500/10 flex items-center justify-center">
                        <FileText size={10} className="text-cyan-500" />
                    </div>
                    <span className="text-[11px] tc-text font-medium flex-1">{step.label}</span>
                </div>
                {step.artifactIds && allArtifacts && (
                    <div className="ml-10 mt-1 flex flex-wrap gap-1">
                        {step.artifactIds.map(aid => {
                            const art = allArtifacts[aid];
                            if (!art) return null;
                            const meta = ARTIFACT_META[art.type];
                            return (
                                <button key={aid} onClick={() => onOpenArtifact(aid)}
                                    className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md border tc-border-light tc-surface-hover transition-colors">
                                    <span className={meta.color}>{meta.icon}</span>
                                    <span className="tc-text">{art.title}</span>
                                    {art.tier && <TierBadge tier={art.tier} />}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    }

    // Tool step — with special rendering for session_spawn
    const isSpawnTool = step.toolName === 'session_spawn';

    return (
        <div className="border-b tc-border-light">
            <button onClick={() => setOpen(!open)}
                style={{ cursor: 'pointer' }}
                className="w-full px-3 py-2 flex items-center gap-2 text-left tc-surface-hover transition-colors">
                <span className="text-[10px] tc-text-muted w-4 text-right">{index}.</span>
                {isSpawnTool
                    ? <Bot size={11} className="text-teal-400" />
                    : <Zap size={11} className="text-amber-400" />
                }
                <span className="text-[11px] text-blue-500 font-mono flex-1">{step.toolName}</span>
                {step.tier && <TierBadge tier={step.tier} />}
                {step.latencyMs != null && step.latencyMs > 0 && <span className="text-[10px] tc-text-muted">{step.latencyMs}ms</span>}
                {step.signed && <CheckCircle size={10} className="text-emerald-500" />}
                <ChevronRight size={10} className={`tc-text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
            </button>
            {open && (
                <div className="ml-10 px-3 pb-2 space-y-0.5 text-[10px]">
                    {step.args && Object.keys(step.args).length > 0 && (
                        <div className="tc-text-secondary">
                            <span className="tc-text-muted">Args: </span>
                            <span className="font-mono">{JSON.stringify(step.args)}</span>
                        </div>
                    )}
                    {/* Sub-agent inline sessions for session_spawn */}
                    {isSpawnTool && <SubAgentInline />}
                    {step.result && !isSpawnTool && (
                        <div className="tc-text">
                            <span className="tc-text-muted">Result: </span>{step.result}
                        </div>
                    )}
                    {step.signature && (
                        <div className="text-emerald-500/60 font-mono">
                            <span className="tc-text-muted">Sig: </span>{step.signature}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

/** Inline sub-agent sessions — renders inside the session_spawn accordion */
const SubAgentInline: React.FC = () => {
    const [sessions, setSessions] = useState<SpawnedSession[]>([]);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    useEffect(() => {
        const update = () => setSessions(sessionSpawnService.getAllSessions());
        update();
        const unsub = sessionSpawnService.onAny(() => update());
        const iv = setInterval(update, 1500);
        return () => { unsub(); clearInterval(iv); };
    }, []);

    if (sessions.length === 0) {
        return <div className="tc-text-muted py-1">No sub-agent sessions spawned yet.</div>;
    }

    const statusColor = (s: string) =>
        s === 'completed' ? 'var(--tc-verified-text)'
            : s === 'running' ? 'var(--tc-send-active)'
                : s === 'failed' ? 'var(--tc-unverified-text)'
                    : 'var(--tc-text-muted)';

    return (
        <div className="mt-1 space-y-1.5">
            {sessions.map(s => {
                const elapsed = s.elapsedMs
                    ? s.elapsedMs >= 60000
                        ? `${(s.elapsedMs / 60000).toFixed(1)}m`
                        : `${(s.elapsedMs / 1000).toFixed(1)}s`
                    : '';
                const isActive = s.status === 'running' || s.status === 'pending';
                const isExpanded = expandedId === s.runId;

                return (
                    <div
                        key={s.runId}
                        className="rounded-md border tc-border-light tc-surface overflow-hidden"
                        style={{ boxShadow: 'var(--tc-shadow-sm)' }}
                    >
                        {/* Session header */}
                        <button
                            onClick={() => setExpandedId(isExpanded ? null : s.runId)}
                            className="w-full px-2.5 py-1.5 flex items-center gap-2 text-left tc-surface-hover transition-colors"
                            style={{ cursor: 'pointer' }}
                        >
                            <span
                                style={{
                                    width: 7, height: 7, borderRadius: '50%',
                                    backgroundColor: statusColor(s.status),
                                    flexShrink: 0,
                                    ...(isActive ? { animation: 'pulse 1.5s ease-in-out infinite' } : {}),
                                }}
                            />
                            <Bot size={10} className="tc-text-secondary" />
                            <span className="text-[11px] font-medium tc-text flex-1">{s.name}</span>
                            {elapsed && <span className="text-[10px] tc-text-muted">{elapsed}</span>}
                            {s.signedOpsCount > 0 && (
                                <span className="text-[9px]" style={{ color: 'var(--tc-verified-text)' }}>
                                    🔒{s.signedOpsCount}
                                </span>
                            )}
                            <ChevronRight size={9} className={`tc-text-muted transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                        </button>

                        {/* Progress bar */}
                        <div style={{
                            height: 2,
                            background: 'var(--tc-border)',
                        }}>
                            <div style={{
                                height: '100%',
                                width: `${s.progress}%`,
                                background: statusColor(s.status),
                                transition: 'width 0.3s ease',
                            }} />
                        </div>

                        {/* Current step label */}
                        {s.currentStep && (
                            <div className="px-2.5 py-1 text-[10px] tc-text-muted" style={{ borderTop: '1px solid var(--tc-border-light)' }}>
                                {s.currentStep}
                            </div>
                        )}

                        {/* Expanded: result/error */}
                        {isExpanded && s.status === 'completed' && s.result && (
                            <div
                                className="px-2.5 py-2 text-[11px] tc-text leading-relaxed"
                                style={{
                                    borderTop: '1px solid var(--tc-border-light)',
                                    background: 'var(--tc-expanded-bg)',
                                    maxHeight: 160,
                                    overflowY: 'auto',
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word',
                                }}
                            >
                                {s.result}
                            </div>
                        )}
                        {isExpanded && s.status === 'failed' && s.error && (
                            <div
                                className="px-2.5 py-2 text-[11px] leading-relaxed"
                                style={{
                                    borderTop: '1px solid var(--tc-border-light)',
                                    background: 'var(--tc-expanded-bg)',
                                    color: 'var(--tc-unverified-text)',
                                }}
                            >
                                {s.error}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};
