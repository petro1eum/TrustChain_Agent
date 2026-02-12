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
    /** Версия схемы подписи/canonical payload */
    signature_schema_version: number;
    /** Идентификатор ключа подписи (для rotation/revocation) */
    key_id: string;
    /** Логический tenant для изоляции sequence/key-space */
    tenant_id?: string;
    /** Algorithm used for signing */
    algorithm: 'ed25519' | 'hmac-sha256';
    /** Base64 public key (for verification) */
    public_key: string;
    /** Chain of Trust: previous signature hash (Pro/Enterprise only) */
    parent_signature?: string;
    /** Certificate metadata */
    certificate: TrustChainCertificate;
    /** Подписанный контекст состояния модели/политик */
    decision_context?: Record<string, any>;
    /** Контекст выполнения (привязка подписи к окружению) */
    execution_context?: {
        instance?: string;
        context?: string;
        document_mode?: string;
        tenant_id?: string;
    };
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
    signature_schema_version: number;
    key_id: string;
    user_query: string;
    parent_signature?: string;
    decision_context_hash?: string;
    execution_context_hash?: string;
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

export interface ExternalTrustSigner {
    key_id: string;
    public_key: string;
    algorithm: 'ed25519';
    sign: (payload: Uint8Array) => Promise<string>; // base64 signature
    provider?: string;
    healthCheck?: () => Promise<{ ok: boolean; latency_ms?: number; error?: string }>;
}

export interface ExternalSignerHealth {
    mode: 'local' | 'external';
    provider: string;
    status: 'unknown' | 'healthy' | 'degraded' | 'down';
    key_id: string;
    last_checked_at: string | null;
    last_latency_ms: number | null;
    last_error: string | null;
}

// ─── Helpers ───

