/**
 * PeopleTab — Contacts list for multi-party chat
 * Part 13: Phase 1
 *
 * Shows user identity, contact list with online status,
 * public keys, and add/remove contacts.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
    User, UserPlus, Copy, Check, Shield, Search,
    MoreVertical, Trash2, MessageSquare, X, ExternalLink,
} from 'lucide-react';
import { contactService } from '../../services/contacts/contactService';
import { identityService } from '../../services/identity/identityService';
import type { Contact, IdentityInfo } from '../../types/channelTypes';

// ─── Status dot colors ───

const STATUS_COLORS: Record<string, string> = {
    online: 'bg-emerald-500',
    away: 'bg-amber-500',
    offline: 'bg-gray-400',
};

const STATUS_LABELS: Record<string, string> = {
    online: 'Online',
    away: 'Away',
    offline: 'Offline',
};

// ─── Relative time (concise) ───

function relativeTime(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 60_000) return 'now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
    return `${Math.floor(diff / 86_400_000)}d`;
}

// ─── Props ───

interface PeopleTabProps {
    /** Callback when user clicks "Message" on a contact */
    onStartDM?: (contact: Contact) => void;
}

// ─── Component ───

export const PeopleTab: React.FC<PeopleTabProps> = ({ onStartDM }) => {
    const [identity, setIdentity] = useState<IdentityInfo | null>(null);
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [showAddForm, setShowAddForm] = useState(false);
    const [newName, setNewName] = useState('');
    const [newKey, setNewKey] = useState('');
    const [copiedKey, setCopiedKey] = useState(false);
    const [expandedContact, setExpandedContact] = useState<string | null>(null);
    const [editingName, setEditingName] = useState(false);
    const [nameInput, setNameInput] = useState('');

    // ── Initialize identity + load contacts ──
    useEffect(() => {
        identityService.getIdentity().then(setIdentity);
        setContacts(contactService.getAllSorted());

        const unsub = contactService.onChange(() => {
            setContacts(contactService.getAllSorted());
        });
        return unsub;
    }, []);

    // ── Filtered contacts ──
    const filteredContacts = searchQuery
        ? contactService.search(searchQuery)
        : contacts;

    // ── Copy public key ──
    const handleCopyKey = useCallback(async () => {
        if (!identity) return;
        await navigator.clipboard.writeText(identityService.getShareableKey());
        setCopiedKey(true);
        setTimeout(() => setCopiedKey(false), 2000);
    }, [identity]);

    // ── Add contact ──
    const handleAddContact = useCallback(() => {
        if (!newName.trim() || !newKey.trim()) return;
        const contact = contactService.addFromShareableKey(newKey.trim(), newName.trim());
        if (!contact) {
            // Try as raw hex
            contactService.add({
                id: newKey.slice(0, 16),
                name: newName.trim(),
                publicKey: newKey.trim(),
                status: 'offline',
                verified: false,
            });
        }
        setNewName('');
        setNewKey('');
        setShowAddForm(false);
    }, [newName, newKey]);

    // ── Remove contact ──
    const handleRemoveContact = useCallback((id: string) => {
        contactService.remove(id);
        if (expandedContact === id) setExpandedContact(null);
    }, [expandedContact]);

    // ── Save display name ──
    const handleSaveName = useCallback(() => {
        if (nameInput.trim()) {
            identityService.setDisplayName(nameInput.trim());
            identityService.getIdentity().then(setIdentity);
        }
        setEditingName(false);
    }, [nameInput]);

    return (
        <div className="space-y-2 px-1">
            {/* ── My Identity ── */}
            <div className="tc-surface border tc-border-light rounded-xl p-2.5">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-semibold tc-text-muted uppercase tracking-wider">Your Identity</span>
                    <div className={`w-2 h-2 rounded-full ${STATUS_COLORS.online}`} />
                </div>

                {identity ? (
                    <div className="space-y-1.5">
                        {/* Name */}
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-white text-[11px] font-bold shrink-0">
                                {identity.displayName.slice(0, 2).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                                {editingName ? (
                                    <div className="flex items-center gap-1">
                                        <input
                                            value={nameInput}
                                            onChange={e => setNameInput(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && handleSaveName()}
                                            className="flex-1 px-1.5 py-0.5 text-[11px] tc-surface border tc-border-light rounded tc-text focus:outline-none focus:ring-1 focus:ring-blue-500/30"
                                            autoFocus
                                        />
                                        <button onClick={handleSaveName} className="text-emerald-500 hover:text-emerald-400">
                                            <Check size={12} />
                                        </button>
                                        <button onClick={() => setEditingName(false)} className="tc-text-muted hover:tc-text">
                                            <X size={12} />
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => { setEditingName(true); setNameInput(identity.displayName); }}
                                        className="text-[12px] tc-text font-medium hover:text-blue-500 transition-colors text-left"
                                    >
                                        {identity.displayName}
                                    </button>
                                )}
                                <div className="text-[9px] tc-text-muted font-mono">
                                    {identity.publicKey.slice(0, 8)}…{identity.publicKey.slice(-4)}
                                </div>
                            </div>
                        </div>

                        {/* Copy public key */}
                        <button
                            onClick={handleCopyKey}
                            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium rounded-lg tc-surface-hover transition-colors text-blue-500 hover:text-blue-400"
                        >
                            {copiedKey ? <><Check size={11} /> Copied!</> : <><Copy size={11} /> Share Public Key</>}
                        </button>
                    </div>
                ) : (
                    <div className="text-[11px] tc-text-muted py-2 text-center animate-pulse">
                        Generating keypair…
                    </div>
                )}
            </div>

            {/* ── Search ── */}
            {contacts.length > 3 && (
                <div className="relative">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 tc-text-muted" />
                    <input
                        type="text"
                        placeholder="Search contacts…"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full tc-surface border tc-border-light rounded-lg pl-7 pr-2 py-1.5 text-[11px] tc-text placeholder:tc-text-muted focus:outline-none focus:ring-1 focus:ring-blue-500/30"
                    />
                </div>
            )}

            {/* ── Contacts List ── */}
            <div className="tc-surface border tc-border-light rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-2.5 py-2">
                    <span className="text-[10px] font-semibold tc-text-muted uppercase tracking-wider">
                        Contacts ({contacts.length})
                    </span>
                    <span className="text-[9px] tc-text-muted">
                        {contactService.onlineCount} online
                    </span>
                </div>

                {filteredContacts.length === 0 ? (
                    <div className="px-3 py-4 text-center">
                        <User size={20} className="mx-auto tc-text-muted mb-1.5 opacity-40" />
                        <div className="text-[11px] tc-text-muted">
                            {searchQuery ? 'No contacts found' : 'No contacts yet'}
                        </div>
                    </div>
                ) : (
                    <div className="divide-y tc-border-light">
                        {filteredContacts.map(contact => (
                            <div key={contact.id}>
                                <button
                                    onClick={() => setExpandedContact(
                                        expandedContact === contact.id ? null : contact.id
                                    )}
                                    className="w-full flex items-center gap-2 px-2.5 py-2 hover:bg-white/5 transition-colors text-left"
                                >
                                    {/* Avatar */}
                                    <div className="relative shrink-0">
                                        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-gray-400 to-gray-600 flex items-center justify-center text-white text-[10px] font-bold">
                                            {contact.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                                        </div>
                                        <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[var(--tc-surface)] ${STATUS_COLORS[contact.status]}`} />
                                    </div>

                                    {/* Name + status */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1">
                                            <span className="text-[11px] tc-text font-medium truncate">{contact.name}</span>
                                            {contact.verified && (
                                                <Shield size={9} className="text-emerald-500 shrink-0" />
                                            )}
                                        </div>
                                        <div className="text-[9px] tc-text-muted">
                                            {contact.status === 'online' ? 'Online' :
                                                contact.lastSeen ? `Last seen ${relativeTime(contact.lastSeen)} ago` :
                                                    STATUS_LABELS[contact.status]}
                                        </div>
                                    </div>
                                </button>

                                {/* Expanded details */}
                                {expandedContact === contact.id && (
                                    <div className="px-2.5 pb-2 space-y-1.5">
                                        {/* Public key */}
                                        <div className="flex items-center gap-1 py-1 px-2 rounded-md tc-surface">
                                            <span className="text-[9px] tc-text-muted">Key:</span>
                                            <span className="text-[9px] tc-text font-mono truncate flex-1">
                                                {contact.publicKey.slice(0, 12)}…{contact.publicKey.slice(-6)}
                                            </span>
                                            <button
                                                onClick={async () => {
                                                    await navigator.clipboard.writeText(contact.publicKey);
                                                }}
                                                className="p-0.5 rounded tc-surface-hover tc-text-muted hover:tc-text"
                                                title="Copy key"
                                            >
                                                <Copy size={9} />
                                            </button>
                                        </div>

                                        {/* Actions */}
                                        <div className="flex gap-1">
                                            {onStartDM && (
                                                <button
                                                    onClick={() => onStartDM(contact)}
                                                    className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] font-medium text-blue-500 hover:text-blue-400 rounded-lg tc-surface-hover transition-colors"
                                                >
                                                    <MessageSquare size={10} /> Message
                                                </button>
                                            )}
                                            <button
                                                onClick={() => handleRemoveContact(contact.id)}
                                                className="flex items-center justify-center gap-1 py-1.5 px-2 text-[10px] font-medium text-red-400 hover:text-red-500 rounded-lg tc-surface-hover transition-colors"
                                            >
                                                <Trash2 size={10} />
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ── Add Contact ── */}
            {showAddForm ? (
                <div className="tc-surface border tc-border-light rounded-xl p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold tc-text uppercase tracking-wider">Add Contact</span>
                        <button onClick={() => setShowAddForm(false)} className="p-0.5 rounded tc-surface-hover tc-text-muted">
                            <X size={10} />
                        </button>
                    </div>
                    <input
                        value={newName}
                        onChange={e => setNewName(e.target.value)}
                        placeholder="Display name"
                        className="w-full px-2 py-1.5 text-[11px] tc-surface border tc-border-light rounded-lg tc-text placeholder:tc-text-muted focus:outline-none focus:ring-1 focus:ring-blue-500/30"
                    />
                    <input
                        value={newKey}
                        onChange={e => setNewKey(e.target.value)}
                        placeholder="tc:ed25519:hex… or raw public key"
                        className="w-full px-2 py-1.5 text-[11px] tc-surface border tc-border-light rounded-lg tc-text font-mono placeholder:tc-text-muted focus:outline-none focus:ring-1 focus:ring-blue-500/30"
                    />
                    <button
                        onClick={handleAddContact}
                        disabled={!newName.trim() || !newKey.trim()}
                        className="w-full py-1.5 text-[11px] font-medium rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                        Add Contact
                    </button>
                </div>
            ) : (
                <button
                    onClick={() => setShowAddForm(true)}
                    className="w-full flex items-center justify-center gap-1.5 py-2 text-[11px] font-medium text-blue-500 hover:text-blue-400 rounded-xl tc-surface-hover border tc-border-light transition-colors"
                >
                    <UserPlus size={12} /> Add Contact
                </button>
            )}
        </div>
    );
};
