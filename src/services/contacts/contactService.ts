/**
 * Contact Service — Manage user contacts for Multi-Party Chat
 * Part 13: Phase 1
 *
 * Stores contacts in localStorage for offline-first operation.
 * Each contact has a verified Ed25519 public key.
 */

import type { Contact, ParticipantStatus } from '../../types/channelTypes';

// ─── Constants ───

const STORAGE_KEY = 'tc_contacts';

// ─── Demo Contacts ───

const DEMO_CONTACTS: Contact[] = [
    {
        id: 'alice_7f3b2c8e',
        name: 'Alice Chen',
        publicKey: '7f3b2c8e91d4506f8a2e3b1c9d0f5a6e7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2',
        email: 'alice@trustchain.ai',
        status: 'online',
        lastSeen: Date.now() - 120_000,
        verified: true,
        addedAt: Date.now() - 86_400_000 * 7,
    },
    {
        id: 'bob_e5f6a7b8',
        name: 'Bob Smith',
        publicKey: 'e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5',
        email: 'bob@trustchain.ai',
        status: 'away',
        lastSeen: Date.now() - 3_600_000,
        verified: true,
        addedAt: Date.now() - 86_400_000 * 3,
    },
    {
        id: 'carol_a1b2c3d4',
        name: 'Carol Wang',
        publicKey: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1',
        email: 'carol@trustchain.ai',
        status: 'offline',
        lastSeen: Date.now() - 86_400_000,
        verified: true,
        addedAt: Date.now() - 86_400_000 * 14,
    },
];

// ─── Service ───

class ContactService {
    private contacts: Map<string, Contact> = new Map();
    private changeListeners: Set<() => void> = new Set();

    constructor() {
        this.load();
    }

    // ─── CRUD ───

    /** Get all contacts sorted by name */
    getAll(): Contact[] {
        return Array.from(this.contacts.values())
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    /** Get contacts sorted by status (online first) then name */
    getAllSorted(): Contact[] {
        const statusOrder: Record<ParticipantStatus, number> = {
            online: 0,
            away: 1,
            offline: 2,
        };
        return Array.from(this.contacts.values())
            .sort((a, b) => {
                const sa = statusOrder[a.status] ?? 2;
                const sb = statusOrder[b.status] ?? 2;
                if (sa !== sb) return sa - sb;
                return a.name.localeCompare(b.name);
            });
    }

    /** Get a contact by ID */
    get(id: string): Contact | undefined {
        return this.contacts.get(id);
    }

    /** Find contact by public key */
    findByPublicKey(publicKey: string): Contact | undefined {
        return Array.from(this.contacts.values()).find(c => c.publicKey === publicKey);
    }

    /** Add a new contact */
    add(contact: Omit<Contact, 'addedAt'> & { addedAt?: number }): Contact {
        const full: Contact = {
            ...contact,
            addedAt: contact.addedAt ?? Date.now(),
        };
        this.contacts.set(full.id, full);
        this.save();
        this.notify();
        return full;
    }

    /** Add contact from shareable key string (tc:ed25519:hex) */
    addFromShareableKey(shareableKey: string, name: string): Contact | null {
        const match = shareableKey.match(/^tc:(\w+):([0-9a-f]+)$/i);
        if (!match) return null;
        const publicKey = match[2];
        const id = publicKey.slice(0, 16);

        // Check if already exists
        if (this.contacts.has(id)) {
            return this.contacts.get(id)!;
        }

        return this.add({
            id,
            name,
            publicKey,
            status: 'offline',
            verified: false,
        });
    }

    /** Update a contact */
    update(id: string, updates: Partial<Omit<Contact, 'id' | 'publicKey'>>): boolean {
        const existing = this.contacts.get(id);
        if (!existing) return false;
        Object.assign(existing, updates);
        this.save();
        this.notify();
        return true;
    }

    /** Remove a contact */
    remove(id: string): boolean {
        const deleted = this.contacts.delete(id);
        if (deleted) {
            this.save();
            this.notify();
        }
        return deleted;
    }

    /** Update presence status of a contact */
    updateStatus(id: string, status: ParticipantStatus): void {
        const contact = this.contacts.get(id);
        if (contact) {
            contact.status = status;
            if (status !== 'offline') contact.lastSeen = Date.now();
            this.save();
            this.notify();
        }
    }

    // ─── Search ───

    /** Search contacts by name or email */
    search(query: string): Contact[] {
        if (!query.trim()) return this.getAllSorted();
        const q = query.toLowerCase();
        return this.getAllSorted().filter(c =>
            c.name.toLowerCase().includes(q) ||
            (c.email && c.email.toLowerCase().includes(q))
        );
    }

    // ─── Stats ───

    get count(): number {
        return this.contacts.size;
    }

    get onlineCount(): number {
        return Array.from(this.contacts.values()).filter(c => c.status === 'online').length;
    }

    // ─── Change listeners ───

    onChange(listener: () => void): () => void {
        this.changeListeners.add(listener);
        return () => this.changeListeners.delete(listener);
    }

    private notify(): void {
        for (const cb of this.changeListeners) {
            try { cb(); } catch (e) { console.error('[Contacts] Listener error:', e); }
        }
    }

    // ─── Persistence ───

    private save(): void {
        try {
            const data = Array.from(this.contacts.values());
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch { /* quota exceeded */ }
    }

    private load(): void {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const data: Contact[] = JSON.parse(raw);
                for (const c of data) {
                    this.contacts.set(c.id, c);
                }
            } else {
                // Load demo contacts on first run
                for (const c of DEMO_CONTACTS) {
                    this.contacts.set(c.id, c);
                }
                this.save();
            }
        } catch {
            // Corrupt data — reload demo
            for (const c of DEMO_CONTACTS) {
                this.contacts.set(c.id, c);
            }
            this.save();
        }
    }
}

// ─── Singleton ───

export const contactService = new ContactService();
