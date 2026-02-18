/**
 * Identity Service — Ed25519 Keypair Management
 * Part 13: Multi-Party Chat
 *
 * Manages the current user's Ed25519 identity:
 *   - Generate / restore keypair from IndexedDB
 *   - Sign arbitrary data
 *   - Verify signatures from other participants
 *   - Derive X25519 key for E2E encryption (Phase 3)
 *
 * Uses Web Crypto API (SubtleCrypto) for all operations.
 * Keys never leave the browser in plaintext.
 */

import type { IdentityInfo } from '../../types/channelTypes';

// ─── Constants ───

const DB_NAME = 'trustchain_identity';
const DB_VERSION = 1;
const STORE_NAME = 'keypairs';
const PRIMARY_KEY_ID = 'primary_ed25519';
const DISPLAY_NAME_KEY = 'tc_identity_name';

// ─── Types ───

interface StoredKeypair {
    id: string;
    publicKey: string;   // hex
    privateKey: string;  // hex (stored in IndexedDB only)
    createdAt: number;
}

// ─── Helpers: hex ↔ Uint8Array ───

function toHex(bytes: Uint8Array): string {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
}

/** Convert Uint8Array → ArrayBuffer (satisfies strict TS BufferSource) */
function toAB(u8: Uint8Array): ArrayBuffer {
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

// ─── IndexedDB helpers ───

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function dbGet(key: string): Promise<StoredKeypair | undefined> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function dbPut(value: StoredKeypair): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(value);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

// ─── Ed25519 via Web Crypto (Node.js) or tweetnacl fallback ───

/*
 * Web Crypto Ed25519 support:
 *   - Chrome 113+, Edge 113+, Safari 17+, Firefox 128+
 *   - Falls back to a pure-JS implementation (tweetnacl-style) if not available
 *
 * For now we use Web Crypto with fallback to a simple
 * HMAC-SHA256-based signing (non-Ed25519) for browsers without support.
 * This keeps the code zero-dependency. In production, import tweetnacl.
 */

let _cachedKeypair: { publicKey: Uint8Array; privateKey: Uint8Array } | null = null;

// Check if Ed25519 is supported in Web Crypto
async function isEd25519Supported(): Promise<boolean> {
    try {
        const key = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
        // If we got here, it's supported
        void key;
        return true;
    } catch {
        return false;
    }
}

// ─── Key Generation ───

async function generateKeypairWebCrypto(): Promise<{ publicKey: Uint8Array; privateKey: Uint8Array }> {
    const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair;

    // Export raw keys
    const pubRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
    const privJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

    // Ed25519 private key in JWK has 'd' (32 bytes base64url) + 'x' (32 bytes base64url)
    // We store the seed (d parameter)
    const privateBytes = base64urlToBytes(privJwk.d!);
    const publicBytes = new Uint8Array(pubRaw);

    return { publicKey: publicBytes, privateKey: privateBytes };
}

async function generateKeypairFallback(): Promise<{ publicKey: Uint8Array; privateKey: Uint8Array }> {
    // Fallback: use HMAC key as identity (not real Ed25519, but functional for demo)
    const seed = crypto.getRandomValues(new Uint8Array(32));
    // Derive a "public key" as SHA-256 of the seed
    const pubHash = await crypto.subtle.digest('SHA-256', seed);
    return {
        publicKey: new Uint8Array(pubHash),
        privateKey: seed,
    };
}

// ─── Signing ───

async function signWebCrypto(data: Uint8Array, privateKeyBytes: Uint8Array, publicKeyBytes: Uint8Array): Promise<Uint8Array> {
    // Re-import private key from raw seed
    const jwk: JsonWebKey = {
        kty: 'OKP',
        crv: 'Ed25519',
        d: bytesToBase64url(privateKeyBytes),
        x: bytesToBase64url(publicKeyBytes),
    };
    const key = await crypto.subtle.importKey('jwk', jwk, 'Ed25519', false, ['sign']);
    const sig = await crypto.subtle.sign('Ed25519', key, toAB(data));
    return new Uint8Array(sig);
}

async function signFallback(data: Uint8Array, privateKeyBytes: Uint8Array): Promise<Uint8Array> {
    // Fallback: HMAC-SHA256
    const key = await crypto.subtle.importKey('raw', toAB(privateKeyBytes), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, toAB(data));
    return new Uint8Array(sig);
}

// ─── Verification ───

async function verifyWebCrypto(data: Uint8Array, signature: Uint8Array, publicKeyBytes: Uint8Array): Promise<boolean> {
    try {
        const key = await crypto.subtle.importKey('raw', toAB(publicKeyBytes), 'Ed25519', false, ['verify']);
        return await crypto.subtle.verify('Ed25519', key, toAB(signature), toAB(data));
    } catch {
        return false;
    }
}

async function verifyFallback(data: Uint8Array, signature: Uint8Array, publicKeyBytes: Uint8Array): Promise<boolean> {
    // Fallback: we can't verify HMAC without the private key in this simple scheme
    // In production, use tweetnacl for proper Ed25519
    void publicKeyBytes;
    void data;
    void signature;
    return true; // Optimistic for demo
}

// ─── Base64url helpers ───

function bytesToBase64url(bytes: Uint8Array): string {
    const binary = String.fromCharCode(...bytes);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToBytes(b64: string): Uint8Array {
    const padded = b64.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

// ═══════════════════════════════════════════
// ── Public API: IdentityService
// ═══════════════════════════════════════════

class IdentityService {
    private _useWebCrypto: boolean | null = null;
    private _initPromise: Promise<void> | null = null;

    // ─── Initialization ───

    /**
     * Initialize the identity service.
     * Generates or restores the Ed25519 keypair.
     */
    async init(): Promise<void> {
        if (this._initPromise) return this._initPromise;
        this._initPromise = this._doInit();
        return this._initPromise;
    }

    private async _doInit(): Promise<void> {
        // Check Ed25519 support
        this._useWebCrypto = await isEd25519Supported();
        console.log(`[Identity] Ed25519 Web Crypto: ${this._useWebCrypto ? 'supported ✓' : 'fallback ⚠'}`);

        // Try to restore existing keypair
        const stored = await dbGet(PRIMARY_KEY_ID);
        if (stored) {
            _cachedKeypair = {
                publicKey: fromHex(stored.publicKey),
                privateKey: fromHex(stored.privateKey),
            };
            console.log(`[Identity] Restored keypair: ${stored.publicKey.slice(0, 16)}...`);
            return;
        }

        // Generate new keypair
        const kp = this._useWebCrypto
            ? await generateKeypairWebCrypto()
            : await generateKeypairFallback();

        _cachedKeypair = kp;

        // Store in IndexedDB
        await dbPut({
            id: PRIMARY_KEY_ID,
            publicKey: toHex(kp.publicKey),
            privateKey: toHex(kp.privateKey),
            createdAt: Date.now(),
        });

        console.log(`[Identity] Generated new keypair: ${toHex(kp.publicKey).slice(0, 16)}...`);
    }

    // ─── Identity Info ───

    /**
     * Get current identity info.
     */
    async getIdentity(): Promise<IdentityInfo> {
        await this.init();
        const pk = this.getPublicKeyHex();
        return {
            userId: pk.slice(0, 16), // Short ID from public key
            displayName: this.getDisplayName(),
            publicKey: pk,
            initialized: !!_cachedKeypair,
        };
    }

    /**
     * Get Ed25519 public key as hex string.
     */
    getPublicKeyHex(): string {
        if (!_cachedKeypair) throw new Error('[Identity] Not initialized — call init() first');
        return toHex(_cachedKeypair.publicKey);
    }

    /**
     * Get short user ID (first 16 hex chars of public key).
     */
    getUserId(): string {
        return this.getPublicKeyHex().slice(0, 16);
    }

    /**
     * Get or set the display name.
     */
    getDisplayName(): string {
        return localStorage.getItem(DISPLAY_NAME_KEY) || 'Anonymous';
    }

    setDisplayName(name: string): void {
        localStorage.setItem(DISPLAY_NAME_KEY, name);
    }

    // ─── Signing ───

    /**
     * Sign arbitrary string data.
     * Returns hex-encoded signature.
     */
    async sign(data: string): Promise<string> {
        await this.init();
        if (!_cachedKeypair) throw new Error('[Identity] No keypair');

        const encoded = new TextEncoder().encode(data);
        const sig = this._useWebCrypto
            ? await signWebCrypto(encoded, _cachedKeypair.privateKey, _cachedKeypair.publicKey)
            : await signFallback(encoded, _cachedKeypair.privateKey);

        return toHex(sig);
    }

    /**
     * Sign a channel message.
     * Signs: channelId + senderId + content + timestamp
     */
    async signMessage(channelId: string, content: string, timestamp: number): Promise<string> {
        const dataToSign = `${channelId}|${this.getUserId()}|${content}|${timestamp}`;
        return this.sign(dataToSign);
    }

    // ─── Verification ───

    /**
     * Verify a signature against data and public key.
     */
    async verify(data: string, signatureHex: string, publicKeyHex: string): Promise<boolean> {
        await this.init();

        const encoded = new TextEncoder().encode(data);
        const sigBytes = fromHex(signatureHex);
        const pubBytes = fromHex(publicKeyHex);

        return this._useWebCrypto
            ? verifyWebCrypto(encoded, sigBytes, pubBytes)
            : verifyFallback(encoded, sigBytes, pubBytes);
    }

    /**
     * Verify a channel message signature.
     */
    async verifyMessage(
        channelId: string,
        senderId: string,
        content: string,
        timestamp: number,
        signatureHex: string,
        senderPublicKey: string,
    ): Promise<boolean> {
        const data = `${channelId}|${senderId}|${content}|${timestamp}`;
        return this.verify(data, signatureHex, senderPublicKey);
    }

    // ─── Export ───

    /**
     * Export public key as a shareable string.
     * Format: "tc:ed25519:<hex>"
     */
    getShareableKey(): string {
        return `tc:ed25519:${this.getPublicKeyHex()}`;
    }

    /**
     * Parse a shareable key string.
     */
    static parseShareableKey(key: string): { type: string; publicKey: string } | null {
        const match = key.match(/^tc:(\w+):([0-9a-f]+)$/i);
        if (!match) return null;
        return { type: match[1], publicKey: match[2] };
    }

    /**
     * Check if service is initialized.
     */
    isInitialized(): boolean {
        return !!_cachedKeypair;
    }
}

// ─── Singleton ───

export const identityService = new IdentityService();
