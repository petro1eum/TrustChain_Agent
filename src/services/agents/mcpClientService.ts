/**
 * Gap B: MCP (Model Context Protocol) Client Service
 * 
 * Поддержка динамического подключения внешних MCP серверов
 * для расширения возможностей агента без изменения кода.
 * 
 * MCP spec: https://modelcontextprotocol.io
 */

import { trustchainService } from '../trustchainService';
import type { TrustChainEnvelope } from '../trustchainService';

// ─── Типы MCP Protocol ───

export interface MCPToolParameter {
    type: string;
    description?: string;
    enum?: string[];
    required?: boolean;
}

export interface MCPToolDefinition {
    name: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, MCPToolParameter>;
        required?: string[];
    };
}

export interface MCPResource {
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
}

export interface MCPServerConfig {
    id: string;
    name: string;
    url: string;
    transport: 'stdio' | 'sse' | 'http' | 'streamable-http';
    enabled: boolean;
    apiKey?: string;
    timeout?: number;
}

export interface MCPServerConnection {
    config: MCPServerConfig;
    tools: MCPToolDefinition[];
    resources: MCPResource[];
    status: 'connected' | 'disconnected' | 'error';
    lastError?: string;
    connectedAt?: number;
    sessionId?: string;  // For streamable-http MCP protocol
}

export interface MCPTrustRecord {
    serverId: string;
    issuer: string;
    fingerprint: string;
    validFrom?: string;
    validTo?: string;
    revoked?: boolean;
    tier?: 'sandbox' | 'trusted' | 'critical';
}

// ─── Константы ───

const DEFAULT_TIMEOUT = 15000;
const DISCOVERY_CACHE_TTL = 5 * 60 * 1000; // 5 минут

// Backend URL
const _proc = typeof process !== 'undefined' ? process.env : {} as Record<string, string | undefined>;
const BACKEND_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_URL)
    || _proc.VITE_BACKEND_URL
    || '';  // No default — skip backend calls when not configured
const MCP_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_MCP_URL)
    || _proc.VITE_MCP_URL
    || '';

// ─── Сервис ───

export class MCPClientService {
    private connections: Map<string, MCPServerConnection> = new Map();
    private toolCache: Map<string, { tools: any[]; timestamp: number }> = new Map();
    private sessionIds: Map<string, string> = new Map();  // serverId → mcp-session-id
    private trustRegistry: Map<string, MCPTrustRecord> = new Map();

    private isMutatingTool(toolName: string): boolean {
        const lower = String(toolName || '').toLowerCase();
        return /^(create|update|delete|upsert|write|apply|set|run|execute)_/.test(lower)
            || lower.includes('approve')
            || lower.includes('block')
            || lower.includes('revoke');
    }

    private shouldAllowUnsignedReadFallback(
        config: MCPServerConfig,
        toolName: string,
        denyCode?: string,
        denyMessage?: string
    ): boolean {
        if (this.isMutatingTool(toolName)) return false;
        if (!this.isLocalUrl(config.url)) return false;
        const flagRaw = ((typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_TRUSTCHAIN_UNSIGNED_READ_FALLBACK)
            || _proc.VITE_TRUSTCHAIN_UNSIGNED_READ_FALLBACK
            || 'true');
        const enabled = String(flagRaw).toLowerCase() === 'true';
        if (!enabled) return false;
        const code = String(denyCode || '').toUpperCase();
        if (['INVALID_SIGNATURE', 'VERIFY_ERROR', 'MISSING_TRUSTCHAIN_FIELDS', 'NO_TRUSTCHAIN'].includes(code)) {
            return true;
        }
        const msg = String(denyMessage || '').toLowerCase();
        return msg.includes('invalid signature') || msg.includes('verify') || msg.includes('подпись');
    }

