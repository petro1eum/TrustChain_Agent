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

// ─── Константы ───

const DEFAULT_TIMEOUT = 15000;
const DISCOVERY_CACHE_TTL = 5 * 60 * 1000; // 5 минут

// Backend URL
const _proc = typeof process !== 'undefined' ? process.env : {} as Record<string, string | undefined>;
const BACKEND_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_URL)
    || _proc.VITE_BACKEND_URL
    || '';  // No default — skip backend calls when not configured

// ─── Сервис ───

export class MCPClientService {
    private connections: Map<string, MCPServerConnection> = new Map();
    private toolCache: Map<string, { tools: any[]; timestamp: number }> = new Map();
    private sessionIds: Map<string, string> = new Map();  // serverId → mcp-session-id

    // ──────────────────────────────────────────────
    // Connection Management
    // ──────────────────────────────────────────────

    /**
     * Подключается к MCP серверу и обнаруживает его tools/resources
     */
    async connect(config: MCPServerConfig): Promise<MCPServerConnection> {
        console.log(`[MCP] Connecting to ${config.name} at ${config.url} (transport: ${config.transport})...`);

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

        const config = connection.config;
        const timeout = config.timeout || DEFAULT_TIMEOUT;

        // ── TrustChain: sign the outgoing call ──
        let tcEnvelope: TrustChainEnvelope | undefined;
        try {
            tcEnvelope = await trustchainService.sign(toolName, args);
        } catch (e) {
            console.warn('[MCP] TrustChain signing skipped:', (e as Error).message);
        }

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
                arguments: args
            });
            return attachSignature(result?.content || result);
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
                        ...(tcEnvelope ? { trustchain: tcEnvelope } : {}),
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
                ...(tcEnvelope ? { trustchain: tcEnvelope } : {})
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
