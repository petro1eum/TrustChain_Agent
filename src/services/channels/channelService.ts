/**
 * Channel Service — Manage multi-party chat channels
 * Part 13: Phase 2
 *
 * Handles channel lifecycle, message sending/receiving,
 * signing via identityService, and localStorage persistence.
 * WebSocket transport will be added in Phase 4.
 */

import type {
    Channel, ChannelType, ChannelMessage, Participant, ChannelRole,
} from '../../types/channelTypes';
import { identityService } from '../identity/identityService';
import { contactService } from '../contacts/contactService';
import type { Contact } from '../../types/channelTypes';

// ─── Constants ───

const STORAGE_KEY_CHANNELS = 'tc_channels';
const STORAGE_KEY_MESSAGES = 'tc_channel_messages';

// ─── Demo Data ───

function createDemoChannels(userId: string): Channel[] {
    const now = Date.now();
    return [
        {
            id: 'ch_agent_default',
            type: 'agent',
            name: 'TrustChain Agent',
            participants: [
                { id: userId, type: 'user', name: 'You', publicKey: '', status: 'online', role: 'owner' },
                { id: 'tc_agent_001', type: 'agent', name: 'TrustChain Agent', publicKey: 'agent_key_001', status: 'online', role: 'member', certificate: 'x509_tc_agent' },
            ],
            createdBy: userId,
            createdAt: now - 86_400_000,
            lastMessageAt: now - 120_000,
            lastMessagePreview: 'Audit complete. 3 issues found.',
            lastMessageSender: 'TrustChain Agent',
            unreadCount: 0,
            encrypted: false,
            trustScore: 100,
        },
        {
            id: 'ch_dm_alice',
            type: 'dm',
            name: 'Alice Chen',
            participants: [
                { id: userId, type: 'user', name: 'You', publicKey: '', status: 'online', role: 'owner' },
                { id: 'alice_7f3b2c8e', type: 'user', name: 'Alice Chen', publicKey: '7f3b2c8e91d4506f8a2e3b1c9d0f5a6e7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2', status: 'online', role: 'member' },
            ],
            createdBy: userId,
            createdAt: now - 86_400_000 * 2,
            lastMessageAt: now - 900_000,
            lastMessagePreview: 'I found 3 issues in the auth module 🛡️',
            lastMessageSender: 'Alice Chen',
            unreadCount: 2,
            encrypted: true,
            trustScore: 100,
        },
        {
            id: 'ch_group_alpha',
            type: 'group',
            name: 'Project Alpha',
            description: 'Security audit coordination',
            participants: [
                { id: userId, type: 'user', name: 'You', publicKey: '', status: 'online', role: 'owner' },
                { id: 'alice_7f3b2c8e', type: 'user', name: 'Alice Chen', publicKey: '7f3b2c8e91d4506f8a2e3b1c9d0f5a6e7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2', status: 'online', role: 'member' },
                { id: 'bob_e5f6a7b8', type: 'user', name: 'Bob Smith', publicKey: 'e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5', status: 'away', role: 'member' },
                { id: 'tc_agent_002', type: 'agent', name: 'Code Reviewer', publicKey: 'agent_key_002', status: 'online', role: 'member', certificate: 'x509_code_reviewer' },
            ],
            createdBy: userId,
            createdAt: now - 86_400_000 * 5,
            lastMessageAt: now - 3_600_000,
            lastMessagePreview: 'Reviewed PR #42 — approved with comments',
            lastMessageSender: 'Code Reviewer',
            unreadCount: 5,
            encrypted: true,
            trustScore: 98,
        },
    ];
}