    private loadTrustRegistry(): void {
        try {
            if (typeof window === 'undefined') return;
            const raw = window.localStorage.getItem('trustchain_mcp_registry');
            if (!raw) return;
            const parsed = JSON.parse(raw);
            const records: MCPTrustRecord[] = Array.isArray(parsed) ? parsed : (parsed?.records || []);
            this.trustRegistry.clear();
            for (const record of records) {
                if (record?.serverId) this.trustRegistry.set(record.serverId, record);
            }
        } catch {
            // ignore registry parsing errors
        }
    }

    private persistTrustRegistry(): void {
        try {
            if (typeof window === 'undefined') return;
            const records = Array.from(this.trustRegistry.values());
            window.localStorage.setItem('trustchain_mcp_registry', JSON.stringify(records));
        } catch {
            // ignore persistence errors
        }
    }

    private normalizeServerId(serverId: string): string {
        const raw = String(serverId || '').trim().toLowerCase();
        return raw
            .replace(/^panel_/, '')
            .replace(/^mcp_/, '')
            .replace(/[-\s]+/g, '_');
    }

    private getTrustRecord(serverId: string): MCPTrustRecord | undefined {
        const exact = this.trustRegistry.get(serverId);
        if (exact) return exact;
        const normalized = this.normalizeServerId(serverId);
        if (!normalized) return undefined;
        for (const [id, record] of this.trustRegistry.entries()) {
            if (this.normalizeServerId(id) === normalized) return record;
            if (record?.serverId && this.normalizeServerId(record.serverId) === normalized) return record;
        }
        return undefined;
    }

    private isLocalUrl(url: string): boolean {
        try {
            const parsed = new URL(url);
            return /^(localhost|127\.0\.0\.1)$/i.test(parsed.hostname);
        } catch {
            return /localhost|127\.0\.0\.1/.test(String(url || ''));
        }
    }

    private shouldAutoTrustLocal(): boolean {
        const raw = ((typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_TRUSTCHAIN_AUTO_TRUST_LOCAL_MCP)
            || _proc.VITE_TRUSTCHAIN_AUTO_TRUST_LOCAL_MCP
            || '');
        if (String(raw).trim()) return String(raw).toLowerCase() === 'true';
        if (typeof window === 'undefined') return false;
        return /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
    }

    private upsertTrustRecord(record: MCPTrustRecord): void {
        if (!record?.serverId) return;
        this.trustRegistry.set(record.serverId, record);
    }

    private async syncTrustRegistryFromMcp(configs: MCPServerConfig[]): Promise<void> {
        const candidates: string[] = [];
        if (MCP_URL) candidates.push(MCP_URL);
        for (const cfg of configs) {
            if (!cfg?.url) continue;
            if (this.isLocalUrl(cfg.url)) candidates.push(cfg.url);
        }

        const visited = new Set<string>();
        for (const base of candidates) {
            const normalized = String(base || '').replace(/\/+$/, '');
            if (!normalized || visited.has(normalized)) continue;
            visited.add(normalized);
            try {
                const response = await fetch(`${normalized}/api/mcp-trust/servers`, {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' },
                    signal: AbortSignal.timeout(3000),
                });
                if (!response.ok) continue;
                const data = await response.json();
                const rows = Array.isArray(data?.servers) ? data.servers : [];
                for (const row of rows) {
                    const serverId = String(row?.server_id || row?.serverId || '').trim();
                    if (!serverId) continue;
                    this.upsertTrustRecord({
                        serverId,
                        issuer: String(row?.issuer || 'local-ca'),
                        fingerprint: String(row?.fingerprint || row?.certificate_id || ''),
                        validFrom: row?.valid_from || row?.validFrom || undefined,
                        validTo: row?.valid_to || row?.validTo || undefined,
                        revoked: String(row?.status || '').toLowerCase() === 'revoked' || !!row?.revoked,
                        tier: (row?.trust_tier || row?.tier || 'sandbox') as MCPTrustRecord['tier'],
                        // keep backend status for evaluateTrust
                        ...(row?.status ? { status: String(row.status) } as any : {}),
                    });
                }
                this.persistTrustRegistry();
                return;
            } catch {
                // try next candidate
            }
        }
    }

