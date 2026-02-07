import React from 'react';
import {
    Plus, Search, MessageSquare, Shield, CheckCircle,
    Bot, PanelLeftClose, Key, WifiOff, ChevronRight, RefreshCw,
    BarChart3, AlertCircle
} from 'lucide-react';
import type { Tier, Message, Conversation } from './types';
import { TierBadge, AGENT_TOOLS, AGENT_POLICIES, DEMO_CONVERSATIONS } from './constants';
import type { AgentTool } from '../../hooks/useAgent';
import { chatHistoryService } from '../../services/chatHistoryService';

interface ChatSidebarProps {
    activeConversation: string | null;
    setActiveConversation: (id: string | null) => void;
    messages: Message[];
    setMessages: (msgs: Message[]) => void;
    activeSection: 'chats' | 'agent' | 'trust';
    setActiveSection: (s: 'chats' | 'agent' | 'trust') => void;
    searchQuery: string;
    setSearchQuery: (q: string) => void;
    activeArtifactId: string | null;
    setActiveArtifactId: (id: string | null) => void;
    setSidebarOpen: (open: boolean) => void;
    setShowSettings: (show: boolean) => void;
    setSettingsTab: (tab: 'general' | 'tools' | 'mcp' | 'skills') => void;
    setInitialToolId: (id: string | undefined) => void;
    agent: { status: string; isInitialized: boolean; error: string | null; tools: AgentTool[] };
    toolsByCategory: [string, AgentTool[]][];
    demoMessages: Message[];
}

