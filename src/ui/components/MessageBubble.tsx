import React, { useState } from 'react';
import {
    User, Bot, Clock, Copy, Zap, CheckCircle, ChevronRight, Shield, AlertTriangle
} from 'lucide-react';
import type { Message, Artifact, ToolCall } from './types';
import { ThinkingContainer } from './ThinkingContainer';
import { ArtifactCard } from './ArtifactCard';
import { normalizeTrustChainMarkup, renderInline, renderFullMarkdown } from './MarkdownRenderer';

/**
 * MessageBubble — Renders a single chat message with optional execution steps,
 * tool calls, artifact cards, and signature badges.
 */
export const MessageBubble: React.FC<{
    message: Message;
    activeArtifactId: string | null;
    onOpenArtifact: (id: string) => void;
    allArtifacts: Record<string, Artifact>;
}> = ({ message, activeArtifactId, onOpenArtifact, allArtifacts }) => {
    const isUser = message.role === 'user';
    const isParticipant = message.role === 'participant';
    const isAgent = message.role === 'assistant' || (isParticipant && message.senderType === 'agent');
    const isOtherUser = isParticipant && message.senderType === 'user';
    const artifact = message.artifactId ? allArtifacts[message.artifactId] : null;
    const normalizedContent = normalizeTrustChainMarkup(message.content || '');

    // Avatar gradient based on sender type
    const avatarGradient = isUser
        ? 'bg-gradient-to-br from-blue-500 to-blue-600'
        : isOtherUser
            ? 'bg-gradient-to-br from-slate-400 to-slate-600'
            : 'bg-gradient-to-br from-violet-500 to-purple-600';

    // Bubble style based on sender type
    const bubbleClass = isUser
        ? 'tc-user-bubble rounded-br-md inline-block'
        : isOtherUser
            ? 'tc-assistant-bubble border rounded-bl-md bg-slate-50/50 dark:bg-slate-800/30'
            : 'tc-assistant-bubble border rounded-bl-md';

    // Avatar content
    const avatarContent = isUser
        ? <User size={16} className="text-white" />
        : isOtherUser && message.senderName
            ? <span className="text-white text-[10px] font-bold">{message.senderName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</span>
            : <Bot size={16} className="text-white" />;

    return (
        <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''} group`}>
            {/* Avatar */}
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-1 shadow-lg ${avatarGradient}`}>
                {avatarContent}
            </div>

            {/* Content */}
            <div className={`flex-1 min-w-0 overflow-hidden ${isUser ? 'max-w-[75%]' : 'max-w-[85%]'} ${isUser ? 'text-right' : ''}`}>
                {/* Sender name for multi-party */}
                {isParticipant && message.senderName && (
                    <div className={`text-[10px] font-semibold mb-0.5 ${isOtherUser ? 'text-slate-500' : 'text-purple-500'}`}>
                        {message.senderName}
                        {message.senderType === 'agent' && <span className="ml-1 text-[8px] px-1 py-0 rounded bg-purple-500/10 text-purple-500">agent</span>}
                    </div>
                )}
                <div className={`text-left rounded-2xl px-4 py-3 text-sm leading-relaxed max-w-full ${bubbleClass}`}
                    style={{ overflowWrap: 'anywhere' }}>
                    {/* Execution timeline (new agent-style) */}
                    {!isUser && message.executionSteps && message.executionSteps.length > 0 && (
                        <div className="mb-2.5">
                            <ThinkingContainer steps={message.executionSteps} onOpenArtifact={onOpenArtifact} allArtifacts={allArtifacts} />
                        </div>
                    )}

                    {/* Legacy tool calls fallback */}
                    {!isUser && !message.executionSteps && message.tool_calls && message.tool_calls.length > 0 && (
                        <div className="mb-2.5 pb-2 border-b tc-border-light">
                            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                                <Zap size={9} />
                                {message.tool_calls.length} tool{message.tool_calls.length > 1 ? 's' : ''} used
                            </div>
                            {message.tool_calls.map((tc) => (
                                <ToolCallChip key={tc.id} tool={tc} />
                            ))}
                        </div>
                    )}

                    {/* Message content */}
                    <div className={isUser ? 'whitespace-pre-wrap break-all' : 'break-all tc-markdown'}>
                        {isUser ? renderInline(message.content) : renderFullMarkdown(normalizedContent)}
                    </div>
                </div>

                {/* Multiple artifact cards */}
                {message.artifactIds && message.artifactIds.map(aid => {
                    const art = allArtifacts[aid];
                    if (!art) return null;
                    return (
                        <ArtifactCard
                            key={aid}
                            artifact={art}
                            onClick={() => onOpenArtifact(aid)}
                            isActive={activeArtifactId === aid}
                        />
                    );
                })}

                {/* Single artifact card (legacy) */}
                {!message.artifactIds && artifact && (
                    <ArtifactCard
                        artifact={artifact}
                        onClick={() => onOpenArtifact(artifact.id)}
                        isActive={activeArtifactId === artifact.id}
                    />
                )}

                {/* Signature badge */}
                {!isUser && message.verified !== undefined && message.signature && (
                    <div className="mt-1.5">
                        <SignatureBadge signature={message.signature} verified={message.verified} />
                    </div>
                )}

                {/* Timestamp */}
                <div className={`flex items-center gap-2 mt-1 text-[11px] tc-text-muted 
          ${isUser ? 'justify-end' : 'justify-start'}`}>
                    <Clock size={10} />
                    <span>{message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    {!isUser && (
                        <button className="opacity-0 group-hover:opacity-100 transition-opacity hover:tc-text-secondary ml-1">
                            <Copy size={11} />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

/* ── Signature Badge ── */
const SignatureBadge: React.FC<{ signature: string; verified: boolean }> = ({ signature, verified }) => (
    <div className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border
        ${verified ? 'tc-verified' : 'tc-unverified'}`}>
        {verified ? <Shield size={12} /> : <AlertTriangle size={12} />}
        <span className="font-mono">{signature.substring(0, 12)}…</span>
        <span className="opacity-60">·</span>
        <span>{verified ? 'Verified' : 'Unverified'}</span>
    </div>
);

/* ── Tool Call Chip ── */
const ToolCallChip: React.FC<{ tool: ToolCall }> = ({ tool }) => {
    const [expanded, setExpanded] = useState(false);
    return (
        <div className="my-1">
            <button
                onClick={() => setExpanded(!expanded)}
                className="inline-flex items-center gap-1.5 tc-tool-chip border
          rounded-lg px-2.5 py-1.5 text-xs transition-colors group"
            >
                <Zap size={12} className="text-amber-400" />
                <span className="text-blue-500 font-mono">{tool.name}</span>
                {tool.latencyMs && <span className="tc-text-muted">{tool.latencyMs}ms</span>}
                {tool.signature && (
                    <CheckCircle size={10} className="text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                )}
                <ChevronRight size={12} className={`tc-text-muted transition-transform ${expanded ? 'rotate-90' : ''}`} />
            </button>
            {expanded && (
                <div className="ml-4 mt-1 text-xs tc-expanded border rounded-lg p-2.5 space-y-1">
                    <div className="tc-text-secondary">
                        <span className="tc-text-muted">Args: </span>
                        <span className="font-mono">{JSON.stringify(tool.args)}</span>
                    </div>
                    {tool.result && (
                        <div className="tc-text">
                            <span className="tc-text-muted">Result: </span>{tool.result}
                        </div>
                    )}
                    {tool.signature && (
                        <div className="text-emerald-500/60 font-mono">
                            <span className="tc-text-muted">Sig: </span>{tool.signature}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
