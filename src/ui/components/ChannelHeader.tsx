/**
 * ChannelHeader — Displays channel info, participants, and encryption status
 * Part 13: Phase 2
 */

import React, { useState } from 'react';
import {
    Lock, Users, Bot, ChevronDown, Settings, Hash, User, Shield
} from 'lucide-react';
import type { Channel, Participant } from '../../types/channelTypes';

// ─── Channel type icons ───

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
    agent: <Bot size={16} className="text-purple-500" />,
    dm: <User size={16} className="text-blue-500" />,
    group: <Hash size={16} className="text-emerald-500" />,
    swarm: <Bot size={16} className="text-amber-500" />,
};

const STATUS_COLORS: Record<string, string> = {
    online: 'bg-emerald-500',
    away: 'bg-amber-500',
    offline: 'bg-gray-400',
};

// ─── Props ───

interface ChannelHeaderProps {
    channel: Channel;
    onBack?: () => void;
}

// ─── Component ───

export const ChannelHeader: React.FC<ChannelHeaderProps> = ({ channel }) => {
    const [showParticipants, setShowParticipants] = useState(false);

    const otherParticipants = channel.participants.filter(p => p.role !== 'owner');
    const onlineCount = channel.participants.filter(p => p.status === 'online').length;

    return (
        <div className="relative">
            {/* Main header */}
            <div className="flex items-center justify-between px-5 py-3 border-b tc-border-light tc-surface">
                <div className="flex items-center gap-3 min-w-0">
                    {/* Channel icon */}
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800 flex items-center justify-center shrink-0">
                        {CHANNEL_ICONS[channel.type]}
                    </div>

                    {/* Name + description */}
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <h2 className="text-sm font-semibold tc-text truncate">{channel.name}</h2>
                            {channel.encrypted && (
                                <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-500 text-[9px] font-medium">
                                    <Lock size={8} /> E2E
                                </span>
                            )}
                        </div>
                        <div className="text-[11px] tc-text-muted truncate">
                            {channel.type === 'dm'
                                ? otherParticipants[0]?.status === 'online' ? 'Online' : 'Offline'
                                : `${channel.participants.length} participants · ${onlineCount} online`
                            }
                        </div>
                    </div>
                </div>

                {/* Right actions */}
                <div className="flex items-center gap-1">
                    {channel.trustScore > 0 && (
                        <span className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium text-emerald-500 tc-surface-hover">
                            <Shield size={10} /> {channel.trustScore}%
                        </span>
                    )}
                    {(channel.type === 'group' || channel.type === 'swarm') && (
                        <button
                            onClick={() => setShowParticipants(!showParticipants)}
                            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium tc-text-muted hover:tc-text tc-surface-hover transition-colors"
                        >
                            <Users size={12} /> {channel.participants.length}
                            <ChevronDown size={10} className={`transition-transform ${showParticipants ? 'rotate-180' : ''}`} />
                        </button>
                    )}
                </div>
            </div>

            {/* Participants dropdown */}
            {showParticipants && (
                <div className="absolute right-4 top-full mt-1 w-64 rounded-xl tc-surface border tc-border-light shadow-xl z-50 overflow-hidden">
                    <div className="px-3 py-2 border-b tc-border-light">
                        <span className="text-[10px] font-semibold tc-text-muted uppercase tracking-wider">
                            Participants ({channel.participants.length})
                        </span>
                    </div>
                    <div className="max-h-48 overflow-y-auto py-1">
                        {channel.participants.map(p => (
                            <div key={p.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/5">
                                <div className="relative">
                                    <div className={`w-6 h-6 rounded-md flex items-center justify-center text-white text-[9px] font-bold shrink-0
                                        ${p.type === 'agent'
                                            ? 'bg-gradient-to-br from-violet-500 to-purple-600'
                                            : 'bg-gradient-to-br from-gray-400 to-gray-600'}`}>
                                        {p.type === 'agent' ? <Bot size={12} /> : p.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                                    </div>
                                    <div className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-[var(--tc-surface)] ${STATUS_COLORS[p.status]}`} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-[11px] tc-text font-medium truncate flex items-center gap-1">
                                        {p.name}
                                        {p.role === 'owner' && <span className="text-[8px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-500">owner</span>}
                                        {p.type === 'agent' && <span className="text-[8px] px-1 py-0.5 rounded bg-purple-500/10 text-purple-500">agent</span>}
                                    </div>
                                    <div className="text-[9px] tc-text-muted font-mono truncate">
                                        {p.publicKey ? `${p.publicKey.slice(0, 8)}…` : 'You'}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