function createDemoMessages(): Record<string, ChannelMessage[]> {
    const now = Date.now();
    return {
        ch_dm_alice: [
            {
                id: 'msg_a1', channelId: 'ch_dm_alice',
                senderId: 'alice_7f3b2c8e', senderType: 'user', senderName: 'Alice Chen',
                content: 'Hey! I finished the security review of the auth module.',
                timestamp: now - 1_800_000, signature: 'sig_alice_1', verified: true, encrypted: true,
            },
            {
                id: 'msg_a2', channelId: 'ch_dm_alice',
                senderId: 'alice_7f3b2c8e', senderType: 'user', senderName: 'Alice Chen',
                content: 'I found 3 issues in the auth module 🛡️\n\n1. JWT expiry not checked on refresh\n2. CSRF token missing on password reset\n3. Rate limiting bypass via X-Forwarded-For',
                timestamp: now - 900_000, signature: 'sig_alice_2', verified: true, encrypted: true,
            },
        ],
        ch_group_alpha: [
            {
                id: 'msg_g1', channelId: 'ch_group_alpha',
                senderId: 'bob_e5f6a7b8', senderType: 'user', senderName: 'Bob Smith',
                content: 'Team, I pushed the new auth middleware to staging.',
                timestamp: now - 7_200_000, signature: 'sig_bob_1', verified: true, encrypted: true,
            },
            {
                id: 'msg_g2', channelId: 'ch_group_alpha',
                senderId: 'alice_7f3b2c8e', senderType: 'user', senderName: 'Alice Chen',
                content: 'Nice! I\'ll run the penetration tests against it this afternoon.',
                timestamp: now - 5_400_000, signature: 'sig_alice_g1', verified: true, encrypted: true,
            },
            {
                id: 'msg_g3', channelId: 'ch_group_alpha',
                senderId: 'tc_agent_002', senderType: 'agent', senderName: 'Code Reviewer',
                content: 'Reviewed PR #42 — approved with comments.\n\n**Summary:**\n- Auth middleware properly validates JWT tokens ✅\n- Added rate limiting for login endpoint ✅\n- Suggestion: Consider adding HSTS headers for the API endpoints.\n\n🛡️ *TrustChain signed: 8 operations verified*',
                timestamp: now - 3_600_000, signature: 'sig_agent_g1', verified: true, encrypted: false,
                executionSteps: [
                    { id: 'es1', type: 'tool', label: 'code_review', result: '3 files analyzed' },
                    { id: 'es2', type: 'tool', label: 'security_scan', result: '0 vulnerabilities found' },
                ],
            },
        ],
        ch_agent_default: [
            {
                id: 'msg_ag1', channelId: 'ch_agent_default',
                senderId: 'tc_agent_001', senderType: 'agent', senderName: 'TrustChain Agent',
                content: 'Welcome! I\'m your TrustChain Agent. Every response I provide is cryptographically signed.\n\nHow can I help you today?',
                timestamp: now - 86_400_000, signature: 'sig_agent_welcome', verified: true,
            },
        ],
    };
}

// ─── Service ───

class ChannelService {
    private channels: Map<string, Channel> = new Map();
    private messages: Map<string, ChannelMessage[]> = new Map();
    private changeListeners: Set<() => void> = new Set();
    private _initialized = false;

    // ─── Init ───

    async init(): Promise<void> {
        if (this._initialized) return;
        this._initialized = true;

        await identityService.init();
        const userId = identityService.getUserId();

        // Try to load from storage
        const loaded = this.load();
        if (!loaded) {
            // Initialize with demo data
            const demoChannels = createDemoChannels(userId);
            for (const ch of demoChannels) {
                this.channels.set(ch.id, ch);
            }
            const demoMessages = createDemoMessages();
            for (const [chId, msgs] of Object.entries(demoMessages)) {
                this.messages.set(chId, msgs);
            }
            this.save();
        }
    }

    // ─── Channel CRUD ───

    /** Get all channels sorted by last message time */
    getChannels(): Channel[] {
        return Array.from(this.channels.values())
            .filter(ch => !ch.archived)
            .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    }

    /** Get channels by type */
    getChannelsByType(type: ChannelType): Channel[] {
        return this.getChannels().filter(ch => ch.type === type);
    }

    /** Get a single channel */
    getChannel(id: string): Channel | undefined {
        return this.channels.get(id);
    }

    /** Create a new channel */
    async createChannel(
        type: ChannelType,
        name: string,
        participantContacts: Contact[] = [],
        description?: string,
    ): Promise<Channel> {
        await this.init();
        const userId = identityService.getUserId();
        const displayName = identityService.getDisplayName();
        const publicKey = identityService.getPublicKeyHex();

        const participants: Participant[] = [
            { id: userId, type: 'user', name: displayName, publicKey, status: 'online', role: 'owner' as ChannelRole },
            ...participantContacts.map(c => ({
                id: c.id,
                type: 'user' as const,
                name: c.name,
                publicKey: c.publicKey,
                status: c.status,
                role: 'member' as ChannelRole,
            })),
        ];

        // For agent chats, add a default agent
        if (type === 'agent') {
            participants.push({
                id: 'tc_agent_' + Date.now().toString(36),
                type: 'agent',
                name: name || 'TrustChain Agent',
                publicKey: 'agent_key_' + Date.now().toString(36),
                status: 'online',
                role: 'member',
                certificate: 'x509_' + Date.now().toString(36),
            });
        }

        const channel: Channel = {
            id: 'ch_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
            type,
            name: type === 'dm' && participantContacts.length === 1 ? participantContacts[0].name : name,
            description,
            participants,
            createdBy: userId,
            createdAt: Date.now(),
            lastMessageAt: Date.now(),
            lastMessagePreview: '',
            unreadCount: 0,
            encrypted: type === 'dm' || type === 'group',
            trustScore: 100,
        };

        this.channels.set(channel.id, channel);
        this.messages.set(channel.id, []);
        this.save();
        this.notify();
        return channel;
    }

