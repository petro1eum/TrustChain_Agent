/**
 * Сервис выполнения инструментов
 * Выделен из smart-ai-agent.ts для уменьшения размера основного файла
 * Содержит всю логику выполнения инструментов (~900 строк)
 */

import { agentDebugService } from '../agentDebugService';
import { webSearchService } from '../webSearchService';
import { codeExecutionService } from '../codeExecutionService';
import { bashExecutionService } from '../bashExecutionService';
import { trustchainService } from '../trustchainService';
import type { TrustChainEnvelope } from '../trustchainService';
import { signViaBackend, recordAnalyticsViaBackend, recordGraphNodeViaBackend } from '../backendSigningService';
import type { BackendSignature } from '../backendSigningService';
import type { MetricsService } from './metricsService';
import type { ToolHandlersService } from './toolHandlersService';
import type { AppActions, DataProcessingContext, ExecutionPlan } from '../../agents/types';
import type { ResourceManager } from '../resources';
import { CodeAnalysisService } from './codeAnalysisService';

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

      // 🔐 TrustChain: подпись каждого tool call (browser Ed25519)
      let tcEnvelope: TrustChainEnvelope | undefined;
      try {
        tcEnvelope = await trustchainService.sign(toolName, args);
      } catch (e) {
        console.warn('[ToolExecution][TrustChain] Signing skipped:', (e as Error).message);
      }

      // 🔐 Backend TrustChain: подпись через Python Ed25519 (trust_chain library)
      const latency = Date.now() - toolStartTime;
      let backendSig: BackendSignature | null = null;
      try {
        const resultPreview = typeof result === 'string' ? result : JSON.stringify(result);
        // Fire-and-forget: don't await if we want faster UX
        backendSig = await signViaBackend(toolName, args, resultPreview || '', latency);
      } catch (e) {
        console.warn('[ToolExecution][BackendSign] Skipped:', (e as Error).message);
      }

      // Обогащаем результат подписями
      if (result && typeof result === 'object') {
        if (tcEnvelope) {
          result.__tc_envelope = tcEnvelope;
          result.__tc_signature = tcEnvelope.signature;
        }
        if (backendSig) {
          result.__tc_backend = backendSig;
          result.__tc_backend_signature = backendSig.signature;
          result.__tc_backend_verified = backendSig.verified;
        }
      }

      // 📊 TrustChain Pro: Analytics record (fire-and-forget)
      const toolSuccess = !(result && typeof result === 'object' && result.error);
      recordAnalyticsViaBackend(toolName, latency, toolSuccess);

      // 🗓 TrustChain Pro: Execution Graph node (fire-and-forget)
      const graphPreview = typeof result === 'string' ? result : JSON.stringify(result);
      recordGraphNodeViaBackend(toolName, args, graphPreview || '');

      // Кешируем результат (FIFO лимит 200)
      this.deps.toolExecutionCache.set(cacheKey, result);
      if (this.deps.toolExecutionCache.size > 200) {
        const firstKey = this.deps.toolExecutionCache.keys().next().value;
        if (firstKey !== undefined) this.deps.toolExecutionCache.delete(firstKey);
      }

      // 📊 метрики
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
      // === Web инструменты ===
      case 'web_search': case 'web_fetch':
        result = await this.routeWebTool(toolName, args);
        break;

      // === Legacy data-processing/ETL инструменты вынесены в MCP плагины ===
      case 'text_processing':
      case 'semantic_analysis':
      case 'handle_missing_data':
      case 'normalize_data':
      case 'handle_outliers':
      case 'execute_pandas_operation':
      case 'smart_lookup_and_merge':
      case 'analyze_data_quality':
      case 'access_source_file':
      case 'add_to_workspace':
      case 'get_transformation_data':
      case 'search_transformation_data':
      case 'get_file_metadata':
        return {
          success: false,
          error: `Tool "${toolName}" удален из универсального ядра. Подключите эквивалент через MCP plugin.`,
          code: 'LEGACY_TOOL_REMOVED_FROM_CORE'
        };

      case 'extract_table_to_excel':
        result = await this.deps.toolHandlers.handleExtractTableToExcel(args);
        break;

      // === Docker Agent инструменты ===
      case 'bash_tool': case 'view': case 'create_file':
      case 'create_artifact': case 'str_replace':
      case 'session_spawn': case 'session_status': case 'session_result':
      case 'message_agent': case 'write_memory_tool': case 'read_memory_tool':
        result = await this.routeDockerTool(toolName, args);
        break;

      // === Code execution инструменты ===
      case 'execute_code': case 'execute_bash':
      case 'import_tool': case 'save_tool':
      case 'list_tools': case 'load_tool':
        result = await this.routeCodeTool(toolName, args);
        break;

      // === Code Analysis: AST-level code understanding ===
      case 'analyze_code_structure':
      case 'search_code_symbols':
      case 'get_code_dependencies':
        result = await this.routeCodeAnalysisTool(toolName, args);
        break;

      case 'none':
      case 'answer':
      case 'no_tool':
        return { success: true, message: 'Direct answer without tools' };

      default: {
        // === TrustChain tools (tc_*) ===
        const { isTrustChainTool, routeTrustChainTool } = await import('./trustchainToolExecution');
        if (isTrustChainTool(toolName)) {
          result = await routeTrustChainTool(toolName, args);
          break;
        }

        // Check if this is a dynamically registered app action
        const { appActionsRegistry } = await import('../appActionsRegistry');
        if (appActionsRegistry.has(toolName)) {
          result = await appActionsRegistry.callAction(toolName, args);
          break;
        }
        // All domain-specific tools are handled by MCP servers.
        // If we reach here, the tool was not routed through MCP.
        console.error(`[ToolExecution] Unknown tool: ${toolName}. Domain tools should be served via MCP or registered via postMessage.`);
        throw new Error(`Unknown tool: ${toolName}. Provide via MCP server or register via trustchain:register_actions postMessage.`);
      }
    }

    // КРИТИЧНО: Проверяем что result был установлен
    if (result === undefined) {
      console.error(`[ToolExecution] CRITICAL: result is undefined after switch for ${toolName}!`);
      throw new Error(`Tool ${toolName} did not set result. Check switch case implementation.`);
    }

    return result;
  }

  // ========== Доменные методы маршрутизации ==========

  /** Docker container tools: bash_tool, view, create_file, create_artifact, str_replace, session_spawn, session_status, session_result, message_agent, write_memory_tool, read_memory_tool */
  private async routeDockerTool(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case 'bash_tool': return this.deps.toolHandlers.handleBashTool(args);
      case 'view': return this.deps.toolHandlers.handleView(args);
      case 'create_file': return this.deps.toolHandlers.handleCreateFile(args);
      case 'create_artifact': return this.deps.toolHandlers.handleCreateArtifact(args);
      case 'str_replace': return this.deps.toolHandlers.handleStrReplace(args);
      case 'session_spawn': return this.deps.toolHandlers.handleSessionSpawn(args);
      case 'session_status': return this.deps.toolHandlers.handleSessionStatus(args);
      case 'session_result': return this.deps.toolHandlers.handleSessionResult(args);
      case 'message_agent': return this.deps.toolHandlers.handleMessageAgent(args);
      case 'write_memory_tool': return this.deps.toolHandlers.handleWriteMemoryTool(args);
      case 'read_memory_tool': return this.deps.toolHandlers.handleReadMemoryTool(args);
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

