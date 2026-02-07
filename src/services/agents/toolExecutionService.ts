/**
 * Сервис выполнения инструментов
 * Выделен из smart-ai-agent.ts для уменьшения размера основного файла
 * Содержит всю логику выполнения инструментов (~900 строк)
 */

import { agentDebugService } from '../agentDebugService';
import { backendApiService, API_ENDPOINTS, DATA_FILES } from '../backendApiService';
import { frontendNavigationService } from '../frontendNavigationService';
import { webSearchService } from '../webSearchService';
import { codeExecutionService } from '../codeExecutionService';
import { bashExecutionService } from '../bashExecutionService';
import type { MetricsService } from './metricsService';
import type { ToolHandlersService } from './toolHandlersService';
import type { AppActions, DataProcessingContext, ExecutionPlan } from '../../agents/types';
import type { ResourceManager } from '../resources';
import { CodeAnalysisService } from './codeAnalysisService';

// Поддержка как Vite окружения, так и Node.js окружения
const _proc = typeof process !== 'undefined' ? process.env : {} as Record<string, string | undefined>;
const BACKEND_URL = (typeof import.meta !== 'undefined' && (import.meta.env?.VITE_BACKEND_URL || import.meta.env?.VITE_API_BASE))
  || _proc.VITE_BACKEND_URL
  || _proc.VITE_API_BASE
  || 'http://localhost:8000';

console.log(`[ToolExecutionService] Backend URL: ${BACKEND_URL}`);
const FETCH_TIMEOUT = 30000; // 30 секунд timeout для всех fetch запросов