    /** Delete a channel */
    deleteChannel(id: string): boolean {
        const deleted = this.channels.delete(id);
        if (deleted) {
            this.messages.delete(id);
            this.save();
            this.notify();
        }
        return deleted;
    }

    // ─── Messages ───

    /** Get messages for a channel */
    getMessages(channelId: string): ChannelMessage[] {
        return this.messages.get(channelId) || [];
    }

    /** Send a message (signs with identityService) */
    async sendMessage(channelId: string, content: string): Promise<ChannelMessage> {
        await this.init();
        const channel = this.channels.get(channelId);
        if (!channel) throw new Error(`Channel ${channelId} not found`);

        const userId = identityService.getUserId();
        const displayName = identityService.getDisplayName();
        const timestamp = Date.now();
        const signature = await identityService.signMessage(channelId, content, timestamp);

        const msg: ChannelMessage = {
            id: 'msg_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
            channelId,
            senderId: userId,
            senderType: 'user',
            senderName: displayName,
            content,
            timestamp,
            signature,
            verified: true,
            encrypted: channel.encrypted,
        };

        const msgs = this.messages.get(channelId) || [];
        msgs.push(msg);
        this.messages.set(channelId, msgs);

        // Update channel metadata
        channel.lastMessageAt = timestamp;
        channel.lastMessagePreview = content.slice(0, 80);
        channel.lastMessageSender = displayName;

        this.save();
        this.notify();
        return msg;
    }

    /** Add an external message (received from another participant) */
    addExternalMessage(msg: ChannelMessage): void {
        const msgs = this.messages.get(msg.channelId) || [];
        msgs.push(msg);
        this.messages.set(msg.channelId, msgs);

        const channel = this.channels.get(msg.channelId);
        if (channel) {
            channel.lastMessageAt = msg.timestamp;
            channel.lastMessagePreview = msg.content.slice(0, 80);
            channel.lastMessageSender = msg.senderName;
            channel.unreadCount += 1;
        }

        this.save();
        this.notify();
    }

    /** Mark channel as read */
    markRead(channelId: string): void {
        const ch = this.channels.get(channelId);
        if (ch && ch.unreadCount > 0) {
            ch.unreadCount = 0;
            this.save();
            this.notify();
        }
    }

    // ─── Participants ───

    /** Add participant to a channel */
    addParticipant(channelId: string, contact: Contact, role: ChannelRole = 'member'): boolean {
        const ch = this.channels.get(channelId);
        if (!ch) return false;
        if (ch.participants.some(p => p.id === contact.id)) return false;

        ch.participants.push({
            id: contact.id,
            type: 'user',
            name: contact.name,
            publicKey: contact.publicKey,
            status: contact.status,
            role,
        });
        this.save();
        this.notify();
        return true;
    }

    /** Remove participant from a channel */
    removeParticipant(channelId: string, participantId: string): boolean {
        const ch = this.channels.get(channelId);
        if (!ch) return false;
        const idx = ch.participants.findIndex(p => p.id === participantId);
        if (idx === -1) return false;
        ch.participants.splice(idx, 1);
        this.save();
        this.notify();
        return true;
    }

    // ─── Change Listening ───

    onChange(listener: () => void): () => void {
        this.changeListeners.add(listener);
        return () => this.changeListeners.delete(listener);
    }

    private notify(): void {
        for (const cb of this.changeListeners) {
            try { cb(); } catch (e) { console.error('[Channels] Listener error:', e); }
        }
    }

    // ─── Persistence ───

    private save(): void {
        try {
            const channels = Array.from(this.channels.values());
            localStorage.setItem(STORAGE_KEY_CHANNELS, JSON.stringify(channels));

            const msgs: Record<string, ChannelMessage[]> = {};
            for (const [k, v] of this.messages.entries()) {
                msgs[k] = v;
            }
            localStorage.setItem(STORAGE_KEY_MESSAGES, JSON.stringify(msgs));
        } catch { /* quota */ }
    }

    private load(): boolean {
        try {
            const chRaw = localStorage.getItem(STORAGE_KEY_CHANNELS);
            if (!chRaw) return false;
            const channels: Channel[] = JSON.parse(chRaw);
            for (const ch of channels) this.channels.set(ch.id, ch);

            const msgRaw = localStorage.getItem(STORAGE_KEY_MESSAGES);
            if (msgRaw) {
                const msgs: Record<string, ChannelMessage[]> = JSON.parse(msgRaw);
                for (const [k, v] of Object.entries(msgs)) this.messages.set(k, v);
            }
            return true;
        } catch {
            return false;
        }
    }
}

// ─── Singleton ───

export const channelService = new ChannelService();
