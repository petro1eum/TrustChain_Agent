/**
 * Backend Signing Service — bridges frontend tool calls to backend Ed25519 signing.
 *
 * Calls POST /api/trustchain/chain/record so that every tool call from SmartAIAgent
 * gets a backend-issued Ed25519 signature (same key as agent_runtime.py).
 * Non-blocking: errors are logged but never thrown to avoid disrupting the agent.
 */

export interface BackendSignature {
    id: string;
    signature: string;
    parent_signature: string | null;
    verified: boolean;
    key_id: string;
    algorithm: 'Ed25519';
}

const SIGN_TIMEOUT = 5000; // 5s — fire-and-forget shouldn't block agent

function getBaseUrl(): string {
    return (
        (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_URL) || ''
    );
}

/**
 * Sign a tool call via the backend's TrustChain API (Ed25519).
 * Returns null on any failure (network, backend down, timeout).
 */
export async function signViaBackend(
    toolName: string,
    args: Record<string, any>,
    resultPreview: string,
    latencyMs: number
): Promise<BackendSignature | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SIGN_TIMEOUT);

    try {
        const resp = await fetch(`${getBaseUrl()}/api/trustchain/chain/record`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                tool: toolName,
                data: {
                    args,
                    result_preview: resultPreview.slice(0, 500),
                },
                latency_ms: latencyMs,
            }),
        });

        if (!resp.ok) {
            console.warn(`[BackendSigning] HTTP ${resp.status} for ${toolName}`);
            return null;
        }

        const data = await resp.json();
        return data as BackendSignature;
    } catch (err: any) {
        if (err.name === 'AbortError') {
            console.warn(`[BackendSigning] Timeout for ${toolName}`);
        } else {
            console.warn(`[BackendSigning] Failed for ${toolName}:`, err.message);
        }
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Sign a reasoning/thinking step via backend StreamingReasoningChain.
 * Returns null on failure.
 */
export async function signReasoningViaBackend(
    steps: string[]
): Promise<{ name: string; steps: any[]; all_verified: boolean } | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SIGN_TIMEOUT);

    try {
        const resp = await fetch(`${getBaseUrl()}/api/trustchain-pro/streaming/sign-reasoning`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({ steps }),
        });

        if (!resp.ok) return null;
        return await resp.json();
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Record a tool call in TrustChainAnalytics (per-tool metrics).
 * Fire-and-forget — never blocks the agent.
 */
export async function recordAnalyticsViaBackend(
    toolName: string,
    latencyMs: number,
    success: boolean
): Promise<void> {
    try {
        fetch(`${getBaseUrl()}/api/trustchain-pro/analytics/record`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tool: toolName, latency_ms: latencyMs, success }),
        }).catch(() => { }); // fully fire-and-forget
    } catch {
        // silent
    }
}

/**
 * Add a node to the ExecutionGraph (DAG of tool calls).
 * Fire-and-forget — never blocks the agent.
 */
export async function recordGraphNodeViaBackend(
    toolName: string,
    args: Record<string, any>,
    resultPreview: string,
    sessionId: string = 'frontend'
): Promise<void> {
    try {
        fetch(`${getBaseUrl()}/api/trustchain-pro/graph/add-node`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: sessionId,
                tool: toolName,
                args,
                result_preview: resultPreview.slice(0, 500),
            }),
        }).catch(() => { }); // fully fire-and-forget
    } catch {
        // silent
    }
}