    private bootstrapLocalTrust(configs: MCPServerConfig[]): void {
        if (!this.shouldAutoTrustLocal()) return;
        const now = Date.now();
        const validTo = new Date(now + 1000 * 60 * 60 * 24 * 30).toISOString(); // 30d

        for (const cfg of configs) {
            if (!cfg?.id || !this.isLocalUrl(cfg.url)) continue;
            if (this.getTrustRecord(cfg.id)) continue;

            const normalized = this.normalizeServerId(cfg.id);
            if (!['onaidocs', 'playwright'].includes(normalized)) continue;

            this.upsertTrustRecord({
                serverId: cfg.id,
                issuer: 'local-dev-bootstrap',
                fingerprint: `dev:${normalized}`,
                validFrom: new Date(now).toISOString(),
                validTo,
                revoked: false,
                tier: normalized === 'onaidocs' ? 'trusted' : 'sandbox',
            });
            console.warn(`[MCP][Trust] Auto-trusted local MCP "${cfg.id}" for dev profile.`);
        }
        this.persistTrustRegistry();
    }

    private evaluateTrust(config: MCPServerConfig, toolName?: string): { allowed: boolean; reason?: string } {
        const isLocal = this.isLocalUrl(config.url);
        const allowLocalUnsigned = ((typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_TRUSTCHAIN_ALLOW_LOCAL_UNSIGNED_MCP) || 'false') === 'true';
        const record = this.getTrustRecord(config.id);
        const isHighRiskCall = !!toolName && this.isMutatingTool(toolName);

        if (record?.revoked) {
            return { allowed: false, reason: `MCP certificate revoked for ${config.id}` };
        }
        if (record && record.validTo && Date.parse(record.validTo) < Date.now()) {
            return { allowed: false, reason: `MCP certificate expired for ${config.id}` };
        }
        if (record) {
            const status = String((record as any).status || (record.revoked ? 'revoked' : 'active')).toLowerCase();
            const trustTier = String((record.tier || (record as any).trust_tier || 'sandbox')).toLowerCase();
            if (status !== 'active') {
                return { allowed: false, reason: `MCP certificate is not active for ${config.id}` };
            }
            if (isHighRiskCall && !['trusted', 'critical'].includes(trustTier)) {
                return { allowed: false, reason: `MCP tier "${trustTier}" is insufficient for high-risk tool ${toolName}` };
            }
            return { allowed: true };
        }
        if (isLocal && allowLocalUnsigned) return { allowed: true };
        return { allowed: false, reason: `Untrusted MCP server ${config.id}. Add certificate to trustchain_mcp_registry.` };
    }

    // ──────────────────────────────────────────────
    // Connection Management
    // ──────────────────────────────────────────────

    /**
     * Подключается к MCP серверу и обнаруживает его tools/resources
     */
    async connect(config: MCPServerConfig): Promise<MCPServerConnection> {
        console.log(`[MCP] Connecting to ${config.name} at ${config.url} (transport: ${config.transport})...`);
        this.loadTrustRegistry();
        const trustDecision = this.evaluateTrust(config);
        if (!trustDecision.allowed) {
            const denied: MCPServerConnection = {
                config,
                tools: [],
                resources: [],
                status: 'error',
                lastError: trustDecision.reason || 'trust policy denied'
            };
            this.connections.set(config.id, denied);
            console.error(`[MCP] Trust policy denied ${config.name}: ${denied.lastError}`);
            return denied;
        }

        try {
            // For streamable-http: initialize the session first
            if (config.transport === 'streamable-http') {
                await this.initializeStreamableHTTP(config);
            }

            // Получаем список tools от MCP сервера
            const tools = await this.discoverTools(config);
            const resources = await this.discoverResources(config);

            const connection: MCPServerConnection = {
                config,
                tools,
                resources,
                status: 'connected',
                connectedAt: Date.now(),
                sessionId: this.sessionIds.get(config.id)
            };

            this.connections.set(config.id, connection);
            console.log(`[MCP] Connected to ${config.name}: ${tools.length} tools, ${resources.length} resources`);

            return connection;
        } catch (error: any) {
            const connection: MCPServerConnection = {
                config,
                tools: [],
                resources: [],
                status: 'error',
                lastError: error.message
            };
            this.connections.set(config.id, connection);
            console.error(`[MCP] Failed to connect to ${config.name}:`, error.message);
            return connection;
        }
    }

