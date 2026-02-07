/**
 * Barrel export для всех инструментов SmartAIAgent
 * 
 * ВАЖНО: Все импорты должны быть на уровне модуля для правильной загрузки
 */

// Импортируем все инструменты на уровне модуля
import { backendApiTools } from './backendApiTools';
import { frontendTools } from './frontendTools';
import { categoryTools } from './categoryTools';
import { categoryManagementTools } from './categoryManagementTools';
import { codeExecutionTools } from './codeExecutionTools';
import { webTools } from './webTools';
import { fileTools } from './fileTools';
import { searchTools } from './searchTools';
import { codeAnalysisTools } from './codeAnalysisTools';
import { BrowserService } from '../services/agents/browserService';

// Gap G: Static browser tool definitions
const _browserSvc = new BrowserService();
const browserTools = _browserSvc.getToolDefinitions();

// Re-export для внешнего использования
export { backendApiTools, frontendTools, categoryTools, categoryManagementTools, codeExecutionTools, webTools, fileTools, searchTools, codeAnalysisTools, browserTools };

/**
 * Все наборы инструментов для валидации
 */
const ALL_TOOLSETS = {
  backendApiTools,
  frontendTools,
  categoryTools,
  categoryManagementTools,
  codeExecutionTools,
  webTools,
  fileTools,
  searchTools,
  codeAnalysisTools,
  browserTools
} as const;

/**
 * Получить все инструменты SmartAIAgent
 */
export function getAllSmartAgentTools() {
  // Единая точка валидации — проверяем все наборы
  for (const [name, toolset] of Object.entries(ALL_TOOLSETS)) {
    if (!toolset) {
      console.error(`[getAllSmartAgentTools] ❌ ${name} is undefined or null`);
      console.error(`[getAllSmartAgentTools] 💡 Try: 1) Hard refresh (Ctrl+Shift+R), 2) Clear browser cache, 3) Restart dev server`);
      throw new Error(`${name} is not defined - check imports. Try hard refresh.`);
    }
  }

  return [
    ...backendApiTools,
    ...frontendTools,
    ...categoryTools,
    ...categoryManagementTools,
    ...codeExecutionTools,
    ...webTools,
    ...fileTools,
    ...searchTools,
    ...codeAnalysisTools,
    ...browserTools
  ];
}

/**
 * Белый список разрешенных инструментов
 */
export const ALLOWED_TOOLS = new Set([
  // Backend API (5)
  'list_api_endpoints', 'list_data_files', 'backend_api_call', 'get_yaml_file', 'save_yaml_file',
  // Frontend Navigation (11)
  'get_app_structure', 'get_current_screen', 'navigate_to_tab', 'navigate_to_subtab', 'select_category', 'select_product', 'search_ui', 'apply_filters', 'get_screen_data', 'get_selected_items', 'click_element',
  // File Ops (3)
  'search_files_by_name', 'read_project_file', 'get_synonyms_preview', 'extract_table_to_excel',
  // Web Search (2)
  'web_search', 'web_fetch',
  // Testing & Diagnostics (10)
  'run_category_diagnostic', 'test_category_search', 'get_category_info', 'get_category_config', 'save_category_config',
  'get_category_backups', 'restore_category_backup', 'get_diagnostic_history', 'validate_category_config', 'get_category_param_coverage',
  // Category Management (8)
  'create_category_index', 'load_category_data', 'check_category_data_loading', 'get_atomic_file', 'save_atomic_file',
  'get_index_registry', 'update_index_registry', 'run_regression_tests',
  // Code Execution & Docker (10)
  'execute_code', 'execute_bash', 'import_tool', 'save_tool', 'list_tools', 'load_tool',
  'bash_tool', 'view', 'create_file', 'str_replace',
  // Artifacts (1) - КРИТИЧНО для графиков и визуализаций!
  'create_artifact',
  // Excel Export (3)
  'export_search_to_excel', 'advanced_export_to_excel', 'get_available_categories',
  // Professional Search (4) - 🔍 ПРОФЕССИОНАЛЬНЫЕ ИНСТРУМЕНТЫ ПОИСКА
  'search_products', 'analyze_search_params', 'compare_products', 'quick_search',
  // Specification Matching (1) - 🎯 PDF → Catalog matching
  'match_specification_to_catalog',
  // Code Analysis (3) - 🧬 AST-level code understanding (Gap #6)
  'analyze_code_structure', 'search_code_symbols', 'get_code_dependencies',
  // Browser (3) — 🌐 Headless web browsing (Gap G)
  'browser_navigate', 'browser_screenshot', 'browser_extract'
]);

