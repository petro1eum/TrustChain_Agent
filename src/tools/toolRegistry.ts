/**
 * Tool Registry — центральный реестр метаданных инструментов агента.
 *
 * Определяет: категорию, risk-level, locked-статус (нельзя отключить),
 * и default-enabled для каждого инструмента.
 *
 * NOTE: kb-catalog specific tools (Frontend Navigation, Category Management,
 * Category Diagnostics, Search & Export) live in the kb-catalog project
 * at: admin_app_backend/ai_studio/app/src/agents/tools/kbToolRegistry.ts
 */

// ── Types ──

export type ToolCategory =
    | 'Code Execution'
    | 'Backend API'
    | 'Files & Data'
    | 'Web'
    | 'Code Analysis'
    | 'Browser'
    | 'MCP'
    | 'Data Processing'
    | 'Memory'
    | 'TrustChain';

export type RiskLevel = 'safe' | 'moderate' | 'dangerous';

export interface ToolParameter {
    name: string;
    type: string;
    description: string;
    required: boolean;
    defaultValue?: string;
    enum?: string[];
}

export interface ToolMeta {
    id: string;
    name: string;
    description: string;
    category: ToolCategory;
    riskLevel: RiskLevel;
    locked: boolean;           // true → always on, toggle disabled
    defaultEnabled: boolean;   // initial state for new users
    parameters?: ToolParameter[];  // input schema for detail view
}

// ── Category helpers ──

// (Category icons handled by Lucide components in ToolManager.tsx)

const CATEGORY_DESCRIPTIONS: Record<ToolCategory, string> = {
    'Code Execution': 'Run code, bash commands, manage files inside Docker sandbox',
    'Backend API': 'Interact with the backend REST API (endpoints, YAML configs)',
    'Files & Data': 'Search & read project files, extract tables, synonyms preview',
    'Web': 'Web search and page fetching',
    'Code Analysis': 'AST-level code analysis — structure, symbols, dependencies',
    'Browser': 'Headless browser — navigate, screenshot, extract (Playwright)',
    'MCP': 'Model Context Protocol — dynamic tool servers (stdio/sse/http)',
    'Data Processing': 'Text processing, semantic analysis, data quality, normalization',
    'Memory': 'Persistent memory — cross-session knowledge, facts, preferences',
    'TrustChain': 'Cryptographic signing, verification, compliance, analytics — OSS/PRO/ENT tiers',
};

const CATEGORY_RISK: Record<ToolCategory, RiskLevel> = {
    'Code Execution': 'dangerous',
    'Backend API': 'moderate',
    'Files & Data': 'safe',
    'Web': 'safe',
    'Code Analysis': 'safe',
    'Browser': 'moderate',
    'MCP': 'moderate',
    'Data Processing': 'safe',
    'Memory': 'safe',
    'TrustChain': 'moderate',
};

// ── Registry ──

function t(
    id: string,
    name: string,
    description: string,
    category: ToolCategory,
    opts: { locked?: boolean; defaultEnabled?: boolean; riskLevel?: RiskLevel; params?: ToolParameter[] } = {},
): ToolMeta {
    return {
        id,
        name,
        description,
        category,
        riskLevel: opts.riskLevel ?? CATEGORY_RISK[category],
        locked: opts.locked ?? false,
        defaultEnabled: opts.defaultEnabled ?? true,
        parameters: opts.params,
    };
}

const p = (name: string, type: string, description: string, required = true): ToolParameter => ({
    name, type, description, required,
});

