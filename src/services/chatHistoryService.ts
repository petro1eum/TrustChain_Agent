/**
 * Chat History Service — persistent conversation memory for TrustChain Agent
 * 
 * Ported from AI Studio's chatHistoryService pattern:
 * - Session lifecycle: startSession → addMessage → endSession
 * - localStorage persistence with automatic cleanup
 * - Cross-session search for ConversationMemoryService
 */

export interface ChatHistoryEntry {
    id: string;
    role: string;
    content: string;
    timestamp: string;  // ISO string for serialization
    // Extended fields for full message restoration
    executionSteps?: any[];
    tool_calls?: any[];
    signature?: string;
    verified?: boolean;
    artifactIds?: string[];
    thinking?: string;
}

export interface ChatSession {
    sessionId: string;
    title: string;
    startTime: string;
    endTime?: string;
    agentName: string;
    model: string;
    messages: ChatHistoryEntry[];
    messageCount: number;
}

const STORAGE_KEY = 'tc_chat_history';
const MAX_SESSIONS = 50;
const MAX_MESSAGES_PER_SESSION = 200;

export class ChatHistoryService {
    private currentSession: ChatSession | null = null;
    private changeListeners: Array<() => void> = [];

    constructor() {
        // Migrate old sessions that lack titles
        this.migrateTitles();
    }

    /** Retroactively populate titles for old sessions missing them */
    private migrateTitles(): void {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (!stored) return;
            const sessions: ChatSession[] = JSON.parse(stored);
            let changed = false;
            for (const session of sessions) {
                if (!session.title || session.title === 'New Chat') {
                    // Extract title from first user message
                    const firstUserMsg = session.messages?.find(m => m.role === 'user');
                    if (firstUserMsg?.content) {
                        const text = firstUserMsg.content.trim().slice(0, 60);
                        session.title = text + (firstUserMsg.content.length > 60 ? '…' : '');
                        changed = true;
                    } else {
                        // No user message — use date/time as title
                        const dt = new Date(session.startTime);
                        session.title = `Chat ${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                        changed = true;
                    }
                }
            }
            if (changed) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
            }
        } catch { /* ignore migration errors */ }
    }

    /** Register a listener called whenever sessions change */
    onSessionsChanged(listener: () => void): () => void {
        this.changeListeners.push(listener);
        return () => {
            this.changeListeners = this.changeListeners.filter(l => l !== listener);
        };
    }

    private notifyChange(): void {
        this.changeListeners.forEach(l => l());
    }

    // ── Session Lifecycle ──

    /** Start a new chat session (ends any existing one first) */
    startSession(agentName: string = 'TrustChain Agent', model: string = 'unknown'): string {
        if (this.currentSession) {
            this.endSession();
        }

        const sessionId = `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        this.currentSession = {
            sessionId,
            title: 'New Chat',
            startTime: new Date().toISOString(),
            agentName,
            model,
            messages: [],
            messageCount: 0
        };

        this.saveSession(this.currentSession);
        this.notifyChange();
        console.log(`💬 Chat: Started session ${sessionId}`);
        return sessionId;
    }

    /** Get the current active session */
    getCurrentSession(): ChatSession | null {
        return this.currentSession;
    }

    /** End the current session */
    endSession(): void {
        if (!this.currentSession) return;

        this.currentSession.endTime = new Date().toISOString();
        this.saveSession(this.currentSession);
        this.notifyChange();

        console.log(`💬 Chat: Ended session ${this.currentSession.sessionId} (${this.currentSession.messageCount} msgs)`);
        this.currentSession = null;
    }

    // ── Message Operations ──

    /** Add a message to the current session */
    addMessage(message: {
        role: string;
        content: string;
        timestamp?: Date;
        executionSteps?: any[];
        tool_calls?: any[];
        signature?: string;
        verified?: boolean;
        artifactIds?: string[];
        thinking?: string;
    }): void {
        if (!this.currentSession) {
            // Auto-start session if none exists
            this.startSession();
        }

        // Skip empty or temporary messages
        if (!message.content?.trim()) return;
        if (message.role === 'assistant_temp') return;

        const entry: ChatHistoryEntry = {
            id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            role: message.role,
            content: message.content,
            timestamp: (message.timestamp || new Date()).toISOString(),
            // Persist execution data
            ...(message.executionSteps?.length ? { executionSteps: message.executionSteps } : {}),
            ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
            ...(message.signature ? { signature: message.signature } : {}),
            ...(message.verified !== undefined ? { verified: message.verified } : {}),
            ...(message.artifactIds?.length ? { artifactIds: message.artifactIds } : {}),
            ...(message.thinking ? { thinking: message.thinking } : {}),
        };

        this.currentSession!.messages.push(entry);
        this.currentSession!.messageCount++;

        // Auto-title from first user message
        if (message.role === 'user' && this.currentSession!.title === 'New Chat') {
            const title = message.content.trim().slice(0, 60);
            this.currentSession!.title = title + (message.content.length > 60 ? '…' : '');
        }

        // Cap messages per session
        if (this.currentSession!.messages.length > MAX_MESSAGES_PER_SESSION) {
            this.currentSession!.messages = this.currentSession!.messages.slice(-MAX_MESSAGES_PER_SESSION);
        }

        this.saveSession(this.currentSession!);
        this.notifyChange();
    }

    // ── Query Operations ──

    /** Get all stored sessions */
    getAllSessions(): ChatSession[] {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            return stored ? JSON.parse(stored) : [];
        } catch (error) {
            console.error('Error reading chat history:', error);
            return [];
        }
    }

    /** Get recent sessions sorted by date */
    getRecentSessions(limit: number = 20): ChatSession[] {
        return this.getAllSessions()
            .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
            .slice(0, limit);
    }

    /** Search messages across all past sessions (excludes current session) */
    searchMessages(query: string): ChatHistoryEntry[] {
        const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        if (keywords.length === 0) return [];

        const sessions = this.getAllSessions();
        const results: ChatHistoryEntry[] = [];
        const currentSessionId = this.currentSession?.sessionId;

        for (const session of sessions) {
            // Skip current session — it's already in the LLM context
            if (session.sessionId === currentSessionId) continue;

            for (const msg of session.messages) {
                const contentLower = (msg.content || '').toLowerCase();
                if (keywords.some(kw => contentLower.includes(kw))) {
                    results.push(msg);
                }
            }
        }

        // Most recent first, limit to 10
        return results
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, 10);
    }

    // ── Utilities ──

    /** Get messages from the current session (for history passing) */
    getHistory(): ChatHistoryEntry[] {
        return this.currentSession ? [...this.currentSession.messages] : [];
    }

    /** Get last N messages from the current session */
    getRecent(count: number): ChatHistoryEntry[] {
        return this.currentSession ? this.currentSession.messages.slice(-count) : [];
    }

    /** Clear all stored history */
    clearAllHistory(): void {
        localStorage.removeItem(STORAGE_KEY);
        this.currentSession = null;
        this.notifyChange();
        console.log('💬 Chat: All history cleared');
    }

    /** Clear current session messages (keeps session alive) */
    clear(): void {
        if (this.currentSession) {
            this.currentSession.messages = [];
            this.currentSession.messageCount = 0;
            this.saveSession(this.currentSession);
        }
    }

    /** Update title of the current session */
    updateTitle(title: string): void {
        if (this.currentSession) {
            this.currentSession.title = title;
            this.saveSession(this.currentSession);
            this.notifyChange();
        }
    }

    /** Delete a session by ID */
    deleteSession(sessionId: string): void {
        const sessions = this.getAllSessions().filter(s => s.sessionId !== sessionId);
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
        } catch { /* ignore */ }
        if (this.currentSession?.sessionId === sessionId) {
            this.currentSession = null;
        }
        this.notifyChange();
        console.log(`💬 Chat: Deleted session ${sessionId}`);
    }

