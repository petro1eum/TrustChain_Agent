/**
 * Agent Contract — Central interface convention file.
 *
 * PURPOSE: When building a new UI for the agent (right panel, full-screen,
 * mobile, etc.), import everything through this single contract file.
 *
 * Usage:
 *   import { UI_SLOTS, ToolMeta, ArtifactsService } from '../agent-contract';
 *
 * Convention:
 *   - All public types live in their source modules but are re-exported here.
 *   - Canonical UI slot names (UI_SLOTS) define where UI components mount.
 *   - Canonical tool IDs (TOOL_IDS) match the tool registry.
 *   - Service singletons are exported for direct consumption.
 */

// ── Types ──────────────────────────────────────────

export type { ToolMeta, ToolCategory, RiskLevel, ToolParameter } from './tools/toolRegistry';
export type { ArtifactData, ArtifactType, ArtifactInfo, ArtifactContent } from './services/artifacts/types';
export type {
    AgentEvent, LogLevel, AgentEventType, Span, Metric, Dashboard, ObservabilityConfig,
} from './services/observability/types';
export type { MemoryEntry, MemoryCategory } from './services/agents/persistentMemoryService';
export type { FrontendCallbacks } from './hooks/useFrontendIntegration';

// ── Services ───────────────────────────────────────

export { ArtifactsService, artifactsService } from './services/artifacts';
export { getToolRegistry, getLockedToolIds, getDefaultEnabledToolIds, loadEnabledToolIds, saveEnabledToolIds } from './tools/toolRegistry';
export { frontendNavigationService, FrontendNavigationService } from './services/frontendNavigationService';
export { chatHistoryService, ChatHistoryService } from './services/chatHistoryService';
export { ResourceManager } from './services/resources';

// ── Hooks ──────────────────────────────────────────

export { useFrontendIntegration, createScreenDataGetter, createSelectedItemsGetter } from './hooks/useFrontendIntegration';

// ── UI Slot Convention ─────────────────────────────
// Canonical names for where UI components mount.
// Any new UI shell should render components into these slots.

export const UI_SLOTS = {
    /** Main chat interface with message list + input */
    CHAT_PANEL: 'chat-panel',
    /** Artifacts viewer — right panel or modal */
    ARTIFACTS_PANEL: 'artifacts-panel',
    /** Tool management settings */
    TOOL_MANAGER: 'tool-manager',
    /** Skills browser and manager */
    SKILLS_MANAGER: 'skills-manager',
    /** MCP server connections */
    MCP_MANAGER: 'mcp-manager',
    /** Agent debug/execution viewer */
    DEBUG_VIEWER: 'debug-viewer',
    /** Settings modal/panel */
    SETTINGS_MODAL: 'settings-modal',
} as const;

export type UISlot = typeof UI_SLOTS[keyof typeof UI_SLOTS];

// ── Canonical Tool IDs ─────────────────────────────
// These match the IDs in toolRegistry.ts. Use these constants
// instead of string literals to avoid typos.

export const TOOL_IDS = {
    // Code Execution
    EXECUTE_CODE: 'execute_code',
    EXECUTE_BASH: 'execute_bash',
    BASH_TOOL: 'bash_tool',
    VIEW: 'view',
    CREATE_FILE: 'create_file',
    STR_REPLACE: 'str_replace',
    IMPORT_TOOL: 'import_tool',
    SAVE_TOOL: 'save_tool',
    LIST_TOOLS: 'list_tools',
    LOAD_TOOL: 'load_tool',
    CREATE_ARTIFACT: 'create_artifact',
    // Backend API
    LIST_ENDPOINTS: 'list_api_endpoints',
    LIST_DATA_FILES: 'list_data_files',
    API_CALL: 'backend_api_call',
    GET_YAML: 'get_yaml_file',
    SAVE_YAML: 'save_yaml_file',
    // Files & Data
    SEARCH_FILES: 'search_files_by_name',
    READ_FILE: 'read_project_file',
    SYNONYMS_PREVIEW: 'get_synonyms_preview',
    EXTRACT_TABLE: 'extract_table_to_excel',
    // Web
    WEB_SEARCH: 'web_search',
    WEB_FETCH: 'web_fetch',
    // Code Analysis
    ANALYZE_CODE: 'analyze_code_structure',
    SEARCH_SYMBOLS: 'search_code_symbols',
    CODE_DEPS: 'get_code_dependencies',
    // Browser
    BROWSER_NAVIGATE: 'browser_navigate',
    BROWSER_SCREENSHOT: 'browser_screenshot',
    BROWSER_EXTRACT: 'browser_extract',
    // MCP
    MCP_CONNECT: 'mcp_connect',
    MCP_DISCONNECT: 'mcp_disconnect',
    MCP_CALL_TOOL: 'mcp_call_tool',
    // Data Processing
    TEXT_PROCESSING: 'text_processing',
    SEMANTIC_ANALYSIS: 'semantic_analysis',
    MISSING_DATA: 'missing_data',
    NORMALIZE_DATA: 'normalize_data',
    OUTLIERS: 'outliers',
    PANDAS_OP: 'pandas_operation',
    DATA_QUALITY: 'data_quality_analysis',
    // Memory
    MEMORY_SAVE: 'memory_save',
    MEMORY_RECALL: 'memory_recall',
} as const;

export type ToolId = typeof TOOL_IDS[keyof typeof TOOL_IDS];

// ── Agent Event Names ──────────────────────────────
// Canonical event names for agent ↔ UI communication.

export const AGENT_EVENTS = {
    ARTIFACT_CREATED: 'artifact_created',
    TOOL_EXECUTED: 'tool_executed',
    THINKING_STARTED: 'thinking_started',
    THINKING_COMPLETE: 'thinking_complete',
    PLAN_CREATED: 'plan_created',
    ERROR: 'error',
    SESSION_START: 'session_start',
    SESSION_END: 'session_end',
} as const;