const TOOL_REGISTRY: ToolMeta[] = [
    // ── Code Execution (11) ──
    t('execute_code', 'Execute Code', 'Run code snippets in a sandboxed environment', 'Code Execution', {
        locked: true,
        params: [p('code', 'string', 'Source code to execute'), p('language', 'string', 'Programming language', false)],
    }),
    t('execute_bash', 'Execute Bash', 'Run bash commands in the sandbox', 'Code Execution', {
        locked: true,
        params: [p('command', 'string', 'Bash command to execute')],
    }),
    t('bash_tool', 'Bash Tool', 'Execute arbitrary bash commands in Docker container', 'Code Execution', {
        locked: true,
        params: [p('command', 'string', 'Command line to execute'), p('timeout', 'number', 'Timeout in seconds', false)],
    }),
    t('view', 'View File', 'View file contents inside Docker sandbox', 'Code Execution', {
        locked: true,
        params: [p('path', 'string', 'File path to view'), p('line_start', 'number', 'Start line', false), p('line_end', 'number', 'End line', false)],
    }),
    t('create_file', 'Create File', 'Create or overwrite a file in Docker sandbox', 'Code Execution', {
        locked: true,
        params: [p('path', 'string', 'File path'), p('content', 'string', 'File content')],
    }),
    t('str_replace', 'String Replace', 'Replace text in a file (sed-like)', 'Code Execution', {
        locked: true,
        params: [p('path', 'string', 'File path'), p('old_str', 'string', 'Text to find'), p('new_str', 'string', 'Replacement text')],
    }),
    t('import_tool', 'Import Tool', 'Import a tool definition from storage', 'Code Execution', { params: [p('name', 'string', 'Tool name')] }),
    t('save_tool', 'Save Tool', 'Save a tool definition to storage', 'Code Execution', { params: [p('name', 'string', 'Tool name'), p('definition', 'object', 'Tool definition JSON')] }),
    t('list_tools', 'List Tools', 'List all saved tool definitions', 'Code Execution'),
    t('load_tool', 'Load Tool', 'Load a specific tool by name', 'Code Execution', { params: [p('name', 'string', 'Tool name')] }),
    t('create_artifact', 'Create Artifact', 'Create charts, graphs, and visual artifacts', 'Code Execution', {
        locked: true,
        params: [p('type', 'string', 'Artifact type (chart, table, html)'), p('title', 'string', 'Display title'), p('content', 'string', 'Artifact content (code/html)')],
    }),

    // ── Backend API (5) ──
    t('list_api_endpoints', 'List Endpoints', 'List all available backend API endpoints', 'Backend API'),
    t('list_data_files', 'List Data Files', 'List available data files on the server', 'Backend API'),
    t('backend_api_call', 'API Call', 'Make a call to a backend API endpoint', 'Backend API'),
    t('get_yaml_file', 'Get YAML', 'Read a YAML configuration file', 'Backend API'),
    t('save_yaml_file', 'Save YAML', 'Save a YAML configuration file', 'Backend API'),

    // ── Files & Data (4) ──
    t('search_files_by_name', 'Search Files', 'Search for files by name pattern', 'Files & Data'),
    t('read_project_file', 'Read File', 'Read a project file contents', 'Files & Data'),
    t('get_synonyms_preview', 'Synonyms Preview', 'Preview synonyms for a term', 'Files & Data'),
    t('extract_table_to_excel', 'Extract to Excel', 'Extract a table from data to Excel format', 'Files & Data'),

    // ── Web (2) ──
    t('web_search', 'Web Search', 'Search the web for information', 'Web', { locked: true }),
    t('web_fetch', 'Web Fetch', 'Fetch and parse a web page', 'Web', { locked: true }),

    // ── Code Analysis (3) ──
    t('analyze_code_structure', 'Code Structure', 'Analyze code structure via AST', 'Code Analysis'),
    t('search_code_symbols', 'Search Symbols', 'Search for code symbols (functions, etc)', 'Code Analysis'),
    t('get_code_dependencies', 'Code Dependencies', 'Get dependency graph of a module', 'Code Analysis'),

    // ── Browser (3) ──
    t('browser_navigate', 'Navigate', 'Navigate to a URL in headless browser', 'Browser'),
    t('browser_screenshot', 'Screenshot', 'Take a screenshot of the current page', 'Browser'),
    t('browser_extract', 'Extract', 'Extract content from the current page', 'Browser'),

    // ── MCP — Model Context Protocol (3) ──
    t('mcp_connect', 'MCP Connect', 'Connect to an MCP server (stdio/sse/http)', 'MCP'),
    t('mcp_disconnect', 'MCP Disconnect', 'Disconnect from an MCP server', 'MCP'),
    t('mcp_call_tool', 'MCP Call Tool', 'Execute a tool on a connected MCP server', 'MCP'),

    // ── Data Processing (7) ──
    t('text_processing', 'Text Processing', 'Clean, normalize, extract emails/phones from text', 'Data Processing'),
    t('semantic_analysis', 'Semantic Analysis', 'LLM-based semantic analysis of data', 'Data Processing'),
    t('missing_data', 'Missing Data', 'Handle missing data (drop, fill, interpolate, KNN)', 'Data Processing'),
    t('normalize_data', 'Normalize Data', 'Normalize and standardize data values', 'Data Processing'),
    t('outliers', 'Outliers', 'Detect and handle outliers in data', 'Data Processing'),
    t('pandas_operation', 'Pandas Operation', 'Execute pandas-like operations on data', 'Data Processing'),
    t('data_quality_analysis', 'Data Quality', 'Analyze data quality and generate reports', 'Data Processing'),

    // ── Memory (2) ──
    t('memory_save', 'Save Memory', 'Save knowledge/preference to persistent memory', 'Memory'),
    t('memory_recall', 'Recall Memory', 'Recall relevant facts from persistent memory', 'Memory'),

    // ── TrustChain OSS (6) ──
    t('tc_sign', 'Sign Data', 'Sign data with Ed25519 cryptographic signature', 'TrustChain', { locked: true }),
    t('tc_verify_chain', 'Verify Chain', 'Verify operation chain integrity', 'TrustChain', { locked: true }),
    t('tc_get_audit_trail', 'Audit Trail', 'Get signed operation history', 'TrustChain'),
    t('tc_get_stats', 'TC Stats', 'Get signing statistics and metrics', 'TrustChain'),
    t('tc_security_scan', 'Security Scan', 'Scan for CVEs with signed results', 'TrustChain'),
    t('tc_git_diff', 'Git Diff', 'Analyze git changes (signed)', 'TrustChain'),

    // ── TrustChain PRO (5) ──
    t('tc_execution_graph', 'Execution Graph', 'Build execution DAG with fork/replay detection', 'TrustChain'),
    t('tc_analytics_snapshot', 'Analytics', 'Get real-time analytics metrics', 'TrustChain'),
    t('tc_policy_evaluate', 'Policy Check', 'Evaluate tool call against policies', 'TrustChain'),
    t('tc_kms_keys', 'KMS Keys', 'Key management status', 'TrustChain'),
    t('tc_kms_rotate', 'Key Rotate', 'Rotate Ed25519 signing key', 'TrustChain'),

    // ── TrustChain Enterprise (4) ──
    t('tc_compliance_report', 'Compliance Report', 'Generate SOC2/HIPAA/AI Act report', 'TrustChain'),
    t('tc_tsa_timestamp', 'TSA Timestamp', 'Generate RFC 3161 timestamp', 'TrustChain'),
    t('tc_tsa_verify', 'TSA Verify', 'Verify TSA timestamp', 'TrustChain'),
    t('tc_airgap_status', 'Air-Gap Status', 'Check air-gap capabilities', 'TrustChain'),
];

