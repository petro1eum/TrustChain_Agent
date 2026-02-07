import React, { useState, useMemo } from 'react';
import {
    Brain, ChevronDown, ChevronUp, CheckCircle2, Loader2,
    AlertCircle, Clock, Wrench, XCircle, Zap
} from 'lucide-react';

/**
 * LiveThinkingAccordion — Shows agent execution steps as a collapsible accordion.
 * Renders live during processing and as a final summary after completion.
 * Ported from AI Studio's ThinkingContainer with TrustChain theme integration.
 */

interface LiveThinkingAccordionProps {
    events: any[];         // MessageEvent[] from useAgent streamingEvents
    streamingText?: string; // Partial accumulated text
}

const formatDuration = (startTime?: Date, endTime?: Date): string => {
    if (!startTime) return '';
    const end = endTime || new Date();
    const ms = end.getTime() - startTime.getTime();
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
};

export const LiveThinkingAccordion: React.FC<LiveThinkingAccordionProps> = ({
    events,
    streamingText = '',
}) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());

    // Build steps from events (pair tool_calls with tool_results)
    const steps = useMemo(() => {
        const result: { event: any; index: number; toolResult?: any }[] = [];
        let stepIndex = 0;

        events.forEach(event => {
            if (event.type === 'thinking' || event.type === 'tool_call') {
                const toolResult = event.type === 'tool_call'
                    ? events.find((e: any) => e.type === 'tool_result' && e.toolCallId === event.id)
                    : undefined;
                stepIndex++;
                result.push({ event, index: stepIndex, toolResult });
            }
        });

        return result;
    }, [events]);

    // Compute stats
    const stats = useMemo(() => {
        let toolCallCount = 0;
        let completedTools = 0;
        let failedTools = 0;
        let verifiedCount = 0;
        let hasRunningTool = false;

        events.forEach((event: any) => {
            if (event.type === 'tool_call') {
                toolCallCount++;
                if (event.status === 'running') hasRunningTool = true;
                const hasResult = events.some((e: any) => e.type === 'tool_result' && e.toolCallId === event.id);
                if (hasResult) completedTools++;
            } else if (event.type === 'tool_result') {
                if (event.error) failedTools++;
                if (event.signature) verifiedCount++;
            }
        });

        const totalSteps = steps.length;
        const isProcessing = hasRunningTool || totalSteps === 0;

        return { totalSteps, toolCallCount, completedTools, failedTools, verifiedCount, isProcessing };
    }, [events, steps]);

    const toggleStep = (stepIndex: number) => {
        setExpandedSteps(prev => {
            const next = new Set(prev);
            if (next.has(stepIndex)) next.delete(stepIndex);
            else next.add(stepIndex);
            return next;
        });
    };

    // If no events yet, show a minimal spinner
    if (steps.length === 0) {
        return (
            <div className="flex items-center gap-2 py-1">
                <Loader2 size={14} className="animate-spin text-violet-400" />
                <span className="text-[12px] tc-text-muted">Thinking…</span>
            </div>
        );
    }

    return (
        <div className="tc-thinking-container rounded-xl border tc-border-light overflow-hidden -mx-1">
            {/* ── Header (always visible) ── */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left tc-surface-hover transition-colors"
            >
                {stats.isProcessing ? (
                    <Loader2 size={14} className="animate-spin text-blue-400" />
                ) : stats.failedTools > 0 ? (
                    <AlertCircle size={14} className="text-yellow-400" />
                ) : (
                    <CheckCircle2 size={14} className="text-green-400" />
                )}

                <span className="text-[11px] font-medium tc-text flex-1">
                    {stats.isProcessing ? 'Agent Execution' : 'Agent Execution'}
                </span>

                <span className="text-[10px] tc-text-muted">
                    {stats.totalSteps} steps
                    {stats.toolCallCount > 0 && ` · ${stats.completedTools}/${stats.toolCallCount} tools`}
                </span>

                {stats.verifiedCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 size={10} /> {stats.verifiedCount} signed
                    </span>
                )}

                {isExpanded ? <ChevronUp size={12} className="tc-text-muted" /> : <ChevronDown size={12} className="tc-text-muted" />}
            </button>

            {/* ── Expanded step list ── */}
            {isExpanded && (
                <div className="border-t tc-border-light max-h-[350px] overflow-y-auto tc-scrollbar">
                    {steps.map(({ event, index, toolResult }) => {
                        const isStepExpanded = expandedSteps.has(index);
                        const isError = !!toolResult?.error;

                        let icon: React.ReactNode;
                        let label: string;
                        let title: string;
                        let details: string = '';

                        if (event.type === 'thinking') {
                            icon = <Brain size={12} className="text-purple-400" />;
                            label = 'Thinking';
                            title = event.title || event.summary || 'Reasoning';
                            details = event.content || '';
                        } else {
                            // tool_call
                            if (event.status === 'running') {
                                icon = <Loader2 size={12} className="animate-spin text-blue-400" />;
                                label = 'Running';
                            } else if (isError) {
                                icon = <XCircle size={12} className="text-red-400" />;
                                label = 'Failed';
                            } else if (toolResult) {
                                icon = <CheckCircle2 size={12} className="text-green-400" />;
                                label = 'Done';
                            } else {
                                icon = <Wrench size={12} className="text-yellow-400" />;
                                label = 'Pending';
                            }
                            title = event.name || 'Tool';
                            details = toolResult?.result || event.arguments || '';
                            if (typeof details === 'object') {
                                try { details = JSON.stringify(details, null, 2); } catch { details = String(details); }
                            }
                        }

                        return (
                            <div key={`step-${index}`} className="border-b tc-border-light last:border-b-0">
                                <button
                                    onClick={() => toggleStep(index)}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-left tc-surface-hover transition-colors"
                                >
                                    <span className="text-[10px] tc-text-muted font-mono w-4 text-right">{index}</span>
                                    {icon}
                                    <span className={`text-[10px] font-medium ${isError ? 'text-red-400' :
                                            label === 'Thinking' ? 'text-purple-400' :
                                                label === 'Running' ? 'text-blue-400' :
                                                    'text-green-400'
                                        }`}>{label}</span>
                                    <span className="text-[11px] tc-text flex-1 truncate font-mono">{title}</span>
                                    {event.type === 'tool_call' && toolResult && (
                                        <span className="text-[9px] tc-text-muted flex items-center gap-0.5">
                                            <Clock size={9} />
                                            {formatDuration(event.timestamp, toolResult.timestamp)}
                                        </span>
                                    )}
                                    {toolResult?.signature && (
                                        <CheckCircle2 size={10} className="text-emerald-400" />
                                    )}
                                    {details && (
                                        isStepExpanded
                                            ? <ChevronUp size={10} className="tc-text-muted" />
                                            : <ChevronDown size={10} className="tc-text-muted" />
                                    )}
                                </button>
                                {isStepExpanded && details && (
                                    <div className="px-4 py-2 tc-surface border-t tc-border-light">
                                        <pre className="text-[10px] tc-text-secondary whitespace-pre-wrap break-words max-h-[150px] overflow-y-auto font-mono">
                                            {typeof details === 'string' ? details.substring(0, 800) : JSON.stringify(details, null, 2)?.substring(0, 800)}
                                        </pre>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── Streaming partial text ── */}
            {streamingText && (
                <div className="border-t tc-border-light px-3 py-2">
                    <p className="text-[12px] tc-text leading-relaxed">{streamingText.substring(0, 300)}{streamingText.length > 300 ? '…' : ''}</p>
                </div>
            )}
        </div>
    );
};