export const ChatSidebar: React.FC<ChatSidebarProps> = ({
    activeConversation, setActiveConversation,
    messages, setMessages,
    activeSection, setActiveSection,
    searchQuery, setSearchQuery,
    setActiveArtifactId,
    setSidebarOpen, setShowSettings, setSettingsTab, setInitialToolId,
    agent, toolsByCategory, demoMessages,
}) => (
    <aside className="w-[260px] shrink-0 border-r tc-sidebar flex flex-col">
        {/* Header */}
        <div className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 tc-logo rounded-xl flex items-center justify-center shadow-lg">
                    <Shield size={16} className="text-white" />
                </div>
                <div>
                    <div className="text-sm font-semibold tc-text-heading">TrustChain</div>
                    <div className="text-[10px] tc-text-muted -mt-0.5">Agent v0.3.0</div>
                </div>
            </div>
            <button onClick={() => setSidebarOpen(false)}
                className="tc-text-muted hover:tc-text p-1 rounded-lg tc-btn-hover transition-colors">
                <PanelLeftClose size={16} />
            </button>
        </div>

        {/* New Chat */}
        <div className="px-3 mb-2">
            <button onClick={() => { chatHistoryService.endSession(); setActiveConversation(null); setMessages([]); setActiveArtifactId(null); }}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium tc-new-chat border transition-all">
                <Plus size={16} />New Chat
            </button>
        </div>

        {/* Search */}
        <div className="px-3 mb-3">
            <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 tc-text-muted" />
                <input type="text" placeholder="Search…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full tc-surface border tc-border-light rounded-xl pl-9 pr-3 py-2 text-xs tc-text placeholder:tc-text-muted focus:outline-none transition-colors" />
            </div>
        </div>

        {/* Tabs */}
        <div className="px-3 flex gap-1 mb-2">
            {([
                { id: 'chats' as const, icon: <MessageSquare size={13} />, label: 'Chats' },
                { id: 'agent' as const, icon: <Bot size={13} />, label: 'Agent' },
                { id: 'trust' as const, icon: <Shield size={13} />, label: 'Trust' },
            ]).map((s) => (
                <button key={s.id} onClick={() => setActiveSection(s.id)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex-1 justify-center
                    ${activeSection === s.id ? 'tc-tab-active' : 'tc-text-muted hover:tc-text tc-surface-hover'}`}>
                    {s.icon}{s.label}
                </button>
            ))}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5 tc-scrollbar">
            {activeSection === 'chats' && (
                <>
                    <div className="px-2 py-1.5 text-[10px] font-medium tc-text-muted uppercase tracking-wider">Recent</div>
                    {DEMO_CONVERSATIONS.filter(c => !searchQuery || c.title.toLowerCase().includes(searchQuery.toLowerCase())).map((conv) => (
                        <button key={conv.id}
                            onClick={() => { setActiveConversation(conv.id); if (conv.id === '1') setMessages(demoMessages); else setMessages([]); setActiveArtifactId(null); }}
                            className={`w-full text-left px-3 py-2.5 rounded-xl transition-all
                            ${activeConversation === conv.id ? 'tc-surface border tc-border-light' : 'tc-surface-hover border border-transparent'}`}>
                            <div className="flex items-center gap-2">
                                <div className="flex-1 min-w-0">
                                    <div className="text-[13px] tc-text truncate">{conv.title}</div>
                                    <div className="text-[11px] tc-text-muted truncate mt-0.5">{conv.lastMessage}</div>
                                </div>
                                {conv.trustScore === 1.0 && <CheckCircle size={12} className="text-emerald-500/60 shrink-0" />}
                            </div>
                        </button>
                    ))}
                </>
            )}
            {activeSection === 'trust' && (
                <div className="space-y-2 px-1">
                    {/* Chain Status */}
                    <div className="tc-surface border tc-border-light rounded-xl p-2.5">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-semibold tc-text-muted uppercase tracking-wider">Chain Status</span>
                            <TierBadge tier="oss" />
                        </div>
                        <div className="flex items-center gap-2 mb-1.5">
                            <CheckCircle size={14} className="text-emerald-500" />
                            <span className="text-[13px] tc-text font-medium">Verified</span>
                        </div>
                        <div className="grid grid-cols-3 gap-1 text-center">
                            {[{ v: '47', l: 'ops' }, { v: '0', l: 'violations' }, { v: '100%', l: 'integrity' }].map(x => (
                                <div key={x.l} className="tc-surface rounded-lg p-1.5">
                                    <div className={`text-[13px] font-semibold ${x.l === 'ops' ? 'tc-text' : 'text-emerald-500'}`}>{x.v}</div>
                                    <div className="text-[9px] tc-text-muted">{x.l}</div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Analytics */}
                    <div className="tc-surface border tc-border-light rounded-xl p-2.5">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-semibold tc-text-muted uppercase tracking-wider">Analytics</span>
                            <TierBadge tier="pro" />
                        </div>
                        {[
                            { label: 'Throughput', val: '9,100 ops/sec' },
                            { label: 'Sign latency', val: '0.11ms' },
                            { label: 'Unique tools', val: '6' },
                        ].map(r => (
                            <div key={r.label} className="flex justify-between py-1 text-[12px]">
                                <span className="tc-text-muted">{r.label}</span>
                                <span className="tc-text font-mono">{r.val}</span>
                            </div>
                        ))}
                        <button onClick={() => { setActiveArtifactId('art-analytics'); setActiveConversation('1'); setMessages(demoMessages); }}
                            className="w-full mt-1 text-[11px] text-blue-500 hover:text-blue-400 transition-colors text-center py-1 rounded-lg tc-surface-hover">
                            View Dashboard →
                        </button>
                    </div>

                    {/* Execution Graph */}
                    <div className="tc-surface border tc-border-light rounded-xl p-2.5">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-semibold tc-text-muted uppercase tracking-wider">Execution Graph</span>
                            <TierBadge tier="pro" />
                        </div>
                        <div className="grid grid-cols-2 gap-1 text-center">
                            {[{ v: '2', l: 'chains' }, { v: '6', l: 'nodes' }, { v: '0', l: 'forks' }, { v: '0', l: 'replays' }].map(x => (
                                <div key={x.l} className="tc-surface rounded-lg p-1.5">
                                    <div className="text-[13px] font-semibold tc-text">{x.v}</div>
                                    <div className="text-[9px] tc-text-muted">{x.l}</div>
                                </div>
                            ))}
                        </div>
                        <button onClick={() => { setActiveArtifactId('art-graph'); setActiveConversation('1'); setMessages(demoMessages); }}
                            className="w-full mt-1.5 text-[11px] text-blue-500 hover:text-blue-400 transition-colors text-center py-1 rounded-lg tc-surface-hover">
                            View Graph →
                        </button>
                    </div>

                    {/* Compliance */}
                    <div className="tc-surface border tc-border-light rounded-xl p-2.5">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-semibold tc-text-muted uppercase tracking-wider">Compliance</span>
                            <TierBadge tier="enterprise" />
                        </div>
                        {[
                            { fw: 'SOC 2', status: '8/8', ok: true },
                            { fw: 'HIPAA', status: '5/5', ok: true },
                            { fw: 'EU AI Act', status: '4/4', ok: true },
                        ].map(c => (
                            <div key={c.fw} className="flex items-center justify-between py-1 text-[12px]">
                                <span className="tc-text-muted">{c.fw}</span>
                                <div className="flex items-center gap-1.5">
                                    <span className="tc-text font-mono">{c.status}</span>
                                    <CheckCircle size={10} className="text-emerald-500" />
                                </div>
                            </div>
                        ))}
                        <button onClick={() => { setActiveArtifactId('art-compliance'); setActiveConversation('1'); setMessages(demoMessages); }}
                            className="w-full mt-1 text-[11px] text-blue-500 hover:text-blue-400 transition-colors text-center py-1 rounded-lg tc-surface-hover">
                            Generate Report →
                        </button>
                    </div>

                    {/* Infrastructure */}
                    <div className="tc-surface border tc-border-light rounded-xl p-2.5">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-semibold tc-text-muted uppercase tracking-wider">Infrastructure</span>
                            <TierBadge tier="enterprise" />
                        </div>
                        {[
                            { icon: <Key size={12} />, label: 'KMS Provider', val: 'AWS KMS' },
                            { icon: <RefreshCw size={12} />, label: 'Key Rotation', val: '2h ago' },
                            { icon: <WifiOff size={12} />, label: 'Air-Gapped', val: 'Off' },
                        ].map(r => (
                            <div key={r.label} className="flex items-center justify-between py-1 text-[12px]">
                                <div className="flex items-center gap-1.5 tc-text-muted">
                                    {r.icon}
                                    <span>{r.label}</span>
                                </div>
                                <span className="tc-text font-mono text-[11px]">{r.val}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            {activeSection === 'agent' && (
                <div className="space-y-2 px-1">
                    {/* Agent Status */}
                    <div className="tc-surface border tc-border-light rounded-xl p-2.5">
                        <div className="text-[10px] font-semibold tc-text-muted uppercase tracking-wider mb-2">Agent Status</div>
                        <div className="flex items-center gap-2 py-1">
                            <div className={`w-2 h-2 rounded-full ${agent.status === 'ready' ? 'bg-emerald-500' :
                                agent.status === 'thinking' ? 'bg-amber-500 animate-pulse' :
                                    agent.status === 'error' ? 'bg-red-500' : 'bg-gray-400'
                                }`} />
                            <span className="text-[12px] tc-text capitalize">{agent.status}</span>
                            {!agent.isInitialized && (
                                <button onClick={() => setShowSettings(true)}
                                    className="ml-auto text-[10px] text-blue-500 hover:text-blue-400">
                                    Configure →
                                </button>
                            )}
                        </div>
                        {agent.error && (
                            <div className="text-[11px] text-red-400 mt-1 flex items-center gap-1">
                                <AlertCircle size={10} />
                                {agent.error}
                            </div>
                        )}
                    </div>

                    {/* Tools Inventory */}
                    <div className="tc-surface border tc-border-light rounded-xl p-2.5">
                        <div className="text-[10px] font-semibold tc-text-muted uppercase tracking-wider mb-2">
                            Tools ({agent.tools.length || AGENT_TOOLS.length})
                        </div>
                        {agent.tools.length > 0 ? (
                            toolsByCategory.map(([category, catTools]) => (
                                <div key={category} className="mb-1.5">
                                    <div className="flex items-center gap-1.5 mb-1">
                                        <span className="text-[9px] font-semibold tc-text-muted uppercase tracking-wider">{category}</span>
                                        <span className="text-[9px] tc-text-muted">({catTools.length})</span>
                                    </div>
                                    {catTools.map(t => (
                                        <div key={t.name}
                                            onClick={() => { setInitialToolId(t.name); setSettingsTab('tools'); setShowSettings(true); }}
                                            className="flex items-center justify-between py-0.5 px-1 rounded cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-colors group">
                                            <span className="text-[11px] text-blue-500 font-mono truncate group-hover:text-blue-600 dark:group-hover:text-blue-400" title={t.description}>{t.name}</span>
                                            <ChevronRight size={8} className="text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </div>
                                    ))}
                                </div>
                            ))
                        ) : (
                            (['oss', 'pro', 'enterprise'] as Tier[]).map(tier => {
                                const tierTools = AGENT_TOOLS.filter(t => t.tier === tier);
                                if (!tierTools.length) return null;
                                return (
                                    <div key={tier} className="mb-1.5">
                                        <div className="flex items-center gap-1.5 mb-1">
                                            <TierBadge tier={tier} />
                                        </div>
                                        {tierTools.map(t => (
                                            <div key={t.name} className="flex items-center justify-between py-1 px-1">
                                                <span className="text-[11px] text-blue-500 font-mono">{t.name}</span>
                                                <span className="text-[10px] tc-text-muted">{t.desc}</span>
                                            </div>
                                        ))}
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {/* Policies */}
                    <div className="tc-surface border tc-border-light rounded-xl p-2.5">
                        <div className="text-[10px] font-semibold tc-text-muted uppercase tracking-wider mb-2">Policies</div>
                        {AGENT_POLICIES.map(p => (
                            <div key={p.name} className="flex items-center justify-between py-1">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[11px] font-mono tc-text">{p.name}</span>
                                </div>
                                <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${p.enforced ? 'text-emerald-600 bg-emerald-500/10' : 'text-gray-500 bg-gray-500/10'}`}>
                                    {p.enforced ? 'ENFORCED' : 'OFF'}
                                </span>
                            </div>
                        ))}
                    </div>

                    {/* Session Config */}
                    <div className="tc-surface border tc-border-light rounded-xl p-2.5">
                        <div className="text-[10px] font-semibold tc-text-muted uppercase tracking-wider mb-2">Session</div>
                        {[
                            { label: 'Model', val: localStorage.getItem('tc_model') || 'Not set' },
                            { label: 'Signer', val: 'Ed25519' },
                            { label: 'TSA', val: 'rfc3161.ai' },
                        ].map(r => (
                            <div key={r.label} className="flex items-center justify-between py-1 text-[12px]">
                                <span className="tc-text-muted">{r.label}</span>
                                <span className="tc-text font-mono text-[11px]">{r.val}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t tc-border">
            <div className="tc-trust-card border rounded-xl p-2.5 flex items-center gap-2.5">
                <div className="w-6 h-6 rounded-lg tc-trust-icon flex items-center justify-center">
                    <Shield size={12} className="text-emerald-500" />
                </div>
                <div className="flex-1">
                    <div className="text-[11px] font-medium text-emerald-600">Chain Verified</div>
                    <div className="text-[10px] tc-text-muted">47 ops · 0 violations</div>
                </div>
            </div>
        </div>
    </aside>
);