// ── Public API ──

export function getToolRegistry(): ToolMeta[] {
    return TOOL_REGISTRY;
}

export function getLockedToolIds(): Set<string> {
    return new Set(TOOL_REGISTRY.filter(t => t.locked).map(t => t.id));
}

export function getDefaultEnabledToolIds(): Set<string> {
    return new Set(TOOL_REGISTRY.filter(t => t.defaultEnabled).map(t => t.id));
}

export function getCategoryDescription(cat: ToolCategory): string {
    return CATEGORY_DESCRIPTIONS[cat] || '';
}

export function getCategoryRisk(cat: ToolCategory): RiskLevel {
    return CATEGORY_RISK[cat] || 'safe';
}

/**
 * Load enabled tool IDs from localStorage, or return defaults.
 * Locked tools are always included.
 */
export function loadEnabledToolIds(): Set<string> {
    const locked = getLockedToolIds();
    try {
        const saved = localStorage.getItem('agent_enabled_tools');
        if (saved) {
            const parsed: string[] = JSON.parse(saved);
            const set = new Set(parsed);
            // Guarantee locked tools are always in
            for (const id of locked) set.add(id);
            return set;
        }
    } catch {
        // corrupt data → reset to defaults
    }
    return getDefaultEnabledToolIds();
}

/**
 * Save enabled tool IDs to localStorage.
 * Locked tools are always included.
 */
export function saveEnabledToolIds(ids: Set<string>): void {
    const locked = getLockedToolIds();
    for (const id of locked) ids.add(id);
    localStorage.setItem('agent_enabled_tools', JSON.stringify([...ids]));
}
