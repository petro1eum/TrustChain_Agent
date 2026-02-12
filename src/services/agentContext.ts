/**
 * Agent Context — singleton that holds the current deployment context.
 * Set once from PanelApp URL params (?instance=myapp&context=dashboard).
 * 
 * `instance` is used ONLY as a namespace for localStorage isolation.
 * The agent does NOT use instance to determine behavior or tools —
 * all platform-specific tools come exclusively via MCP protocol.
 */

let currentInstance: string = 'default';
let currentContext: string | null = null;

/**
 * Initialize the agent context. Called once from PanelApp on mount.
 */
export function setAgentContext(instance: string, context: string | null): void {
    currentInstance = instance || 'default';
    currentContext = context;
    console.log(`[AgentContext] instance=${currentInstance}, context=${currentContext}`);
}

/** Current platform instance (namespace for localStorage isolation) */
export function getAgentInstance(): string { return currentInstance; }

/** Current page context (dashboard, documents, risk_tree, etc.) */
export function getAgentContext(): string | null { return currentContext; }
