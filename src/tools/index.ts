/**
 * Universal Tools — project-agnostic tools always available in TrustChain Agent.
 * 
 * Architecture: 3-Tier Tool System
 *   1. Universal Tools (this file) — always loaded, work in any project
 *   2. TrustChain Tools (Ed25519, audit) — always loaded, our killer feature
 *   3. Platform Tools — loaded dynamically via MCP protocol from each project's MCP Server
 * 
 * IMPORTANT: All project-specific tools (kb-catalog, OnaiDocs, CRM, ERP, etc.)
 * MUST live inside each project's MCP Server and be discovered via MCP protocol.
 * The agent NEVER contains project-specific tool code.
 */

import { codeExecutionTools } from './codeExecutionTools';
import { webTools } from './webTools';
import { fileTools } from './fileTools';
import { codeAnalysisTools } from './codeAnalysisTools';
import { SESSION_SPAWN_TOOLS } from './sessionSpawnTools';
import { BrowserService } from '../services/agents/browserService';
import { browserPanelTools } from './browserPanelTools';

// Browser tools from BrowserService
const _browserSvc = new BrowserService();
const browserTools = _browserSvc.getToolDefinitions();

// Re-export for external use
export { codeExecutionTools, webTools, fileTools, codeAnalysisTools, browserTools, browserPanelTools, SESSION_SPAWN_TOOLS };

/**
 * All universal toolsets (project-agnostic)
 */
const UNIVERSAL_TOOLSETS = {
  codeExecutionTools,
  webTools,
  fileTools,
  codeAnalysisTools,
  browserTools,
  browserPanelTools,
} as const;

/**
 * Get all universal tools for SmartAIAgent.
 * These are always available regardless of which project embeds the agent.
 */
export function getAllSmartAgentTools() {
  // Validate all toolsets
  for (const [name, toolset] of Object.entries(UNIVERSAL_TOOLSETS)) {
    if (!toolset) {
      console.error(`[getAllSmartAgentTools] ❌ ${name} is undefined or null`);
      throw new Error(`${name} is not defined - check imports. Try hard refresh.`);
    }
  }

  return [
    ...codeExecutionTools,
    ...webTools,
    ...fileTools,
    ...codeAnalysisTools,
    ...browserTools,
    ...browserPanelTools,
    ...SESSION_SPAWN_TOOLS,
  ];
}

/**
 * Universal tools whitelist — project-agnostic tools that are always allowed.
 * MCP tools bypass this list entirely (they are trusted via MCP discover).
 */
export const UNIVERSAL_TOOLS = new Set([
  // Code Execution & Docker (10)
  'execute_code', 'execute_bash', 'import_tool', 'save_tool', 'list_tools', 'load_tool',
  'bash_tool', 'view', 'create_file', 'str_replace',
  // Web Search (2)
  'web_search', 'web_fetch',
  // File Ops (4)
  'search_files_by_name', 'read_project_file', 'get_synonyms_preview', 'extract_table_to_excel',
  // Artifacts (1) — CRITICAL for charts and visualizations
  'create_artifact',
  // Code Analysis (3) — AST-level code understanding
  'analyze_code_structure', 'search_code_symbols', 'get_code_dependencies',
  // Browser (3) — Headless web browsing via Playwright
  'browser_navigate', 'browser_screenshot', 'browser_extract',
  // Browser Panel (11) — Agent-controlled embedded browser in UI
  'browser_panel_open', 'browser_panel_search', 'browser_panel_close',
  'browser_panel_back', 'browser_panel_forward', 'browser_panel_refresh',
  'browser_panel_click', 'browser_panel_scroll', 'browser_panel_fill',
  'browser_panel_read', 'browser_panel_status',
  // Sub-Agents (3) — Spawn and manage background sub-agent sessions
  'session_spawn', 'session_status', 'session_result',
]);

// Legacy alias for backward compatibility during migration
export const ALLOWED_TOOLS = UNIVERSAL_TOOLS;
