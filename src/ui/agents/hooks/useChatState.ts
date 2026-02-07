/**
 * useChatState — manages chat messages, input, attachments, and processing state.
 */

import { useState, useRef, useCallback } from 'react';
import type { ChatMessage, ChatAttachment } from '../../../agents/types';
import type { ProcessingState } from '../types';

export interface ChatStateReturn {
    messages: ChatMessage[];
    setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
    inputValue: string;
    setInputValue: React.Dispatch<React.SetStateAction<string>>;
    inputRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
    messagesEndRef: React.RefObject<HTMLDivElement | null>;
    pendingAttachments: ChatAttachment[];
    setPendingAttachments: React.Dispatch<React.SetStateAction<ChatAttachment[]>>;
    attachmentsUploading: number;
    setAttachmentsUploading: React.Dispatch<React.SetStateAction<number>>;
    processing: ProcessingState;
    setProcessing: React.Dispatch<React.SetStateAction<ProcessingState>>;
    clearChat: () => void;
    exportChat: () => void;
    formatTime: (date?: Date) => string;
}

export function useChatState(): ChatStateReturn {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
    const [attachmentsUploading, setAttachmentsUploading] = useState(0);
    const [processing, setProcessing] = useState<ProcessingState>({
        isProcessing: false,
    });

    const inputRef = useRef<HTMLInputElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const clearChat = useCallback(() => {
        setMessages([]);
        setPendingAttachments([]);
        setAttachmentsUploading(0);
        setProcessing({ isProcessing: false });
    }, []);

    const exportChat = useCallback(() => {
        const exportData = {
            exportedAt: new Date().toISOString(),
            messageCount: messages.length,
            messages: messages.map(msg => ({
                role: msg.role,
                content: msg.content,
                timestamp: msg.timestamp?.toISOString(),
                ...(msg.attachments?.length && { attachments: msg.attachments.map(a => a.filename) }),
            })),
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `chat-export-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        URL.revokeObjectURL(url);
    }, [messages]);

    const formatTime = useCallback((date?: Date): string => {
        if (!date) return '';
        return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }, []);

    return {
        messages,
        setMessages,
        inputValue,
        setInputValue,
        inputRef,
        messagesEndRef,
        pendingAttachments,
        setPendingAttachments,
        attachmentsUploading,
        setAttachmentsUploading,
        processing,
        setProcessing,
        clearChat,
        exportChat,
        formatTime,
    };
}
