/**
 * ThreadPanel — Multi-Thread Sub-Agent Visualization
 * 
 * Displays active and completed sub-agent sessions with real-time
 * progress bars, status indicators, and expandable results.
 * 
 * Inspired by OpenAI Codex App's multi-thread agent view.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { dockerAgentService } from '../../services/dockerAgentService';

export interface SpawnedSession {
    runId: string;
    name: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    progress: number;
    elapsedMs?: number;
    signedOpsCount: number;
    currentStep?: string;
    result?: string;
    error?: string;
    signature?: string;
}

// ─── Styles ───

const styles = {
    container: {
        position: 'fixed' as const,
        right: '16px',
        bottom: '80px',
        width: '360px',
        maxHeight: '420px',
        backgroundColor: 'var(--tc-surface)',
        borderRadius: '12px',
        border: '1px solid var(--tc-border)',
        boxShadow: 'var(--tc-shadow-lg)',
        overflow: 'hidden',
        zIndex: 1000,
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: '13px',
        color: 'var(--tc-text-primary)',
        transition: 'transform 0.2s ease, opacity 0.2s ease',
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        borderBottom: '1px solid var(--tc-border)',
        background: 'var(--tc-surface-alt)',
    },
    headerTitle: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontWeight: 600,
        fontSize: '14px',
        color: 'var(--tc-text-heading)',
    },
    badge: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: '20px',
        height: '20px',
        borderRadius: '10px',
        backgroundColor: 'var(--tc-send-active)',
        color: '#fff',
        fontSize: '11px',
        fontWeight: 700,
        padding: '0 6px',
    },
    closeBtn: {
        background: 'none',
        border: 'none',
        color: 'var(--tc-text-secondary)',
        cursor: 'pointer',
        fontSize: '18px',
        padding: '2px 6px',
        borderRadius: '4px',
        lineHeight: 1,
    },
    sessionList: {
        overflowY: 'auto' as const,
        maxHeight: '360px',
        padding: '8px',
    },
    sessionCard: {
        padding: '10px 12px',
        borderRadius: '8px',
        backgroundColor: 'var(--tc-surface)',
        border: '1px solid var(--tc-border)',
        marginBottom: '6px',
        cursor: 'pointer',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        boxShadow: 'var(--tc-shadow-sm)',
    },
    sessionCardActive: {
        borderColor: 'var(--tc-send-active)',
    },
    sessionHeader: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '6px',
    },
    sessionName: {
        fontWeight: 600,
        fontSize: '13px',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        color: 'var(--tc-text-heading)',
    },
    statusDot: (status: string) => ({
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        backgroundColor:
            status === 'completed' ? 'var(--tc-verified-text)' :
                status === 'running' ? 'var(--tc-send-active)' :
                    status === 'failed' ? 'var(--tc-unverified-text)' :
                        status === 'cancelled' ? '#f59e0b' :
                            'var(--tc-text-muted)',
        flexShrink: 0,
    }),
    progressBar: {
        width: '100%',
        height: '4px',
        borderRadius: '2px',
        backgroundColor: 'var(--tc-border)',
        overflow: 'hidden' as const,
        marginBottom: '6px',
    },
    progressFill: (progress: number, status: string) => ({
        height: '100%',
        width: `${progress}%`,
        borderRadius: '2px',
        backgroundColor:
            status === 'completed' ? 'var(--tc-verified-text)' :
                status === 'failed' ? 'var(--tc-unverified-text)' :
                    'var(--tc-send-active)',
        transition: 'width 0.3s ease',
    }),
    sessionMeta: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: '11px',
        color: 'var(--tc-text-secondary)',
    },
    certBadge: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        fontSize: '10px',
        color: 'var(--tc-verified-text)',
    },
    resultPreview: {
        marginTop: '8px',
        padding: '8px',
        borderRadius: '6px',
        backgroundColor: 'var(--tc-expanded-bg)',
        border: '1px solid var(--tc-border-light)',
        fontSize: '12px',
        lineHeight: 1.4,
        maxHeight: '120px',
        overflowY: 'auto' as const,
        whiteSpace: 'pre-wrap' as const,
        wordBreak: 'break-word' as const,
        color: 'var(--tc-text-primary)',
    },
    empty: {
        padding: '24px 16px',
        textAlign: 'center' as const,
        color: 'var(--tc-text-secondary)',
        fontSize: '13px',
    },
    cancelBtn: {
        background: 'none',
        border: '1px solid var(--tc-unverified-text)',
        color: 'var(--tc-unverified-text)',
        cursor: 'pointer',
        fontSize: '10px',
        padding: '2px 8px',
        borderRadius: '4px',
        fontWeight: 600,
    },
};

// ─── Sub-components ───

interface SessionCardProps {
    session: SpawnedSession;
    expanded: boolean;
    onToggle: () => void;
    onCancel: (runId: string) => void;
}

const SessionCard: React.FC<SessionCardProps> = ({ session, expanded, onToggle, onCancel }) => {
    const elapsed = session.elapsedMs
        ? session.elapsedMs >= 60000
            ? `${(session.elapsedMs / 60000).toFixed(1)}m`
            : `${(session.elapsedMs / 1000).toFixed(1)}s`
        : '';

    const isActive = session.status === 'running' || session.status === 'pending';

    return (
        <div
            style={{
                ...styles.sessionCard,
                ...(isActive ? styles.sessionCardActive : {}),
            }}
            onClick={onToggle}
        >
            {/* Header */}
            <div style={styles.sessionHeader}>
                <div style={styles.sessionName}>
                    <div style={styles.statusDot(session.status)} />
                    {session.name}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {isActive && (
                        <button
                            style={styles.cancelBtn}
                            onClick={(e) => { e.stopPropagation(); onCancel(session.runId); }}
                            title="Cancel"
                        >
                            Cancel
                        </button>
                    )}
                    {elapsed && (
                        <span style={{ fontSize: '11px', color: 'var(--text-secondary, #a6adc8)' }}>
                            {elapsed}
                        </span>
                    )}
                </div>
            </div>

            {/* Progress bar */}
            <div style={styles.progressBar}>
                <div style={styles.progressFill(session.progress, session.status)} />
            </div>

            {/* Meta */}
            <div style={styles.sessionMeta}>
                <span>{session.currentStep}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {session.signedOpsCount > 0 && (
                        <span style={styles.certBadge}>
                            {'\u{1F512}'} {session.signedOpsCount} ops
                        </span>
                    )}
                    {session.signature && (
                        <span style={styles.certBadge}>
                            {'\u2713'} signed
                        </span>
                    )}
                </div>
            </div>

            {/* Expanded: result preview */}
            {expanded && session.status === 'completed' && session.result && (
                <div style={styles.resultPreview}>
                    {session.result.slice(0, 500)}
                    {(session.result.length || 0) > 500 ? '...' : ''}
                </div>
            )}

            {/* Expanded: error */}
            {expanded && session.status === 'failed' && session.error && (
                <div style={{ ...styles.resultPreview, color: '#f38ba8' }}>
                    {session.error}
                </div>
            )}
        </div>
    );
};

