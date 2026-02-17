/**
 * TrustChain Tools — OpenAI function calling specs for TrustChain Agent.
 *
 * Implements 15 tools across 3 tiers:
 *   OSS (6):  tc_sign, tc_verify_chain, tc_get_audit_trail, tc_get_stats, tc_security_scan, tc_git_diff
 *   PRO (5):  tc_execution_graph, tc_analytics_snapshot, tc_policy_evaluate, tc_kms_keys, tc_kms_rotate
 *   ENT (4):  tc_compliance_report, tc_tsa_timestamp, tc_tsa_verify, tc_airgap_status
 *
 * Each tool maps to a real backend endpoint in:
 *   - backend/routers/trustchain_api.py     (OSS)
 *   - backend/routers/trustchain_pro_api.py (PRO/ENT)
 */

// ── OSS Tools ──

export const trustchainOssTools = [
    {
        type: 'function',
        function: {
            name: 'tc_sign',
            description: 'Sign data using Ed25519 cryptographic signature. Creates an unforgeable audit entry in the TrustChain. Returns signature, key_id, and verification status.',
            parameters: {
                type: 'object',
                properties: {
                    tool: { type: 'string', description: 'Tool name being signed (e.g., "security_scan")' },
                    data: { type: 'object', description: 'Data payload to sign (will be canonicalized and hashed)' },
                },
                required: ['tool', 'data'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'tc_verify_chain',
            description: 'Verify the integrity of the entire TrustChain operation chain. Checks that all signatures are valid, the chain is unbroken (no forks, replays, or orphans), and all nonces are unique.',
            parameters: {
                type: 'object',
                properties: {},
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'tc_get_audit_trail',
            description: 'Get the signed audit trail — list of all cryptographically signed operations in the current session. Each entry includes tool name, args hash, signature, timestamp, and chain link.',
            parameters: {
                type: 'object',
                properties: {
                    limit: { type: 'number', description: 'Max number of entries to return (default 100)' },
                    offset: { type: 'number', description: 'Skip first N entries (default 0)' },
                },
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'tc_get_stats',
            description: 'Get aggregate TrustChain statistics: total operations, success rate, average signing latency, chain length, policy violations, and per-tool metrics.',
            parameters: {
                type: 'object',
                properties: {},
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'tc_security_scan',
            description: 'Run a security scan on the project: check dependencies for known CVEs (npm audit / pip audit), scan for secrets in code, and check file permissions. Results are cryptographically signed.',
            parameters: {
                type: 'object',
                properties: {
                    depth: { type: 'string', enum: ['quick', 'full'], description: 'Scan depth: "quick" (deps only) or "full" (deps + code + secrets)' },
                    modules: {
                        type: 'array', items: { type: 'string' },
                        description: 'Specific modules/directories to scan (default: all)',
                    },
                },
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'tc_git_diff',
            description: 'Analyze git changes in the repository. Returns a signed diff summary with files changed, lines added/removed, and change categories. The result is cryptographically signed for audit trail.',
            parameters: {
                type: 'object',
                properties: {
                    commit: { type: 'string', description: 'Git ref to diff against (default: HEAD~1)' },
                    path: { type: 'string', description: 'Specific path to diff (default: all files)' },
                },
                required: [],
            },
        },
    },
];

// ── PRO Tools ──

export const trustchainProTools = [
    {
        type: 'function',
        function: {
            name: 'tc_execution_graph',
            description: 'Build an execution DAG (Directed Acyclic Graph) from the current chain of signed operations. Detects forks, replays, and orphan nodes. Returns graph stats and a Mermaid diagram for visualization.',
            parameters: {
                type: 'object',
                properties: {},
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'tc_analytics_snapshot',
            description: 'Get a real-time analytics snapshot: operations count, verification rate, throughput (ops/sec), average latency, per-tool metrics, and policy violations. [PRO feature]',
            parameters: {
                type: 'object',
                properties: {},
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'tc_policy_evaluate',
            description: 'Evaluate a tool call against loaded security policies. Returns allow/deny decision with policy name and reason. Load policies with YAML first. [PRO feature]',
            parameters: {
                type: 'object',
                properties: {
                    tool_id: { type: 'string', description: 'Tool ID to evaluate' },
                    args: { type: 'object', description: 'Tool arguments to check against policies' },
                    context: { type: 'object', description: 'Additional context (user role, tenant, etc.)' },
                },
                required: ['tool_id'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'tc_kms_keys',
            description: 'Get information about available cryptographic keys: key ID, algorithm, provider (local/HSM/cloud KMS), status, and rotation schedule. [PRO feature]',
            parameters: {
                type: 'object',
                properties: {},
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'tc_kms_rotate',
            description: 'Rotate the active signing key. Creates a new Ed25519 key pair, archives the old one, and updates all active sessions. [PRO feature]',
            parameters: {
                type: 'object',
                properties: {},
                required: [],
            },
        },
    },
];

// ── Enterprise Tools ──

export const trustchainEnterpriseTools = [
    {
        type: 'function',
        function: {
            name: 'tc_compliance_report',
            description: 'Generate a compliance evidence report from the TrustChain audit trail. Evaluates all signed operations against regulatory framework controls (SOC 2, HIPAA, or EU AI Act). Returns score, control pass/fail status, and evidence. [Enterprise feature]',
            parameters: {
                type: 'object',
                properties: {
                    framework: {
                        type: 'string',
                        enum: ['soc2', 'hipaa', 'ai_act'],
                        description: 'Compliance framework to evaluate against',
                    },
                    type: { type: 'string', description: 'Report type (e.g., "type_ii" for SOC 2)' },
                },
                required: ['framework'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'tc_tsa_timestamp',
            description: 'Generate an RFC 3161 timestamp for data using the local Timestamp Authority (TSA). Provides independent time attestation for audit entries. [Enterprise feature]',
            parameters: {
                type: 'object',
                properties: {
                    data: { type: 'string', description: 'Data to timestamp (will be hashed)' },
                },
                required: ['data'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'tc_tsa_verify',
            description: 'Verify an RFC 3161 timestamp against the original data. Confirms that the data existed at the claimed time. [Enterprise feature]',
            parameters: {
                type: 'object',
                properties: {
                    data: { type: 'string', description: 'Original data that was timestamped' },
                    timestamp_response: { type: 'object', description: 'TSA timestamp response to verify' },
                },
                required: ['data', 'timestamp_response'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'tc_airgap_status',
            description: 'Check air-gap capabilities of the TrustChain deployment. Reports whether the system can operate fully offline with local signing, local TSA, and embedded policy engine. [Enterprise feature]',
            parameters: {
                type: 'object',
                properties: {},
                required: [],
            },
        },
    },
];

// ── Combined export ──

export const trustchainTools = [
    ...trustchainOssTools,
    ...trustchainProTools,
    ...trustchainEnterpriseTools,
];

/** Tool ID → Tier mapping */
export const TRUSTCHAIN_TOOL_TIERS: Record<string, 'oss' | 'pro' | 'enterprise'> = {
    tc_sign: 'oss',
    tc_verify_chain: 'oss',
    tc_get_audit_trail: 'oss',
    tc_get_stats: 'oss',
    tc_security_scan: 'oss',
    tc_git_diff: 'oss',
    tc_execution_graph: 'pro',
    tc_analytics_snapshot: 'pro',
    tc_policy_evaluate: 'pro',
    tc_kms_keys: 'pro',
    tc_kms_rotate: 'pro',
    tc_compliance_report: 'enterprise',
    tc_tsa_timestamp: 'enterprise',
    tc_tsa_verify: 'enterprise',
    tc_airgap_status: 'enterprise',
};
