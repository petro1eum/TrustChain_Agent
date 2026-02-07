import { useState, useRef, useEffect, useCallback } from 'react';
import type { Message, Artifact } from '../ui/components/types';
import { chatHistoryService } from '../services/chatHistoryService';

/**
 * useChatState — Manages all chat-related state, refs, and utilities.
 * Ported from AI Studio's useChatState hook, adapted for TrustChain Agent types.
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

    // Refs
    messagesEndRef: React.RefObject<HTMLDivElement | null>;
    inputRef: React.RefObject<HTMLTextAreaElement | null>;

    // Utilities
    clearChat: () => void;
    exportChat: () => void;
    formatTime: (date: Date) => string;
}

export const useChatState = (initialMessages: Message[] = []): UseChatStateReturn => {
    const [messages, setMessages] = useState<Message[]>(initialMessages);
    const [inputValue, setInputValue] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [activeConversation, setActiveConversation] = useState<string | null>('1');
    const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);
    const [dynamicArtifacts, setDynamicArtifacts] = useState<Record<string, Artifact>>({});
    const [artifactMaximized, setArtifactMaximized] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Auto-scroll to latest message
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isTyping]);

    // End session on unmount
    useEffect(() => {
        return () => {
            chatHistoryService.endSession();
        };
    }, []);

    // Clear chat
    const clearChat = useCallback(() => {
        chatHistoryService.endSession();
        setMessages([]);
        setActiveArtifactId(null);
        setDynamicArtifacts({});
        setIsTyping(false);
    }, []);

    // Export chat as text file
    const exportChat = useCallback(() => {
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
    }, [messages]);

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
        messagesEndRef, inputRef,
        clearChat, exportChat, formatTime,
    };
};
