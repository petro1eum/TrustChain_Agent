import React, { useState } from 'react';
import { Zap, ChevronRight, Sparkles, FileText, CheckCircle } from 'lucide-react';
import type { ExecutionStep, Artifact } from './types';
import { ARTIFACT_META, TierBadge } from './constants';

/**
 * ThinkingContainer — Rich visualization of agent execution timeline.
 * Shows planning steps, tool calls, and artifact generation in an expandable UI.
 */
export const ThinkingContainer: React.FC<{
    steps: ExecutionStep[];
    onOpenArtifact: (id: string) => void;
    allArtifacts?: Record<string, Artifact>;
}> = ({ steps, onOpenArtifact, allArtifacts }) => {
    const [expanded, setExpanded] = useState(false);
    const totalMs = steps.reduce((s, st) => s + (st.latencyMs || 0), 0);
    const toolSteps = steps.filter(s => s.type === 'tool');
    const signedCount = toolSteps.filter(s => s.signed).length;

    return (
        <div className="mb-2.5 tc-thinking-container rounded-xl border tc-border-light overflow-hidden">
            {/* Header */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left tc-surface-hover transition-colors"
            >
                <div className="w-5 h-5 rounded-md bg-violet-500/10 flex items-center justify-center">
                    <Zap size={11} className="text-violet-500" />
                </div>
                <span className="text-[11px] font-medium tc-text flex-1">
                    Agent Execution
                </span>
                <span className="text-[10px] tc-text-muted">
                    {steps.length} steps · {totalMs}ms · {signedCount}/{toolSteps.length} signed
                </span>
                <ChevronRight size={12} className={`tc-text-muted transition-transform ${expanded ? 'rotate-90' : ''}`} />
            </button>

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
                    {step.latencyMs && <span className="text-[10px] tc-text-muted">{step.latencyMs}ms</span>}
                </div>
                {step.detail && (
                    <div className="ml-10 mt-1 text-[11px] tc-text-secondary font-mono">{step.detail}</div>
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

    // Tool step
    return (
        <div className="border-b tc-border-light">
            <button onClick={() => setOpen(!open)}
                className="w-full px-3 py-2 flex items-center gap-2 text-left tc-surface-hover transition-colors">
                <span className="text-[10px] tc-text-muted w-4 text-right">{index}.</span>
                <Zap size={11} className="text-amber-400" />
                <span className="text-[11px] text-blue-500 font-mono flex-1">{step.toolName}</span>
                {step.tier && <TierBadge tier={step.tier} />}
                {step.latencyMs && <span className="text-[10px] tc-text-muted">{step.latencyMs}ms</span>}
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
                    {step.result && (
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
