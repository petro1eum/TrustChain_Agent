import React, { useState, useEffect, useCallback, useMemo } from 'react';
import '../agentTheme.css';
import { ThinkingContainer } from '../components/ThinkingContainer';
import {
    Bot, X, Loader2, ArrowUp, Check, ChevronRight,
    Search, FileText, BarChart3, Sparkles, Wrench, Zap, Shield,
    Terminal, Activity, AlertTriangle, CheckCircle, Database,
    TrendingUp, Lock, Eye, MessageSquare, Clock
} from 'lucide-react';
import { useAgent, type AgentTool } from '../../hooks/useAgent';
import { useChatState } from '../../hooks/useChatState';
import { chatHistoryService } from '../../services/chatHistoryService';
import { agentCallbacksService } from '../../services/agents/agentCallbacksService';
import { setAgentContext } from '../../services/agentContext';
import type { Message, Artifact, ExecutionStep } from '../components/types';
import { renderFullMarkdown } from '../components/MarkdownRenderer';
import '../theme.ts';

// ─── URL Parameter Parsing ───

function getPanelParams() {
    const params = new URLSearchParams(window.location.search);
    const mcpUrl = params.get('mcp') || null;
    const instance = params.get('instance') || 'default';

    // Pre-register MCP config in localStorage BEFORE Agent initializes.
    // This fixes a race condition: SmartAIAgent constructor fires connectAll()
    // which reads from 'kb_agent_mcp_servers' — if we don't write here first,
    // the MCP server never gets discovered.
    if (mcpUrl) {
        try {
            const mcpConfig = {
                id: `panel_${instance}`,
                name: `Panel MCP (${instance})`,
                url: mcpUrl,
                transport: 'sse',
                enabled: true,
            };
            const existing = JSON.parse(localStorage.getItem('kb_agent_mcp_servers') || '[]');
            const filtered = existing.filter((c: any) => c.id !== mcpConfig.id);
            filtered.push(mcpConfig);
            localStorage.setItem('kb_agent_mcp_servers', JSON.stringify(filtered));
        } catch { /* ignore */ }
    }

    return {
        instance,
        mcpUrl,
        systemPrompt: params.get('system') ? atob(params.get('system')!) : null,
        theme: (params.get('theme') as 'dark' | 'light') || 'dark',
        lang: params.get('lang') || 'ru',
        context: params.get('context') || null,   // page context: "risk_tree", "contracts", "documents", etc.
        title: params.get('title') || null,        // custom panel title
        hostUrl: params.get('hostUrl') || null,    // URL of the host app page (for Playwright navigation)
    };
}

// ─── localStorage Namespace ───

const panelParams = getPanelParams();
const NS = `tc_panel_${panelParams.instance}`;

function nsGet(key: string): string | null {
    return localStorage.getItem(`${NS}_${key}`);
}

// ─── Context-Aware Skill Suggestions ───
// These are driven by ?context= URL param from the host page.
// Each page embeds the panel with its own context, and the panel
// shows only the skills relevant to that page.

interface ContextSkill {
    icon: React.ReactNode;
    label: string;
    prompt: string;
    color: string;
}

function getContextSkills(context: string | null, mcpTools: Array<{ name: string; description: string }>): ContextSkill[] {
    // 1. If MCP tools are available, use them as primary skills
    if (mcpTools.length > 0) {
        const iconMap: Record<string, React.ReactNode> = {
            list: <Search size={13} />, get: <FileText size={13} />,
            analyz: <Sparkles size={13} />, suggest: <Sparkles size={13} />,
            update: <Wrench size={13} />, harmon: <BarChart3 size={13} />,
            search: <Search size={13} />, export: <BarChart3 size={13} />,
        };
        const colorMap: Record<string, string> = {
            list: '#06b6d4', get: '#3b82f6', analyz: '#a78bfa',
            suggest: '#8b5cf6', update: '#f59e0b', harmon: '#34d399',
            search: '#06b6d4', export: '#22c55e',
        };
        return mcpTools.slice(0, 5).map(tool => {
            const lower = tool.name.toLowerCase();
            const matchKey = Object.keys(iconMap).find(k => lower.includes(k));
            return {
                icon: matchKey ? iconMap[matchKey] : <Zap size={13} />,
                label: tool.description || tool.name,
                prompt: tool.description || `Используй ${tool.name}`,
                color: matchKey ? colorMap[matchKey] : '#818cf8',
            };
        });
    }

    // 2. No MCP tools — generic fallback. Host can inject skills via trustchain:skills postMessage.
    return [
        { icon: <MessageSquare size={13} />, label: 'Задайте вопрос', prompt: '', color: '#818cf8' },
    ];
}

function getContextGreeting(context: string | null): { title: string; subtitle: string } {
    // Generic greeting. Host app can override via trustchain:greeting postMessage.
    return { title: 'Чем могу помочь?', subtitle: 'Задайте вопрос или выберите действие' };
}

// ═══════════════════════════════════════════
//  Context-Specific System Prompts
//  Each page gets a unique expert role
// ═══════════════════════════════════════════

function getContextSystemPrompt(context: string | null): string {
    const params = getPanelParams();
    const hostUrl = params.hostUrl;

    // Playwright instructions — generic, not project-specific
    const browserInstructions = hostUrl
        ? `

## Browser (Playwright)
You have Playwright tools for direct interaction with the host page: ${hostUrl}
⚠️ PRIORITY: Always use MCP tools first! Playwright is a last resort for:
- Visually verifying page content
- Clicking UI elements
- When MCP tools don't provide needed information

Steps: mcp_playwright_browser_navigate → mcp_playwright_browser_snapshot → click/type`
        : '';

    // Generic fallback — no domain knowledge, no project-specific tools
    // Projects MUST supply their own system prompt via ?system= URL parameter.
    // See INTEGRATION_STANDARD.md for requirements.
    return `You are an AI assistant integrated via TrustChain Agent.
Use MCP tools to access the platform's real data. Never fabricate data — always call an MCP tool.
Only use tools that are provided by the connected MCP server (prefixed with mcp_panel_*).
Do NOT use built-in tools like search_products, compare_products, quick_search — they belong to other contexts.

Respond in the same language as the user's message.
Format: use **bold headers**, numbered lists, tables, and conclude with a **Recommendation:** section.${browserInstructions}`;
}