    /**
     * Отключается от MCP сервера
     */
    disconnect(serverId: string): void {
        const conn = this.connections.get(serverId);
        if (conn) {
            conn.status = 'disconnected';
            conn.tools = [];
            conn.resources = [];
            this.connections.delete(serverId);
            this.toolCache.delete(serverId);
            console.log(`[MCP] Disconnected from ${conn.config.name}`);
        }
    }

    /**
     * Загружает конфигурации MCP серверов из настроек
     */
    async loadServerConfigs(): Promise<MCPServerConfig[]> {
        // Пробуем загрузить из backend (only if configured)
        if (BACKEND_URL) {
            try {
                const response = await fetch(`${BACKEND_URL}/api/agent/mcp/servers`, {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' }
                });
                if (response.ok) {
                    const data = await response.json();
                    return (data.servers || []) as MCPServerConfig[];
                }
            } catch {
                // Backend недоступен
            }
        }

        // Fallback: localStorage
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                const raw = localStorage.getItem('kb_agent_mcp_servers');
                if (raw) return JSON.parse(raw);
            }
        } catch {
            // ignore
        }

        return [];
    }

    /**
     * Подключается ко всем сконфигурированным серверам
     * Also auto-discovers well-known MCP servers (Playwright)
     */
    async connectAll(): Promise<MCPServerConnection[]> {
        const configs = await this.loadServerConfigs();
        const results: MCPServerConnection[] = [];

        // Auto-discover Playwright MCP if running (via Vite proxy to bypass CORS)
        // The proxy at /playwright-mcp forwards to localhost:8931/mcp
        const hasPlaywright = configs.some(c => c.id === 'playwright');
        if (!hasPlaywright) {
            // Determine the base URL: use vite dev server origin for the proxy
            const proxyBase = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
            const playwrightProxyUrl = `${proxyBase}/playwright-mcp`;
            try {
                const probe = await fetch(playwrightProxyUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
                    body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe', version: '1.0' } }, id: 0 }),
                    signal: AbortSignal.timeout(3000)
                });
                if (probe.ok) {
                    console.log('[MCP] Auto-discovered Playwright MCP via proxy');
                    configs.push({
                        id: 'playwright',
                        name: 'Playwright Browser',
                        url: playwrightProxyUrl,
                        transport: 'streamable-http',
                        enabled: true,
                        timeout: 30000
                    });
                }
            } catch {
                // Playwright MCP not running — skip
            }
        }

        this.loadTrustRegistry();
        await this.syncTrustRegistryFromMcp(configs);
        this.bootstrapLocalTrust(configs);

        for (const config of configs.filter(c => c.enabled)) {
            const conn = await this.connect(config);
            results.push(conn);
        }

        return results;
    }

    // ──────────────────────────────────────────────
    // Streamable HTTP MCP Protocol
    // ──────────────────────────────────────────────

    /**
     * Parse SSE response body to extract JSON-RPC result
     */
    private async parseSSEResponse(response: Response): Promise<any> {
        const text = await response.text();
        // SSE format: "event: message\ndata: {json}\n\n"
        const lines = text.split('\n');
        for (const line of lines) {
            if (line.startsWith('data: ')) {
                try {
                    return JSON.parse(line.slice(6));
                } catch { /* skip non-JSON data lines */ }
            }
        }
        // Try plain JSON
        try { return JSON.parse(text); } catch { /* nope */ }
        throw new Error(`Cannot parse SSE response: ${text.slice(0, 200)}`);
    }

    private tryParseJson(text: string): any | null {
        try {
            return JSON.parse(text);
        } catch {
            return null;
        }
    }

    private extractPolicyDeny(raw: any): { code?: string; message?: string; policy?: string } | null {
        const seen = new Set<any>();
        const stack: any[] = [raw];

        while (stack.length > 0) {
            const cur = stack.pop();
            if (cur == null || seen.has(cur)) continue;
            if (typeof cur === 'object') seen.add(cur);

            if (typeof cur === 'string') {
                const parsed = this.tryParseJson(cur);
                if (parsed) stack.push(parsed);
                continue;
            }

            if (Array.isArray(cur)) {
                for (const item of cur) stack.push(item);
                continue;
            }

            if (typeof cur === 'object') {
                const action = String((cur as any).action || '').toLowerCase();
                const hasPolicy = typeof (cur as any).policy === 'string' && !!(cur as any).policy;
                const successFalse = (cur as any).success === false;
                if (action === 'deny' || hasPolicy || successFalse) {
                    return {
                        code: (cur as any).code,
                        message: (cur as any).message || (cur as any).error,
                        policy: (cur as any).policy,
                    };
                }

                // common wrappers
                if ((cur as any).text) stack.push((cur as any).text);
                if ((cur as any).content) stack.push((cur as any).content);
                if ((cur as any).result) stack.push((cur as any).result);
                if ((cur as any).data) stack.push((cur as any).data);
            }
        }
        return null;
    }

    /**
     * Initialize a Streamable HTTP MCP session
     */
    private async initializeStreamableHTTP(config: MCPServerConfig): Promise<string> {
        const response = await fetch(config.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
                ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {})
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'initialize',
                params: {
                    protocolVersion: '2024-11-05',
                    capabilities: {},
                    clientInfo: { name: 'TrustChain Agent', version: '1.0' }
                },
                id: 1
            }),
            signal: AbortSignal.timeout(config.timeout || DEFAULT_TIMEOUT)
        });

        if (!response.ok) {
            throw new Error(`MCP initialize failed: HTTP ${response.status}`);
        }

        // Extract session ID from response header
        const sessionId = response.headers.get('mcp-session-id');
        if (sessionId) {
            this.sessionIds.set(config.id, sessionId);
            console.log(`[MCP] Session established for ${config.name}: ${sessionId.slice(0, 8)}...`);
        }

        // Parse the initialize response
        const data = await this.parseSSEResponse(response);
        console.log(`[MCP] ${config.name} initialized: ${data.result?.serverInfo?.name} v${data.result?.serverInfo?.version}`);

        // Send initialized notification (required by protocol)
        try {
            await fetch(config.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json, text/event-stream',
                    ...(sessionId ? { 'mcp-session-id': sessionId } : {})
                },
                body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
                signal: AbortSignal.timeout(5000)
            });
        } catch { /* notification is best-effort */ }

        return sessionId || '';
    }

    /**
     * Make a JSON-RPC call to a Streamable HTTP MCP server
     */
    private async streamableHTTPCall(config: MCPServerConfig, method: string, params?: any): Promise<any> {
        const sessionId = this.sessionIds.get(config.id);
        const response = await fetch(config.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
                ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
                ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {})
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method,
                ...(params ? { params } : {}),
                id: Date.now()
            }),
            signal: AbortSignal.timeout(config.timeout || DEFAULT_TIMEOUT)
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            // Session expired? Re-initialize
            if (response.status === 404 || errText.includes('not initialized')) {
                console.log(`[MCP] Session expired for ${config.name}, re-initializing...`);
                await this.initializeStreamableHTTP(config);
                return this.streamableHTTPCall(config, method, params);
            }
            throw new Error(`MCP ${method} failed: HTTP ${response.status} — ${errText.slice(0, 200)}`);
        }

        const data = await this.parseSSEResponse(response);
        if (data.error) {
            throw new Error(`MCP ${method} error: ${data.error.message}`);
        }
        return data.result;
    }

    // ──────────────────────────────────────────────
    // Tool Discovery & Invocation
    // ──────────────────────────────────────────────

    /**
     * Обнаруживает tools на MCP сервере
     */
    private async discoverTools(config: MCPServerConfig): Promise<MCPToolDefinition[]> {
        const cached = this.toolCache.get(config.id);
        if (cached && Date.now() - cached.timestamp < DISCOVERY_CACHE_TTL) {
            return cached.tools;
        }

        // Streamable HTTP MCP protocol (Playwright, etc.)
        if (config.transport === 'streamable-http') {
            const result = await this.streamableHTTPCall(config, 'tools/list');
            const tools = result?.tools || [];
            this.toolCache.set(config.id, { tools, timestamp: Date.now() });
            return tools;
        }

        const timeout = config.timeout || DEFAULT_TIMEOUT;

        if (config.transport === 'http' || config.transport === 'sse') {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            try {
                const response = await fetch(`${config.url}/tools/list`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {})
                    },
                    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const data = await response.json();
                const tools = data.result?.tools || data.tools || [];
                this.toolCache.set(config.id, { tools, timestamp: Date.now() });
                return tools;
            } catch (error: any) {
                clearTimeout(timeoutId);
                throw error;
            }
        }

        // stdio transport — через backend proxy
        try {
            const response = await fetch(`${BACKEND_URL}/api/agent/mcp/discover`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ serverId: config.id, config })
            });

            if (response.ok) {
                const data = await response.json();
                return data.tools || [];
            }
        } catch {
            // Backend proxy недоступен
        }

        return [];
    }

    /**
     * Обнаруживает resources на MCP сервере
     */
    private async discoverResources(config: MCPServerConfig): Promise<MCPResource[]> {
        if (config.transport === 'http' || config.transport === 'sse') {
            try {
                const response = await fetch(`${config.url}/resources/list`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {})
                    },
                    body: JSON.stringify({ jsonrpc: '2.0', method: 'resources/list', id: 1 })
                });

                if (response.ok) {
                    const data = await response.json();
                    return data.result?.resources || data.resources || [];
                }
            } catch {
                // ignore
            }
        }

        return [];
    }

    /**
     * Вызывает tool на MCP сервере.
     * Каждый вызов подписывается TrustChain Ed25519 — см. INTEGRATION_STANDARD.md § TrustChain.
     */
    async callTool(serverId: string, toolName: string, args: Record<string, any>): Promise<any> {
        const connection = this.connections.get(serverId);
        if (!connection || connection.status !== 'connected') {
            throw new Error(`MCP server ${serverId} is not connected`);
        }
        const trustDecision = this.evaluateTrust(connection.config, toolName);
        if (!trustDecision.allowed) {
            throw new Error(`[MCP][Trust] ${trustDecision.reason || 'server not trusted'}`);
        }

        const config = connection.config;
        const timeout = config.timeout || DEFAULT_TIMEOUT;

        // ── TrustChain: sign the outgoing call ──
        let tcEnvelope: TrustChainEnvelope | undefined;
        try {
            tcEnvelope = await trustchainService.sign(toolName, args);
        } catch (e) {
            console.warn('[MCP] TrustChain signing skipped:', (e as Error).message);
            if (this.isMutatingTool(toolName)) {
                throw new Error(`[MCP][TrustChain] Fail-closed: мутационный tool "${toolName}" запрещен без подписи`);
            }
        }
        const documentMode = (typeof window !== 'undefined')
            ? (window as any).__trustchain_document_mode?.mode
            : undefined;
        const tcPayload = tcEnvelope
            ? {
                ...tcEnvelope,
                mcp_server_id: serverId,
                ...(documentMode ? { document_mode: documentMode } : {}),
            }
            : undefined;

        // Helper: attach TrustChain metadata to raw result
        const attachSignature = (rawResult: any) => {
            if (!tcEnvelope) return rawResult;
            // If result is an array of content blocks, wrap them
            if (Array.isArray(rawResult)) {
                return {
                    content: rawResult,
                    signature: tcEnvelope.signature,
                    signature_id: `sig_${tcEnvelope.sequence}`,
                    timestamp: Date.parse(tcEnvelope.timestamp) / 1000,
                    certificate: tcEnvelope.certificate,
                };
            }
            // If result is already an object, merge
            if (rawResult && typeof rawResult === 'object') {
                return {
                    ...rawResult,
                    signature: rawResult.signature || tcEnvelope.signature,
                    signature_id: rawResult.signature_id || `sig_${tcEnvelope.sequence}`,
                    timestamp: rawResult.timestamp || Date.parse(tcEnvelope.timestamp) / 1000,
                    certificate: rawResult.certificate || tcEnvelope.certificate,
                };
            }
            return rawResult;
        };

        // Streamable HTTP MCP protocol (Playwright, etc.)
        if (config.transport === 'streamable-http') {
            const result = await this.streamableHTTPCall(config, 'tools/call', {
                name: toolName,
                arguments: args,
                ...(tcPayload ? { trustchain: tcPayload } : {})
            });
            const normalized = result?.content || result;
            const deny = this.extractPolicyDeny(normalized);
            if (deny) {
                if (this.shouldAllowUnsignedReadFallback(config, toolName, deny.code, deny.message)) {
                    console.warn(`[MCP][Trust] Unsigned read fallback for ${toolName}: ${deny.code || 'DENY'}`);
                    const retry = await this.streamableHTTPCall(config, 'tools/call', {
                        name: toolName,
                        arguments: args,
                    });
                    const retryNormalized = retry?.content || retry;
                    return (retryNormalized && typeof retryNormalized === 'object')
                        ? { ...retryNormalized, trustchain_fallback_unsigned: true }
                        : { result: retryNormalized, trustchain_fallback_unsigned: true };
                }
                throw new Error(`[MCP][Policy] ${deny.code || 'DENY'}: ${deny.message || 'Tool denied'}`);
            }
            return attachSignature(normalized);
        }

        if (config.transport === 'http' || config.transport === 'sse') {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            try {
                const response = await fetch(`${config.url}/tools/call`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {})
                    },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        method: 'tools/call',
                        params: { name: toolName, arguments: args },
                        // TrustChain: cryptographic signature of this call
                        ...(tcPayload ? { trustchain: tcPayload } : {}),
                        id: Date.now()
                    }),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(`MCP tool call failed: HTTP ${response.status}`);
                }

                const data = await response.json();
                const rawResult = data.result?.content || data.result || data;
                const deny = this.extractPolicyDeny(rawResult);
                if (deny) {
                    if (this.shouldAllowUnsignedReadFallback(config, toolName, deny.code, deny.message)) {
                        console.warn(`[MCP][Trust] Unsigned read fallback for ${toolName}: ${deny.code || 'DENY'}`);
                        const retryResponse = await fetch(`${config.url}/tools/call`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {})
                            },
                            body: JSON.stringify({
                                jsonrpc: '2.0',
                                method: 'tools/call',
                                params: { name: toolName, arguments: args },
                                id: Date.now()
                            }),
                            signal: controller.signal
                        });
                        if (!retryResponse.ok) {
                            throw new Error(`MCP unsigned fallback failed: HTTP ${retryResponse.status}`);
                        }
                        const retryData = await retryResponse.json();
                        const retryRaw = retryData.result?.content || retryData.result || retryData;
                        const retryDeny = this.extractPolicyDeny(retryRaw);
                        if (retryDeny) {
                            throw new Error(`[MCP][Policy] ${retryDeny.code || 'DENY'}: ${retryDeny.message || 'Tool denied'}`);
                        }
                        const attached = attachSignature(retryRaw);
                        return (attached && typeof attached === 'object')
                            ? { ...attached, trustchain_fallback_unsigned: true }
                            : { result: attached, trustchain_fallback_unsigned: true };
                    }
                    throw new Error(`[MCP][Policy] ${deny.code || 'DENY'}: ${deny.message || 'Tool denied'}`);
                }
                return attachSignature(rawResult);
            } catch (error: any) {
                clearTimeout(timeoutId);
                throw error;
            }
        }

        // stdio — через backend proxy
        const response = await fetch(`${BACKEND_URL}/api/agent/mcp/call`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                serverId: config.id, toolName, args,
                ...(tcPayload ? { trustchain: tcPayload } : {})
            })
        });

        if (!response.ok) {
            throw new Error(`MCP proxy call failed: HTTP ${response.status}`);
        }

        const data = await response.json();
        return attachSignature(data.result || data);
    }

    // ──────────────────────────────────────────────
    // OpenAI Format Conversion
    // ──────────────────────────────────────────────

    /**
     * Конвертирует MCP tools в формат OpenAI function calling
     */
    convertToOpenAITools(): Array<{ type: 'function'; function: any }> {
        const openaiTools: Array<{ type: 'function'; function: any }> = [];

        for (const [serverId, connection] of this.connections) {
            if (connection.status !== 'connected') continue;

            for (const tool of connection.tools) {
                openaiTools.push({
                    type: 'function',
                    function: {
                        name: `mcp_${serverId}_${tool.name}`,
                        description: `[MCP:${connection.config.name}] ${tool.description}`,
                        parameters: tool.inputSchema || {
                            type: 'object',
                            properties: {},
                            required: []
                        }
                    }
                });
            }
        }

        return openaiTools;
    }

    /**
     * Проверяет, является ли tool name MCP-инструментом,
     * и если да — роутит вызов на нужный сервер
     */
    isMCPTool(toolName: string): boolean {
        return toolName.startsWith('mcp_');
    }

    /**
     * Парсит MCP tool name → serverId + originalToolName
     */
    parseMCPToolName(toolName: string): { serverId: string; originalName: string } | null {
        if (!toolName.startsWith('mcp_')) return null;

        const parts = toolName.slice(4); // Remove 'mcp_'
        // Find which server this belongs to
        for (const serverId of this.connections.keys()) {
            if (parts.startsWith(`${serverId}_`)) {
                return {
                    serverId,
                    originalName: parts.slice(serverId.length + 1)
                };
            }
        }
        return null;
    }

    /**
     * Legacy alias fallback:
     * when model emits a plain domain tool (e.g. list_documents),
     * try to resolve it to an actual connected MCP tool name.
     */
    resolveLegacyToolAlias(toolName: string): string | null {
        const raw = String(toolName || '').trim();
        if (!raw || raw.startsWith('mcp_')) return null;
        for (const [serverId, connection] of this.connections) {
            if (connection.status !== 'connected') continue;
            const match = connection.tools.find((t) => t?.name === raw);
            if (match) return `mcp_${serverId}_${raw}`;
        }
        return null;
    }

    /**
     * Выполняет MCP tool call, парсит tool name автоматически
     */
    async executeMCPTool(toolName: string, args: Record<string, any>): Promise<any> {
        const parsed = this.parseMCPToolName(toolName);
        if (!parsed) {
            throw new Error(`Invalid MCP tool name: ${toolName}`);
        }
        return this.callTool(parsed.serverId, parsed.originalName, args);
    }

    // ──────────────────────────────────────────────
    // Status & Info
    // ──────────────────────────────────────────────

    /**
     * Получает статус всех подключений
     */
    getStatus(): Array<{ id: string; name: string; status: string; tools: number; error?: string }> {
        const result = [];
        for (const [id, conn] of this.connections) {
            result.push({
                id,
                name: conn.config.name,
                status: conn.status,
                tools: conn.tools.length,
                error: conn.lastError
            });
        }
        return result;
    }

    /**
     * Количество подключённых серверов
     */
    get connectedCount(): number {
        return [...this.connections.values()].filter(c => c.status === 'connected').length;
    }

    /**
     * Общее количество доступных MCP tools
     */
    get totalToolCount(): number {
        let count = 0;
        for (const conn of this.connections.values()) {
            if (conn.status === 'connected') count += conn.tools.length;
        }
        return count;
    }
}
