/**
 * Channel Types — Multi-Party Chat System
 * Part 13: User↔User, Agent↔Agent, Group Channels
 *
 * Every message in every channel type is a signed TrustChain record.
 */

// ─── Channel Types ───

export type ChannelType = 'agent' | 'dm' | 'group' | 'swarm';

export type ParticipantType = 'user' | 'agent';

export type ParticipantStatus = 'online' | 'away' | 'offline';

export type ChannelRole = 'owner' | 'admin' | 'member' | 'observer';

// ─── Participant ───

export interface Participant {
    /** Unique identifier (user DID or agent cert serial) */
    id: string;
    /** Human or bot */
    type: ParticipantType;
    /** Display name */
    name: string;
    /** Ed25519 public key (hex) */
    publicKey: string;
    /** Online status */
    status: ParticipantStatus;
    /** Avatar URL or initials fallback */
    avatar?: string;
    /** X.509 certificate serial (agents only) */
    certificate?: string;
    /** Role in channel */
    role: ChannelRole;
    /** Last seen timestamp */
    lastSeen?: number;
}

// ─── Channel ───

export interface Channel {
    /** Unique channel ID */
    id: string;
    /** Channel type */
    type: ChannelType;
    /** Display name (auto-generated for dm, user-set for group) */
    name: string;
    /** Channel description (groups/swarms) */
    description?: string;
    /** All participants */
    participants: Participant[];
    /** Creator ID */
    createdBy: string;
    /** Timestamps */
    createdAt: number;
    lastMessageAt: number;
    /** Last message preview (decrypted for display) */
    lastMessagePreview: string;
    /** Sender name for last message */
    lastMessageSender?: string;
    /** Unread messages */
    unreadCount: number;
    /** Whether channel uses E2E encryption (dm & group) */
    encrypted: boolean;
    /** Percentage of messages with valid signatures */
    trustScore: number;
    /** Pinned (user preference) */
    pinned?: boolean;
    /** Archived */
    archived?: boolean;
    /** Swarm task description (swarm type only) */
    swarmTask?: string;
}

// ─── Messages ───

export interface ChannelMessage {
    /** Unique message ID */
    id: string;
    /** Parent channel ID */
    channelId: string;
    /** Sender identifier */
    senderId: string;
    /** Sender type: user or agent */
    senderType: ParticipantType;
    /** Sender display name */
    senderName: string;
    /** Message content (plaintext; for E2E channels — decrypted) */
    content: string;
    /** Unix timestamp (ms) */
    timestamp: number;
    /** Ed25519 signature of (channelId + senderId + content + timestamp) */
    signature: string;
    /** Whether signature was verified by recipient */
    verified?: boolean;
    /** Whether this message was sent encrypted */
    encrypted?: boolean;
    /** Reply-to message ID */
    replyTo?: string;

    // ─── Agent-specific fields ───

    /** Agent execution steps (tool calls, planning, etc.) */
    executionSteps?: import('../ui/components/types').ExecutionStep[];
    /** Linked artifact IDs */
    artifactIds?: string[];
    /** Agent thinking/reasoning (collapsible) */
    thinking?: string;
    /** Tool calls made by agent */
    tool_calls?: import('../ui/components/types').ToolCall[];
}

// ─── Encryption Metadata ───

export interface EncryptedPayload {
    /** Base64 ciphertext */
    ciphertext: string;
    /** Base64 nonce (12 bytes for AES-256-GCM) */
    nonce: string;
    /** Sender's ephemeral public key (for forward secrecy) */
    ephemeralPublicKey?: string;
}

export interface GroupKeyInfo {
    /** Channel ID this key belongs to */
    channelId: string;
    /** Key version (incremented on member change) */
    version: number;
    /** Encrypted group key (per-participant) */
    wrappedKeys: Record<string, string>; // participantId → encrypted key
    /** When this key was created */
    createdAt: number;
}

// ─── Contact ───

export interface Contact {
    /** User ID */
    id: string;
    /** Display name */
    name: string;
    /** Ed25519 public key (hex) */
    publicKey: string;
    /** Email or identifier for search */
    email?: string;
    /** Online status */
    status: ParticipantStatus;
    /** Last seen */
    lastSeen?: number;
    /** Whether identity has been verified via TrustChain */
    verified: boolean;
    /** When contact was added */
    addedAt: number;
    /** User avatar URL */
    avatar?: string;
}

// ─── Events ───

export type ChannelEventType =
    | 'message'       // new message
    | 'typing'        // participant is typing
    | 'presence'      // participant status changed
    | 'member_join'   // new participant added
    | 'member_leave'  // participant left/removed
    | 'channel_update' // name/description changed
    | 'key_rotation';  // group key rotated

export interface ChannelEvent {
    type: ChannelEventType;
    channelId: string;
    timestamp: number;
    payload: unknown;
}

// ─── WebSocket Protocol ───

export interface WSMessage {
    /** Message type */
    type: 'subscribe' | 'unsubscribe' | 'message' | 'typing' | 'presence' | 'ack';
    /** Channel ID (if applicable) */
    channelId?: string;
    /** Message payload */
    payload?: unknown;
    /** Request ID for ack correlation */
    requestId?: string;
}

// ─── Service Interfaces ───

export interface IdentityInfo {
    /** User's unique ID (derived from public key) */
    userId: string;
    /** Display name */
    displayName: string;
    /** Ed25519 public key (hex) */
    publicKey: string;
    /** Whether keypair exists */
    initialized: boolean;
}