/**
 * Выполнить fetch запрос с timeout
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = FETCH_TIMEOUT
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    console.log(`[fetchWithTimeout] Starting fetch to ${url}`, { timeoutMs });

    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // КРИТИЧНО: Проверяем что response получен
    if (!response) {
      console.error(`[fetchWithTimeout] No response received from ${url}`);
      throw new Error(`No response received from ${url}`);
    }

    console.log(`[fetchWithTimeout] Response received from ${url}`, {
      status: response.status,
      ok: response.ok,
      statusText: response.statusText
    });

    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);

    // Детальная обработка разных типов ошибок
    if (error.name === 'AbortError' || error.message?.includes('aborted')) {
      console.error(`[fetchWithTimeout] Timeout after ${timeoutMs}ms for ${url}`);
      throw new Error(`Request timeout after ${timeoutMs}ms: ${url}`);
    }

    // CORS или network errors в браузере
    if (error.name === 'TypeError' && error.message?.includes('Failed to fetch')) {
      console.error(`[fetchWithTimeout] Network/CORS error for ${url}`, error);
      throw new Error(`Network error: ${error.message}. Check CORS settings and backend availability at ${url}`);
    }

    // Другие ошибки
    console.error(`[fetchWithTimeout] Fetch failed for ${url}`, {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack
    });

    throw new Error(`Fetch failed for ${url}: ${error.message || String(error)}`);
  }
}

export interface ToolExecutionServiceDependencies {
  metricsService: MetricsService;
  toolHandlers: ToolHandlersService;
  toolExecutionCache: Map<string, any>;
  recentToolCalls: Map<string, Array<{ args: any; result: any; timestamp: number }>>;
  appActions?: AppActions;
  context: DataProcessingContext;
  executionPlan?: ExecutionPlan;
  getApiParams: (params: any) => any;
  isNonInformativeResult: (result: any) => boolean;
  attemptErrorRecovery: (errorContext: any) => Promise<{ success: boolean; result?: any }>;
  normalizeArgs: (args: any, aliases: Record<string, string>) => any;
  safeAppAction: (fn: () => Promise<any>) => Promise<{ success: boolean; data?: any; error?: string }>;
  resourceManager?: ResourceManager; // Опциональный ResourceManager для rate limiting
  currentModel?: string; // Текущая модель для расчета стоимости
}

export class ToolExecutionService {
  private deps: ToolExecutionServiceDependencies;

  constructor(deps: ToolExecutionServiceDependencies) {
    this.deps = deps;
  }

  /**
   * Интеллектуальное выполнение инструментов
   * Основной метод с маршрутизацией на обработчики
   */
  /**
   * Валидация путей — whitelist + защита от path traversal
   */
  private validatePaths(toolName: string, args: any): void {
    const ALLOWED_PREFIXES = ['/mnt/user-data/', '/mnt/skills/', '/tmp/'];
    const PATH_FIELDS = ['path', 'file_path', 'filename', 'file', 'file_name'];

    for (const field of PATH_FIELDS) {
      const val = args?.[field];
      if (typeof val !== 'string' || !val) continue;

      // Path traversal check
      if (val.includes('..')) {
        throw new Error(`[Security] Path traversal detected in ${toolName}.${field}: "${val}"`);
      }

      // Whitelist check (только для абсолютных путей)
      if (val.startsWith('/') && !ALLOWED_PREFIXES.some(prefix => val.startsWith(prefix))) {
        throw new Error(`[Security] Path not in allowed prefixes in ${toolName}.${field}: "${val}"`);
      }
    }
  }

  async executeToolIntelligently(
    toolName: string,
    args: any,
    context: Record<string, any>
  ): Promise<any> {
    // Логируем вызов инструмента
    const toolStartTime = Date.now();
    agentDebugService.logToolCall(toolName, args);

    // Валидация путей перед выполнением
    this.validatePaths(toolName, args);

    this.enforcePendingFileWorkflow(toolName);

    // Проверяем кеш для идемпотентных операций
    const cacheKey = `${toolName}:${JSON.stringify(args)}`;
    if (this.deps.toolExecutionCache.has(cacheKey)) {
      this.deps.metricsService.recordCacheHit();
      const cachedResult = this.deps.toolExecutionCache.get(cacheKey);
      agentDebugService.logToolResponse(toolName, cachedResult, 0, args);
      this.updatePendingFileRequestState(toolName, args, cachedResult);
      return cachedResult;
    } else {
      this.deps.metricsService.recordCacheMiss();
    }

    // Проверяем лимиты ресурсов перед выполнением
    if (this.deps.resourceManager) {
      // Оцениваем размер запроса для проверки лимитов
      const estimatedTokens = JSON.stringify(args).length / 4; // Примерная оценка
      const limitCheck = this.deps.resourceManager.checkLimits(
        toolName,
        this.deps.currentModel,
        estimatedTokens
      );

      if (!limitCheck.allowed) {
        const error = new Error(`Rate limit exceeded: ${limitCheck.reason}`);
        (error as any).limitCheck = limitCheck;
        throw error;
      }
    }

    try {
      let result: any;

      console.log(`[ToolExecution] executeToolIntelligently: ${toolName}`, { args, context });

      // Маршрутизация на реальные обработчики
      result = await this.routeToolExecution(toolName, args, context);

      console.log(`[ToolExecution] routeToolExecution result for ${toolName}:`, result);

      // КРИТИЧНО: Проверяем что результат не undefined
      if (result === undefined) {
        console.error(`[ToolExecution] CRITICAL: routeToolExecution returned undefined for ${toolName}!`);
        result = {
          success: false,
          error: `Tool ${toolName} returned undefined result. Check routeToolExecution implementation.`
        };
      }

      this.updatePendingFileRequestState(toolName, args, result);

      // Кешируем результат (FIFO лимит 200)
      this.deps.toolExecutionCache.set(cacheKey, result);
      if (this.deps.toolExecutionCache.size > 200) {
        const firstKey = this.deps.toolExecutionCache.keys().next().value;
        if (firstKey !== undefined) this.deps.toolExecutionCache.delete(firstKey);
      }

      // 📊 метрики
      const latency = Date.now() - toolStartTime;
      this.deps.metricsService.recordToolCall(toolName, latency);

      // Регистрируем использование ресурсов
      if (this.deps.resourceManager) {
        // Оцениваем размер результата
        const resultSize = JSON.stringify(result).length;
        const estimatedTokens = resultSize / 4; // Примерная оценка

        this.deps.resourceManager.recordUsage(toolName, this.deps.currentModel, {
          toolCalls: 1,
          tokens: estimatedTokens,
          apiRequests: 1
        });
      }

      // Логируем результат
      agentDebugService.logToolResponse(toolName, result, latency, args);

      // 📝 Сохраняем в историю (последние 5)
      this.updateRecentToolCalls(toolName, args, result);

      // 🔍 Анализ двух последних вызовов для обнаружения зацикливания
      await this.checkForRepeatedNonInformativeResults(toolName);

      return result;

    } catch (error: any) {
      // 📊 ошибки
      this.deps.metricsService.recordToolFailure(toolName);
      if ((error?.message || '').includes('Timeout')) {
        this.deps.metricsService.recordAsyncTimeout();
      }

      // Логируем ошибку
      agentDebugService.logError(`Tool ${toolName} failed: ${error.message}`, { toolName, args, context });

      // Интеллектуальная обработка ошибок
      const errorContext = {
        tool: toolName,
        args: args,
        error: error.message,
        context: context
      };

      const recovery = await this.deps.attemptErrorRecovery(errorContext);

      if (recovery.success) {
        const executionTime = Date.now() - toolStartTime;
        agentDebugService.logToolResponse(toolName, recovery.result, executionTime, args);
        return recovery.result;
      }

      throw error;
    }
  }

  private enforcePendingFileWorkflow(toolName: string): void {
    const pending = this.deps.context.pendingFileRequest;
    if (!pending || pending.fileCreated) {
      return;
    }

    // Требуем создание Excel файла сразу после получения данных
    if (pending.type === 'excel' && Array.isArray(pending.items) && pending.items.length > 0) {
      const allowedTools = new Set(['bash_tool']);
      if (!allowedTools.has(toolName)) {
        const error = new Error(
          `Нужно завершить экспорт в Excel: уже получено ${pending.items.length} позиций. ` +
          `Сразу вызови bash_tool с Python кодом, который сохранит данные в /mnt/user-data/outputs/.`
        );
        (error as any).code = 'PENDING_EXCEL_FILE';
        throw error;
      }
    }
  }

  private updatePendingFileRequestState(toolName: string, args: any, result: any): void {
    const pending = this.deps.context.pendingFileRequest;
    if (!pending) {
      return;
    }

    if (toolName === 'test_category_search' && pending.type === 'excel') {
      if (result && Array.isArray(result.items) && result.items.length > 0) {
        pending.items = result.items;
        pending.query = args?.query;
        pending.categorySlug = args?.categorySlug;
        pending.fileCreated = false;
      }
    }

    if (toolName === 'bash_tool' && pending.type === 'excel') {
      if (!result || result.success !== false) {
        pending.fileCreated = true;
      }
    }

    if (pending.fileCreated) {
      this.deps.context.pendingFileRequest = undefined;
    }
  }

  /**
   * Маршрутизация выполнения инструментов
   * Весь switch-case перенесен из smart-ai-agent.ts
   */
  private async routeToolExecution(
    toolName: string,
    args: any,
    context: Record<string, any>
  ): Promise<any> {
    let result: any;

    switch (toolName) {
      // === File & Data инструменты ===
      case 'get_synonyms_preview': case 'search_files_by_name':
      case 'read_project_file':
        return this.routeFileTool(toolName, args);

      case 'web_search': case 'web_fetch':
        result = await this.routeWebTool(toolName, args);
        break;

      // === Инструменты обработки данных ===
      case 'text_processing':
        result = await this.deps.toolHandlers.handleTextProcessing(args);
        break;

      case 'semantic_analysis':
        result = await this.deps.toolHandlers.handleSemanticAnalysis(args, context);
        break;

      case 'handle_missing_data':
        result = await this.deps.toolHandlers.handleMissingData(args, context);
        break;

      case 'normalize_data':
        result = await this.deps.toolHandlers.handleNormalizeData(args, context);
        break;

      case 'handle_outliers':
        result = await this.deps.toolHandlers.handleOutliers(args, context);
        break;

      case 'execute_pandas_operation':
        result = await this.deps.toolHandlers.handlePandasOperation(args, context);
        break;

      case 'smart_lookup_and_merge':
        result = await this.deps.toolHandlers.handleSmartLookup(args, context);
        break;

      case 'analyze_data_quality':
        result = await this.deps.toolHandlers.handleDataQualityAnalysis(args, context);
        break;

      // === Инструменты приложения ===
      case 'load_file_from_path': {
        const norm = this.deps.normalizeArgs(args, { client_name: 'clientName', file_path: 'filePath' });
        const res = await this.deps.safeAppAction(() => Promise.resolve(this.deps.appActions!.loadFileFromPath(norm.filePath, norm.clientName)));
        result = res.success ? res.data : { success: false, error: res.error };
        break;
      }

      case 'analyze_file_content': {
        const norm = this.deps.normalizeArgs(args, { file_id: 'fileId', file_name: 'fileName' });
        const fileId = norm.fileId || norm.fileName;
        const res = await this.deps.safeAppAction(() => Promise.resolve(this.deps.appActions!.loadFileContent(fileId)));
        result = res.success ? res.data : { success: false, error: res.error };
        break;
      }

      case 'data_quality_check': {
        const norm = this.deps.normalizeArgs(args, { file_id: 'fileId' });
        const res = await this.deps.safeAppAction(() => Promise.resolve(this.deps.appActions!.dataQualityCheck(norm.fileId)));
        result = res.success ? res.data : { success: false, error: res.error };
        break;
      }

      case 'execute_rule': {
        const norm = this.deps.normalizeArgs(args, { rule_id: 'ruleId', file_id: 'fileId' });
        const res = await this.deps.safeAppAction(() => Promise.resolve(this.deps.appActions!.executeRule(norm.ruleId, norm.fileId)));
        result = res.success ? res.data : { success: false, error: res.error };
        break;
      }

      case 'validate_rule': {
        const norm = this.deps.normalizeArgs(args, {});
        const res = await this.deps.safeAppAction(() => Promise.resolve(this.deps.appActions!.validateRule(norm.ruleData)));
        result = res.success ? res.data : { success: false, error: res.error };
        break;
      }

      case 'fuzzy_matching': {
        const norm = this.deps.normalizeArgs(args, {});
        const res = await this.deps.safeAppAction(() => Promise.resolve(this.deps.appActions!.fuzzyMatching(norm.data, norm.config)));
        result = res.success ? res.data : { success: false, error: res.error };
        break;
      }

      case 'create_data_report': {
        const norm = this.deps.normalizeArgs(args, { file_id: 'fileId' });
        const res = await this.deps.safeAppAction(() => Promise.resolve(this.deps.appActions!.createDataReport(norm.fileId, norm.format)));
        result = res.success ? res.data : { success: false, error: res.error };
        break;
      }

      case 'export_data': {
        const norm = this.deps.normalizeArgs(args, { file_id: 'fileId' });
        const res = await this.deps.safeAppAction(() => Promise.resolve(this.deps.appActions!.exportData(norm.fileId, norm.format)));
        result = res.success ? res.data : { success: false, error: res.error };
        break;
      }

      case 'get_available_files': {
        const res = await this.deps.safeAppAction(() => Promise.resolve(this.deps.appActions!.getAvailableFiles()));
        result = res.success ? res.data : { success: false, error: res.error };
        break;
      }

      case 'get_available_clients': {
        const res = await this.deps.safeAppAction(() => Promise.resolve(this.deps.appActions!.getAvailableClients()));
        result = res.success ? res.data : { success: false, error: res.error };
        break;
      }

      case 'switch_view': {
        const norm = this.deps.normalizeArgs(args, {});
        const res = await this.deps.safeAppAction(async () => { this.deps.appActions!.switchView(norm.view); return true; });
        result = res.success ? res.data : { success: false, error: res.error };
        break;
      }

      case 'select_client': {
        const norm = this.deps.normalizeArgs(args, { client_id: 'clientId' });
        const res = await this.deps.safeAppAction(() => Promise.resolve(this.deps.appActions!.selectClient(norm.clientId)));
        result = res.success ? res.data : { success: false, error: res.error };
        break;
      }

      case 'select_file': {
        const norm = this.deps.normalizeArgs(args, { file_id: 'fileId' });
        const res = await this.deps.safeAppAction(() => Promise.resolve(this.deps.appActions!.selectFile(norm.fileId)));
        result = res.success ? res.data : { success: false, error: res.error };
        break;
      }

      case 'backup_system': {
        const res = await this.deps.safeAppAction(() => Promise.resolve(this.deps.appActions!.backupSystem()));
        result = res.success ? res.data : { success: false, error: res.error };
        break;
      }

      case 'system_status': {
        const res = await this.deps.safeAppAction(() => Promise.resolve(this.deps.appActions!.systemStatus()));
        result = res.success ? res.data : { success: false, error: res.error };
        break;
      }

      // === Инструменты файловой системы ===
      case 'access_source_file':
        result = await this.deps.toolHandlers.handleAccessSourceFile(args, context);
        break;

      case 'add_to_workspace':
        result = await this.deps.toolHandlers.handleAddToWorkspace(args, context);
        break;

      // === Новые инструменты для работы с данными проекта ===
      case 'get_transformation_data':
        result = await this.deps.toolHandlers.handleGetTransformationData(args, context);
        break;

      case 'search_transformation_data':
        result = await this.deps.toolHandlers.handleSearchTransformationData(args, context);
        break;

      case 'get_file_metadata':
        result = await this.deps.toolHandlers.handleGetFileMetadata(args, context);
        break;

      case 'extract_table_to_excel':
        return this.routeFileTool(toolName, args);

      // === Docker Agent инструменты ===
      case 'bash_tool': case 'view': case 'create_file':
      case 'create_artifact': case 'str_replace':
        result = await this.routeDockerTool(toolName, args);
        break;

      // === Backend API инструменты ===
      case 'backend_api_call': case 'get_yaml_file': case 'save_yaml_file':
      case 'list_api_endpoints': case 'list_data_files':
        result = await this.routeBackendApiTool(toolName, args);
        break;

      // === Frontend Navigation инструменты ===
      case 'get_app_structure': case 'get_current_screen':
      case 'navigate_to_tab': case 'navigate_to_subtab':
      case 'select_category': case 'select_product':
      case 'search_ui': case 'apply_filters':
      case 'get_screen_data': case 'get_selected_items':
      case 'click_element':
        result = await this.routeFrontendTool(toolName, args, context);
        break;

      // === Категории: тестирование и диагностика ===
      case 'run_category_diagnostic': case 'test_category_search':
        result = await this.routeCategoryTool(toolName, args);
        break;

      // === Search & Export инструменты ===
      case 'export_search_to_excel': case 'advanced_export_to_excel':
      case 'get_available_categories': case 'search_products':
      case 'analyze_search_params': case 'compare_products':
      case 'quick_search':
        result = await this.routeSearchTool(toolName, args);
        break;

      // === Category config/info/management ===
      case 'get_category_info': case 'get_category_config':
      case 'save_category_config': case 'get_category_backups':
      case 'restore_category_backup': case 'get_diagnostic_history':
      case 'validate_category_config': case 'get_category_param_coverage':
      case 'create_category_index': case 'load_category_data':
      case 'check_category_data_loading': case 'get_atomic_file':
      case 'save_atomic_file': case 'get_index_registry':
      case 'update_index_registry':
        result = await this.routeCategoryTool(toolName, args);
        break;

      case 'run_regression_tests':
        result = await this.routeCategoryTool(toolName, args);
        break;

      // === Code execution инструменты ===
      case 'execute_code': case 'execute_bash':
      case 'import_tool': case 'save_tool':
      case 'list_tools': case 'load_tool':
        result = await this.routeCodeTool(toolName, args);
        break;

      // === Conversation Memory ===
      case 'conversation_search':
        result = await this.deps.toolHandlers.handleConversationSearch(args);
        break;
      case 'recent_chats':
        result = await this.deps.toolHandlers.handleRecentChats(args);
        break;

      // === Search: match specification ===
      case 'match_specification_to_catalog':
        result = await this.routeSearchTool(toolName, args);
        break;

      // === Code Analysis (Gap #6): AST-level code understanding ===
      case 'analyze_code_structure':
      case 'search_code_symbols':
      case 'get_code_dependencies':
        result = await this.routeCodeAnalysisTool(toolName, args);
        break;

      case 'none':
      case 'answer':
      case 'no_tool':
        return { success: true, message: 'Direct answer without tools' };

      default:
        console.error(`[ToolExecution] Unknown tool: ${toolName}`);
        throw new Error(`Unknown tool: ${toolName}`);
    }

    // КРИТИЧНО: Проверяем что result был установлен
    if (result === undefined) {
      console.error(`[ToolExecution] CRITICAL: result is undefined after switch for ${toolName}!`);
      throw new Error(`Tool ${toolName} did not set result. Check switch case implementation.`);
    }

    return result;
  }

  // ========== Доменные методы маршрутизации ==========

  /** Docker container tools: bash_tool, view, create_file, create_artifact, str_replace */
  private async routeDockerTool(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case 'bash_tool': return this.deps.toolHandlers.handleBashTool(args);
      case 'view': return this.deps.toolHandlers.handleView(args);
      case 'create_file': return this.deps.toolHandlers.handleCreateFile(args);
      case 'create_artifact': return this.deps.toolHandlers.handleCreateArtifact(args);
      case 'str_replace': return this.deps.toolHandlers.handleStrReplace(args);
      default: throw new Error(`Unknown docker tool: ${toolName}`);
    }
  }

  /** Web tools: web_search, web_fetch */
  private async routeWebTool(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case 'web_search': {
        const q = String(args.query || '').trim();
        const n = Math.max(1, Math.min(Number(args.maxResults || 5), 10));
        if (!q) return { success: false, error: 'Поисковый запрос не может быть пустым' };
        try {
          const searchResults = await webSearchService.searchWithCitations(q, n);
          return {
            success: true, query: q,
            results: searchResults.results.map((r, i) => ({ index: i, title: r.title || 'Без названия', url: r.url, snippet: r.snippet || '' })),
            citations: searchResults.citations,
            citationFormat: webSearchService.formatCitations(searchResults.citations),
            totalResults: searchResults.totalResults
          };
        } catch {
          const basicResults = await webSearchService.search(q, n);
          return {
            success: true, query: q,
            results: basicResults.map((r, i) => ({ index: i, title: r.title || 'Без названия', url: r.url, snippet: r.snippet || '' })),
            citations: basicResults.map((r, i) => ({ url: r.url, index: i })),
            totalResults: basicResults.length
          };
        }
      }
      case 'web_fetch': {
        const url = String(args.url || '').trim();
        if (!url) throw new Error('url is required');
        return { success: true, ...(await webSearchService.fetchPage(url)) };
      }
      default: throw new Error(`Unknown web tool: ${toolName}`);
    }
  }

  /** Backend API tools: backend_api_call, get/save_yaml, list_endpoints/files */
  private async routeBackendApiTool(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case 'backend_api_call':
        return backendApiService.callEndpoint(args.endpoint, args.params, args.body);
      case 'get_yaml_file':
        return backendApiService.getYamlFile(args.path);
      case 'save_yaml_file':
        await backendApiService.saveYamlFile(args.path, args.content);
        return { success: true, message: 'File saved successfully' };
      case 'list_api_endpoints':
        return { endpoints: Object.keys(API_ENDPOINTS), spec: backendApiService.getApiSpec() };
      case 'list_data_files':
        return { files: DATA_FILES, spec: backendApiService.getFilesSpec() };
      default: throw new Error(`Unknown backend API tool: ${toolName}`);
    }
  }

  /** File & data tools: get_synonyms_preview, search_files, read_project_file, extract_table */
  private async routeFileTool(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case 'get_synonyms_preview': {
        const limit = Math.max(1, Math.min(Number(args.limit || 20), 100));
        const toPairs = (data: any): string[] => {
          if (!data) return [];
          if (Array.isArray(data)) {
            return data.map((v: any) => {
              if (typeof v === 'string') return v;
              if (v && typeof v === 'object') {
                const raw = v.raw ?? v.src ?? v.from ?? v.key ?? '';
                const norm = v.norm ?? v.dst ?? v.to ?? v.value ?? '';
                return `${String(raw)}` + (norm ? ` -> ${String(norm)}` : '');
              }
              return String(v);
            });
          }
          if (typeof data === 'object') {
            const obj = data.items || data.synonyms || data;
            return Object.keys(obj).map(k => `${k} -> ${obj[k]}`);
          }
          return [];
        };
        const tryFetchJson = async (url: string) => {
          try { const r = await fetch(url, { method: 'GET' }); if (!r.ok) return null; return await r.json(); } catch { return null; }
        };
        try {
          const auto = await backendApiService.callEndpoint('autoreplace_get');
          const items = toPairs(auto).slice(0, limit);
          if (items.length) return { success: true, source: 'autoreplace', items };
        } catch { }
        try {
          const compiled = await backendApiService.callEndpoint('synonyms_compile');
          const items = toPairs(compiled).slice(0, limit);
          if (items.length) return { success: true, source: 'synonyms_compile', items };
        } catch { }
        const candidates = ['http://127.0.0.1:8000/static/atomic/autoreplace.json', 'http://localhost:8000/static/atomic/autoreplace.json', '/atomic/autoreplace.json'];
        for (const url of candidates) {
          const json = await tryFetchJson(url);
          if (json) { const items = toPairs(json).slice(0, limit); if (items.length) return { success: true, source: url, items }; }
        }
        return { success: false, error: 'synonyms_not_found' };
      }
      case 'search_files_by_name': {
        const needleRaw = String(args.query || '').trim().toLowerCase();
        if (!needleRaw) throw new Error('query is required');
        const collect = (): { path: string; section: string }[] => {
          const out: { path: string; section: string }[] = [];
          for (const f of DATA_FILES.categories || []) out.push({ path: `categories/${f}`, section: 'categories' });
          for (const f of DATA_FILES.mixins || []) out.push({ path: `mixins/${f}`, section: 'mixins' });
          for (const f of DATA_FILES.atomic || []) out.push({ path: `atomic/${f}`, section: 'atomic' });
          const desc = (DATA_FILES as any).descriptors as Record<string, string[]> | undefined;
          const groups: Array<keyof NonNullable<typeof desc>> = ['diameter', 'pressure', 'thread', 'valve'];
          for (const grp of groups) { const arr = desc?.[grp] || []; for (const f of arr) out.push({ path: `descriptors/${grp}/${f}`, section: `descriptors/${grp}` }); }
          return out;
        };
        const all = collect();
        return { success: true, query: needleRaw, hits: all.filter(e => e.path.toLowerCase().includes(needleRaw)) };
      }
      case 'read_project_file': {
        const pathInput = String(args.path || '').trim();
        const limitNum = Math.max(1, Math.min(Number(args.limit || 20), 200));
        if (!pathInput) throw new Error('path is required');
        const resolvePath = (p: string): string | null => {
          if (p.includes('/')) return p;
          const fname = p;
          const cands: string[] = [];
          for (const f of DATA_FILES.categories || []) cands.push(`categories/${f}`);
          for (const f of DATA_FILES.mixins || []) cands.push(`mixins/${f}`);
          for (const f of DATA_FILES.atomic || []) cands.push(`atomic/${f}`);
          const desc: Record<'diameter' | 'pressure' | 'thread' | 'valve', string[]> | undefined = DATA_FILES.descriptors as any;
          for (const grp of (['diameter', 'pressure', 'thread', 'valve'] as const)) { for (const f of (desc?.[grp] || []) as string[]) cands.push(`descriptors/${grp}/${f}`); }
          const matches = cands.filter((c: string) => c.endsWith(`/${fname}`) || c === fname || c.toLowerCase().includes(fname.toLowerCase()));
          if (matches.length === 1) return matches[0];
          if (matches.length > 1) { matches.sort((a: string, b: string) => a.length - b.length); return matches[0]; }
          return null;
        };
        const path = resolvePath(pathInput) || pathInput;
        const isYaml = /\.ya?ml$/i.test(path) || /(descriptors|categories|mixins)\//.test(path);
        const isJson = /\.json$/i.test(path) || path.startsWith('atomic/');
        const previewLines = (text: string, lim: number): string[] => text.split(/\r?\n/).slice(0, lim);
        const previewJson = (data: any, lim: number): any => {
          if (Array.isArray(data)) return data.slice(0, lim);
          if (data && typeof data === 'object') return Object.fromEntries(Object.entries(data as Record<string, unknown>).slice(0, lim));
          return data;
        };
        if (isYaml) {
          try { const content: any = await backendApiService.getYamlFile(path); return { success: true, path, type: 'yaml', preview: previewLines(String(content || ''), limitNum) }; }
          catch (e: any) { return { success: false, path, error: e?.message || 'yaml_read_failed' }; }
        }
        if (isJson) {
          const fileName = path.split('/').pop() || path;
          try { const unified = await backendApiService.callEndpoint('files_read', undefined, { path, limit: limitNum }); if (unified?.success) return { success: true, path, type: 'json', source: 'backend:files_read', preview: unified.preview ?? unified.content }; } catch { }
          const jsonCandidates = [`http://127.0.0.1:8000/static/atomic/${fileName}`, `http://localhost:8000/static/atomic/${fileName}`, `/atomic/${fileName}`];
          const tryFJ = async (url: string): Promise<any | null> => { try { const r = await fetch(url, { method: 'GET' }); if (!r.ok) return null; return await r.json(); } catch { return null; } };
          if (/autoreplace\.json$/i.test(fileName)) { try { const auto = await backendApiService.callEndpoint('autoreplace_get'); return { success: true, path, type: 'json', source: 'backend:autoreplace_get', preview: previewJson(auto, limitNum) }; } catch { } }
          for (const url of jsonCandidates) { const json = await tryFJ(url); if (json) return { success: true, path, type: 'json', source: url, preview: previewJson(json, limitNum) }; }
          return { success: false, path, error: 'json_not_found' };
        }
        try { const r = await fetch(path); if (r.ok) { const text = await r.text(); return { success: true, path, type: 'text', preview: previewLines(text, limitNum) }; } return { success: false, path, error: `fetch_failed ${r.status}` }; }
        catch (e: any) { return { success: false, path, error: e?.message || 'read_failed' }; }
      }
      case 'extract_table_to_excel':
        return this.deps.toolHandlers.handleExtractTableToExcel(args);
      default: throw new Error(`Unknown file tool: ${toolName}`);
    }
  }

  /** Frontend navigation tools */
  private async routeFrontendTool(toolName: string, args: any, context: Record<string, any>): Promise<any> {
    switch (toolName) {
      case 'get_app_structure':
        return { structure: frontendNavigationService.getAppStructure(), description: frontendNavigationService.getAppStructureDescription() };
      case 'get_current_screen':
        return { state: frontendNavigationService.getCurrentState(), context: await frontendNavigationService.getScreenContext(), availableActions: frontendNavigationService.getAvailableActions() };
      case 'navigate_to_tab':
        return frontendNavigationService.navigateToTab(args.tabId);
      case 'navigate_to_subtab':
        return frontendNavigationService.navigateToSubTab(args.tabId, args.subTabId);
      case 'select_category':
        return frontendNavigationService.selectCategory(args.categoryId);
      case 'select_product':
        return frontendNavigationService.selectProduct(args.productId);
      case 'search_ui': {
        try {
          const result = await frontendNavigationService.search(args.query);
          if (result && typeof result === 'object' && (result.error || result.success === false)) {
            const errorMsg = result.error || result.message || '';
            if (errorMsg.includes('not available') || errorMsg.includes('setSearchQuery')) {
              const categorySlug = args.categorySlug || context.categorySlug;
              return { success: false, error: `search_ui недоступен. Используй test_category_search вместо этого.`, suggestion: categorySlug ? `test_category_search(query="${args.query}", categorySlug="${categorySlug}")` : undefined, originalError: errorMsg };
            }
          }
          return result;
        } catch (error: any) {
          const errorMsg = error.message || String(error);
          if (errorMsg.includes('not available') || errorMsg.includes('setSearchQuery'))
            return { success: false, error: `search_ui недоступен: ${errorMsg}. Используй test_category_search для тестирования поиска.`, suggestion: 'test_category_search(query, categorySlug)' };
          throw error;
        }
      }
      case 'apply_filters':
        return frontendNavigationService.applyFilters(args.filters);
      case 'get_screen_data':
        return frontendNavigationService.getScreenData();
      case 'get_selected_items':
        return frontendNavigationService.getSelectedItems();
      case 'click_element':
        return frontendNavigationService.clickElement(args.elementId);
      default: throw new Error(`Unknown frontend tool: ${toolName}`);
    }
  }

  /** Search & export tools */
  private async routeSearchTool(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case 'search_products': {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/os/search/products`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: args.query, category_slug: args.category_slug || args.categorySlug, filters: args.filters || {}, size: args.size || 20, explain: args.explain || false, include_params: args.include_params !== false })
        }, 30000);
        if (!response?.ok) { const t = response ? await response.text() : 'No response'; throw new Error(`search_products failed: ${t}`); }
        return response.json();
      }
      case 'export_search_to_excel': {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/os/search/export`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: args.query, category_slug: args.category_slug || args.categorySlug, size: args.size || 1000, filename: args.filename })
        }, 60000);
        if (!response?.ok) { const t = response ? await response.text() : 'No response'; throw new Error(`Export failed: ${t}`); }
        const exportResult = await response.json();
        if (exportResult.success && exportResult.content_base64) {
          await this.deps.toolHandlers.handleCreateArtifact({ description: `Excel экспорт: "${args.query}" (${exportResult.rows} строк)`, filename: exportResult.filename, content: exportResult.content_base64, type: 'excel' });
          return { success: true, filename: exportResult.filename, rows: exportResult.rows, columns: exportResult.columns, column_names: exportResult.column_names, query: exportResult.query, category: exportResult.category, message: `Excel "${exportResult.filename}" создан (${exportResult.rows} строк).`, artifact_created: true };
        }
        return exportResult;
      }
      case 'advanced_export_to_excel': {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/os/search/export/advanced`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ queries: args.queries, filename: args.filename, columns: args.columns, merge_sheets: args.merge_sheets ?? false, include_search_info: args.include_search_info ?? true })
        }, 120000);
        if (!response?.ok) { const t = response ? await response.text() : 'No response'; throw new Error(`Advanced export failed: ${t}`); }
        const exportResult = await response.json();
        if (exportResult.success && exportResult.content_base64) {
          await this.deps.toolHandlers.handleCreateArtifact({ description: `Excel экспорт: ${args.queries?.length || 0} запросов, ${exportResult.total_rows} строк`, filename: exportResult.filename, content: exportResult.content_base64, type: 'excel' });
          return { success: true, filename: exportResult.filename, total_rows: exportResult.total_rows, sheets: exportResult.sheets, queries_processed: exportResult.queries_processed, queries_requested: exportResult.queries_requested, message: `Excel "${exportResult.filename}" создан (${exportResult.total_rows} строк).`, artifact_created: true };
        }
        return exportResult;
      }
      case 'get_available_categories': {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/os/export/categories`, { method: 'GET', headers: { 'Content-Type': 'application/json' } }, 10000);
        if (!response?.ok) throw new Error('Failed to get categories');
        return response.json();
      }
      case 'quick_search': {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/os/search/quick`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: args.query })
        }, 10000);
        if (!response?.ok) { const t = response ? await response.text() : 'No response'; throw new Error(`quick_search failed: ${t}`); }
        return response.json();
      }
      case 'compare_products': {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/os/search/compare`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ queries: args.queries, compare_by: args.compare_by || ['price', 'count', 'brands', 'params'] })
        }, 60000);
        if (!response?.ok) { const t = response ? await response.text() : 'No response'; throw new Error(`compare_products failed: ${t}`); }
        return response.json();
      }
      case 'analyze_search_params': {
        const categorySlug = args.category_slug || args.categorySlug;
        let url = `${BACKEND_URL}/api/os/search/params`;
        if (categorySlug) url += `?category_slug=${encodeURIComponent(categorySlug)}`;
        else if (args.query) url += `?query=${encodeURIComponent(args.query)}`;
        const response = await fetchWithTimeout(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } }, 15000);
        if (!response?.ok) { const t = response ? await response.text() : 'No response'; throw new Error(`analyze_search_params failed: ${t}`); }
        return response.json();
      }
      case 'match_specification_to_catalog':
        return this.deps.toolHandlers.handleMatchSpecificationToCatalog(args);
      default: throw new Error(`Unknown search tool: ${toolName}`);
    }
  }

  /** Category management & diagnostics tools */
  private async routeCategoryTool(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case 'run_category_diagnostic': {
        const stepMap: Record<string, string> = { 'full': 'full', '0.5': 'step0.5-check-atomics-loading', '1': 'step1-check-data', '2': 'step2-check-category', '3': 'step3-check-tokenization', '3.5': 'step3.5-check-parameter-extraction', '3.6': 'step3.6-check-synonyms-in-atomics', '3.7': 'step3.7-check-article-numbers-preserved', '4': 'step4-check-filters', '4.7': 'step4.7-check-diameter-format', '5': 'step5-check-exclusions', '6': 'step6-check-operator' };
        const endpoint = stepMap[args.step] || args.step;
        const endpointPath = endpoint === 'full' ? `/api/os/category/${args.categorySlug}/diagnostic/full` : `/api/os/category/${args.categorySlug}/diagnostic/${endpoint}`;
        const response = await fetch(`${BACKEND_URL}${endpointPath}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: args.query, ...(args.jdeCode && { jde_code: args.jdeCode }) }) });
        if (!response.ok) { const t = await response.text(); throw new Error(`Diagnostic failed: ${response.status} - ${t}`); }
        return response.json();
      }
      case 'test_category_search': {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/os/search`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: args.query, category: args.categorySlug, size: args.size || 10, debug: args.debug !== false })
        }, FETCH_TIMEOUT);
        if (!response?.ok) { const t = response ? await response.text() : 'No response'; throw new Error(`Search test failed: ${response?.status} - ${t}`); }
        return response.json();
      }
      case 'get_category_info': {
        const response = await fetchWithTimeout(`${BACKEND_URL}/api/os/category/${args.categorySlug}/info`, { method: 'GET', headers: { 'Content-Type': 'application/json' } }, FETCH_TIMEOUT);
        if (!response?.ok) { const t = response ? await response.text() : 'No response'; throw new Error(`Failed to get category info: ${t}`); }
        return response.json();
      }
      case 'get_category_config': {
        const pathMap: Record<string, string> = { 'yaml': `/api/os/category/${args.categorySlug}/config/yaml`, 'json': `/api/os/category/${args.categorySlug}/config/json`, 'py': `/api/os/category/${args.categorySlug}/config/py` };
        const response = await fetch(`${BACKEND_URL}${pathMap[args.configType]}`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
        if (!response.ok) { const t = await response.text(); throw new Error(`Failed to get config: ${t}`); }
        return response.json();
      }
      case 'save_category_config': {
        const pathMap: Record<string, string> = { 'yaml': `/api/os/category/${args.categorySlug}/config/yaml`, 'json': `/api/os/category/${args.categorySlug}/config/json`, 'py': `/api/os/category/${args.categorySlug}/config/py` };
        const response = await fetch(`${BACKEND_URL}${pathMap[args.configType]}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: args.content }) });
        if (!response.ok) { const t = await response.text(); throw new Error(`Failed to save config: ${t}`); }
        return response.json();
      }
      case 'get_category_backups': {
        const url = new URL(`${BACKEND_URL}/api/os/category/${args.categorySlug}/backups`);
        if (args.configType) url.searchParams.set('type', args.configType);
        const response = await fetch(url.toString(), { method: 'GET', headers: { 'Content-Type': 'application/json' } });
        if (!response.ok) { const t = await response.text(); throw new Error(`Failed to get backups: ${t}`); }
        return response.json();
      }
      case 'restore_category_backup': {
        const response = await fetch(`${BACKEND_URL}/api/os/category/${args.categorySlug}/restore-backup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ backup_path: args.backupPath }) });
        if (!response.ok) { const t = await response.text(); throw new Error(`Failed to restore backup: ${t}`); }
        return response.json();
      }
      case 'get_diagnostic_history': {
        const url = new URL(`${BACKEND_URL}/api/os/category/${args.categorySlug}/diagnostic/history`);
        url.searchParams.set('limit', String(args.limit || 50));
        const response = await fetch(url.toString(), { method: 'GET', headers: { 'Content-Type': 'application/json' } });
        if (!response.ok) { const t = await response.text(); throw new Error(`Failed to get diagnostic history: ${t}`); }
        return response.json();
      }
      case 'validate_category_config': {
        const response = await fetch(`${BACKEND_URL}/api/os/category/${args.categorySlug}/validate-config`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        if (!response.ok) { const t = await response.text(); throw new Error(`Validation failed: ${t}`); }
        return response.json();
      }
      case 'get_category_param_coverage': {
        const response = await fetch(`${BACKEND_URL}/api/os/category/${args.categorySlug}/diagnostic/param-coverage`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
        if (!response.ok) { const t = await response.text(); throw new Error(`Failed to get param coverage: ${t}`); }
        return response.json();
      }
      case 'create_category_index': {
        const { dockerAgentService } = await import('../dockerAgentService');
        const cmd = `cd /mnt/workspace && admin_app_backend/.venv/bin/python tools/os_build_index.py --category ${args.categorySlug}${args.recreate ? ' --recreate' : ''}`.trim();
        const r = await dockerAgentService.bashTool({ command: cmd, description: `Создание индекса ${args.categorySlug}` });
        if (!r.success) throw new Error(`Failed to create index: ${r.stderr || r.error}`);
        return { success: true, categorySlug: args.categorySlug, recreated: args.recreate || false, output: r.stdout, message: `Индекс ${args.categorySlug} ${args.recreate ? 'пересоздан' : 'создан'}` };
      }
      case 'load_category_data': {
        const { dockerAgentService } = await import('../dockerAgentService');
        const cmd = `cd /mnt/workspace && admin_app_backend/.venv/bin/python tools/load_category_to_v8.py ${args.categorySlug}${args.clear ? ' --clear' : ''}`.trim();
        const r = await dockerAgentService.bashTool({ command: cmd, description: `Загрузка данных ${args.categorySlug}`, timeout: 300000 });
        if (!r.success) throw new Error(`Failed to load data: ${r.stderr || r.error}`);
        return { success: true, categorySlug: args.categorySlug, cleared: args.clear || false, output: r.stdout, message: `Данные ${args.categorySlug} загружены` };
      }
      case 'check_category_data_loading': {
        const { dockerAgentService } = await import('../dockerAgentService');
        const r = await dockerAgentService.bashTool({ command: `cd /mnt/workspace && admin_app_backend/.venv/bin/python tools/find_skipped_documents.py ${args.categorySlug}`, description: `Проверка загрузки ${args.categorySlug}` });
        if (!r.success) throw new Error(`Failed: ${r.stderr || r.error}`);
        const output = r.stdout;
        return { success: true, categorySlug: args.categorySlug, loaded: output.match(/Загружено:\s*(\d+)/)?.[1] ? parseInt(output.match(/Загружено:\s*(\d+)/)![1], 10) : null, skipped: output.match(/Пропущено:\s*(\d+)/)?.[1] ? parseInt(output.match(/Пропущено:\s*(\d+)/)![1], 10) : null, percentLoaded: output.match(/Процент загружено:\s*([\d.]+)%/)?.[1] ? parseFloat(output.match(/Процент загружено:\s*([\d.]+)%/)![1]) : null, output: r.stdout, isComplete: output.match(/Процент загружено:\s*([\d.]+)%/)?.[1] ? parseFloat(output.match(/Процент загружено:\s*([\d.]+)%/)![1]) === 100.0 : false };
      }
      case 'get_atomic_file': {
        const { dockerAgentService } = await import('../dockerAgentService');
        const fp = `/mnt/workspace/atomic/${args.fileName}.json`;
        const vr = await dockerAgentService.view({ path: fp, description: `Чтение атомика ${args.fileName}` });
        if (vr.type !== 'file') throw new Error(`Atomic file ${args.fileName} not found`);
        return { success: true, fileName: args.fileName, content: JSON.parse(vr.content), path: fp };
      }
      case 'save_atomic_file': {
        const { dockerAgentService } = await import('../dockerAgentService');
        const fp = `/mnt/workspace/atomic/${args.fileName}.json`;
        await dockerAgentService.bashTool({ command: `cd /mnt/workspace && cp atomic/${args.fileName}.json atomic/${args.fileName}.json.backup.$(date +%Y%m%d_%H%M%S) 2>/dev/null || true`, description: `Backup атомика ${args.fileName}` });
        await dockerAgentService.createFile({ path: fp, file_text: args.content, description: `Сохранение атомика ${args.fileName}` });
        JSON.parse(args.content); // validate
        return { success: true, fileName: args.fileName, path: fp, message: `Атомик ${args.fileName} сохранён (backup создан)` };
      }
      case 'get_index_registry': {
        const { dockerAgentService } = await import('../dockerAgentService');
        const fp = '/mnt/workspace/config/opensearch/index_versions.yaml';
        const vr = await dockerAgentService.view({ path: fp, description: 'Чтение реестра индексов' });
        if (vr.type !== 'file') throw new Error('Index registry not found');
        return { success: true, content: vr.content, path: fp };
      }
      case 'update_index_registry': {
        const { dockerAgentService } = await import('../dockerAgentService');
        const fp = '/mnt/workspace/config/opensearch/index_versions.yaml';
        await dockerAgentService.bashTool({ command: `cd /mnt/workspace && cp config/opensearch/index_versions.yaml config/opensearch/index_versions.yaml.backup.$(date +%Y%m%d_%H%M%S)`, description: 'Backup реестра индексов' });
        await dockerAgentService.createFile({ path: fp, file_text: args.content, description: 'Обновление реестра индексов' });
        return { success: true, path: fp, message: 'Реестр индексов обновлён (backup создан)' };
      }
      case 'run_regression_tests': {
        const { dockerAgentService } = await import('../dockerAgentService');
        const cmd = `cd /mnt/workspace && admin_app_backend/.venv/bin/python tests/test_search.py${args.categorySlug ? ` --category ${args.categorySlug}` : ''}`.trim();
        const r = await dockerAgentService.bashTool({ command: cmd, description: `Регрессия${args.categorySlug ? ` ${args.categorySlug}` : ''}`, timeout: 600000 });
        const output = r.stdout;
        return { success: r.success && r.returncode === 0, categorySlug: args.categorySlug || 'all', passed: output.match(/(\d+)\s+passed/)?.[1] ? parseInt(output.match(/(\d+)\s+passed/)![1], 10) : null, failed: output.match(/(\d+)\s+failed/)?.[1] ? parseInt(output.match(/(\d+)\s+failed/)![1], 10) : null, total: output.match(/(\d+)\s+total/)?.[1] ? parseInt(output.match(/(\d+)\s+total/)![1], 10) : null, output: r.stdout, stderr: r.stderr, returncode: r.returncode };
      }
      default: throw new Error(`Unknown category tool: ${toolName}`);
    }
  }

  /** Code execution tools */
  private async routeCodeTool(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case 'execute_code': {
        const executionContext = codeExecutionService.getContext();
        const planContext: Record<string, any> = {};
        if (this.deps.executionPlan) {
          this.deps.executionPlan.steps.forEach((step, index) => {
            if (step.executed && step.result) { planContext[`step_${index}_result`] = step.result; planContext[`step_${step.id}_result`] = step.result; }
          });
        }
        return codeExecutionService.executeCode(args.code, { ...executionContext, ...planContext, ...(args.context || {}) }, args.timeout || 5000);
      }
      case 'execute_bash': {
        try {
          return await bashExecutionService.executeWithState({ command: args.command, working_dir: args.working_dir, timeout: args.timeout });
        } catch (error: any) {
          return { success: false, stdout: '', stderr: '', returncode: -1, execution_time: 0, working_dir: bashExecutionService.getCurrentWorkingDir(), command: args.command, error: error.message || 'Ошибка выполнения bash команды' };
        }
      }
      case 'import_tool':
        return codeExecutionService.importTool(args.toolPath);
      case 'save_tool': {
        const toolPath = await codeExecutionService.saveTool(args.toolName, args.code, args.basePath || '/agent-tools');
        return { success: true, toolPath, message: `Tool "${args.toolName}" saved` };
      }
      case 'list_tools': {
        const tools = codeExecutionService.getAvailableTools();
        return { success: true, tools, count: tools.length };
      }
      case 'load_tool': {
        const code = await codeExecutionService.loadTool(args.toolName);
        return { success: true, toolName: args.toolName, code };
      }
      default: throw new Error(`Unknown code tool: ${toolName}`);
    }
  }

  /**
   * Обновление истории последних вызовов инструментов
   */
  private updateRecentToolCalls(toolName: string, args: any, result: any): void {
    const historyKey = toolName;
    const prev = (this.deps.recentToolCalls.get(historyKey) || [])
      .filter(c => Date.now() - c.timestamp < 10000);
    prev.push({ args, result, timestamp: Date.now() });
    const trimmed = prev.slice(-5);
    this.deps.recentToolCalls.set(historyKey, trimmed);
    // FIFO лимит 200 инструментов в истории
    if (this.deps.recentToolCalls.size > 200) {
      const firstKey = this.deps.recentToolCalls.keys().next().value;
      if (firstKey !== undefined) this.deps.recentToolCalls.delete(firstKey);
    }
  }

  /**
   * Проверка на повторяющиеся неинформативные результаты
   */
  private async checkForRepeatedNonInformativeResults(toolName: string): Promise<void> {
    const history = this.deps.recentToolCalls.get(toolName) || [];
    if (history.length >= 2) {
      const lastTwo = history.slice(-2);
      const r1 = JSON.stringify(lastTwo[0].result);
      const r2 = JSON.stringify(lastTwo[1].result);
      if (r1 === r2 && this.deps.isNonInformativeResult(lastTwo[1].result)) {
        const waitTime = Math.min(2000 * Math.pow(2, history.length - 2), 8000);
        console.warn(`Detected repeated non-informative response for ${toolName}. Backoff ${waitTime}ms`);
        await new Promise(res => setTimeout(res, waitTime));
        if (history.length >= 3) {
          throw new Error(`Tool ${toolName} returned same non-informative result ${history.length} times`);
        }
      }
    }
  }

  /** Code Analysis tools (Gap #6) */
  private codeAnalysisService = new CodeAnalysisService();

  private async routeCodeAnalysisTool(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case 'analyze_code_structure': {
        const structure = await this.codeAnalysisService.parseFileStructure(args.file_path);
        return {
          success: true,
          file: args.file_path,
          language: structure.language,
          totalLines: structure.totalLines,
          functions: structure.functions.map(f => `${f.name} (line ${f.line})`),
          classes: structure.classes.map(c => `${c.name} (line ${c.line}, methods: ${c.methods.join(', ') || 'none'})`),
          imports: structure.imports.map(i => `${i.name} from ${i.source}`),
          exports: structure.exports.map(e => `${e.name} (line ${e.line})`),
          summary: `${structure.functions.length} functions, ${structure.classes.length} classes, ${structure.imports.length} imports, ${structure.totalLines} lines`
        };
      }
      case 'search_code_symbols': {
        const results = await this.codeAnalysisService.searchSymbols(
          args.pattern,
          args.scope || '/mnt/workspace',
          args.symbol_type
        );
        return {
          success: true,
          pattern: args.pattern,
          resultsCount: results.length,
          results: results.map(r => ({
            file: r.file,
            line: r.line,
            type: r.type,
            context: r.context
          }))
        };
      }
      case 'get_code_dependencies': {
        const graph = await this.codeAnalysisService.getDependencyGraph(args.file_path);
        return {
          success: true,
          file: graph.file,
          imports: graph.imports.map(i => ({
            source: i.source,
            names: i.names,
            isRelative: i.isRelative
          })),
          importedBy: graph.importedBy || [],
          summary: `${graph.imports.length} imports, ${(graph.importedBy || []).length} dependents`
        };
      }
      default:
        throw new Error(`Unknown code analysis tool: ${toolName}`);
    }
  }
}

