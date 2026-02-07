/**
 * Gap B: MCP (Model Context Protocol) Client Service
 * 
 * Поддержка динамического подключения внешних MCP серверов
 * для расширения возможностей агента без изменения кода.
 * 
 * MCP spec: https://modelcontextprotocol.io
 */

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
    transport: 'stdio' | 'sse' | 'http';
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
}

// ─── Константы ───

const DEFAULT_TIMEOUT = 15000;
const DISCOVERY_CACHE_TTL = 5 * 60 * 1000; // 5 минут

// Backend URL
const BACKEND_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_URL)
    || process.env.VITE_BACKEND_URL
    || 'http://localhost:8000';

// ─── Сервис ───

export class MCPClientService {
    private connections: Map<string, MCPServerConnection> = new Map();
    private toolCache: Map<string, { tools: any[]; timestamp: number }> = new Map();

    // ──────────────────────────────────────────────
    // Connection Management
    // ──────────────────────────────────────────────

    /**
     * Подключается к MCP серверу и обнаруживает его tools/resources
     */
    async connect(config: MCPServerConfig): Promise<MCPServerConnection> {
        console.log(`[MCP] Connecting to ${config.name} at ${config.url}...`);

        try {
            // Получаем список tools от MCP сервера
            const tools = await this.discoverTools(config);
            const resources = await this.discoverResources(config);

            const connection: MCPServerConnection = {
                config,
                tools,
                resources,
                status: 'connected',
                connectedAt: Date.now()
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
        // Пробуем загрузить из backend
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
     */
    async connectAll(): Promise<MCPServerConnection[]> {
        const configs = await this.loadServerConfigs();
        const results: MCPServerConnection[] = [];

        for (const config of configs.filter(c => c.enabled)) {
            const conn = await this.connect(config);
            results.push(conn);
        }

        return results;
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
     * Вызывает tool на MCP сервере
     */
    async callTool(serverId: string, toolName: string, args: Record<string, any>): Promise<any> {
        const connection = this.connections.get(serverId);
        if (!connection || connection.status !== 'connected') {
            throw new Error(`MCP server ${serverId} is not connected`);
        }

        const config = connection.config;
        const timeout = config.timeout || DEFAULT_TIMEOUT;

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
                        id: Date.now()
                    }),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(`MCP tool call failed: HTTP ${response.status}`);
                }

                const data = await response.json();
                return data.result?.content || data.result || data;
            } catch (error: any) {
                clearTimeout(timeoutId);
                throw error;
            }
        }

        // stdio — через backend proxy
        const response = await fetch(`${BACKEND_URL}/api/agent/mcp/call`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serverId: config.id, toolName, args })
        });

        if (!response.ok) {
            throw new Error(`MCP proxy call failed: HTTP ${response.status}`);
        }

        const data = await response.json();
        return data.result || data;
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
