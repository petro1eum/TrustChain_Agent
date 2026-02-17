import React from 'react';
import {
    PanelLeft, Hash, Sun, Moon, Settings, BookOpen,
    ChevronDown, Sparkles, Loader2, AlertCircle
} from 'lucide-react';
import type { ThemeMode } from './types';
import { DEMO_CONVERSATIONS } from './constants';
import { chatHistoryService } from '../../services/chatHistoryService';

interface ChatHeaderProps {
    sidebarOpen: boolean;
    setSidebarOpen: (open: boolean) => void;
    activeConversation: string | null;
    theme: ThemeMode;
    toggleTheme: () => void;
    agent: { status: string; isInitialized: boolean };
    setShowSettings: (show: boolean) => void;
    onOpenRunbook?: () => void;
}

function getConversationTitle(id: string | null): string {
    if (!id) return 'New Chat';
    // Check demo conversations first
    const demo = DEMO_CONVERSATIONS.find(c => c.id === id);
    if (demo) return demo.title;
    // Check real sessions
    const session = chatHistoryService.getAllSessions().find(s => s.sessionId === id);
    if (session?.title) return session.title;
    return 'New Chat';
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
    sidebarOpen, setSidebarOpen,
    activeConversation,
    theme, toggleTheme,
    agent, setShowSettings,
    onOpenRunbook,
}) => (
    <header className="h-12 shrink-0 border-b tc-border flex items-center px-4 gap-3">
        <div className="flex-1 flex items-center gap-2">
            <Hash size={14} className="tc-text-muted" />
            <span className="text-sm tc-text font-medium">
                {getConversationTitle(activeConversation)}
            </span>
        </div>
        <div className="flex items-center gap-2">
            {/* Theme toggle */}
            <button onClick={toggleTheme}
                className="tc-theme-toggle" title={theme === 'dark' ? 'Switch to Light' : 'Switch to Dark'}>
                <div className="toggle-dot">
                    {theme === 'dark' ? <Moon size={12} className="text-white" /> : <Sun size={12} className="text-white" />}
                </div>
            </button>
            <button className="flex items-center gap-1.5 text-xs tc-text-secondary
                tc-surface px-3 py-1.5 rounded-lg border tc-border-light transition-colors">
                {agent.status === 'thinking' ? (
                    <Loader2 size={12} className="text-amber-500 animate-spin" />
                ) : agent.isInitialized ? (
                    <Sparkles size={12} className="text-emerald-500" />
                ) : (
                    <AlertCircle size={12} className="text-gray-400" />
                )}
                {agent.isInitialized ? (localStorage.getItem('tc_model') || 'google/gemini-2.5-flash').split('/').pop() : 'No API Key'}
                <ChevronDown size={12} />
            </button>
            {onOpenRunbook && (
                <button onClick={onOpenRunbook}
                    className="tc-text-muted hover:tc-text p-1.5 rounded-lg tc-btn-hover transition-colors flex items-center gap-1"
                    title="Security Runbooks">
                    <BookOpen size={16} />
                    <span className="text-xs hidden sm:inline">Runbooks</span>
                </button>
            )}
            <button onClick={() => setShowSettings(true)}
                className={`tc-text-muted hover:tc-text p-1.5 rounded-lg tc-btn-hover transition-colors ${!agent.isInitialized ? 'text-amber-500' : ''}`}
                title="Agent Settings">
                <Settings size={16} />
            </button>
        </div>
    </header>
);