// ═══════════════════════════════════════════
//  Subcomponents
// ═══════════════════════════════════════════

// ─── Helpers ───

const formatTime = (d: Date | undefined): string => {
    if (!d) return '';
    const date = d instanceof Date ? d : new Date(d);
    return date.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
};

// ─── Progress Steps (Harmonization pattern) ───

const ProgressSteps: React.FC<{ steps: ExecutionStep[] }> = ({ steps }) => {
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    const [showAll, setShowAll] = useState(false);

    const toggleStep = (id: string) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    if (!steps || steps.length === 0) return null;

    const visibleSteps = showAll ? steps : steps.slice(0, 6);

    return (
        <div style={{
            background: 'rgba(30,41,59,0.5)', borderRadius: 8, padding: '8px 10px', marginBottom: 8,
            border: '1px solid #1e293b',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: '#64748b', fontWeight: 600, letterSpacing: 0.5 }}>Progress Updates</span>
                {steps.length > 6 && (
                    <button
                        onClick={() => setShowAll(!showAll)}
                        style={{ fontSize: 10, color: '#818cf8', cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
                    >
                        {showAll ? 'Collapse' : 'Expand all'}
                    </button>
                )}
            </div>
            {visibleSteps.map((step, i) => {
                const isExpanded = expandedIds.has(step.id);
                const isTool = step.type === 'tool' && step.toolName;
                const isPlanning = step.type === 'planning';

                return (
                    <div key={step.id} style={{ marginTop: i === 0 ? 0 : 2 }}>
                        <div
                            onClick={isTool ? () => toggleStep(step.id) : undefined}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 6, fontSize: 11,
                                color: '#cbd5e1', cursor: isTool ? 'pointer' : 'default',
                                padding: '2px 0', lineHeight: 1.5,
                            }}
                        >
                            {/* Step icon */}
                            {isTool ? (
                                <Wrench size={10} style={{ color: '#818cf8', flexShrink: 0 }} />
                            ) : isPlanning ? (
                                <Activity size={10} style={{ color: '#64748b', flexShrink: 0 }} />
                            ) : (
                                <Check size={10} style={{ color: '#34d399', flexShrink: 0 }} />
                            )}

                            {/* Label */}
                            <span style={{ flex: 1, color: isTool ? '#a5b4fc' : '#94a3b8' }}>
                                {isTool ? step.toolName : (step.label || step.detail)}
                            </span>

                            {/* Signature badge */}
                            {step.signed && (
                                <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                    <Shield size={8} style={{ color: '#34d399' }} />
                                </span>
                            )}

                            {/* Status */}
                            {isTool && (
                                <ChevronRight size={10} style={{
                                    color: '#475569', flexShrink: 0,
                                    transform: isExpanded ? 'rotate(90deg)' : 'none',
                                    transition: 'transform 0.15s'
                                }} />
                            )}
                            {!isTool && <Check size={10} style={{ color: '#34d399', flexShrink: 0 }} />}
                        </div>

                        {/* Expanded tool details */}
                        {isTool && isExpanded && (
                            <div style={{
                                marginLeft: 16, marginTop: 2, marginBottom: 4,
                                padding: '6px 8px', background: 'rgba(15,23,42,0.6)',
                                borderRadius: 6, border: '1px solid #1e293b',
                                fontSize: 10, color: '#94a3b8', lineHeight: 1.6,
                            }}>
                                {step.args && Object.keys(step.args).length > 0 && (
                                    <div style={{ marginBottom: 4 }}>
                                        <span style={{ color: '#64748b' }}>Args: </span>
                                        <code style={{ color: '#67e8f9', fontSize: 9 }}>
                                            {JSON.stringify(step.args)}
                                        </code>
                                    </div>
                                )}
                                {step.result && (
                                    <div style={{ marginBottom: 4 }}>
                                        <span style={{ color: '#64748b' }}>Result: </span>
                                        <span style={{ color: '#cbd5e1' }}>
                                            {step.result.length > 200 ? step.result.substring(0, 200) + '…' : step.result}
                                        </span>
                                    </div>
                                )}
                                {step.signature && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <Shield size={8} style={{ color: '#34d399' }} />
                                        <code style={{ color: '#34d399', fontSize: 8, wordBreak: 'break-all' }}>
                                            {step.signature.substring(0, 32)}…
                                        </code>
                                    </div>
                                )}
                                {step.latencyMs !== undefined && step.latencyMs > 0 && (
                                    <div>
                                        <span style={{ color: '#64748b' }}>Latency: </span>
                                        <span>{step.latencyMs}ms</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

// ─── Feedback Buttons (Good/Bad) ───

const FeedbackButtons: React.FC<{ messageId: string }> = ({ messageId }) => {
    const [feedback, setFeedback] = useState<'good' | 'bad' | null>(null);

    if (feedback) {
        return (
            <span style={{ fontSize: 10, color: '#475569' }}>
                {feedback === 'good' ? '👍' : '👎'}
            </span>
        );
    }

    return (
        <div style={{ display: 'flex', gap: 4 }}>
            <button
                onClick={() => setFeedback('good')}
                style={{
                    background: 'none', border: 'none', cursor: 'pointer', fontSize: 10,
                    color: '#475569', padding: '2px 4px', borderRadius: 4,
                    transition: 'color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = '#34d399')}
                onMouseLeave={e => (e.currentTarget.style.color = '#475569')}
                title="Good"
            >
                Good 👍
            </button>
            <button
                onClick={() => setFeedback('bad')}
                style={{
                    background: 'none', border: 'none', cursor: 'pointer', fontSize: 10,
                    color: '#475569', padding: '2px 4px', borderRadius: 4,
                    transition: 'color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                onMouseLeave={e => (e.currentTarget.style.color = '#475569')}
                title="Bad"
            >
                Bad 👎
            </button>
        </div>
    );
};

// ─── Panel Message (Harmonization Agent pattern) ───

const PanelMessage: React.FC<{
    message: Message;
    allArtifacts: Record<string, Artifact>;
    onOpenArtifact: (id: string) => void;
}> = ({ message, allArtifacts, onOpenArtifact }) => {
    const isUser = message.role === 'user';
    const timeStr = formatTime(message.timestamp);

    if (isUser) {
        return (
            <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 3 }}>
                    <div style={{
                        background: 'linear-gradient(135deg, rgba(6,182,212,0.18), rgba(59,130,246,0.14))',
                        border: '1px solid rgba(6,182,212,0.25)',
                        borderRadius: '12px 12px 4px 12px',
                        padding: '10px 14px', fontSize: 12, color: '#67e8f9',
                        whiteSpace: 'pre-wrap', maxWidth: '88%',
                    }}>
                        {message.content}
                    </div>
                </div>
                {timeStr && (
                    <div style={{ textAlign: 'right', fontSize: 9, color: '#475569', marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                        <Clock size={8} /> {timeStr}
                    </div>
                )}
            </div>
        );
    }

    // Assistant message — structured card
    return (
        <div style={{ marginBottom: 14 }}>
            {/* Agent label */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                <div style={{
                    width: 20, height: 20, borderRadius: 6,
                    background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <Bot size={10} color="#fff" />
                </div>
                <span style={{ fontSize: 10, color: '#64748b', flex: 1 }}>Agent</span>
                {message.executionSteps && message.executionSteps.length > 0 && (
                    <span style={{ fontSize: 9, color: '#475569' }}>
                        {message.executionSteps.filter(s => s.type === 'tool').length} steps · {message.executionSteps.filter(s => s.signed !== undefined).length > 0 ? `${message.executionSteps.filter(s => s.signed !== undefined).length}/${message.executionSteps.length} signed` : ''}
                    </span>
                )}
                {message.signature && (
                    <span style={{ fontSize: 9, color: '#34d399', display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Shield size={8} /> verified
                    </span>
                )}
            </div>

            {/* Progress steps (if present) */}
            {message.executionSteps && message.executionSteps.length > 0 && (
                <ThinkingContainer steps={message.executionSteps} onOpenArtifact={onOpenArtifact} allArtifacts={allArtifacts} />
            )}

            {/* Main response card */}
            <div style={{
                background: '#1e293b', border: '1px solid #293548',
                borderRadius: 10, padding: '12px 14px', fontSize: 12, color: '#cbd5e1',
            }}>
                <div className="tc-markdown" style={{ lineHeight: 1.65 }}>{renderFullMarkdown(message.content)}</div>
            </div>

            {/* Artifacts */}
            {message.artifactIds && message.artifactIds.length > 0 && (
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {message.artifactIds.map(aid => {
                        const art = allArtifacts[aid];
                        if (!art) return null;
                        return (
                            <button key={aid} onClick={() => onOpenArtifact(aid)} style={{
                                width: '100%', textAlign: 'left', padding: '8px 10px',
                                background: 'rgba(99,102,241,0.12)', borderLeft: '2px solid #818cf8',
                                borderRadius: 6, color: '#a5b4fc', fontSize: 11, cursor: 'pointer', border: 'none',
                            }}>
                                📄 {art.title}
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Footer: timestamp + feedback */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                {timeStr && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: '#475569' }}>
                        <Clock size={8} /> {timeStr}
                    </div>
                )}
                <FeedbackButtons messageId={message.id} />
            </div>
        </div>
    );
};

// ─── Welcome Screen (Context-Aware) ───

const WelcomeContent: React.FC<{
    context: string | null;
    agentReady: boolean;
    mcpStatus: string;
    skills: ContextSkill[];
    toolCount: number;
    onSkillClick: (prompt: string) => void;
}> = ({ context, agentReady, mcpStatus, skills, toolCount, onSkillClick }) => {
    const greeting = getContextGreeting(context);

    return (
        <div style={{ padding: '0 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100%' }}>
            {/* ── Logo + Greeting ── */}
            <div style={{ textAlign: 'center', marginBottom: 20, paddingTop: 24 }}>
                <div style={{
                    width: 48, height: 48, borderRadius: 14,
                    background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 8px 24px rgba(139,92,246,0.25)',
                    marginBottom: 12,
                }}>
                    <Shield size={22} color="#fff" />
                </div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#e2e8f0', marginBottom: 4 }}>{greeting.title}</div>
                <div style={{ fontSize: 12, color: '#64748b', maxWidth: 240, margin: '0 auto' }}>{greeting.subtitle}</div>
            </div>

            {/* ── Status pills ── */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 24, justifyContent: 'center' }}>
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    background: agentReady ? 'rgba(52,211,153,0.10)' : 'rgba(239,68,68,0.10)',
                    border: `1px solid ${agentReady ? 'rgba(52,211,153,0.25)' : 'rgba(239,68,68,0.25)'}`,
                    borderRadius: 12, padding: '4px 10px', fontSize: 10,
                    color: agentReady ? '#6ee7b7' : '#fca5a5',
                }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: agentReady ? '#34d399' : '#ef4444' }} />
                    {agentReady ? 'Агент готов' : 'Нет API key'}
                </div>
                {mcpStatus === 'connected' && (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        background: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.25)',
                        borderRadius: 12, padding: '4px 10px', fontSize: 10, color: '#6ee7b7',
                    }}>
                        <Activity size={10} /> MCP
                    </div>
                )}
                {toolCount > 0 && (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        background: 'rgba(99,102,241,0.10)', border: '1px solid rgba(99,102,241,0.25)',
                        borderRadius: 12, padding: '4px 10px', fontSize: 10, color: '#a5b4fc',
                    }}>
                        <Wrench size={10} /> {toolCount}
                    </div>
                )}
            </div>

            {/* ── Contextual Skills ── */}
            {skills.length > 0 && skills[0].prompt !== '' && (
                <div style={{ width: '100%', maxWidth: 320 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {skills.map((skill) => (
                            <button
                                key={skill.label}
                                onClick={() => onSkillClick(skill.prompt)}
                                style={{
                                    width: '100%', textAlign: 'left',
                                    background: '#1e293b', border: '1px solid #334155',
                                    borderRadius: 10, padding: '10px 12px',
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    cursor: 'pointer', transition: 'all 0.2s',
                                    color: '#cbd5e1', fontSize: 12,
                                }}
                                onMouseEnter={e => {
                                    e.currentTarget.style.borderColor = skill.color;
                                    e.currentTarget.style.background = 'rgba(30,41,59,0.8)';
                                }}
                                onMouseLeave={e => {
                                    e.currentTarget.style.borderColor = '#334155';
                                    e.currentTarget.style.background = '#1e293b';
                                }}
                            >
                                <span style={{ color: skill.color, display: 'flex', alignItems: 'center', flexShrink: 0 }}>{skill.icon}</span>
                                <span style={{ flex: 1 }}>{skill.label}</span>
                                <ChevronRight size={12} style={{ color: '#475569', flexShrink: 0 }} />
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Security note ── */}
            <div style={{ marginTop: 24, textAlign: 'center' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#475569' }}>
                    <Lock size={9} /> Ed25519 подписи · данные в контуре
                </div>
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════
//  Main Panel App
// ═══════════════════════════════════════════

const PanelApp: React.FC = () => {
    const params = useMemo(() => getPanelParams(), []);

    // Initialize agent context singleton so internal services know the platform
    useEffect(() => {
        setAgentContext(params.instance, params.context);
    }, [params.instance, params.context]);

    const {
        messages, setMessages,
        inputValue, setInputValue,
        isTyping, setIsTyping,
        activeArtifactId, setActiveArtifactId,
        dynamicArtifacts, setDynamicArtifacts,
        messagesEndRef, inputRef,
    } = useChatState([]);

    const agent = useAgent();
    const [mcpStatus, setMcpStatus] = useState<'connecting' | 'connected' | 'offline'>('offline');
    const [mcpTools, setMcpTools] = useState<Array<{ name: string; description: string }>>([]);
    const [viewingArtifact, setViewingArtifact] = useState<Artifact | null>(null);
    const [hostSkills, setHostSkills] = useState<ContextSkill[]>([]);

    // ── Initialize Host Bridge (for page_observe/read/interact tools) ──
    useEffect(() => {
        import('../../services/hostBridgeService').then(({ HostBridgeService }) => {
            HostBridgeService.getInstance().attachListener();
        });
    }, []);

    // ── Listen for postMessage from host page ──
    useEffect(() => {
        const handleMessage = (e: MessageEvent) => {
            if (!e.data || typeof e.data !== 'object') return;

            // Host can send context-specific skills
            if (e.data.type === 'trustchain:skills') {
                const skills: ContextSkill[] = (e.data.skills || []).map((s: any) => ({
                    icon: <Zap size={13} />,
                    label: s.label || s.name,
                    prompt: s.prompt || s.command || '',
                    color: s.color || '#818cf8',
                }));
                setHostSkills(skills);
            }

            // Host can send a pre-filled query
            if (e.data.type === 'trustchain:query') {
                setInputValue(e.data.text || '');
                inputRef.current?.focus();
            }

            // Host can directly auto-send a query
            if (e.data.type === 'trustchain:auto_query' && e.data.text) {
                setInputValue(e.data.text);
                // Auto-send will be triggered by effect
                setTimeout(() => {
                    const btn = document.querySelector('[data-send-btn]') as HTMLButtonElement;
                    btn?.click();
                }, 100);
            }

            // Host can inject custom intent patterns for TaskIntentService
            if (e.data.type === 'trustchain:intent_patterns' && Array.isArray(e.data.patterns)) {
                import('../../services/agents/taskIntentService').then(({ sharedIntentService }) => {
                    sharedIntentService.setCustomPatterns(e.data.patterns);
                });
            }

            // Host can inject domain hints for LLM intent classifier
            if (e.data.type === 'trustchain:domain_hints' && e.data.hints) {
                import('../../services/agents/taskIntentService').then(({ sharedIntentService }) => {
                    sharedIntentService.setDomainHints(e.data.hints);
                });
            }

            // Host can register client-side app actions dynamically
            if (e.data.type === 'trustchain:register_actions' && Array.isArray(e.data.actions)) {
                import('../../services/appActionsRegistry').then(({ appActionsRegistry }) => {
                    appActionsRegistry.registerActions(e.data.actions);
                });
            }

            // Host can clear all registered actions (e.g. on context/page change)
            if (e.data.type === 'trustchain:clear_actions') {
                import('../../services/appActionsRegistry').then(({ appActionsRegistry }) => {
                    appActionsRegistry.clear();
                });
            }

            // Host can inject agent specializations for the orchestrator
            if (e.data.type === 'trustchain:agent_config') {
                import('../../services/agents/agentOrchestratorService').then(({ AgentOrchestratorService }) => {
                    // The orchestrator is instantiated per-agent, but config is shared via
                    // a module-level singleton that agent reads on next decomposition.
                    const sharedConfig = (window as any).__trustchain_agent_config = (window as any).__trustchain_agent_config || {};
                    if (Array.isArray(e.data.specialties)) {
                        sharedConfig.specialties = e.data.specialties;
                        console.log('[PanelApp] Received agent specialties:', e.data.specialties.length);
                    }
                    if (Array.isArray(e.data.complexityKeywords)) {
                        sharedConfig.complexityKeywords = e.data.complexityKeywords;
                    }
                    if (typeof e.data.greeting === 'string') {
                        sharedConfig.greeting = e.data.greeting;
                    }
                });
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Derive current skills (host > MCP > context fallback) ──
    const currentSkills = useMemo(() => {
        if (hostSkills.length > 0) return hostSkills;
        return getContextSkills(params.context, mcpTools);
    }, [hostSkills, params.context, mcpTools]);

    // ── Auto-initialize agent ──
    useEffect(() => {
        const savedKey = nsGet('api_key') || localStorage.getItem('tc_api_key');
        const envKey = (import.meta as any).env?.VITE_OPENAI_API_KEY;
        const apiKey = savedKey || envKey;
        const savedModel = nsGet('model') || localStorage.getItem('tc_model') || 'google/gemini-2.5-flash';
        if (apiKey && !agent.isInitialized) {
            agent.initialize({ apiKey, model: savedModel });
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Auto-connect MCP ──
    useEffect(() => {
        if (!params.mcpUrl) return;
        const connectMCP = async () => {
            setMcpStatus('connecting');
            try {
                const mcpConfig = {
                    id: `panel_${params.instance}`,
                    name: `Panel MCP (${params.instance})`,
                    url: params.mcpUrl!,
                    transport: 'sse' as const,
                    enabled: true,
                };
                const existingConfigs = JSON.parse(localStorage.getItem('kb_agent_mcp_servers') || '[]');
                const filtered = existingConfigs.filter((c: any) => c.id !== mcpConfig.id);
                filtered.push(mcpConfig);
                localStorage.setItem('kb_agent_mcp_servers', JSON.stringify(filtered));

                const response = await fetch(`${params.mcpUrl}/tools`, { signal: AbortSignal.timeout(5000) });
                if (response.ok) {
                    const data = await response.json();
                    const tools = data.tools || data || [];
                    setMcpTools(tools.map((t: any) => ({ name: t.name, description: t.description || t.name })));
                    setMcpStatus('connected');
                } else {
                    setMcpStatus('offline');
                }
            } catch {
                try {
                    const health = await fetch(`${params.mcpUrl!.replace(/\/+$/, '')}/health`, { signal: AbortSignal.timeout(3000) });
                    setMcpStatus(health.ok ? 'connected' : 'offline');
                } catch { setMcpStatus('offline'); }
            }
        };
        connectMCP();
    }, [params.mcpUrl, params.instance]);

    // ── Callbacks ──
    useEffect(() => {
        agentCallbacksService.configure({
            onArtifactCreated: (artifact) => {
                setDynamicArtifacts(prev => ({ ...prev, [artifact.id]: { ...artifact, createdAt: new Date(), version: 1 } }));
                setActiveArtifactId(artifact.id);
            },
        });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Extract artifacts ──
    const extractArtifactsFromEvents = useCallback((events: any[]) => {
        const artifactIds: string[] = [];
        const newArtifacts: Record<string, Artifact> = {};
        const toolCallNames: Record<string, string> = {};
        for (const ev of events) {
            if (ev.type === 'tool_call') toolCallNames[ev.id] = ev.name;
            if (ev.type === 'tool_result') {
                const callName = toolCallNames[ev.toolCallId || ''] || '';
                if (callName !== 'create_artifact' && callName !== 'create_file') continue;
                let result: any;
                try { result = typeof ev.result === 'string' ? JSON.parse(ev.result) : ev.result; } catch { continue; }
                if (result?.id || result?.artifact_id) {
                    const artId = result.id || result.artifact_id;
                    artifactIds.push(artId);
                    newArtifacts[artId] = {
                        id: artId, type: (result.type || 'document') as any,
                        title: result.title || result.name || 'Artifact',
                        content: result.content || JSON.stringify(result, null, 2),
                        createdAt: new Date(), version: 1,
                    };
                }
            }
        }
        return { artifactIds, newArtifacts };
    }, []);

    // ── Send page action to host (for agent→page bridge) ──
    const sendPageAction = useCallback((action: string, payload: Record<string, any> = {}) => {
        try {
            window.parent.postMessage({
                type: 'trustchain:action',
                action,
                payload,
            }, '*');
            console.log('[TC Panel] Sent page action:', action, payload);
        } catch { /* iframe security */ }
    }, []);

    // ── Send message ──
    const handleSend = useCallback(async () => {
        if (!inputValue.trim()) return;
        const text = inputValue.trim();
        const userMsg: Message = { id: `m_${Date.now()}`, role: 'user', content: text, timestamp: new Date() };
        setMessages(prev => [...prev, userMsg]);
        setInputValue('');
        setIsTyping(true);
        if (inputRef.current) inputRef.current.style.height = 'auto';

        if (agent.isInitialized) {
            if (messages.length === 0) chatHistoryService.startSession(`Panel (${params.instance})`, 'openai');
            chatHistoryService.addMessage({ role: 'user', content: text, timestamp: new Date() });
            // Use host-provided system prompt (URL ?system=base64) if available,
            // otherwise fall back to hardcoded context prompts (ЛОМ, kb-catalog, etc.)
            const systemPrompt = params.systemPrompt || getContextSystemPrompt(params.context);
            const chatHistory = [
                { role: 'system' as const, content: systemPrompt },
                ...messages.filter(m => (m.role as string) !== 'assistant_temp').map(m => ({ role: m.role, content: m.content })),
            ];

            const result = await agent.sendMessage(text, undefined, chatHistory);
            const events = result?.events || [];
            const { artifactIds: createdArtifactIds, newArtifacts } = extractArtifactsFromEvents(events);
            if (Object.keys(newArtifacts).length > 0) setDynamicArtifacts(prev => ({ ...prev, ...newArtifacts }));

            // ── Post-process: mark data from signed tool calls with TrustChain badges ──
            const signedResults: { result: string; signature: string; toolName: string }[] = [];
            for (const ev of events as any[]) {
                if (ev.type === 'tool_result' && (ev.signature || ev.certificate)) {
                    const resultStr = typeof ev.result === 'string' ? ev.result : JSON.stringify(ev.result);
                    signedResults.push({
                        result: resultStr || '',
                        signature: ev.signature || ev.certificate || '',
                        toolName: ev.toolName || '',
                    });
                }
            }

            let responseContent = result?.text || 'Агент обработал запрос.';

            if (signedResults.length > 0 && responseContent.length > 20) {
                // ── Universal data point extraction from signed tool results ──
                let totalDataPoints = 0;
                const verifiedIds = new Set<string>();

                for (const sr of signedResults) {
                    // Try to parse the result as JSON — handle nested formats
                    let parsed: any = null;
                    try {
                        parsed = JSON.parse(sr.result);
                        // Handle double-stringified JSON
                        if (typeof parsed === 'string') {
                            parsed = JSON.parse(parsed);
                        }
                        // Handle MCP content wrapper: {content: [{type: "text", text: "..."}]}
                        if (parsed?.content?.[0]?.text) {
                            parsed = JSON.parse(parsed.content[0].text);
                        }
                        // Handle TrustChain data wrapper: {data: {...}, signature: "..."}
                        if (parsed?.data && (parsed?.signature || parsed?.certificate)) {
                            parsed = parsed.data;
                        }
                    } catch {
                        parsed = null;
                    }

                    if (parsed && typeof parsed === 'object') {
                        // Count items from common array fields (works with any MCP tool)
                        // Use a seenIds set to avoid counting duplicate items across overlapping arrays
                        const seenItemIds = new Set<string>();
                        const arrayFields = ['items', 'tasks', 'documents', 'contracts',
                            'meetings', 'vacancies', 'hits', 'results',
                            'employees', 'organizations'];
                        for (const field of arrayFields) {
                            if (Array.isArray(parsed[field])) {
                                for (const item of parsed[field]) {
                                    if (!item || typeof item !== 'object') continue;
                                    // Deduplicate by id to avoid double-counting items/tasks
                                    const itemKey = item.id ? `${item.id}` : JSON.stringify(item).substring(0, 100);
                                    if (seenItemIds.has(itemKey)) continue;
                                    seenItemIds.add(itemKey);
                                    totalDataPoints++;
                                    // Extract identifying values for line marking
                                    if (item.number) verifiedIds.add(item.number);
                                    if (item.reg_number) verifiedIds.add(item.reg_number);
                                    if (item.name && item.name.length > 3) verifiedIds.add(item.name);
                                    if (item.assignee_name) verifiedIds.add(item.assignee_name);
                                    if (item.author_name) verifiedIds.add(item.author_name);
                                    if (item.doc_id) verifiedIds.add(item.doc_id);
                                    if (item.article) verifiedIds.add(item.article);
                                    if (item.id) verifiedIds.add(String(item.id));
                                }
                            }
                        }
                        // Stats-only results (e.g. get_task_stats) count as data points too
                        if (parsed.total !== undefined && totalDataPoints === 0) {
                            totalDataPoints += 1;
                        }
                        // Count by_status / by_priority breakdown entries
                        for (const field of ['by_status', 'by_priority']) {
                            if (Array.isArray(parsed[field])) {
                                totalDataPoints += parsed[field].length;
                                for (const entry of parsed[field]) {
                                    if (entry.status) verifiedIds.add(entry.status);
                                    if (entry.priority) verifiedIds.add(entry.priority);
                                }
                            }
                        }
                    } else {
                        // String result — use regex fallback for doc IDs / task numbers
                        const text = sr.result || '';
                        const idPatterns = [
                            /[A-Z]{2,5}-\d{4}-\d{3,6}/g,
                            /№\s*\d+/g,
                            /\d{2,3}-\d{2,4}/g,  // task numbers like 01-125
                        ];
                        for (const pat of idPatterns) {
                            const matches = text.match(pat);
                            if (matches) {
                                matches.forEach(m => verifiedIds.add(m));
                                totalDataPoints += matches.length;
                            }
                        }
                    }
                }

                // Mark lines containing verified data with green shield
                if (verifiedIds.size > 0) {
                    const lines = responseContent.split('\n');
                    const markedLines = lines.map(line => {
                        const hasVerifiedData = [...verifiedIds].some(id => line.includes(id));
                        if (hasVerifiedData && !line.includes('tc-verified')) {
                            return line + ' <span class="tc-verified" style="color:#34d399;font-size:11px" title="TrustChain Verified">🛡✓</span>';
                        }
                        return line;
                    });
                    responseContent = markedLines.join('\n');
                }

                // Strip any LLM-generated TrustChain shields from response to avoid duplication
                responseContent = responseContent.replace(/^>?\s*[🛡🔐].*TrustChain.*(?:Ed25519|data point|Verified).*\n*/gm, '');
                responseContent = responseContent.replace(/^\n+/, ''); // Remove leading empty lines

                // Single consolidated TrustChain header
                const allSigs = signedResults.map(sr => sr.signature).filter(Boolean);
                const fullSig = allSigs[0] || '';
                const sigShort = fullSig.substring(0, 12) + '…';
                responseContent = `> <span style="color:#34d399;font-weight:bold" title="${fullSig}">🛡 TrustChain Verified</span> — ${totalDataPoints} data points · ${signedResults.length} tool calls · Ed25519: \`${sigShort}\`\n\n${responseContent}`;
            }

            const assistantMsg: Message = {
                id: `m_${Date.now() + 1}`, role: 'assistant',
                content: responseContent,
                timestamp: new Date(),
                ...(createdArtifactIds.length > 0 && { artifactIds: createdArtifactIds }),
                executionSteps: (() => {
                    const steps: ExecutionStep[] = [];
                    const toolCallMap = new Map<string, number>();  // tool_call id → index in steps

                    for (const ev of events as any[]) {
                        if (ev.type === 'thinking') {
                            steps.push({ id: ev.id || `plan_${steps.length}`, type: 'planning', label: ev.title || ev.message || 'Размышляю...', detail: ev.content, latencyMs: 0 });
                        } else if (ev.type === 'tool_call') {
                            const idx = steps.length;
                            steps.push({
                                id: ev.id || `tool_${idx}`,
                                type: 'tool', label: ev.name, toolName: ev.name,
                                args: ev.arguments || ev.args || {},
                                detail: `Вызов ${ev.name}`, latencyMs: 0, signed: false
                            });
                            if (ev.id) toolCallMap.set(ev.id, idx);
                        } else if (ev.type === 'tool_result') {
                            // Merge result+signature into the matching tool_call step
                            const parentIdx = ev.toolCallId ? toolCallMap.get(ev.toolCallId) : undefined;
                            if (parentIdx !== undefined && steps[parentIdx]) {
                                const resultStr = typeof ev.result === 'string' ? ev.result : JSON.stringify(ev.result);
                                steps[parentIdx].result = resultStr?.substring(0, 2000);
                                const sig = ev.signature || (typeof ev.certificate === 'string' ? ev.certificate : undefined);
                                steps[parentIdx].signature = sig;
                                steps[parentIdx].signed = !!sig;
                            }
                        } else if (ev.type === 'reasoning_step') {
                            steps.push({ id: ev.id || `reason_${steps.length}`, type: 'planning', label: ev.message || 'Анализирую...', detail: ev.reasoning_text || ev.detail || '', latencyMs: 0 });
                        }
                    }
                    // Include the final model response in the trace
                    const responseText = result?.text;
                    if (responseText) {
                        steps.push({ id: `response_${Date.now()}`, type: 'planning', label: 'Ответ модели', detail: responseText.substring(0, 3000), latencyMs: 0 });
                    }
                    return steps;
                })(),
            };
            setMessages(prev => [...prev, assistantMsg]);
            setIsTyping(false);
            chatHistoryService.addMessage({ role: 'assistant', content: assistantMsg.content, timestamp: assistantMsg.timestamp });

            // Notify host of result
            try {
                window.parent.postMessage({
                    type: 'trustchain:response',
                    text: assistantMsg.content,
                    hasArtifacts: createdArtifactIds.length > 0,
                }, '*');
            } catch { /* iframe security */ }

            // ── Agent→Page Bridge: intercept page actions from tool results ──
            for (const ev of events) {
                // Check for __page_action__ markers in MCP tool results
                if (ev.type === 'tool_result') {
                    if (ev.result && typeof ev.result === 'string') {
                        try {
                            const parsed = JSON.parse(ev.result);
                            if (parsed?.__page_action__) {
                                sendPageAction(parsed.__page_action__.action, parsed.__page_action__.payload || {});
                            }
                        } catch { /* not JSON */ }
                    }
                    if (ev.result && typeof ev.result === 'object' && ev.result?.__page_action__) {
                        sendPageAction(ev.result.__page_action__.action, ev.result.__page_action__.payload || {});
                    }
                }
                // Auto-refresh after data mutations
                if (ev.type === 'tool_call' && ev.name && ['update_risk'].includes(ev.name)) {
                    sendPageAction('refresh_data');
                }
            }
        } else {
            setMessages(prev => [...prev, { id: `m_${Date.now() + 1}`, role: 'assistant', content: '⚠️ Настройте API ключ в TrustChain Agent для работы.', timestamp: new Date() }]);
            setIsTyping(false);
        }
    }, [inputValue, messages, agent, params.instance, extractArtifactsFromEvents]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    }, [handleSend]);

    const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInputValue(e.target.value);
    }, []);

    // Auto-resize textarea whenever inputValue changes (handles typing, paste, programmatic set)
    useEffect(() => {
        const el = inputRef.current;
        if (el) {
            el.style.height = 'auto';
            el.style.height = el.scrollHeight + 'px';
        }
    }, [inputValue]);

    const handleSkillClick = useCallback((prompt: string) => {
        if (!prompt) return;
        setInputValue(prompt);
        inputRef.current?.focus();
    }, []);

    const handleOpenArtifact = useCallback((id: string) => {
        const art = dynamicArtifacts[id];
        if (art) setViewingArtifact(art);
    }, [dynamicArtifacts]);

    const panelTitle = params.title || 'TrustChain Agent';

    // ═══════════════════════════════════════════
    //  RENDER
    // ═══════════════════════════════════════════

    return (
        <div style={{
            width: '100%', height: '100vh', display: 'flex', flexDirection: 'column',
            background: 'linear-gradient(180deg, #0f172a 0%, #0c1222 100%)',
            color: '#e2e8f0', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            position: 'relative',
        }}>
            {/* ── Header ── */}
            <div style={{
                padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                borderBottom: '1px solid #1e293b', flexShrink: 0,
                background: 'linear-gradient(180deg, #151d2e 0%, #0f172a 100%)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                        width: 26, height: 26, borderRadius: 8,
                        background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 2px 8px rgba(139,92,246,0.3)',
                    }}>
                        <Bot size={14} color="#fff" />
                    </div>
                    <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', lineHeight: 1.2 }}>{panelTitle}</div>
                        <div style={{ fontSize: 9, color: '#64748b' }}>Ed25519 · Verified</div>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        background: agent.isInitialized ? 'rgba(52,211,153,0.12)' : 'rgba(239,68,68,0.12)',
                        border: `1px solid ${agent.isInitialized ? 'rgba(52,211,153,0.3)' : 'rgba(239,68,68,0.3)'}`,
                        borderRadius: 12, padding: '3px 8px', fontSize: 10,
                        color: agent.isInitialized ? '#6ee7b7' : '#fca5a5',
                    }}>
                        <div style={{
                            width: 5, height: 5, borderRadius: '50%',
                            background: agent.isInitialized ? '#34d399' : '#ef4444',
                            boxShadow: agent.isInitialized ? '0 0 6px rgba(52,211,153,0.5)' : 'none',
                        }} />
                        {agent.isInitialized ? 'Online' : 'Offline'}
                    </div>
                </div>
            </div>

            {/* ── Chat Area / Welcome ── */}
            <div style={{
                flex: 1, overflowY: 'auto', padding: '10px 12px', minHeight: 0,
                scrollbarWidth: 'thin', scrollbarColor: '#334155 transparent',
            }}>
                {messages.length === 0 ? (
                    <WelcomeContent
                        context={params.context}
                        agentReady={agent.isInitialized}
                        mcpStatus={mcpStatus}
                        skills={currentSkills}
                        toolCount={agent.tools.length}
                        onSkillClick={handleSkillClick}
                    />
                ) : (
                    <div>
                        {messages.map(msg => (
                            <PanelMessage key={msg.id} message={msg} allArtifacts={dynamicArtifacts} onOpenArtifact={handleOpenArtifact} />
                        ))}
                        {isTyping && (
                            <div style={{ marginBottom: 12 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                    <div style={{ width: 20, height: 20, borderRadius: 6, background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <Bot size={10} color="#fff" />
                                    </div>
                                    <span style={{ fontSize: 10, color: '#64748b' }}>TrustChain Agent</span>
                                </div>
                                <div style={{ background: '#1e293b', borderRadius: 10, padding: '10px 12px', fontFamily: 'monospace', fontSize: 11, border: '1px solid #334155' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#06b6d4' }}>
                                        <Loader2 size={12} className="animate-spin" />
                                        <span>Обработка запроса...</span>
                                    </div>
                                    {agent.streamingText && <div style={{ marginTop: 6, color: '#cbd5e1' }}>{agent.streamingText}</div>}
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>
                )}
            </div>

            {/* ── Artifact Viewer Overlay ── */}
            {viewingArtifact && (
                <div style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', background: '#0f172a' }}>
                    <div style={{ padding: '8px 12px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 12, color: '#e2e8f0' }}>📄 {viewingArtifact.title}</span>
                        <button onClick={() => setViewingArtifact(null)} style={{ color: '#94a3b8', cursor: 'pointer', background: 'none', border: 'none' }}><X size={16} /></button>
                    </div>
                    <div style={{ flex: 1, overflow: 'auto', padding: 12, fontSize: 12, color: '#cbd5e1' }} className="tc-markdown">
                        {renderFullMarkdown(viewingArtifact.content)}
                    </div>
                </div>
            )}

            {/* ── Footer ── */}
            <div style={{ flexShrink: 0, padding: '8px 12px 10px', borderTop: '1px solid #1e293b' }}>
                {isTyping && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 11 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#94a3b8' }}>
                            <Loader2 size={10} className="animate-spin" /><span>Generating...</span>
                        </div>
                        <button onClick={() => { agent.abort(); setIsTyping(false); }} style={{
                            marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 3,
                            color: '#ef4444', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
                            borderRadius: 6, padding: '2px 8px', fontSize: 10, cursor: 'pointer',
                        }}>
                            Stop
                        </button>
                    </div>
                )}
                <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end' }}>
                    <textarea
                        ref={inputRef} value={inputValue} onChange={handleInput} onKeyDown={handleKeyDown}
                        placeholder="Введите запрос..." rows={1}
                        style={{
                            width: '100%', padding: '10px 44px 10px 12px',
                            background: '#1e293b', border: '1px solid #334155',
                            borderRadius: 12, color: '#e2e8f0', fontSize: 12,
                            resize: 'none', outline: 'none',
                            fontFamily: 'inherit', lineHeight: 1.4,
                            transition: 'border-color 0.2s', boxSizing: 'border-box',
                        }}
                        onFocus={e => e.target.style.borderColor = '#6366f1'}
                        onBlur={e => e.target.style.borderColor = '#334155'}
                    />
                    <button
                        data-send-btn
                        onClick={handleSend}
                        disabled={!inputValue.trim() || isTyping}
                        style={{
                            position: 'absolute', right: 8, bottom: 8,
                            width: 26, height: 26, borderRadius: 8,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            border: 'none', flexShrink: 0,
                            cursor: inputValue.trim() && !isTyping ? 'pointer' : 'default',
                            background: inputValue.trim() && !isTyping ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : '#334155',
                            color: inputValue.trim() && !isTyping ? '#fff' : '#64748b',
                            boxShadow: inputValue.trim() && !isTyping ? '0 2px 8px rgba(99,102,241,0.4)' : 'none',
                            transition: 'all 0.2s',
                        }}
                    >
                        <ArrowUp size={14} />
                    </button>
                </div>
                <div style={{ textAlign: 'center', marginTop: 4 }}>
                    <span style={{ fontSize: 9, color: '#334155' }}>Ed25519 · Shift+Enter для переноса</span>
                </div>
            </div>
        </div>
    );
};

export default PanelApp;
