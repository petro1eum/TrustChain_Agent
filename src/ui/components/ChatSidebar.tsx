import React, { useState, useEffect, useCallback } from 'react';
import {
    Plus, Search, MessageSquare, Shield, CheckCircle,
    Bot, PanelLeftClose, Key, WifiOff, ChevronRight, ChevronDown, RefreshCw,
    BarChart3, AlertCircle, Sparkles, Download, Trash2, MoreVertical,
    Wrench, Users, Clock, FileText, Lock, Play, Pause, Trash, X,
    Settings, Power, ToggleLeft, ToggleRight, HardDrive, FolderOpen, Cloud, Box,
    UserCircle
} from 'lucide-react';
import { PeopleTab } from './PeopleTab';
import { ChannelList } from './ChannelList';
import type { Tier, Message, Conversation } from './types';
import { TierBadge, AGENT_TOOLS, AGENT_POLICIES, DEMO_CONVERSATIONS } from './constants';
import type { AgentTool } from '../../hooks/useAgent';
import type { ChatSession } from '../../services/chatHistoryService';
import { schedulerService, type ScheduledJob } from '../../services/agents/schedulerService';
import { sessionSpawnService, type SpawnedSession } from '../../services/agents/sessionSpawnService';
import { userStorageService, LocalFolderBackend, DockerVolumeBackend, GoogleDriveBackend, type StorageUsage } from '../../services/storage';
import { FileManagerPanel } from './FileManagerPanel';

interface ChatSidebarProps {
    activeConversation: string | null;
    setActiveConversation: (id: string | null) => void;
    messages: Message[];
    setMessages: (msgs: Message[]) => void;
    activeSection: 'chats' | 'agent' | 'trust' | 'people';
    setActiveSection: (s: 'chats' | 'agent' | 'trust' | 'people') => void;
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
    // New session management props
    sessions: ChatSession[];
    onLoadSession: (sessionId: string) => void;
    onDeleteSession: (sessionId: string) => void;
    onDownloadSession: (sessionId: string) => void;
    onNewChat: () => void;
    onOpenFileManager?: () => void;
    onLoadChannel?: (channelId: string) => void;
}

/** Format relative time */
function relativeTime(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
}

/** Conversation item with hover actions */
const ConversationItem: React.FC<{
    session: ChatSession;
    isActive: boolean;
    onSelect: () => void;
    onDelete: () => void;
    onDownload: () => void;
}> = ({ session, isActive, onSelect, onDelete, onDownload }) => {
    const [showMenu, setShowMenu] = useState(false);

    return (
        <div
            className={`relative group w-full text-left px-3 py-2.5 rounded-xl transition-all cursor-pointer
            ${isActive ? 'tc-surface border tc-border-light' : 'tc-surface-hover border border-transparent'}`}
            onClick={onSelect}
        >
            <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                    <div className="text-[13px] tc-text truncate">{session.title || `Chat · ${new Date(session.startTime).toLocaleDateString()}`}</div>
                    <div className="text-[11px] tc-text-muted truncate mt-0.5">
                        {session.messageCount} msgs · {relativeTime(session.startTime)}
                    </div>
                </div>
                {/* Hover actions */}
                <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity shrink-0">
                    <button
                        onClick={(e) => { e.stopPropagation(); onDownload(); }}
                        className="p-1 rounded-md tc-surface-hover tc-text-muted hover:tc-text transition-colors"
                        title="Download"
                    >
                        <Download size={12} />
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); onDelete(); }}
                        className="p-1 rounded-md tc-surface-hover text-red-400 hover:text-red-500 transition-colors"
                        title="Delete"
                    >
                        <Trash2 size={12} />
                    </button>
                </div>
            </div>
        </div>
    );
};

// ────────────────────────────────────────────
// ── Reusable Accordion Section ──
// ────────────────────────────────────────────

const AccordionSection: React.FC<{
    icon: React.ReactNode;
    title: string;
    badge?: string | number;
    subtitle?: string;
    defaultOpen?: boolean;
    isOpen?: boolean;
    onToggle?: () => void;
    children: React.ReactNode;
    headerRight?: React.ReactNode;
}> = ({ icon, title, badge, subtitle, defaultOpen = false, isOpen: controlledOpen, onToggle, children, headerRight }) => {
    const [internalOpen, setInternalOpen] = useState(defaultOpen);
    const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
    const toggle = onToggle || (() => setInternalOpen(v => !v));

    return (
        <div className="tc-surface border tc-border-light rounded-xl overflow-hidden">
            <div
                onClick={toggle}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-white/5 cursor-pointer select-none"
            >
                <span className="tc-text-muted shrink-0">{icon}</span>
                <span className="text-[12px] font-semibold tc-text flex-1">{title}</span>
                {badge !== undefined && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-500">{badge}</span>
                )}
                {headerRight}
                {isOpen ? <ChevronDown size={12} className="tc-text-muted shrink-0" /> : <ChevronRight size={12} className="tc-text-muted shrink-0" />}
            </div>
            {isOpen && (
                <div className="px-3 pb-2.5 border-t tc-border-light">
                    {subtitle && <div className="text-[10px] tc-text-muted pt-1.5 pb-1">{subtitle}</div>}
                    {children}
                </div>
            )}
        </div>
    );
};