/** Canonical JSON matching Python's json.dumps(sort_keys=True) */
function canonicalStringify(obj: Record<string, any>): string {
    const canonicalize = (value: any): any => {
        if (Array.isArray(value)) return value.map(canonicalize);
        if (value && typeof value === 'object') {
            const out: Record<string, any> = {};
            for (const key of Object.keys(value).sort()) {
                out[key] = canonicalize(value[key]);
            }
            return out;
        }
        return value;
    };
    return JSON.stringify(canonicalize(obj));
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

/** Convert Uint8Array to Base64 */
function bytesToBase64(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes));
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
    private readonly signatureSchemaVersion = 1;
    private keyId: string = '';
    private strictMode: boolean = true;
    private revokedKeyIds: Set<string> = new Set();
    private externalSigner: ExternalTrustSigner | null = null;
    private externalSignerBootstrapDone: boolean = false;
    private externalSignerHealth: ExternalSignerHealth = {
        mode: 'local',
        provider: 'local-webcrypto',
        status: 'unknown',
        key_id: '',
        last_checked_at: null,
        last_latency_ms: null,
        last_error: null,
    };

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
    private currentDecisionContext: Record<string, any> | null = null;
    private executionContext: {
        instance?: string;
        context?: string;
        document_mode?: string;
        tenant_id?: string;
    } = {};

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
        const strictFromEnv = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_TRUSTCHAIN_STRICT_MODE)
            ?? (typeof process !== 'undefined' ? process.env?.VITE_TRUSTCHAIN_STRICT_MODE : undefined);
        this.strictMode = String(strictFromEnv ?? 'true').toLowerCase() !== 'false';
    }

    private getEnv(name: string, fallback = ''): string {
        const fromMeta = typeof import.meta !== 'undefined'
            ? ((import.meta as any).env?.[name] as string | undefined)
            : undefined;
        const fromProc = typeof process !== 'undefined'
            ? (process.env?.[name] as string | undefined)
            : undefined;
        return String(fromMeta ?? fromProc ?? fallback);
    }

    private async bootstrapExternalSignerFromEnv(): Promise<void> {
        if (this.externalSignerBootstrapDone) return;
        this.externalSignerBootstrapDone = true;

        const signerUrl = this.getEnv('VITE_TRUSTCHAIN_EXTERNAL_SIGNER_URL', '').trim();
        const canaryEnabled = this.getEnv('VITE_TRUSTCHAIN_EXTERNAL_SIGNER_CANARY', 'false').toLowerCase() === 'true';
        if (!signerUrl || !canaryEnabled) return;

        const timeoutMs = Number(this.getEnv('VITE_TRUSTCHAIN_EXTERNAL_SIGNER_TIMEOUT_MS', '5000')) || 5000;
        const signPath = this.getEnv('VITE_TRUSTCHAIN_EXTERNAL_SIGNER_SIGN_PATH', '/sign') || '/sign';
        const healthPath = this.getEnv('VITE_TRUSTCHAIN_EXTERNAL_SIGNER_HEALTH_PATH', '/health') || '/health';
        const base = signerUrl.replace(/\/+$/, '');
        const signUrl = `${base}${signPath.startsWith('/') ? signPath : `/${signPath}`}`;
        const healthUrl = `${base}${healthPath.startsWith('/') ? healthPath : `/${healthPath}`}`;
        let keyId = this.getEnv('VITE_TRUSTCHAIN_EXTERNAL_SIGNER_KEY_ID', '').trim();
        let publicKey = this.getEnv('VITE_TRUSTCHAIN_EXTERNAL_SIGNER_PUBLIC_KEY', '').trim();

        // Если key_id/public_key не заданы в env, пробуем получить их из /health signer-bridge.
        if (!keyId || !publicKey) {
            const abortController = new AbortController();
            const timer = setTimeout(() => abortController.abort(), timeoutMs);
            try {
                const response = await fetch(healthUrl, {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' },
                    signal: abortController.signal,
                });
                if (response.ok) {
                    const data = await response.json();
                    keyId = keyId || String(data?.key_id || '').trim();
                    publicKey = publicKey || String(data?.public_key || '').trim();
                }
            } catch {
                // ignore and fail with explicit message below
            } finally {
                clearTimeout(timer);
            }
        }

        if (!keyId || !publicKey) {
            this.externalSignerHealth = {
                ...this.externalSignerHealth,
                mode: 'external',
                provider: signerUrl,
                status: 'degraded',
                last_error: 'Missing signer key material: set VITE_TRUSTCHAIN_EXTERNAL_SIGNER_KEY_ID/PUBLIC_KEY or expose them via /health',
            };
            return;
        }

        const signer: ExternalTrustSigner = {
            key_id: keyId,
            public_key: publicKey,
            algorithm: 'ed25519',
            provider: signerUrl,
            sign: async (payload: Uint8Array) => {
                const abortController = new AbortController();
                const timer = setTimeout(() => abortController.abort(), timeoutMs);
                try {
                    const response = await fetch(signUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ payload_base64: bytesToBase64(payload) }),
                        signal: abortController.signal,
                    });
                    if (!response.ok) {
                        throw new Error(`External signer HTTP ${response.status}`);
                    }
                    const data = await response.json();
                    const signature = String(data?.signature || data?.signature_base64 || '').trim();
                    if (!signature) {
                        throw new Error('External signer returned empty signature');
                    }
                    return signature;
                } finally {
                    clearTimeout(timer);
                }
            },
            healthCheck: async () => {
                const startedAt = performance.now();
                const abortController = new AbortController();
                const timer = setTimeout(() => abortController.abort(), timeoutMs);
                try {
                    const response = await fetch(healthUrl, {
                        method: 'GET',
                        headers: { 'Content-Type': 'application/json' },
                        signal: abortController.signal,
                    });
                    const latency = Math.round(performance.now() - startedAt);
                    if (!response.ok) {
                        return { ok: false, latency_ms: latency, error: `HTTP ${response.status}` };
                    }
                    return { ok: true, latency_ms: latency };
                } catch (e: any) {
                    const latency = Math.round(performance.now() - startedAt);
                    return { ok: false, latency_ms: latency, error: e?.message || 'health check failed' };
                } finally {
                    clearTimeout(timer);
                }
            },
        };

        this.configureExternalSigner(signer);
        await this.checkExternalSignerHealth(true);
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
        await this.bootstrapExternalSignerFromEnv();
        try {
            if (this.externalSigner) {
                this.algorithm = 'ed25519';
                this.keyId = this.externalSigner.key_id;
                this.publicKeyBase64 = this.externalSigner.public_key;
                this.initialized = true;
                console.log(`[TrustChain] ✅ External signer configured | key_id=${this.keyId}`);
                return;
            }
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
            this.keyId = (await sha256hex(this.publicKeyBase64)).slice(0, 24);
            this.externalSignerHealth = {
                ...this.externalSignerHealth,
                mode: 'local',
                provider: 'local-webcrypto',
                status: 'healthy',
                key_id: this.keyId,
                last_checked_at: new Date().toISOString(),
                last_error: null,
            };

            console.log(`[TrustChain] ✅ Ed25519 keypair generated | Agent: ${this.agentId}`);
            console.log(`[TrustChain]    Public key: ${this.publicKeyBase64.substring(0, 20)}...`);

        } catch (e) {
            // Fallback to HMAC-SHA256 for older browsers
            if (this.strictMode) {
                throw new Error('[TrustChain] Ed25519 is required in strict mode');
            }
            console.warn('[TrustChain] Ed25519 not supported, falling back to HMAC-SHA256');
            this.algorithm = 'hmac-sha256';

            this.hmacKey = await crypto.subtle.generateKey(
                { name: 'HMAC', hash: 'SHA-256' },
                true,
                ['sign', 'verify']
            );

            const rawKey = await crypto.subtle.exportKey('raw', this.hmacKey);
            this.publicKeyBase64 = bufferToBase64(rawKey);
            this.keyId = (await sha256hex(this.publicKeyBase64)).slice(0, 24);
            this.externalSignerHealth = {
                ...this.externalSignerHealth,
                mode: 'local',
                provider: 'local-hmac-fallback',
                status: 'degraded',
                key_id: this.keyId,
                last_checked_at: new Date().toISOString(),
                last_error: 'Ed25519 unavailable',
            };

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
     * Установить контекст выполнения для привязки подписи к окружению.
     */
    setExecutionContext(ctx: { instance?: string; context?: string; document_mode?: string; tenant_id?: string }): void {
        this.executionContext = {
            instance: ctx?.instance,
            context: ctx?.context,
            document_mode: ctx?.document_mode,
            tenant_id: ctx?.tenant_id,
        };
    }

    /**
     * Установить контекст состояния модели/политик для последующей аттестации.
     */
    setDecisionContext(ctx: Record<string, any> | null): void {
        this.currentDecisionContext = ctx ? { ...ctx } : null;
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

        if (this.revokedKeyIds.has(this.keyId)) {
            throw new Error(`[TrustChain] Current key is revoked: ${this.keyId}`);
        }
        if (this.strictMode && this.algorithm !== 'ed25519') {
            throw new Error('[TrustChain] Strict mode denies non-Ed25519 signatures');
        }

        this.sequence++;
        const timestamp = new Date().toISOString();

        // Canonical payload — must match verification on server side
        const payload = canonicalStringify({
            arguments: args,
            execution_context: this.executionContext,
            key_id: this.keyId,
            name: toolName,
            sequence: this.sequence,
            signature_schema_version: this.signatureSchemaVersion,
            tenant_id: this.executionContext?.tenant_id || '',
            timestamp: timestamp,
        });

        // Sign
        let signatureStr: string;
        const encoded = new TextEncoder().encode(payload);

        if (this.externalSigner) {
            const startedAt = performance.now();
            const sigBase64 = await this.externalSigner.sign(encoded);
            const latency = Math.round(performance.now() - startedAt);
            signatureStr = `ed25519:${sigBase64}`;
            this.algorithm = 'ed25519';
            this.keyId = this.externalSigner.key_id;
            this.publicKeyBase64 = this.externalSigner.public_key;
            this.externalSignerHealth = {
                ...this.externalSignerHealth,
                mode: 'external',
                provider: this.externalSigner.provider || 'external-signer',
                status: 'healthy',
                key_id: this.keyId,
                last_checked_at: new Date().toISOString(),
                last_latency_ms: latency,
                last_error: null,
            };
        } else if (this.algorithm === 'ed25519' && this.privateKey) {
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
            signature_schema_version: this.signatureSchemaVersion,
            key_id: this.keyId,
            tenant_id: this.executionContext?.tenant_id || '',
            algorithm: this.algorithm,
            public_key: this.publicKeyBase64,
            certificate: { ...this.certificate },
            execution_context: { ...this.executionContext },
        };

        if (parentSignature) {
            envelope.parent_signature = parentSignature;
        }
        if (this.currentDecisionContext && Object.keys(this.currentDecisionContext).length > 0) {
            envelope.decision_context = { ...this.currentDecisionContext };
        }

        // Audit trail
        const executionContextHash = await sha256hex(JSON.stringify(this.executionContext || {}));
        const decisionContextHash = this.currentDecisionContext
            ? await sha256hex(JSON.stringify(this.currentDecisionContext))
            : undefined;
        this.auditTrail.push({
            tool_name: toolName,
            args_hash: await sha256hex(JSON.stringify(args)),
            signature: signatureStr,
            timestamp,
            sequence: this.sequence,
            signature_schema_version: this.signatureSchemaVersion,
            key_id: this.keyId,
            user_query: this.currentUserQuery,
            parent_signature: parentSignature,
            decision_context_hash: decisionContextHash,
            execution_context_hash: executionContextHash,
        });

        return envelope;
    }

    /**
     * Подписывает финальный ответ агента, связывая его с цепочкой tool signatures.
     */
    async signFinalResponse(
        responseText: string,
        toolSignatures: string[] = [],
        extraContext: Record<string, any> = {}
    ): Promise<{ envelope: TrustChainEnvelope; response_hash: string; tool_signatures_hash: string }> {
        const responseHash = await sha256hex(String(responseText || ''));
        const toolSignaturesHash = await sha256hex(JSON.stringify([...toolSignatures].filter(Boolean).sort()));
        const envelope = await this.sign('__final_response__', {
            response_hash: responseHash,
            tool_signatures_hash: toolSignaturesHash,
            ...extraContext,
        });
        return {
            envelope,
            response_hash: responseHash,
            tool_signatures_hash: toolSignaturesHash,
        };
    }

    /**
     * Verify a TrustChain envelope (client-side double-check).
     */
    async verify(envelope: TrustChainEnvelope, toolName: string, args: Record<string, any>): Promise<boolean> {
        await this.initialize();

        const payload = canonicalStringify({
            arguments: args,
            execution_context: envelope.execution_context || {},
            key_id: envelope.key_id,
            name: toolName,
            sequence: envelope.sequence,
            signature_schema_version: envelope.signature_schema_version,
            tenant_id: envelope.tenant_id || '',
            timestamp: envelope.timestamp,
        });
        const encoded = new TextEncoder().encode(payload);

        try {
            const sigParts = envelope.signature.split(':');
            const sigBase64 = sigParts.length > 1 ? sigParts[1] : sigParts[0];
            const sigBuffer = base64ToBuffer(sigBase64);

            if (envelope.algorithm === 'ed25519' && envelope.public_key) {
                const imported = await crypto.subtle.importKey(
                    'raw',
                    base64ToBuffer(envelope.public_key),
                    { name: 'Ed25519' } as any,
                    false,
                    ['verify']
                );
                return await crypto.subtle.verify(
                    { name: 'Ed25519' } as any,
                    imported,
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
     * Метаданные активного ключа (для ротации и аудита).
     */
    getKeyInfo(): {
        key_id: string;
        algorithm: 'ed25519' | 'hmac-sha256';
        strict_mode: boolean;
        revoked: boolean;
        signer_mode: 'local' | 'external';
        signer_status: 'unknown' | 'healthy' | 'degraded' | 'down';
        signer_latency_ms: number | null;
    } {
        return {
            key_id: this.keyId,
            algorithm: this.algorithm,
            strict_mode: this.strictMode,
            revoked: this.revokedKeyIds.has(this.keyId),
            signer_mode: this.externalSignerHealth.mode,
            signer_status: this.externalSignerHealth.status,
            signer_latency_ms: this.externalSignerHealth.last_latency_ms,
        };
    }

    /**
     * Отметить ключ как отозванный.
     */
    revokeKeyId(keyId: string): void {
        if (!keyId) return;
        this.revokedKeyIds.add(keyId);
    }

    /**
     * Подключение внешнего подписанта (KMS/HSM/keystore).
     */
    configureExternalSigner(signer: ExternalTrustSigner | null): void {
        this.externalSigner = signer;
        if (signer) {
            this.algorithm = signer.algorithm;
            this.keyId = signer.key_id;
            this.publicKeyBase64 = signer.public_key;
            this.externalSignerHealth = {
                ...this.externalSignerHealth,
                mode: 'external',
                provider: signer.provider || 'external-signer',
                status: 'unknown',
                key_id: signer.key_id,
                last_error: null,
            };
        } else {
            this.externalSignerHealth = {
                ...this.externalSignerHealth,
                mode: 'local',
                provider: 'local-webcrypto',
                status: 'unknown',
                key_id: this.keyId,
            };
        }
    }

    async checkExternalSignerHealth(force = false): Promise<ExternalSignerHealth> {
        if (!this.externalSigner || !this.externalSigner.healthCheck) {
            return { ...this.externalSignerHealth };
        }

        const justChecked = this.externalSignerHealth.last_checked_at
            ? (Date.now() - Date.parse(this.externalSignerHealth.last_checked_at)) < 15_000
            : false;
        if (!force && justChecked) {
            return { ...this.externalSignerHealth };
        }

        const report = await this.externalSigner.healthCheck();
        this.externalSignerHealth = {
            ...this.externalSignerHealth,
            mode: 'external',
            provider: this.externalSigner.provider || 'external-signer',
            status: report.ok ? 'healthy' : 'down',
            key_id: this.externalSigner.key_id,
            last_checked_at: new Date().toISOString(),
            last_latency_ms: report.latency_ms ?? null,
            last_error: report.ok ? null : (report.error || 'health check failed'),
        };
        return { ...this.externalSignerHealth };
    }

    /**
     * Принудительная ротация ключа подписи.
     */
    async rotateSigningKey(): Promise<void> {
        if (this.externalSigner) {
            this.externalSignerHealth = {
                ...this.externalSignerHealth,
                mode: 'external',
                provider: this.externalSigner.provider || 'external-signer',
                status: 'unknown',
                key_id: this.externalSigner.key_id,
                last_checked_at: null,
                last_latency_ms: null,
                last_error: null,
            };
            return;
        }
        this.privateKey = null;
        this.publicKey = null;
        this.hmacKey = null;
        this.publicKeyBase64 = '';
        this.keyId = '';
        this.initialized = false;
        this.initPromise = null;
        await this.initialize();
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
            key_id: this.keyId,
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

    /**
     * Health состояния подписи (local/external signer).
     */
    getSignerHealth(): ExternalSignerHealth {
        return { ...this.externalSignerHealth };
    }
}

// ─── Singleton ───

export const trustchainService = new TrustChainService();

export default trustchainService;
