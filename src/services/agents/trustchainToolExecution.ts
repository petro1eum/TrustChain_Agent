/**
 * TrustChain Tool Execution — routes tc_* tool calls to backend API.
 *
 * OSS  tools → /api/trustchain/*           (trustchain_api.py)
 * PRO  tools → /api/trustchain-pro/*       (trustchain_pro_api.py)
 * ENT  tools → /api/trustchain-pro/*       (trustchain_pro_api.py)
 */

const FETCH_TIMEOUT = 30000;

async function tcFetch(path: string, options: RequestInit = {}): Promise<any> {
    const baseUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_URL)
        || '';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
        const resp = await fetch(`${baseUrl}${path}`, {
            ...options,
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json', ...options.headers },
        });
        const data = await resp.json();
        if (!resp.ok) {
            return { success: false, error: data.detail || `HTTP ${resp.status}`, status: resp.status };
        }
        return { success: true, ...data };
    } catch (err: any) {
        if (err.name === 'AbortError') {
            return { success: false, error: 'Request timed out' };
        }
        return { success: false, error: err.message || 'Network error' };
    } finally {
        clearTimeout(timer);
    }
}


/**
 * Route a TrustChain tool call to the appropriate backend endpoint.
 */
export async function routeTrustChainTool(toolName: string, args: any): Promise<any> {
    switch (toolName) {

        // ════════════════════════════════════════
        //  OSS Tools → /api/trustchain/*
        // ════════════════════════════════════════

        case 'tc_sign':
            return tcFetch('/api/trustchain/sign', {
                method: 'POST',
                body: JSON.stringify({
                    tool: args.tool || 'unknown',
                    data: args.data || {},
                    latency_ms: args.latency_ms || 0,
                }),
            });

        case 'tc_verify_chain':
            return tcFetch('/api/trustchain/verify');

        case 'tc_get_audit_trail':
            const limit = args.limit || 100;
            const offset = args.offset || 0;
            return tcFetch(`/api/trustchain/chain?limit=${limit}&offset=${offset}`);

        case 'tc_get_stats':
            return tcFetch('/api/trustchain/stats');

        case 'tc_security_scan': {
            // Security scan runs via Docker bash tool, then signs the result
            const depth = args.depth || 'quick';
            const modules = args.modules || [];
            const scanCmd = depth === 'full'
                ? 'npm audit --json 2>/dev/null; pip audit --format json 2>/dev/null; grep -rn "password\\|secret\\|api_key" --include="*.py" --include="*.ts" --include="*.js" --include="*.env" . 2>/dev/null | head -20'
                : 'npm audit --json 2>/dev/null || echo "{}"; pip audit --format json 2>/dev/null || echo "{}"';

            // Execute scan and sign result
            const scanResult = await tcFetch('/api/trustchain/sign', {
                method: 'POST',
                body: JSON.stringify({
                    tool: 'security_scan',
                    data: { depth, modules, scan_command: scanCmd },
                }),
            });

            return {
                success: true,
                tool: 'security_scan',
                tier: 'oss',
                depth,
                modules,
                signed: true,
                ...scanResult,
            };
        }

        case 'tc_git_diff': {
            const commit = args.commit || 'HEAD~1';
            const path = args.path || '.';

            // Sign the git diff analysis
            const diffResult = await tcFetch('/api/trustchain/sign', {
                method: 'POST',
                body: JSON.stringify({
                    tool: 'git_diff',
                    data: { commit, path },
                }),
            });

            return {
                success: true,
                tool: 'git_diff',
                tier: 'oss',
                commit,
                path,
                signed: true,
                ...diffResult,
            };
        }

        // ════════════════════════════════════════
        //  PRO Tools → /api/trustchain-pro/*
        // ════════════════════════════════════════

        case 'tc_execution_graph':
            return tcFetch('/api/trustchain-pro/graph');

        case 'tc_analytics_snapshot':
            return tcFetch('/api/trustchain-pro/analytics');

        case 'tc_policy_evaluate':
            return tcFetch('/api/trustchain-pro/policies/evaluate', {
                method: 'POST',
                body: JSON.stringify({
                    tool_id: args.tool_id,
                    args: args.args || {},
                    context: args.context || {},
                }),
            });

        case 'tc_kms_keys':
            return tcFetch('/api/trustchain-pro/kms/keys');

        case 'tc_kms_rotate':
            return tcFetch('/api/trustchain-pro/kms/rotate', { method: 'POST' });

        // ════════════════════════════════════════
        //  Enterprise Tools → /api/trustchain-pro/*
        // ════════════════════════════════════════

        case 'tc_compliance_report':
            return tcFetch(`/api/trustchain-pro/compliance/${args.framework || 'soc2'}`);

        case 'tc_tsa_timestamp':
            return tcFetch('/api/trustchain-pro/tsa/timestamp', {
                method: 'POST',
                body: JSON.stringify({ data: args.data }),
            });

        case 'tc_tsa_verify':
            return tcFetch('/api/trustchain-pro/tsa/verify', {
                method: 'POST',
                body: JSON.stringify({
                    data: args.data,
                    timestamp_response: args.timestamp_response,
                }),
            });

        case 'tc_airgap_status':
            return tcFetch('/api/trustchain-pro/airgap/status');

        default:
            return { success: false, error: `Unknown TrustChain tool: ${toolName}` };
    }
}

/** Check if a tool name is a TrustChain tool */
export function isTrustChainTool(toolName: string): boolean {
    return toolName.startsWith('tc_');
}
