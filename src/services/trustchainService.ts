/**
 * TrustChain Service — Ed25519 cryptographic signing for AI tool calls.
 *
 * Signs every outgoing MCP tool call with Ed25519, creating an unforgeable
 * audit trail. Supports Community (OSS) and Pro/Enterprise tiers.
 *
 * Architecture:
 *   Agent  →  trustchainService.sign(toolName, args)  →  MCP Server
 *   MCP Server receives { ...request, trustchain: { signature, ... } }
 *
 * Uses Web Crypto API (browser) with Ed25519 (COSE algorithm).
 * Falls back to HMAC-SHA256 if Ed25519 is not available.
 */

// ─── Types ───

export type TrustChainTier = 'community' | 'pro' | 'enterprise';

export interface TrustChainEnvelope {
    /** Ed25519 signature of canonical payload, prefixed with "ed25519:" */
    signature: string;
    /** Unique agent instance ID */
    agent_id: string;
    /** Session ID (unique per conversation) */
    session_id: string;
    /** ISO 8601 timestamp */
    timestamp: string;
    /** Original user query that triggered this tool call */
    user_query: string;
    /** Sequence number within session (replay protection) */
    sequence: number;
    /** Algorithm used for signing */
    algorithm: 'ed25519' | 'hmac-sha256';
    /** Base64 public key (for verification) */
    public_key: string;
    /** Chain of Trust: previous signature hash (Pro/Enterprise only) */
    parent_signature?: string;
    /** Certificate metadata */
    certificate: TrustChainCertificate;
}

export interface TrustChainCertificate {
    owner: string;
    organization: string;
    role: string;
    tier: TrustChainTier;
    issued: string;
    /** Pro: policy engine enabled */
    policy_engine?: boolean;
    /** Pro: compliance markers */
    compliance?: string[];
}

export interface AuditEntry {
    tool_name: string;
    args_hash: string;
    signature: string;
    timestamp: string;
    sequence: number;
    user_query: string;
    parent_signature?: string;
}

export interface SessionInfo {
    session_id: string;
    agent_id: string;
    started_at: string;
    sequence: number;
    total_calls: number;
    tier: TrustChainTier;
    chain_length: number;
}

// ─── Helpers ───

/** Canonical JSON matching Python's json.dumps(sort_keys=True) */
function canonicalStringify(obj: Record<string, any>): string {
    return JSON.stringify(obj, Object.keys(obj).sort());
}