// ─── Main Panel ───

interface ThreadPanelProps {
    visible?: boolean;
    onClose?: () => void;
}

export const ThreadPanel: React.FC<ThreadPanelProps> = ({ visible = true, onClose }) => {
    const [sessions, setSessions] = useState<SpawnedSession[]>([]);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    // Subscribe to session events
    useEffect(() => {
        const update = async () => {
            try {
                const res = await dockerAgentService.sessionStatus({});
                if (res && res.sessions) {
                    setSessions(res.sessions.map((s: any) => ({
                        runId: s.run_id,
                        name: s.name,
                        status: s.status,
                        progress: s.progress || 0,
                        currentStep: s.current_step,
                        error: s.error,
                        signedOpsCount: 0
                    })));
                }
            } catch { }
        };

        // Initial load
        update();

        // Poll for progress updates
        const interval = setInterval(update, 2000);

        return () => {
            clearInterval(interval);
        };
    }, []);

    const handleCancel = useCallback((runId: string) => {
        console.warn('[ThreadPanel] Cancel not implemented for backend subagents');
    }, []);

    const handleToggle = useCallback((runId: string) => {
        setExpandedId(prev => prev === runId ? null : runId);
    }, []);

    if (!visible) return null;

    const activeCount = sessions.filter(
        s => s.status === 'running' || s.status === 'pending'
    ).length;

    const isInline = !onClose;

    return (
        <div style={isInline ? { fontSize: '13px', color: 'var(--text-primary, #cdd6f4)' } : styles.container}>
            {/* Header */}
            <div style={styles.header}>
                <div style={styles.headerTitle}>
                    <span>Sub-Agent Threads</span>
                    {activeCount > 0 && <span style={styles.badge}>{activeCount}</span>}
                </div>
                {onClose && (
                    <button style={styles.closeBtn} onClick={onClose} title="Close">
                        x
                    </button>
                )}
            </div>

            {/* Session list */}
            <div style={styles.sessionList}>
                {sessions.length === 0 ? (
                    <div style={styles.empty}>
                        No sub-agent sessions yet.<br />
                        The agent will spawn sessions automatically for complex parallel tasks.
                    </div>
                ) : (
                    sessions.map(s => (
                        <SessionCard
                            key={s.runId}
                            session={s}
                            expanded={expandedId === s.runId}
                            onToggle={() => handleToggle(s.runId)}
                            onCancel={handleCancel}
                        />
                    ))
                )}
            </div>
        </div>
    );
};

export default ThreadPanel;
