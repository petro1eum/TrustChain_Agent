/**
 * ChatArea — main message display area with auto-scroll.
 */

import React, { useEffect } from 'react';
import { Bot, User, Wrench, FileText, Loader2 } from 'lucide-react';
import type { ChatMessage } from '../../../agents/types';
import type { ProcessingState } from '../types';

interface ChatAreaProps {
    messages: ChatMessage[];
    processing: ProcessingState;
    messagesEndRef: React.RefObject<HTMLDivElement>;
    formatTime: (date?: Date) => string;
    onSwitchToArtifact?: (filename: string) => void;
}

export const ChatArea: React.FC<ChatAreaProps> = ({
    messages,
    processing,
    messagesEndRef,
    formatTime,
    onSwitchToArtifact,
}) => {
    // Auto-scroll to bottom on new messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, messagesEndRef]);

    if (messages.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center p-8 overflow-hidden">
                <div className="text-center max-w-md">
                    <Bot className="w-16 h-16 text-indigo-400/30 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-300 mb-2">
                        TrustChain Agent
                    </h3>
                    <p className="text-sm text-gray-500 mb-4">
                        AI-ассистент с криптографической верификацией.
                        Задайте вопрос или выберите режим работы.
                    </p>
                    <div className="flex flex-wrap gap-2 justify-center">
                        {['Анализ данных', 'Поиск по каталогу', 'Генерация отчёта', 'Проверка качества'].map(q => (
                            <button
                                key={q}
                                className="px-3 py-1.5 text-xs text-gray-400 border border-gray-700 rounded-full hover:border-indigo-500 hover:text-indigo-300 transition-colors"
                            >
                                {q}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.map((msg, idx) => (
                <MessageBubble
                    key={msg.id || idx}
                    message={msg}
                    formatTime={formatTime}
                    onSwitchToArtifact={onSwitchToArtifact}
                />
            ))}

            {/* Processing indicator */}
            {processing.isProcessing && (
                <div className="flex items-start gap-3 py-2">
                    <div className="w-7 h-7 rounded-full bg-indigo-600/20 flex items-center justify-center shrink-0">
                        <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
                    </div>
                    <div className="text-sm text-gray-400 pt-1.5">
                        {processing.currentStep || 'Обрабатываю запрос...'}
                    </div>
                </div>
            )}

            <div ref={messagesEndRef} />
        </div>
    );
};

/* ──────── Internal: MessageBubble ──────── */

interface MessageBubbleProps {
    message: ChatMessage;
    formatTime: (date?: Date) => string;
    onSwitchToArtifact?: (filename: string) => void;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message, formatTime, onSwitchToArtifact }) => {
    const isUser = message.role === 'user';
    const isSystem = message.role === 'system';
    const isToolCall = message.role === 'tool_call';
    const isToolResponse = message.role === 'tool_response';

    // Tool call / response — compact display
    if (isToolCall || isToolResponse) {
        return (
            <div className="flex items-start gap-2 py-1 px-2 ml-8 border-l-2 border-gray-700/50">
                <Wrench className="w-3.5 h-3.5 text-gray-500 mt-0.5 shrink-0" />
                <div className="text-xs text-gray-500 min-w-0">
                    <span className="font-medium text-gray-400">{message.name || (isToolCall ? 'Tool Call' : 'Tool Result')}</span>
                    {message.content && (
                        <div className="mt-0.5 text-gray-600 truncate max-w-[400px]">{message.content}</div>
                    )}
                </div>
            </div>
        );
    }

    // System message
    if (isSystem) {
        return (
            <div className="flex items-center justify-center py-2">
                <div className="text-xs text-gray-500 bg-gray-800/50 px-3 py-1 rounded-full">
                    {message.content}
                </div>
            </div>
        );
    }

    // User / Assistant bubble
    return (
        <div className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
            {/* Avatar */}
            <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${isUser ? 'bg-blue-600' : 'bg-indigo-600/20'
                }`}>
                {isUser ? (
                    <User className="w-4 h-4 text-white" />
                ) : (
                    <Bot className="w-4 h-4 text-indigo-400" />
                )}
            </div>

            {/* Content */}
            <div className={`max-w-[80%] min-w-0 ${isUser ? 'text-right' : ''}`}>
                <div className={`inline-block px-3 py-2 rounded-xl text-sm whitespace-pre-wrap break-words ${isUser
                        ? 'bg-blue-600 text-white rounded-tr-sm'
                        : 'bg-gray-800 text-gray-200 rounded-tl-sm border border-gray-700/50'
                    }`}>
                    {message.content || ''}

                    {/* Artifact links */}
                    {message.attachments?.map(att => (
                        <button
                            key={att.id}
                            className="mt-2 flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                            onClick={() => onSwitchToArtifact?.(att.filename)}
                        >
                            <FileText className="w-3 h-3" />
                            {att.filename}
                        </button>
                    ))}
                </div>

                {/* Timestamp */}
                <div className={`text-[10px] text-gray-600 mt-0.5 ${isUser ? 'text-right' : ''}`}>
                    {formatTime(message.timestamp)}
                </div>
            </div>
        </div>
    );
};