/** Generate a random hex string */
function randomHex(bytes: number): string {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 hash of a string, returned as hex */
async function sha256hex(data: string): Promise<string> {
    const encoded = new TextEncoder().encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Convert ArrayBuffer to Base64 */
function bufferToBase64(buffer: ArrayBuffer): string {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

/** Convert Base64 to ArrayBuffer */
function base64ToBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

// ─── Service ───

class TrustChainService {
    private privateKey: CryptoKey | null = null;
    private publicKey: CryptoKey | null = null;
    private publicKeyBase64: string = '';
    private hmacKey: CryptoKey | null = null;
    private algorithm: 'ed25519' | 'hmac-sha256' = 'ed25519';

    private agentId: string;
    private sessionId: string;
    private sequence: number = 0;
    private tier: TrustChainTier = 'community';
    private lastSignature: string | null = null;
    private initialized: boolean = false;
    private initPromise: Promise<void> | null = null;

    // Audit trail (Pro/Enterprise)
    private auditTrail: AuditEntry[] = [];
    private currentUserQuery: string = '';

    // Certificate
    private certificate: TrustChainCertificate;

    constructor() {
        this.agentId = `tc-agent-${randomHex(8)}`;
        this.sessionId = `sess_${randomHex(16)}`;
        this.certificate = {
            owner: 'TrustChain Agent',
            organization: 'TrustChain',
            role: 'ai-assistant',
            tier: this.tier,
            issued: new Date().toISOString(),
        };
    }

    /**
     * Initialize the service — generates Ed25519 keypair.
     * Must be called before sign(). Safe to call multiple times.
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = this._doInitialize();
        return this.initPromise;
    }

    private async _doInitialize(): Promise<void> {
        try {
            // Try Ed25519 first (Chrome 113+, Edge 113+, Safari 17+)
            const keyPair = await crypto.subtle.generateKey(
                { name: 'Ed25519' } as any,
                true,  // extractable — needed to export public key
                ['sign', 'verify']
            );

            this.privateKey = keyPair.privateKey;
            this.publicKey = keyPair.publicKey;
            this.algorithm = 'ed25519';

            // Export public key as raw bytes → Base64
            const rawPubKey = await crypto.subtle.exportKey('raw', this.publicKey);
            this.publicKeyBase64 = bufferToBase64(rawPubKey);

            console.log(`[TrustChain] ✅ Ed25519 keypair generated | Agent: ${this.agentId}`);
            console.log(`[TrustChain]    Public key: ${this.publicKeyBase64.substring(0, 20)}...`);

        } catch (e) {
            // Fallback to HMAC-SHA256 for older browsers
            console.warn('[TrustChain] Ed25519 not supported, falling back to HMAC-SHA256');
            this.algorithm = 'hmac-sha256';

            this.hmacKey = await crypto.subtle.generateKey(
                { name: 'HMAC', hash: 'SHA-256' },
                true,
                ['sign', 'verify']
            );

            const rawKey = await crypto.subtle.exportKey('raw', this.hmacKey);
            this.publicKeyBase64 = bufferToBase64(rawKey);

            console.log(`[TrustChain] ⚠️ HMAC-SHA256 fallback | Agent: ${this.agentId}`);
        }

        this.initialized = true;
    }

    /**
     * Set the current user query (called before tool execution begins).
     * This is embedded in every signature for audit purposes.
     */
    setCurrentQuery(query: string): void {
        this.currentUserQuery = query;
    }

    /**
     * Set the tier level: community (OSS), pro, or enterprise.
     */
    setTier(tier: TrustChainTier): void {
        this.tier = tier;
        this.certificate.tier = tier;

        if (tier === 'pro' || tier === 'enterprise') {
            this.certificate.policy_engine = true;
            this.certificate.compliance = tier === 'enterprise'
                ? ['SOC2', 'HIPAA', 'AI-Act']
                : ['SOC2'];
        }

        console.log(`[TrustChain] Tier set to: ${tier}`);
    }

    /**
     * Sign an outgoing MCP tool call.
     * Produces a TrustChainEnvelope that should be attached to the request body.
     */
    async sign(toolName: string, args: Record<string, any>): Promise<TrustChainEnvelope> {
        await this.initialize();

        this.sequence++;
        const timestamp = new Date().toISOString();

        // Canonical payload — must match verification on server side
        const payload = canonicalStringify({
            arguments: args,
            name: toolName,
            sequence: this.sequence,
            timestamp: timestamp,
        });

        // Sign
        let signatureStr: string;
        const encoded = new TextEncoder().encode(payload);

        if (this.algorithm === 'ed25519' && this.privateKey) {
            const sigBuffer = await crypto.subtle.sign(
                { name: 'Ed25519' } as any,
                this.privateKey,
                encoded
            );
            signatureStr = `ed25519:${bufferToBase64(sigBuffer)}`;
        } else if (this.hmacKey) {
            const sigBuffer = await crypto.subtle.sign(
                'HMAC',
                this.hmacKey,
                encoded
            );
            signatureStr = `hmac-sha256:${bufferToBase64(sigBuffer)}`;
        } else {
            throw new Error('[TrustChain] Not initialized — call initialize() first');
        }

        // Chain of Trust (Pro/Enterprise): link to previous signature
        const parentSignature = (this.tier !== 'community' && this.lastSignature)
            ? this.lastSignature
            : undefined;

        this.lastSignature = signatureStr;

        // Build envelope
        const envelope: TrustChainEnvelope = {
            signature: signatureStr,
            agent_id: this.agentId,
            session_id: this.sessionId,
            timestamp,
            user_query: this.currentUserQuery,
            sequence: this.sequence,
            algorithm: this.algorithm,
            public_key: this.publicKeyBase64,
            certificate: { ...this.certificate },
        };

        if (parentSignature) {
            envelope.parent_signature = parentSignature;
        }

        // Audit trail
        this.auditTrail.push({
            tool_name: toolName,
            args_hash: await sha256hex(JSON.stringify(args)),
            signature: signatureStr,
            timestamp,
            sequence: this.sequence,
            user_query: this.currentUserQuery,
            parent_signature: parentSignature,
        });

        return envelope;
    }

    /**
     * Verify a TrustChain envelope (client-side double-check).
     */
    async verify(envelope: TrustChainEnvelope, toolName: string, args: Record<string, any>): Promise<boolean> {
        await this.initialize();

        const payload = canonicalStringify({
            arguments: args,
            name: toolName,
            sequence: envelope.sequence,
            timestamp: envelope.timestamp,
        });
        const encoded = new TextEncoder().encode(payload);

        try {
            const sigParts = envelope.signature.split(':');
            const sigBase64 = sigParts.length > 1 ? sigParts[1] : sigParts[0];
            const sigBuffer = base64ToBuffer(sigBase64);

            if (envelope.algorithm === 'ed25519' && this.publicKey) {
                return await crypto.subtle.verify(
                    { name: 'Ed25519' } as any,
                    this.publicKey,
                    sigBuffer,
                    encoded
                );
            } else if (this.hmacKey) {
                return await crypto.subtle.verify(
                    'HMAC',
                    this.hmacKey,
                    sigBuffer,
                    encoded
                );
            }
        } catch (e) {
            console.error('[TrustChain] Verification error:', e);
        }

        return false;
    }

    /**
     * Start a new session (e.g., new conversation).
     */
    startSession(): string {
        this.sessionId = `sess_${randomHex(16)}`;
        this.sequence = 0;
        this.lastSignature = null;
        this.auditTrail = [];
        console.log(`[TrustChain] New session: ${this.sessionId}`);
        return this.sessionId;
    }

    /**
     * Get current session info.
     */
    getSessionInfo(): SessionInfo {
        return {
            session_id: this.sessionId,
            agent_id: this.agentId,
            started_at: this.certificate.issued,
            sequence: this.sequence,
            total_calls: this.auditTrail.length,
            tier: this.tier,
            chain_length: this.tier !== 'community' ? this.auditTrail.length : 0,
        };
    }

    /**
     * Get the public key as Base64 (for sharing with MCP servers).
     */
    getPublicKeyBase64(): string {
        return this.publicKeyBase64;
    }

    /**
     * Get the agent ID.
     */
    getAgentId(): string {
        return this.agentId;
    }

    /**
     * Get the current tier.
     */
    getTier(): TrustChainTier {
        return this.tier;
    }

    /**
     * Get the certificate for UI display.
     */
    getCertificate(): TrustChainCertificate {
        return { ...this.certificate };
    }

    /**
     * Get the full audit trail (Pro/Enterprise).
     * Community tier returns last 10 entries only.
     */
    getAuditTrail(): AuditEntry[] {
        if (this.tier === 'community') {
            return this.auditTrail.slice(-10);
        }
        return [...this.auditTrail];
    }

    /**
     * Export compliance report (Enterprise only).
     */
    exportComplianceReport(): object | null {
        if (this.tier !== 'enterprise') {
            console.warn('[TrustChain] Compliance reports require Enterprise tier');
            return null;
        }

        return {
            report_id: `rpt_${randomHex(8)}`,
            generated_at: new Date().toISOString(),
            agent_id: this.agentId,
            session_id: this.sessionId,
            tier: this.tier,
            algorithm: this.algorithm,
            public_key: this.publicKeyBase64,
            total_operations: this.auditTrail.length,
            chain_integrity: this.auditTrail.every((entry, i) =>
                i === 0 || entry.parent_signature === this.auditTrail[i - 1].signature
            ),
            compliance_markers: this.certificate.compliance || [],
            audit_entries: this.auditTrail,
        };
    }

    /**
     * Check if service is initialized and ready.
     */
    isReady(): boolean {
        return this.initialized;
    }
}

// ─── Singleton ───

export const trustchainService = new TrustChainService();

export default trustchainService;