    /** Export a session as plain text */
    exportSession(sessionId: string): string {
        const sessions = this.getAllSessions();
        const session = sessions.find(s => s.sessionId === sessionId);
        if (!session) return '';
        const lines = [`# ${session.title}`, `Date: ${session.startTime}`, ''];
        for (const msg of session.messages) {
            const role = msg.role === 'user' ? 'User' : 'Agent';
            lines.push(`[${new Date(msg.timestamp).toLocaleString()}] ${role}:`);
            lines.push(msg.content);
            lines.push('');
        }
        return lines.join('\n');
    }

    // ── Persistence ──

    private saveSession(session: ChatSession): void {
        const sessions = this.getAllSessions();
        const index = sessions.findIndex(s => s.sessionId === session.sessionId);

        if (index >= 0) {
            sessions[index] = session;
        } else {
            sessions.push(session);
        }

        // Enforce max sessions — keep newest
        const trimmed = sessions
            .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
            .slice(0, MAX_SESSIONS);

        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
        } catch (error: any) {
            console.error('Error saving chat history:', error);
            if (error?.name === 'QuotaExceededError') {
                // Emergency cleanup: keep only half
                const half = Math.floor(trimmed.length / 2);
                try {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed.slice(0, half)));
                } catch { /* give up */ }
            }
        }
    }
}

// Singleton export
export const chatHistoryService = new ChatHistoryService();
