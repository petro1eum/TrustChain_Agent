import React from 'react';
import {
    Shield, Code, FileText, Globe, Briefcase, Lock, BarChart3, Bot
} from 'lucide-react';
import type { Message, Artifact } from './types';
import { MessageBubble } from './MessageBubble';
import { LiveThinkingAccordion } from './LiveThinkingAccordion';

/**
 * ChatArea — Message list with welcome screen and live thinking accordion.
 * Shows a collapsible accordion of agent execution steps while the agent
 * is processing, instead of bouncing dots.
 */

interface ChatAreaProps {
    messages: Message[];
    isNewChat: boolean;
    isTyping: boolean;
    activeArtifactId: string | null;
    allArtifacts: Record<string, Artifact>;
    artifactMaximized: boolean;
    activeArtifact: Artifact | null;
    messagesEndRef: React.RefObject<HTMLDivElement | null>;
    inputRef: React.RefObject<HTMLTextAreaElement | null>;
    setActiveArtifactId: (id: string | null) => void;
    setInputValue: (val: string) => void;
    /** Live streaming events from useAgent during processing */
    streamingEvents?: any[];
    /** Live streaming partial text from useAgent during processing */
    streamingText?: string;
}

export const ChatArea: React.FC<ChatAreaProps> = ({
    messages, isNewChat, isTyping,
    activeArtifactId, allArtifacts, artifactMaximized, activeArtifact,
    messagesEndRef, inputRef,
    setActiveArtifactId, setInputValue,
    streamingEvents, streamingText,
}) => (
    <>
        {isNewChat ? (
            /* ── Welcome screen ── */
            <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
                <div className="w-14 h-14 tc-logo rounded-2xl flex items-center justify-center shadow-2xl mb-5">
                    <Shield size={24} className="text-white" />
                </div>
                <h1 className="text-xl font-semibold tc-text-heading mb-1">TrustChain Agent</h1>
                <p className="tc-text-muted text-sm mb-8">Every response cryptographically verified</p>
                <div className="flex flex-wrap gap-2 justify-center max-w-md">
                    {[
                        { icon: <Code size={14} />, label: 'Code Review' },
                        { icon: <FileText size={14} />, label: 'Compliance Report' },
                        { icon: <Globe size={14} />, label: 'Research' },
                        { icon: <Briefcase size={14} />, label: 'Analysis' },
                        { icon: <Lock size={14} />, label: 'Audit Trail' },
                        { icon: <BarChart3 size={14} />, label: 'Dashboard' },
                    ].map((a) => (
                        <button key={a.label}
                            onClick={() => { setInputValue(`${a.label}: `); inputRef.current?.focus(); }}
                            className="flex items-center gap-2 px-3.5 py-2 tc-surface tc-surface-hover
                                border tc-border-light rounded-xl text-sm tc-text transition-all">
                            <span className="text-blue-500">{a.icon}</span>{a.label}
                        </button>
                    ))}
                </div>
            </div>
        ) : (
            /* ── Message list ── */
            <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5 tc-scrollbar">
                {messages.map((msg) => (
                    <MessageBubble
                        key={msg.id}
                        message={msg}
                        activeArtifactId={activeArtifactId}
                        onOpenArtifact={(id) => setActiveArtifactId(id === activeArtifactId ? null : id)}
                        allArtifacts={allArtifacts}
                    />
                ))}

                {/* ── Live Thinking Accordion (replaces bouncing dots) ── */}
                {isTyping && (
                    <div className="flex gap-3 group">
                        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shrink-0 mt-1 shadow-lg">
                            <Bot size={16} className="text-white" />
                        </div>
                        <div className="flex-1 min-w-0 max-w-[85%]">
                            <div className="inline-block text-left rounded-2xl px-4 py-3 text-sm leading-relaxed tc-assistant-bubble border rounded-bl-md">
                                <LiveThinkingAccordion
                                    events={streamingEvents || []}
                                    streamingText={streamingText || ''}
                                />
                            </div>
                        </div>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>
        )}
    </>
);
