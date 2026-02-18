/**
 * ChannelList — Sidebar list of multi-party chat channels
 * Part 13: Phase 2
 *
 * Replaces/augments the existing conversation list in ChatSidebar
 * when the "Chats" tab is active. Shows channels grouped by type
 * with unread badges and type-specific icons.
 */

import React, { useState, useEffect } from 'react';
import {
    Bot, User, Users, Hash, Lock, Shield, ChevronDown,
    MessageSquare, Plus,
} from 'lucide-react';
import { channelService } from '../../services/channels/channelService';
import { contactService } from '../../services/contacts/contactService';
import type { Channel, ChannelType, Contact } from '../../types/channelTypes';

// ─── Icons per channel type ───

const TYPE_ICON: Record<ChannelType, React.ReactNode> = {
    agent: <Bot size={14} className="text-purple-500" />,
    dm: <User size={14} className="text-blue-500" />,
    group: <Users size={14} className="text-emerald-500" />,
    swarm: <Bot size={14} className="text-amber-500" />,
};

const TYPE_LABEL: Record<ChannelType, string> = {
    agent: 'Agent Chat',
    dm: 'Direct Message',
    group: 'Group Channel',
    swarm: 'Agent Swarm',
};

// ─── Relative time helper ───

function relativeTime(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 60_000) return 'now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
    return `${Math.floor(diff / 86_400_000)}d`;
}

// ─── Props ───

interface ChannelListProps {
    activeChannelId: string | null;
    onSelectChannel: (channelId: string) => void;
    searchQuery: string;
}

// ─── Component ───