// ────────────────────────────────────────────
// ── Helpers ──

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// ── Agent Accordion Panel ──
// ────────────────────────────────────────────

const AgentAccordionPanel: React.FC<{
    agent: { status: string; isInitialized: boolean; error: string | null; tools: AgentTool[] };
    toolsByCategory: [string, AgentTool[]][];
    setShowSettings: (show: boolean) => void;
    setSettingsTab: (tab: 'general' | 'tools' | 'mcp' | 'skills') => void;
    setInitialToolId: (id: string | undefined) => void;
    onOpenFileManager?: () => void;
}> = ({ agent, toolsByCategory, setShowSettings, setSettingsTab, setInitialToolId, onOpenFileManager }) => {
    // Accordion state
    const [openSections, setOpenSections] = useState<Record<string, boolean>>({
        tools: false,
        subagents: true,
        cron: true,
        policies: false,
        session: false,
        storage: false,
    });
    const toggleSection = useCallback((key: string) => {
        setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
    }, []);

    // Collapsed categories inside Tools
    const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});
    const toggleCategory = useCallback((cat: string) => {
        setOpenCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
    }, []);

    // Sub-agent sessions (live from service)
    const [sessions, setSessions] = useState<SpawnedSession[]>([]);
    useEffect(() => {
        const refresh = () => setSessions(sessionSpawnService.getActiveSessions());
        refresh();
        const id = setInterval(refresh, 2000);
        return () => clearInterval(id);
    }, []);

    // Cron jobs (live from service)
    const [cronJobs, setCronJobs] = useState<ScheduledJob[]>([]);
    const [schedulerOn, setSchedulerOn] = useState(false);
    const [showCreateJob, setShowCreateJob] = useState(false);
    const [newJobName, setNewJobName] = useState('');
    const [newJobSchedule, setNewJobSchedule] = useState('0 * * * *');
    const [newJobInstruction, setNewJobInstruction] = useState('');

    useEffect(() => {
        const refresh = () => setCronJobs(schedulerService.getAllJobs());
        refresh();
        const id = setInterval(refresh, 5000);
        return () => clearInterval(id);
    }, []);

    const handleCreateJob = useCallback(() => {
        if (!newJobName.trim() || !newJobInstruction.trim()) return;
        schedulerService.createJob({
            name: newJobName.trim(),
            schedule: newJobSchedule.trim(),
            instruction: newJobInstruction.trim(),
        });
        setCronJobs(schedulerService.getAllJobs());
        setNewJobName('');
        setNewJobSchedule('0 * * * *');
        setNewJobInstruction('');
        setShowCreateJob(false);
    }, [newJobName, newJobSchedule, newJobInstruction]);

    const handleToggleJob = useCallback((id: string) => {
        schedulerService.toggleJob(id);
        setCronJobs(schedulerService.getAllJobs());
    }, []);

    const handleDeleteJob = useCallback((id: string) => {
        schedulerService.deleteJob(id);
        setCronJobs(schedulerService.getAllJobs());
    }, []);

    const handleRunJob = useCallback((id: string) => {
        schedulerService.runJob(id);
        setCronJobs(schedulerService.getAllJobs());
    }, []);

    const handleToggleScheduler = useCallback(() => {
        if (schedulerOn) {
            schedulerService.stop();
        } else {
            schedulerService.start();
        }
        setSchedulerOn(!schedulerOn);
    }, [schedulerOn]);

    // ── Policies (toggleable, persisted via UserStorageService) ──
    const [policyStates, setPolicyStates] = useState<Record<string, boolean>>(() => {
        // Sync fallback from localStorage for initial render
        try {
            const saved = localStorage.getItem('tc_policies');
            if (saved) return JSON.parse(saved);
        } catch { /* ignore */ }
        const defaults: Record<string, boolean> = {};
        AGENT_POLICIES.forEach(p => { defaults[p.name] = p.enforced; });
        return defaults;
    });

    // Load from VFS on mount (async, overrides localStorage fallback)
    useEffect(() => {
        userStorageService.getConfig<Record<string, boolean>>('policies').then(saved => {
            if (saved) {
                setPolicyStates(saved);
            } else {
                // First run: import from localStorage → VFS
                userStorageService.importFromLocalStorage();
            }
        });
    }, []);

    const handleTogglePolicy = useCallback((policyName: string) => {
        setPolicyStates(prev => {
            const next = { ...prev, [policyName]: !prev[policyName] };
            // Write to both VFS and localStorage (backward compat)
            userStorageService.setConfig('policies', next);
            localStorage.setItem('tc_policies', JSON.stringify(next));
            return next;
        });
    }, []);

    const policiesEnforced = Object.values(policyStates).filter(Boolean).length;
    const policiesOff = AGENT_POLICIES.length - policiesEnforced;

    // ── Session config (persisted via UserStorageService) ──
    const [sessionModel, setSessionModel] = useState(() => localStorage.getItem('tc_model') || 'google/gemini-2.5-flash');
    const [sessionSigner, setSessionSigner] = useState(() => localStorage.getItem('tc_signer') || 'Ed25519');
    const [sessionTsa, setSessionTsa] = useState(() => localStorage.getItem('tc_tsa') || 'rfc3161.ai');
    const [sessionEditing, setSessionEditing] = useState(false);

    // Load from VFS on mount
    useEffect(() => {
        userStorageService.getConfig<{ model: string; signer: string; tsa: string }>('session').then(saved => {
            if (saved) {
                setSessionModel(saved.model);
                setSessionSigner(saved.signer);
                setSessionTsa(saved.tsa);
            }
        });
    }, []);

    const handleSaveSession = useCallback(() => {
        const session = { model: sessionModel, signer: sessionSigner, tsa: sessionTsa };
        // Write to VFS + localStorage (backward compat)
        userStorageService.setConfig('session', session);
        localStorage.setItem('tc_model', sessionModel);
        localStorage.setItem('tc_signer', sessionSigner);
        localStorage.setItem('tc_tsa', sessionTsa);
        setSessionEditing(false);
    }, [sessionModel, sessionSigner, sessionTsa]);

    // ── Storage state ──
    const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
    const [storageFileCount, setStorageFileCount] = useState(0);
    const [mountingFolder, setMountingFolder] = useState(false);

    useEffect(() => {
        const refreshStorage = async () => {
            try {
                const usage = await userStorageService.getUsage();
                setStorageUsage(usage);
                // Count total files across all dirs
                let count = 0;
                for (const dir of ['config', 'uploads', 'outputs', 'transcripts', 'skills']) {
                    try {
                        const entries = await userStorageService.listDir(dir);
                        count += entries.filter(e => e.type === 'file').length;
                    } catch { /* dir may not exist */ }
                }
                setStorageFileCount(count);
            } catch { /* ignore */ }
        };
        refreshStorage();
        const id = setInterval(refreshStorage, 10000);
        return () => clearInterval(id);
    }, []);

    const handleMountLocalFolder = useCallback(async () => {
        if (!LocalFolderBackend.isSupported()) {
            alert('File System Access API is not supported in this browser. Use Chrome or Edge.');
            return;
        }
        setMountingFolder(true);
        try {
            const backend = new LocalFolderBackend();
            const selected = await backend.selectFolder();
            if (selected) {
                await userStorageService.setBackend(backend, true);
                const usage = await userStorageService.getUsage();
                setStorageUsage(usage);
            }
        } catch (err: any) {
            console.error('[Storage] Mount failed:', err);
        } finally {
            setMountingFolder(false);
        }
    }, []);

    // Docker container availability
    const [dockerAvailable, setDockerAvailable] = useState(false);
    const [connectingDocker, setConnectingDocker] = useState(false);

    useEffect(() => {
        DockerVolumeBackend.isAvailable().then(setDockerAvailable).catch(() => { });
    }, []);

    const handleConnectDocker = useCallback(async () => {
        setConnectingDocker(true);
        try {
            const backend = new DockerVolumeBackend();
            await userStorageService.setBackend(backend, true);
            const usage = await userStorageService.getUsage();
            setStorageUsage(usage);
        } catch (err: any) {
            console.error('[Storage] Docker connect failed:', err);
        } finally {
            setConnectingDocker(false);
        }
    }, []);

    // Google Drive connection
    const [connectingGDrive, setConnectingGDrive] = useState(false);

    const handleConnectGDrive = useCallback(async () => {
        setConnectingGDrive(true);
        try {
            const backend = new GoogleDriveBackend();
            const authed = await backend.authenticate();
            if (authed) {
                await userStorageService.setBackend(backend, true);
                const usage = await userStorageService.getUsage();
                setStorageUsage(usage);
            }
        } catch (err: any) {
            console.error('[Storage] Google Drive connect failed:', err);
            alert(err.message || 'Failed to connect Google Drive');
        } finally {
            setConnectingGDrive(false);
        }
    }, []);

    return (
        <div className="space-y-1.5 px-1">
            {/* ── Agent Status (always visible, not collapsible) ── */}
            <div className="tc-surface border tc-border-light rounded-xl px-3 py-2.5">
                <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${agent.status === 'ready' ? 'bg-emerald-500' :
                        agent.status === 'thinking' ? 'bg-amber-500 animate-pulse' :
                            agent.status === 'error' ? 'bg-red-500' : 'bg-gray-400'
                        }`} />
                    <span className="text-[12px] tc-text font-medium capitalize flex-1">{agent.status}</span>
                    {!agent.isInitialized && (
                        <button onClick={() => setShowSettings(true)}
                            className="text-[10px] text-blue-500 hover:text-blue-400 transition-colors">
                            Configure →
                        </button>
                    )}
                    <button onClick={() => setShowSettings(true)}
                        className="p-1 rounded-md tc-surface-hover tc-text-muted hover:tc-text transition-colors"
                        title="Settings">
                        <Settings size={12} />
                    </button>
                </div>
                {agent.error && (
                    <div className="text-[11px] text-red-400 mt-1.5 flex items-center gap-1">
                        <AlertCircle size={10} />
                        <span className="truncate">{agent.error}</span>
                    </div>
                )}
            </div>

            {/* ── 1. Tools ── */}
            <AccordionSection
                icon={<Wrench size={14} />}
                title="Tools"
                badge={agent.tools.length || AGENT_TOOLS.length}
                subtitle={`${toolsByCategory.length} categories`}
                isOpen={openSections.tools}
                onToggle={() => toggleSection('tools')}
            >
                {agent.tools.length > 0 ? (
                    toolsByCategory.map(([category, catTools]) => (
                        <div key={category} className="mb-0.5">
                            <button
                                onClick={() => toggleCategory(category)}
                                className="w-full flex items-center gap-1.5 py-1 transition-colors hover:bg-white/5 rounded"
                            >
                                {openCategories[category]
                                    ? <ChevronDown size={10} className="tc-text-muted" />
                                    : <ChevronRight size={10} className="tc-text-muted" />
                                }
                                <span className="text-[10px] font-semibold tc-text-muted uppercase tracking-wider">{category}</span>
                                <span className="text-[9px] tc-text-muted">({catTools.length})</span>
                            </button>
                            {openCategories[category] && catTools.map(t => (
                                <div key={t.name}
                                    onClick={() => { setInitialToolId(t.name); setSettingsTab('tools'); setShowSettings(true); }}
                                    className="flex items-center justify-between py-0.5 pl-5 pr-1 rounded cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-colors group">
                                    <span className="text-[11px] text-blue-500 font-mono truncate group-hover:text-blue-600 dark:group-hover:text-blue-400" title={t.description}>{t.name}</span>
                                    <ChevronRight size={8} className="text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                            ))}
                        </div>
                    ))
                ) : (
                    <div className="text-[11px] tc-text-muted py-2 text-center">No tools loaded</div>
                )}
            </AccordionSection>

            {/* ── 2. Sub-Agents ── */}
            <AccordionSection
                icon={<Users size={14} />}
                title="Sub-Agents"
                badge={sessions.length || undefined}
                isOpen={openSections.subagents}
                onToggle={() => toggleSection('subagents')}
            >
                {sessions.length === 0 ? (
                    <div className="text-[11px] tc-text-muted py-3 text-center">
                        <Users size={16} className="mx-auto mb-1.5 opacity-40" />
                        No active sessions
                    </div>
                ) : (
                    <div className="space-y-1 pt-1">
                        {sessions.map(s => (
                            <div key={s.runId} className="flex items-center gap-2 py-1.5 px-2 rounded-lg tc-surface border tc-border-light">
                                <div className={`w-2 h-2 rounded-full shrink-0 ${s.status === 'completed' ? 'bg-emerald-500' :
                                    s.status === 'running' ? 'bg-blue-500 animate-pulse' :
                                        s.status === 'failed' ? 'bg-red-500' : 'bg-gray-400'
                                    }`} />
                                <div className="flex-1 min-w-0">
                                    <div className="text-[11px] tc-text font-medium truncate">{s.name}</div>
                                    <div className="text-[9px] tc-text-muted">
                                        {s.status === 'completed' && s.completedAt && s.startedAt
                                            ? `${((s.completedAt - s.startedAt) / 1000).toFixed(1)}s`
                                            : s.status}
                                    </div>
                                </div>
                                <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${s.status === 'completed' ? 'text-emerald-600 bg-emerald-500/10' :
                                    s.status === 'running' ? 'text-blue-600 bg-blue-500/10' :
                                        s.status === 'failed' ? 'text-red-600 bg-red-500/10' :
                                            'text-gray-500 bg-gray-500/10'
                                    }`}>
                                    {s.status === 'completed' ? 'Done' : s.status === 'running' ? 'Running' : s.status}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </AccordionSection>

            {/* ── 3. Cron Jobs ── */}
            <AccordionSection
                icon={<Clock size={14} />}
                title="Cron Jobs"
                badge={cronJobs.length || undefined}
                isOpen={openSections.cron}
                onToggle={() => toggleSection('cron')}
                headerRight={
                    <button
                        onClick={(e) => { e.stopPropagation(); handleToggleScheduler(); }}
                        className={`p-0.5 rounded transition-colors ${schedulerOn ? 'text-emerald-500' : 'tc-text-muted'}`}
                        title={schedulerOn ? 'Scheduler running' : 'Scheduler stopped'}
                    >
                        <Power size={12} />
                    </button>
                }
            >
                {/* Scheduler toggle */}
                <div className="flex items-center justify-between py-1.5">
                    <span className="text-[10px] tc-text-muted">Scheduler</span>
                    <button
                        onClick={handleToggleScheduler}
                        className="flex items-center gap-1"
                    >
                        {schedulerOn
                            ? <ToggleRight size={18} className="text-emerald-500" />
                            : <ToggleLeft size={18} className="tc-text-muted" />
                        }
                        <span className={`text-[10px] font-medium ${schedulerOn ? 'text-emerald-500' : 'tc-text-muted'}`}>
                            {schedulerOn ? 'On' : 'Off'}
                        </span>
                    </button>
                </div>

                {/* Job list */}
                {cronJobs.length === 0 && !showCreateJob ? (
                    <div className="text-[11px] tc-text-muted py-2 text-center">
                        <Clock size={16} className="mx-auto mb-1.5 opacity-40" />
                        No scheduled jobs
                    </div>
                ) : (
                    <div className="space-y-1 pt-0.5">
                        {cronJobs.map(job => (
                            <div key={job.id} className="py-1.5 px-2 rounded-lg tc-surface border tc-border-light">
                                <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full shrink-0 ${job.enabled ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[11px] tc-text font-medium truncate">{job.name}</div>
                                        <div className="text-[9px] tc-text-muted font-mono">{job.schedule}</div>
                                    </div>
                                    <div className="flex items-center gap-0.5">
                                        <button onClick={() => handleRunJob(job.id)} className="p-1 rounded tc-surface-hover text-blue-500 hover:text-blue-400" title="Run now">
                                            <Play size={10} />
                                        </button>
                                        <button onClick={() => handleToggleJob(job.id)} className="p-1 rounded tc-surface-hover tc-text-muted hover:tc-text" title={job.enabled ? 'Disable' : 'Enable'}>
                                            {job.enabled ? <Pause size={10} /> : <Play size={10} />}
                                        </button>
                                        <button onClick={() => handleDeleteJob(job.id)} className="p-1 rounded tc-surface-hover text-red-400 hover:text-red-500" title="Delete">
                                            <Trash2 size={10} />
                                        </button>
                                    </div>
                                </div>
                                {job.lastRunAt && (
                                    <div className="text-[9px] tc-text-muted mt-0.5 pl-4">
                                        Last: {new Date(job.lastRunAt).toLocaleTimeString()} · Runs: {job.runCount}
                                        {job.lastRunStatus && (
                                            <span className={`ml-1 ${job.lastRunStatus === 'completed' ? 'text-emerald-500' : 'text-red-400'}`}>
                                                ({job.lastRunStatus})
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Create Job Form */}
                {showCreateJob ? (
                    <div className="mt-2 p-2 rounded-lg border tc-border-light tc-surface space-y-1.5">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-semibold tc-text">New Job</span>
                            <button onClick={() => setShowCreateJob(false)} className="p-0.5 rounded tc-surface-hover tc-text-muted">
                                <X size={10} />
                            </button>
                        </div>
                        <input
                            value={newJobName}
                            onChange={e => setNewJobName(e.target.value)}
                            placeholder="Job name"
                            className="w-full px-2 py-1.5 text-[11px] tc-surface border tc-border-light rounded-lg tc-text placeholder:tc-text-muted focus:outline-none focus:ring-1 focus:ring-blue-500/30"
                        />
                        <input
                            value={newJobSchedule}
                            onChange={e => setNewJobSchedule(e.target.value)}
                            placeholder="Cron: 0 * * * *"
                            className="w-full px-2 py-1.5 text-[11px] tc-surface border tc-border-light rounded-lg tc-text font-mono placeholder:tc-text-muted focus:outline-none focus:ring-1 focus:ring-blue-500/30"
                        />
                        <textarea
                            value={newJobInstruction}
                            onChange={e => setNewJobInstruction(e.target.value)}
                            placeholder="Instruction for the agent..."
                            rows={2}
                            className="w-full px-2 py-1.5 text-[11px] tc-surface border tc-border-light rounded-lg tc-text placeholder:tc-text-muted focus:outline-none focus:ring-1 focus:ring-blue-500/30 resize-none"
                        />
                        <button
                            onClick={handleCreateJob}
                            disabled={!newJobName.trim() || !newJobInstruction.trim()}
                            className="w-full py-1.5 text-[11px] font-medium rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            Create Job
                        </button>
                    </div>
                ) : (
                    <button
                        onClick={() => setShowCreateJob(true)}
                        className="w-full mt-1.5 flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium text-blue-500 hover:text-blue-400 rounded-lg tc-surface-hover transition-colors"
                    >
                        <Plus size={12} /> Create Job
                    </button>
                )}
            </AccordionSection>

            {/* ── 4. Policies (interactive toggles) ── */}
            <AccordionSection
                icon={<Lock size={14} />}
                title="Policies"
                badge={`${policiesEnforced}/${AGENT_POLICIES.length}`}
                subtitle={`${policiesEnforced} enforced · ${policiesOff} off`}
                isOpen={openSections.policies}
                onToggle={() => toggleSection('policies')}
            >
                <div className="space-y-1 pt-0.5">
                    {AGENT_POLICIES.map(p => {
                        const isOn = policyStates[p.name] ?? p.enforced;
                        return (
                            <div key={p.name} className="flex items-center gap-2 py-1.5 px-1 rounded-lg hover:bg-white/5 transition-colors">
                                <button
                                    onClick={() => handleTogglePolicy(p.name)}
                                    className="shrink-0"
                                    title={isOn ? 'Click to disable' : 'Click to enable'}
                                >
                                    {isOn
                                        ? <ToggleRight size={20} className="text-emerald-500" />
                                        : <ToggleLeft size={20} className="tc-text-muted" />
                                    }
                                </button>
                                <div className="flex-1 min-w-0">
                                    <div className="text-[11px] font-mono tc-text">{p.name}</div>
                                    <div className="text-[9px] tc-text-muted">{p.desc}</div>
                                </div>
                                <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${isOn ? 'text-emerald-600 bg-emerald-500/10' : 'text-gray-500 bg-gray-500/10'
                                    }`}>
                                    {isOn ? 'ON' : 'OFF'}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </AccordionSection>

            {/* ── 5. Session (editable config) ── */}
            <AccordionSection
                icon={<Key size={14} />}
                title="Session"
                subtitle={`${sessionSigner} · ${sessionModel.split('/').pop() || 'Not set'}`}
                isOpen={openSections.session}
                onToggle={() => toggleSection('session')}
            >
                {!sessionEditing ? (
                    /* Read-only view */
                    <div className="space-y-0.5 pt-0.5">
                        {[
                            { label: 'Model', val: sessionModel.split('/').pop() || 'Not set' },
                            { label: 'Signer', val: sessionSigner },
                            { label: 'TSA', val: sessionTsa },
                        ].map(r => (
                            <div key={r.label} className="flex items-center justify-between py-1 text-[12px]">
                                <span className="tc-text-muted">{r.label}</span>
                                <span className="tc-text font-mono text-[11px]">{r.val}</span>
                            </div>
                        ))}
                        <button
                            onClick={() => setSessionEditing(true)}
                            className="w-full mt-1.5 flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium text-blue-500 hover:text-blue-400 rounded-lg tc-surface-hover transition-colors"
                        >
                            <Settings size={11} /> Edit
                        </button>
                    </div>
                ) : (
                    /* Edit view */
                    <div className="space-y-2 pt-1">
                        <div>
                            <label className="text-[10px] tc-text-muted font-medium block mb-0.5">Model</label>
                            <input
                                value={sessionModel}
                                onChange={e => setSessionModel(e.target.value)}
                                placeholder="google/gemini-2.5-flash"
                                className="w-full px-2 py-1.5 text-[11px] tc-surface border tc-border-light rounded-lg tc-text font-mono placeholder:tc-text-muted focus:outline-none focus:ring-1 focus:ring-blue-500/30"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] tc-text-muted font-medium block mb-0.5">Signer</label>
                            <select
                                value={sessionSigner}
                                onChange={e => setSessionSigner(e.target.value)}
                                className="w-full px-2 py-1.5 text-[11px] tc-surface border tc-border-light rounded-lg tc-text focus:outline-none focus:ring-1 focus:ring-blue-500/30 cursor-pointer"
                            >
                                <option value="Ed25519">Ed25519</option>
                                <option value="HMAC-SHA256">HMAC-SHA256</option>
                                <option value="RSA-PSS">RSA-PSS</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-[10px] tc-text-muted font-medium block mb-0.5">TSA Endpoint</label>
                            <input
                                value={sessionTsa}
                                onChange={e => setSessionTsa(e.target.value)}
                                placeholder="rfc3161.ai"
                                className="w-full px-2 py-1.5 text-[11px] tc-surface border tc-border-light rounded-lg tc-text font-mono placeholder:tc-text-muted focus:outline-none focus:ring-1 focus:ring-blue-500/30"
                            />
                        </div>
                        <div className="flex gap-1.5">
                            <button
                                onClick={handleSaveSession}
                                className="flex-1 py-1.5 text-[11px] font-medium rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                            >
                                Save
                            </button>
                            <button
                                onClick={() => {
                                    setSessionModel(localStorage.getItem('tc_model') || 'google/gemini-2.5-flash');
                                    setSessionSigner(localStorage.getItem('tc_signer') || 'Ed25519');
                                    setSessionTsa(localStorage.getItem('tc_tsa') || 'rfc3161.ai');
                                    setSessionEditing(false);
                                }}
                                className="flex-1 py-1.5 text-[11px] font-medium rounded-lg border tc-border-light tc-text hover:bg-white/5 transition-colors"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </AccordionSection>

            {/* ── 6. Storage ── */}
            <AccordionSection
                icon={<HardDrive size={14} />}
                title="Storage"
                badge={storageFileCount || undefined}
                subtitle={storageUsage ? `${storageUsage.backend === 'memory' ? 'Browser' : storageUsage.backend === 'local-folder' ? 'Local' : storageUsage.backend} · ${formatBytes(storageUsage.used)}` : 'Loading...'}
                isOpen={openSections.storage}
                onToggle={() => toggleSection('storage')}
            >
                <div className="space-y-2 pt-0.5">
                    {/* Backend type */}
                    <div className="flex items-center justify-between py-1 text-[12px]">
                        <span className="tc-text-muted">Backend</span>
                        <span className="tc-text font-mono text-[11px] flex items-center gap-1">
                            {storageUsage?.backend === 'memory' ? <><HardDrive size={11} className="text-blue-400" /> Browser</> :
                                storageUsage?.backend === 'local-folder' ? <><FolderOpen size={11} className="text-amber-400" /> {storageUsage.mountPath || 'Local Folder'}</> :
                                    storageUsage?.backend === 'docker-volume' ? <><Box size={11} className="text-emerald-400" /> Docker</> :
                                        storageUsage?.backend === 'google-drive' ? <><Cloud size={11} className="text-blue-400" /> Google Drive</> :
                                            storageUsage?.backend || 'Loading...'}
                        </span>
                    </div>

                    {/* Usage bar */}
                    {storageUsage && (
                        <div>
                            <div className="flex items-center justify-between text-[10px] mb-0.5">
                                <span className="tc-text-muted">Usage</span>
                                <span className="tc-text-muted">
                                    {formatBytes(storageUsage.used)}
                                    {storageUsage.quota > 0 ? ` / ${formatBytes(storageUsage.quota)}` : ' (unlimited)'}
                                </span>
                            </div>
                            {storageUsage.quota > 0 && (
                                <div className="w-full h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                                    <div
                                        className={`h-full rounded-full transition-all ${storageUsage.used / storageUsage.quota > 0.9 ? 'bg-red-500' :
                                            storageUsage.used / storageUsage.quota > 0.7 ? 'bg-amber-500' : 'bg-emerald-500'
                                            }`}
                                        style={{ width: `${Math.min(100, (storageUsage.used / storageUsage.quota) * 100)}%` }}
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    {/* File count */}
                    <div className="flex items-center justify-between py-1 text-[12px]">
                        <span className="tc-text-muted">Files</span>
                        <span className="tc-text font-mono text-[11px]">{storageFileCount}</span>
                    </div>

                    {/* Actions */}
                    <div className="space-y-1 pt-1">
                        <button
                            onClick={handleMountLocalFolder}
                            disabled={mountingFolder}
                            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium text-blue-500 hover:text-blue-400 rounded-lg tc-surface-hover transition-colors disabled:opacity-40"
                        >
                            <FolderOpen size={12} />
                            {mountingFolder ? 'Selecting...' : 'Mount Local Folder'}
                        </button>
                        {dockerAvailable && (
                            <button
                                onClick={handleConnectDocker}
                                disabled={connectingDocker || storageUsage?.backend === 'docker-volume'}
                                className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium text-emerald-500 hover:text-emerald-400 rounded-lg tc-surface-hover transition-colors disabled:opacity-40"
                            >
                                <Box size={12} />
                                {connectingDocker ? 'Connecting...' :
                                    storageUsage?.backend === 'docker-volume' ? 'Docker Connected' :
                                        'Use Docker Container'}
                            </button>
                        )}
                        <button
                            onClick={handleConnectGDrive}
                            disabled={connectingGDrive || storageUsage?.backend === 'google-drive'}
                            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium text-blue-500 hover:text-blue-400 rounded-lg tc-surface-hover transition-colors disabled:opacity-40"
                        >
                            <Cloud size={12} />
                            {connectingGDrive ? 'Connecting...' :
                                storageUsage?.backend === 'google-drive' ? 'Google Drive Connected' :
                                    'Connect Google Drive'}
                        </button>
                    </div>

                    {/* File tree */}
                    <div className="border-t tc-border-light pt-2 mt-1">
                        {onOpenFileManager && (
                            <button
                                onClick={onOpenFileManager}
                                className="w-full flex items-center justify-center gap-1.5 py-2 mb-2 text-[11px] font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors shadow-sm"
                            >
                                <FolderOpen size={13} />
                                Open File Manager
                            </button>
                        )}
                        <FileManagerPanel />
                    </div>
                </div>
            </AccordionSection>
        </div>
    );
};



export const ChatSidebar: React.FC<ChatSidebarProps> = ({
    activeConversation, setActiveConversation,
    messages, setMessages,
    activeSection, setActiveSection,
    searchQuery, setSearchQuery,
    setActiveArtifactId,
    setSidebarOpen, setShowSettings, setSettingsTab, setInitialToolId,
    agent, toolsByCategory, demoMessages,
    sessions, onLoadSession, onDeleteSession, onDownloadSession, onNewChat,
    onOpenFileManager, onLoadChannel,
}) => {
    // Filter sessions by search query
    const filteredSessions = sessions.filter(s =>
        !searchQuery || s.title.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
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
                <button
                    onClick={() => setSidebarOpen(false)}
                    className="p-1.5 rounded-lg tc-surface-hover transition-colors tc-text-muted hover:tc-text-secondary"
                    title="Collapse sidebar"
                >
                    <PanelLeftClose size={16} />
                </button>
            </div>

            {/* New Chat + Demo */}
            <div className="px-3 mb-2 flex gap-2">
                <button onClick={onNewChat}
                    className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium tc-new-chat border transition-all">
                    <Plus size={16} />New Chat
                </button>
                <button
                    onClick={() => { setActiveConversation('1'); setMessages(demoMessages); setActiveArtifactId(null); }}
                    className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium border transition-all
                    text-amber-600 dark:text-amber-400 border-amber-400/30 bg-amber-500/5 hover:bg-amber-500/15"
                    title="Load demo conversation with TrustChain features"
                >
                    <Sparkles size={14} />Demo
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
            <div className="px-3 flex gap-0.5 mb-2">
                {([
                    { id: 'chats' as const, icon: <MessageSquare size={13} />, label: 'Chats' },
                    { id: 'people' as const, icon: <UserCircle size={13} />, label: 'People' },
                    { id: 'agent' as const, icon: <Bot size={13} />, label: 'Agent' },
                    { id: 'trust' as const, icon: <Shield size={13} />, label: 'Trust' },
                ]).map((s) => (
                    <button key={s.id} onClick={() => setActiveSection(s.id)}
                        title={s.label}
                        className={`flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-medium transition-all
                    ${activeSection === s.id
                                ? 'tc-tab-active flex-[1.6] px-2'
                                : 'tc-text-muted hover:tc-text tc-surface-hover flex-1 px-1'}`}>
                        {s.icon}
                        {activeSection === s.id && <span className="truncate">{s.label}</span>}
                    </button>
                ))}
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5 tc-scrollbar">
                {activeSection === 'chats' && (
                    <>
                        {/* ── Multi-Party Channels ── */}
                        <div className="px-2 py-1.5 text-[10px] font-medium tc-text-muted uppercase tracking-wider">Channels</div>
                        <ChannelList
                            activeChannelId={activeConversation}
                            onSelectChannel={(chId) => {
                                if (onLoadChannel) onLoadChannel(chId);
                                else setActiveConversation(chId);
                            }}
                            searchQuery={searchQuery}
                        />

                        {/* ── Agent Sessions ── */}
                        <div className="px-2 pt-3 pb-1.5 text-[10px] font-medium tc-text-muted uppercase tracking-wider border-t tc-border-light mt-2">Agent Sessions</div>
                        {filteredSessions.length === 0 && (
                            <div className="px-3 py-4 text-center">
                                <MessageSquare size={20} className="mx-auto tc-text-muted mb-1.5 opacity-40" />
                                <div className="text-[11px] tc-text-muted">No agent sessions</div>
                            </div>
                        )}
                        {filteredSessions.map((session) => (
                            <ConversationItem
                                key={session.sessionId}
                                session={session}
                                isActive={activeConversation === session.sessionId}
                                onSelect={() => onLoadSession(session.sessionId)}
                                onDelete={() => onDeleteSession(session.sessionId)}
                                onDownload={() => onDownloadSession(session.sessionId)}
                            />
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
                {activeSection === 'people' && (
                    <PeopleTab />
                )}
                {activeSection === 'agent' && (
                    <AgentAccordionPanel
                        agent={agent}
                        toolsByCategory={toolsByCategory}
                        setShowSettings={setShowSettings}
                        setSettingsTab={setSettingsTab}
                        setInitialToolId={setInitialToolId}
                        onOpenFileManager={onOpenFileManager}
                    />
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
};
