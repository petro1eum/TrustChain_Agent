import { useState, useRef, useEffect, useCallback } from 'react';
import type { Message, Artifact } from '../ui/components/types';
import { chatHistoryService, type ChatSession } from '../services/chatHistoryService';

/**
 * useChatState — Manages all chat-related state, refs, and utilities.
 * Now integrates with chatHistoryService for persistent conversations.
 */
export interface UseChatStateReturn {
    // State
    messages: Message[];
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    inputValue: string;
    setInputValue: React.Dispatch<React.SetStateAction<string>>;
    isTyping: boolean;
    setIsTyping: React.Dispatch<React.SetStateAction<boolean>>;
    activeConversation: string | null;
    setActiveConversation: React.Dispatch<React.SetStateAction<string | null>>;
    activeArtifactId: string | null;
    setActiveArtifactId: React.Dispatch<React.SetStateAction<string | null>>;
    dynamicArtifacts: Record<string, Artifact>;
    setDynamicArtifacts: React.Dispatch<React.SetStateAction<Record<string, Artifact>>>;
    artifactMaximized: boolean;
    setArtifactMaximized: React.Dispatch<React.SetStateAction<boolean>>;
    searchQuery: string;
    setSearchQuery: React.Dispatch<React.SetStateAction<string>>;

    // Chat sessions (real, from localStorage)
    sessions: ChatSession[];

    // Refs
    messagesEndRef: React.RefObject<HTMLDivElement | null>;
    inputRef: React.RefObject<HTMLTextAreaElement | null>;

    // Utilities
    clearChat: () => void;
    exportChat: () => void;
    formatTime: (date: Date) => string;
    loadSession: (sessionId: string) => void;
    deleteSession: (sessionId: string) => void;
    downloadSession: (sessionId: string) => void;
    startNewChat: () => void;
}

export const useChatState = (initialMessages: Message[] = []): UseChatStateReturn => {
    const [messages, setMessages] = useState<Message[]>(initialMessages);
    const [inputValue, setInputValue] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [activeConversation, setActiveConversation] = useState<string | null>(null);
    const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);
    const [dynamicArtifacts, setDynamicArtifacts] = useState<Record<string, Artifact>>({});
    const [artifactMaximized, setArtifactMaximized] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [sessions, setSessions] = useState<ChatSession[]>(() => chatHistoryService.getRecentSessions(20));

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Auto-scroll to latest message
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isTyping]);

    // Subscribe to session changes
    useEffect(() => {
        const unsub = chatHistoryService.onSessionsChanged(() => {
            setSessions(chatHistoryService.getRecentSessions(20));
        });
        return unsub;
    }, []);

    // End session on unmount
    useEffect(() => {
        return () => {
            chatHistoryService.endSession();
        };
    }, []);

    // Start a new empty chat
    const startNewChat = useCallback(() => {
        chatHistoryService.endSession();
        setMessages([]);
        setActiveArtifactId(null);
        setDynamicArtifacts({});
        setIsTyping(false);
        const sid = chatHistoryService.startSession();
        setActiveConversation(sid);
    }, []);

    // Clear chat (same as startNewChat)
    const clearChat = useCallback(() => {
        startNewChat();
    }, [startNewChat]);

    // Load a session from history
    const loadSession = useCallback((sessionId: string) => {
        const allSessions = chatHistoryService.getAllSessions();
        const session = allSessions.find(s => s.sessionId === sessionId);
        if (!session) return;

        // Convert stored messages to UI Message format (including execution data)
        const restored: Message[] = session.messages.map((msg, i) => ({
            id: msg.id || `restored_${i}`,
            role: msg.role as 'user' | 'assistant' | 'system',
            content: msg.content,
            timestamp: new Date(msg.timestamp),
            ...(msg.executionSteps ? { executionSteps: msg.executionSteps } : {}),
            ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}),
            ...(msg.signature ? { signature: msg.signature } : {}),
            ...(msg.verified !== undefined ? { verified: msg.verified } : {}),
            ...(msg.artifactIds ? { artifactIds: msg.artifactIds } : {}),
            ...(msg.thinking ? { thinking: msg.thinking } : {}),
        }));
        setMessages(restored);
        setActiveConversation(sessionId);
        setActiveArtifactId(null);
        setDynamicArtifacts({});
    }, []);

    // Delete a session
    const deleteSession = useCallback((sessionId: string) => {
        chatHistoryService.deleteSession(sessionId);
        if (activeConversation === sessionId) {
            setMessages([]);
            setActiveConversation(null);
            setActiveArtifactId(null);
            setDynamicArtifacts({});
        }
    }, [activeConversation]);

    // Download a session
    const downloadSession = useCallback((sessionId: string) => {
        const text = chatHistoryService.exportSession(sessionId);
        if (!text) return;
        const session = chatHistoryService.getAllSessions().find(s => s.sessionId === sessionId);
        const title = session?.title || 'chat';
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${title.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_').slice(0, 40)}.txt`;
        link.click();
        URL.revokeObjectURL(url);
    }, []);

    // Export current chat as text file (legacy)
    const exportChat = useCallback(() => {
        if (activeConversation) {
            downloadSession(activeConversation);
        } else {
            const chatText = messages.map(msg =>
                `[${msg.timestamp?.toLocaleString()}] ${msg.role === 'user' ? 'User' : 'Agent'}: ${msg.content}`
            ).join('\n\n');
            const blob = new Blob([chatText], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `trustchain-chat-${new Date().toISOString().split('T')[0]}.txt`;
            link.click();
            URL.revokeObjectURL(url);
        }
    }, [messages, activeConversation, downloadSession]);

    // Format time
    const formatTime = useCallback((date: Date) => {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }, []);

    return {
        messages, setMessages,
        inputValue, setInputValue,
        isTyping, setIsTyping,
        activeConversation, setActiveConversation,
        activeArtifactId, setActiveArtifactId,
        dynamicArtifacts, setDynamicArtifacts,
        artifactMaximized, setArtifactMaximized,
        searchQuery, setSearchQuery,
        sessions,
        messagesEndRef, inputRef,
        clearChat, exportChat, formatTime,
        loadSession, deleteSession, downloadSession, startNewChat,
    };
};