export const ChannelList: React.FC<ChannelListProps> = ({
    activeChannelId, onSelectChannel, searchQuery,
}) => {
    const [channels, setChannels] = useState<Channel[]>([]);
    const [showNewMenu, setShowNewMenu] = useState(false);
    const [showCreateGroup, setShowCreateGroup] = useState(false);
    const [groupName, setGroupName] = useState('');
    const [selectedContacts, setSelectedContacts] = useState<string[]>([]);

    useEffect(() => {
        channelService.init().then(() => {
            setChannels(channelService.getChannels());
        });
        const unsub = channelService.onChange(() => {
            setChannels(channelService.getChannels());
        });
        return unsub;
    }, []);

    // Filter by search
    const filtered = searchQuery
        ? channels.filter(ch =>
            ch.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            ch.lastMessagePreview.toLowerCase().includes(searchQuery.toLowerCase())
        )
        : channels;

    // ── Create channel handlers ──

    const handleCreateAgent = async () => {
        const ch = await channelService.createChannel('agent', 'New Agent Chat');
        onSelectChannel(ch.id);
        setShowNewMenu(false);
    };

    const handleCreateDM = async (contact: Contact) => {
        const ch = await channelService.createChannel('dm', contact.name, [contact]);
        onSelectChannel(ch.id);
        setShowNewMenu(false);
    };

    const handleCreateGroup = async () => {
        if (!groupName.trim()) return;
        const contacts = selectedContacts
            .map(id => contactService.get(id))
            .filter(Boolean) as Contact[];
        const ch = await channelService.createChannel('group', groupName, contacts);
        onSelectChannel(ch.id);
        setShowCreateGroup(false);
        setGroupName('');
        setSelectedContacts([]);
        setShowNewMenu(false);
    };

    const contacts = contactService.getAllSorted();

    return (
        <div className="space-y-1 px-1">
            {/* ── New Channel Menu ── */}
            {showNewMenu && (
                <div className="tc-surface border tc-border-light rounded-xl overflow-hidden mb-2 shadow-lg">
                    {/* Agent Chat */}
                    <button
                        onClick={handleCreateAgent}
                        className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-white/5 transition-colors text-left"
                    >
                        <Bot size={14} className="text-purple-500" />
                        <div>
                            <div className="text-[11px] tc-text font-medium">Agent Chat</div>
                            <div className="text-[9px] tc-text-muted">Chat with TrustChain Agent</div>
                        </div>
                    </button>

                    {/* Direct Messages */}
                    {contacts.length > 0 && (
                        <>
                            <div className="px-3 pt-2 pb-1 border-t tc-border-light">
                                <span className="text-[9px] font-semibold tc-text-muted uppercase tracking-wider">Direct Message</span>
                            </div>
                            {contacts.slice(0, 5).map(c => (
                                <button
                                    key={c.id}
                                    onClick={() => handleCreateDM(c)}
                                    className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 transition-colors text-left"
                                >
                                    <div className="w-5 h-5 rounded-md bg-gradient-to-br from-gray-400 to-gray-500 flex items-center justify-center text-white text-[8px] font-bold">
                                        {c.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                                    </div>
                                    <span className="text-[11px] tc-text">{c.name}</span>
                                </button>
                            ))}
                        </>
                    )}

                    {/* Group Channel */}
                    <button
                        onClick={() => { setShowCreateGroup(true); setShowNewMenu(false); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 border-t tc-border-light hover:bg-white/5 transition-colors text-left"
                    >
                        <Users size={14} className="text-emerald-500" />
                        <div>
                            <div className="text-[11px] tc-text font-medium">Group Channel</div>
                            <div className="text-[9px] tc-text-muted">Chat with multiple participants</div>
                        </div>
                    </button>
                </div>
            )}

            {/* ── Create Group Form ── */}
            {showCreateGroup && (
                <div className="tc-surface border tc-border-light rounded-xl p-2.5 mb-2 space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold tc-text uppercase tracking-wider">New Group</span>
                        <button onClick={() => setShowCreateGroup(false)} className="text-[10px] tc-text-muted hover:tc-text">✕</button>
                    </div>
                    <input
                        value={groupName}
                        onChange={e => setGroupName(e.target.value)}
                        placeholder="Group name"
                        className="w-full px-2 py-1.5 text-[11px] tc-surface border tc-border-light rounded-lg tc-text placeholder:tc-text-muted focus:outline-none focus:ring-1 focus:ring-blue-500/30"
                    />
                    <div className="space-y-0.5">
                        {contacts.map(c => (
                            <label key={c.id} className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-white/5 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={selectedContacts.includes(c.id)}
                                    onChange={e => {
                                        setSelectedContacts(
                                            e.target.checked
                                                ? [...selectedContacts, c.id]
                                                : selectedContacts.filter(id => id !== c.id)
                                        );
                                    }}
                                    className="rounded"
                                />
                                <span className="text-[11px] tc-text">{c.name}</span>
                            </label>
                        ))}
                    </div>
                    <button
                        onClick={handleCreateGroup}
                        disabled={!groupName.trim()}
                        className="w-full py-1.5 text-[11px] font-medium rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                        Create Group
                    </button>
                </div>
            )}

            {/* ── Channel List ── */}
            {filtered.length === 0 ? (
                <div className="text-center py-6">
                    <MessageSquare size={20} className="mx-auto tc-text-muted opacity-40 mb-1.5" />
                    <div className="text-[11px] tc-text-muted">
                        {searchQuery ? 'No channels found' : 'No channels yet'}
                    </div>
                </div>
            ) : (
                <div className="space-y-0.5">
                    {filtered.map(channel => (
                        <button
                            key={channel.id}
                            onClick={() => {
                                onSelectChannel(channel.id);
                                channelService.markRead(channel.id);
                            }}
                            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left transition-all
                                ${activeChannelId === channel.id
                                    ? 'tc-tab-active shadow-sm'
                                    : 'hover:bg-white/5'
                                }`}
                        >
                            {/* Type icon */}
                            <div className="relative shrink-0">
                                <div className={`w-9 h-9 rounded-xl flex items-center justify-center
                                    ${channel.type === 'agent' ? 'bg-purple-500/10' :
                                        channel.type === 'dm' ? 'bg-blue-500/10' :
                                            channel.type === 'group' ? 'bg-emerald-500/10' :
                                                'bg-amber-500/10'}`}>
                                    {TYPE_ICON[channel.type]}
                                </div>
                                {channel.encrypted && (
                                    <Lock size={7} className="absolute -top-0.5 -right-0.5 text-emerald-500" />
                                )}
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-1">
                                    <span className="text-[12px] tc-text font-medium truncate">{channel.name}</span>
                                    <span className="text-[9px] tc-text-muted shrink-0">{relativeTime(channel.lastMessageAt)}</span>
                                </div>
                                <div className="flex items-center justify-between gap-1 mt-0.5">
                                    <span className="text-[10px] tc-text-muted truncate">
                                        {channel.lastMessageSender && (
                                            <span className="font-medium">{channel.lastMessageSender}: </span>
                                        )}
                                        {channel.lastMessagePreview || 'No messages yet'}
                                    </span>
                                    {channel.unreadCount > 0 && (
                                        <span className="shrink-0 w-4.5 h-4.5 min-w-[18px] rounded-full bg-blue-500 text-white text-[9px] font-bold flex items-center justify-center">
                                            {channel.unreadCount}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {/* ── New Channel Toggle Button ── */}
            <button
                onClick={() => setShowNewMenu(!showNewMenu)}
                className="w-full flex items-center justify-center gap-1.5 py-2 mt-1 text-[11px] font-medium text-blue-500 hover:text-blue-400 rounded-xl tc-surface-hover border tc-border-light transition-colors"
            >
                <Plus size={12} /> New Channel
            </button>
        </div>
    );
};
