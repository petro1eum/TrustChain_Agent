/**
 * toolSourceMap — Maps tool IDs to their real source code locations.
 *
 * This is the REAL mapping of where each tool is defined (OpenAI spec)
 * and where its execution logic lives (routing code).
 */

// ── Source File Info ──

export interface ToolSourceInfo {
    /** File containing the OpenAI function calling spec (JSON schema) */
    specFile: string;
    /** Export name in the spec file */
    specExport: string;
    /** File containing the execution/routing logic */
    executionFile: string;
    /** Method name for execution routing */
    executionMethod: string;
    /** Handler file (if custom handler exists) */
    handlerFile?: string;
}

// ── Tool Source Map ──

const BASE = 'src/';

export const TOOL_SOURCE_MAP: Record<string, ToolSourceInfo> = {
    // ── Code Execution ──
    execute_code: { specFile: `${BASE}tools/codeExecutionTools.ts`, specExport: 'codeExecutionTools', executionFile: `${BASE}services/agents/toolExecutionService.ts`, executionMethod: 'routeToolExecution → execute_code handler' },
    execute_bash: { specFile: `${BASE}tools/codeExecutionTools.ts`, specExport: 'codeExecutionTools', executionFile: `${BASE}services/agents/toolExecutionService.ts`, executionMethod: 'routeToolExecution → execute_bash handler' },
    bash_tool: { specFile: `${BASE}agents/base/toolsSpecification.ts`, specExport: 'basicTools', executionFile: `${BASE}services/agents/toolExecutionService.ts`, executionMethod: 'routeDockerTool' },
    view: { specFile: `${BASE}agents/base/toolsSpecification.ts`, specExport: 'basicTools', executionFile: `${BASE}services/agents/toolExecutionService.ts`, executionMethod: 'routeDockerTool' },
    create_file: { specFile: `${BASE}agents/base/toolsSpecification.ts`, specExport: 'basicTools', executionFile: `${BASE}services/agents/toolExecutionService.ts`, executionMethod: 'routeDockerTool' },
    str_replace: { specFile: `${BASE}agents/base/toolsSpecification.ts`, specExport: 'basicTools', executionFile: `${BASE}services/agents/toolExecutionService.ts`, executionMethod: 'routeDockerTool' },
    create_artifact: { specFile: `${BASE}agents/base/toolsSpecification.ts`, specExport: 'basicTools', executionFile: `${BASE}services/agents/toolExecutionService.ts`, executionMethod: 'routeDockerTool' },
    import_tool: { specFile: `${BASE}tools/codeExecutionTools.ts`, specExport: 'codeExecutionTools', executionFile: `${BASE}services/agents/toolExecutionService.ts`, executionMethod: 'routeToolExecution → import_tool' },
    save_tool: { specFile: `${BASE}tools/codeExecutionTools.ts`, specExport: 'codeExecutionTools', executionFile: `${BASE}services/agents/toolExecutionService.ts`, executionMethod: 'routeToolExecution → save_tool' },
    load_tool: { specFile: `${BASE}tools/codeExecutionTools.ts`, specExport: 'codeExecutionTools', executionFile: `${BASE}services/agents/toolExecutionService.ts`, executionMethod: 'routeToolExecution → load_tool' },
    list_tools: { specFile: `${BASE}tools/codeExecutionTools.ts`, specExport: 'codeExecutionTools', executionFile: `${BASE}services/agents/toolExecutionService.ts`, executionMethod: 'routeToolExecution → list_tools' },

    // ── Backend API ──
    list_api_endpoints: { specFile: `${BASE}tools/backendApiTools.ts`, specExport: 'backendApiTools', executionFile: `${BASE}services/agents/toolExecutionService.ts`, executionMethod: 'routeBackendApiTool' },
    list_data_files: { specFile: `${BASE}tools/backendApiTools.ts`, specExport: 'backendApiTools', executionFile: `${BASE}services/agents/toolExecutionService.ts`, executionMethod: 'routeBackendApiTool' },
    backend_api_call: { specFile: `${BASE}tools/backendApiTools.ts`, specExport: 'backendApiTools', executionFile: `${BASE}services/agents/toolExecutionService.ts`, executionMethod: 'routeBackendApiTool' },
    get_yaml_file: { specFile: `${BASE}tools/backendApiTools.ts`, specExport: 'backendApiTools', executionFile: `${BASE}services/agents/toolExecutionService.ts`, executionMethod: 'routeBackendApiTool' },
    save_yaml_file: { specFile: `${BASE}tools/backendApiTools.ts`, specExport: 'backendApiTools', executionFile: `${BASE}services/agents/toolExecutionService.ts`, executionMethod: 'routeBackendApiTool' },

    // ── Files & Data ──
    search_files_by_name: { specFile: `${BASE}tools/fileTools.ts`, specExport: 'fileTools', executionFile: `${BASE}services/agents/toolExecutionService.ts`, executionMethod: 'routeFileTool' },
    read_project_file: { specFile: `${BASE}tools/fileTools.ts`, specExport: 'fileTools', executionFile: `${BASE}services/agents/toolExecutionService.ts`, executionMethod: 'routeFileTool' },
    get_synonyms_preview: { specFile: `${BASE}tools/fileTools.ts`, specExport: 'fileTools', executionFile: `${BASE}services/agents/toolExecutionService.ts`, executionMethod: 'routeFileTool' },

    // ── Web ──
    web_search: { specFile: `${BASE}tools/webTools.ts`, specExport: 'webTools', executionFile: `${BASE}services/agents/toolExecutionService.ts`, executionMethod: 'routeWebTool' },
    web_fetch: { specFile: `${BASE}tools/webTools.ts`, specExport: 'webTools', executionFile: `${BASE}services/agents/toolExecutionService.ts`, executionMethod: 'routeWebTool' },

    // ── Code Analysis ──
    analyze_code_structure: { specFile: `${BASE}tools/codeAnalysisTools.ts`, specExport: 'codeAnalysisTools', executionFile: `${BASE}services/agents/toolExecutionService.ts`, executionMethod: 'routeCodeAnalysisTool' },
    search_code_symbols: { specFile: `${BASE}tools/codeAnalysisTools.ts`, specExport: 'codeAnalysisTools', executionFile: `${BASE}services/agents/toolExecutionService.ts`, executionMethod: 'routeCodeAnalysisTool' },
    get_code_dependencies: { specFile: `${BASE}tools/codeAnalysisTools.ts`, specExport: 'codeAnalysisTools', executionFile: `${BASE}services/agents/toolExecutionService.ts`, executionMethod: 'routeCodeAnalysisTool' },

    // ── Browser ──
    browser_navigate: { specFile: `${BASE}tools/frontendTools.ts`, specExport: 'frontendTools', executionFile: `${BASE}services/agents/toolExecutionService.ts`, executionMethod: 'routeFrontendTool' },
    browser_screenshot: { specFile: `${BASE}tools/frontendTools.ts`, specExport: 'frontendTools', executionFile: `${BASE}services/agents/toolExecutionService.ts`, executionMethod: 'routeFrontendTool' },
    browser_extract: { specFile: `${BASE}tools/frontendTools.ts`, specExport: 'frontendTools', executionFile: `${BASE}services/agents/toolExecutionService.ts`, executionMethod: 'routeFrontendTool' },

    // ── TrustChain OSS ──
    tc_sign: { specFile: `${BASE}tools/trustchainTools.ts`, specExport: 'trustchainOssTools', executionFile: `${BASE}services/agents/trustchainToolExecution.ts`, executionMethod: 'routeTrustChainTool' },
    tc_verify_chain: { specFile: `${BASE}tools/trustchainTools.ts`, specExport: 'trustchainOssTools', executionFile: `${BASE}services/agents/trustchainToolExecution.ts`, executionMethod: 'routeTrustChainTool' },
    tc_get_audit_trail: { specFile: `${BASE}tools/trustchainTools.ts`, specExport: 'trustchainOssTools', executionFile: `${BASE}services/agents/trustchainToolExecution.ts`, executionMethod: 'routeTrustChainTool' },
    tc_get_stats: { specFile: `${BASE}tools/trustchainTools.ts`, specExport: 'trustchainOssTools', executionFile: `${BASE}services/agents/trustchainToolExecution.ts`, executionMethod: 'routeTrustChainTool' },
    tc_security_scan: { specFile: `${BASE}tools/trustchainTools.ts`, specExport: 'trustchainOssTools', executionFile: `${BASE}services/agents/trustchainToolExecution.ts`, executionMethod: 'routeTrustChainTool' },
    tc_git_diff: { specFile: `${BASE}tools/trustchainTools.ts`, specExport: 'trustchainOssTools', executionFile: `${BASE}services/agents/trustchainToolExecution.ts`, executionMethod: 'routeTrustChainTool' },

    // ── TrustChain PRO ──
    tc_execution_graph: { specFile: `${BASE}tools/trustchainTools.ts`, specExport: 'trustchainProTools', executionFile: `${BASE}services/agents/trustchainToolExecution.ts`, executionMethod: 'routeTrustChainTool' },
    tc_analytics_snapshot: { specFile: `${BASE}tools/trustchainTools.ts`, specExport: 'trustchainProTools', executionFile: `${BASE}services/agents/trustchainToolExecution.ts`, executionMethod: 'routeTrustChainTool' },
    tc_policy_evaluate: { specFile: `${BASE}tools/trustchainTools.ts`, specExport: 'trustchainProTools', executionFile: `${BASE}services/agents/trustchainToolExecution.ts`, executionMethod: 'routeTrustChainTool' },
    tc_kms_keys: { specFile: `${BASE}tools/trustchainTools.ts`, specExport: 'trustchainProTools', executionFile: `${BASE}services/agents/trustchainToolExecution.ts`, executionMethod: 'routeTrustChainTool' },
    tc_kms_rotate: { specFile: `${BASE}tools/trustchainTools.ts`, specExport: 'trustchainProTools', executionFile: `${BASE}services/agents/trustchainToolExecution.ts`, executionMethod: 'routeTrustChainTool' },

    // ── TrustChain Enterprise ──
    tc_compliance_report: { specFile: `${BASE}tools/trustchainTools.ts`, specExport: 'trustchainEnterpriseTools', executionFile: `${BASE}services/agents/trustchainToolExecution.ts`, executionMethod: 'routeTrustChainTool' },
    tc_tsa_timestamp: { specFile: `${BASE}tools/trustchainTools.ts`, specExport: 'trustchainEnterpriseTools', executionFile: `${BASE}services/agents/trustchainToolExecution.ts`, executionMethod: 'routeTrustChainTool' },
    tc_tsa_verify: { specFile: `${BASE}tools/trustchainTools.ts`, specExport: 'trustchainEnterpriseTools', executionFile: `${BASE}services/agents/trustchainToolExecution.ts`, executionMethod: 'routeTrustChainTool' },
    tc_airgap_status: { specFile: `${BASE}tools/trustchainTools.ts`, specExport: 'trustchainEnterpriseTools', executionFile: `${BASE}services/agents/trustchainToolExecution.ts`, executionMethod: 'routeTrustChainTool' },
};

/**
 * Get source info for a tool. Returns undefined for custom/MCP tools.
 */
export function getToolSource(toolId: string): ToolSourceInfo | undefined {
    return TOOL_SOURCE_MAP[toolId];
}

/**
 * Get all unique spec files (for "Source Files" section)
 */
export function getToolSpecFiles(): string[] {
    const files = new Set<string>();
    for (const info of Object.values(TOOL_SOURCE_MAP)) {
        files.add(info.specFile);
    }
    return [...files].sort();
}
