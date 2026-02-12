/**
 * Сервис обработчиков инструментов
 * Выделен из smart-ai-agent.ts для улучшения структуры кода
 */

import type { AppActions, DataProcessingContext } from '../../agents/types';
import OpenAI from 'openai';
import * as XLSX from 'xlsx';
import { ArtifactsService } from '../artifacts';

export interface ToolHandlersServiceDependencies {
  appActions?: AppActions;
  context: DataProcessingContext;
  openai: OpenAI;
  normalizeArgs: (args: any, aliases: Record<string, string>) => any;
  safeAppAction: (fn: () => Promise<any>) => Promise<{ success: boolean; data?: any; error?: string }>;
}

export class ToolHandlersService {
  private deps: ToolHandlersServiceDependencies;

  constructor(deps: ToolHandlersServiceDependencies) {
    this.deps = deps;
  }

  async handleGetTransformationData(_args: any, _context: any): Promise<any> {
    if (!this.deps.appActions) throw new Error('App actions not available');

    try {
      const transformationData = await this.deps.appActions.getTransformationData();
      return {
        success: true,
        data: transformationData,
        description: 'Получены данные трансформации проекта'
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        description: 'Ошибка получения данных трансформации'
      };
    }
  }

  async handleSearchTransformationData(args: any, _context: any): Promise<any> {
    const norm = this.deps.normalizeArgs(args, { q: 'query', search_query: 'query', search_term: 'query' });
    let query = norm.query || norm.keywords || norm.term || '';
    if (!query || query === 'undefined') {
      return { success: false, error: 'No search query provided', query: '', description: 'Требуется указать поисковый запрос' };
    }
    const res = await this.deps.safeAppAction(() => this.deps.appActions!.searchTransformationData(query));
    if (res.success) return { success: true, query, results: res.data, description: `Поиск по запросу: "${query}"` };
    return { success: false, error: res.error, query, description: 'Ошибка поиска в данных трансформации' };
  }

  async handleGetFileMetadata(args: any, _context: any): Promise<any> {
    const norm = this.deps.normalizeArgs(args, { file_name: 'fileName' });
    const fileIdOrName = norm.fileId || norm.fileName || norm.name;

    console.log(`ToolHandlersService: handleGetFileMetadata вызван с:`, args);
    console.log(`ToolHandlersService: Извлеченный параметр: ${fileIdOrName}`);

    const res = await this.deps.safeAppAction(() => this.deps.appActions!.getFileMetadata(fileIdOrName));
    if (res.success) return { success: true, fileIdOrName, metadata: res.data, description: `Метаданные файла: ${fileIdOrName}` };
    return { success: false, error: res.error, fileIdOrName, description: 'Ошибка получения метаданных файла' };
  }

  async handleExtractTableToExcel(args: any): Promise<any> {
    // Refactored: Now calls backend Docker endpoint for isolation + TrustChain
    const norm = this.deps.normalizeArgs(args, {
      file_name: 'filename',
      file: 'filename',
      page_start: 'pageStart',
      page_end: 'pageEnd',
      sheet_name: 'sheetName',
      user_query: 'userQuery',
      userQuery: 'userQuery',
      query: 'query'
    });

    const filename = String(norm.filename || '').trim();
    if (!filename) {
      return { success: false, error: 'filename is required', description: 'Укажите имя PDF файла' };
    }

    const pageStart = Number(norm.pageStart);
    const pageEnd = Number(norm.pageEnd);
    if (!Number.isFinite(pageStart) || !Number.isFinite(pageEnd)) {
      return { success: false, error: 'page_start/page_end required', description: 'Укажите диапазон страниц' };
    }

    // Extract user query from instruction if not provided directly
    const extractUserQuery = (instruction: string): string => {
      if (!instruction) return '';
      const marker = '=== ВОПРОС ПОЛЬЗОВАТЕЛЯ ===';
      let text = instruction;
      if (text.includes(marker)) {
        text = text.split(marker).pop() || text;
      }
      text = text.split('[ВЛОЖЕНИЯ:')[0];
      text = text.split('[ПРЕДПРОСМОТР ВЛОЖЕНИЙ]')[0];
      return text.trim();
    };

    const rawInstruction = String(this.deps.context.lastInstruction || '').trim();
    const userQuery = String(norm.userQuery || norm.query || '').trim() || extractUserQuery(rawInstruction);

    try {
      // Call backend Docker endpoint
      const _env = typeof process !== 'undefined' ? process.env : {} as Record<string, string | undefined>;
      const BACKEND_URL = (typeof import.meta !== 'undefined' && (import.meta.env?.VITE_BACKEND_URL || import.meta.env?.VITE_API_BASE))
        || _env.VITE_BACKEND_URL
        || _env.VITE_API_BASE
        || '';

      const response = await fetch(`${BACKEND_URL}/api/docker-agent/extract_table`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename,
          page_start: Math.min(pageStart, pageEnd),
          page_end: Math.max(pageStart, pageEnd),
          user_query: userQuery || undefined,
          sheet_name: norm.sheetName || 'Товары'
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: response.statusText }));
        return {
          success: false,
          error: errorData.detail || `HTTP ${response.status}`,
          description: 'Ошибка вызова backend endpoint'
        };
      }

      const rawResult = await response.json();

      // Unwrap TrustChain response: {data: {...}, signature: "...", certificate: {...}}
      const signature = rawResult.signature;
      const signature_id = rawResult.signature_id;
      const certificate = rawResult.certificate;
      const result = rawResult.data ?? rawResult; // Fallback if no TrustChain wrapping

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'extraction_failed',
          description: result.description || 'Не удалось извлечь данные'
        };
      }

      // Upload the Excel file to artifacts
      const upload = await ArtifactsService.uploadArtifact({
        filename: result.filename,
        contentBase64: result.content_base64
      });

      if (!upload.success) {
        return { success: false, error: upload.error || 'upload_failed', description: 'Не удалось сохранить Excel' };
      }

      const size = Math.round((result.content_base64.length * 3) / 4);
      return {
        success: true,
        filename: upload.filename || result.filename,
        path: upload.path,
        rows_count: result.rows_count,
        description: `Таблица сохранена в Excel (${result.rows_count} строк)`,
        diagnostics: result.diagnostics,
        // TrustChain signature from backend (already extracted above)
        signature,
        signature_id,
        certificate,
        attachment: {
          id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: 'file',
          filename: upload.filename || result.filename,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          size
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'backend_call_failed',
        description: 'Не удалось вызвать backend для извлечения таблицы'
      };
    }
  }


  async handleTextProcessing(args: any): Promise<any> {
    const { column, operations } = args;

    const workspaceData = this.deps.context.workspace_df;
    if (!workspaceData) {
      throw new Error('Нет данных в workspace для обработки');
    }

    let dataToProcess: any[] = [];
    if (workspaceData.data && Array.isArray(workspaceData.data)) {
      dataToProcess = workspaceData.data;
    } else {
      throw new Error(`Некорректный формат данных в workspace`);
    }

    if (dataToProcess.length === 0) {
      throw new Error('Workspace содержит пустые данные');
    }

    const firstRow = dataToProcess[0];
    if (!firstRow.hasOwnProperty(column)) {
      const availableColumns = Object.keys(firstRow);
      throw new Error(`Колонка "${column}" не найдена. Доступные колонки: ${availableColumns.join(', ')}`);
    }

    const textOperations = {
      clean: (text: string) => String(text || '').trim().replace(/\s+/g, ' ').replace(/[^\w\s\-\.@]/g, ''),
      lowercase: (text: string) => String(text || '').toLowerCase(),
      uppercase: (text: string) => String(text || '').toUpperCase(),
      strip: (text: string) => String(text || '').trim(),
      extract_emails: (text: string) => {
        const emailRegex = /[\w.-]+@[\w.-]+\.\w+/g;
        return (String(text || '').match(emailRegex) || []).join(', ');
      },
      extract_phones: (text: string) => {
        const phoneRegex = /[\+]?[(]?[0-9]{1,4}[)]?[-\s\.]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,9}/g;
        return (String(text || '').match(phoneRegex) || []).join(', ');
      }
    };

    let processedCount = 0;
    const processedData = dataToProcess.map((row) => {
      let processedValue = row[column];

      for (const operation of operations) {
        if (textOperations[operation as keyof typeof textOperations]) {
          processedValue = textOperations[operation as keyof typeof textOperations](processedValue);
          processedCount++;
        } else {
          console.warn(`Внимание: Неизвестная операция: ${operation}`);
        }
      }

      return {
        ...row,
        [`${column}_processed`]: processedValue
      };
    });

    this.deps.context.workspace_df = {
      ...workspaceData,
      data: processedData,
      columns: [...(workspaceData.columns || []), `${column}_processed`]
    };

    this.deps.context.history_stack.push({
      operation: 'text_processing',
      column,
      operations,
      timestamp: new Date().toISOString(),
      affectedRows: processedData.length
    });

    return {
      success: true,
      column: column,
      operations: operations,
      processed_count: processedData.length,
      sample_before: dataToProcess.slice(0, 3).map(row => row[column]),
      sample_after: processedData.slice(0, 3).map(row => row[`${column}_processed`]),
      new_column: `${column}_processed`,
      total_rows: processedData.length
    };
  }

  async handleSemanticAnalysis(args: any, context: any): Promise<any> {
    const { column, instruction, new_column } = args;

    const analysisPrompt = `
Проанализируй текстовые данные и выполни инструкцию.
Колонка: ${column}
Инструкция: ${instruction}
Примеры данных: ${JSON.stringify(context.sampleData?.slice(0, 3))}
`;

    // Note: getApiParams должен быть передан через deps или использован напрямую
    const response = await this.deps.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'Ты аналитик данных.' },
        { role: 'user', content: analysisPrompt }
      ],
      temperature: 0.3
    });

    return {
      success: true,
      new_column: new_column,
      analysis: response.choices[0].message.content
    };
  }

  async handleMissingData(args: any, _context: any): Promise<any> {
    const { strategy, group_by, n_neighbors } = args;

    const strategies = {
      drop: () => ({ action: 'drop_missing', count: 0 }),
      fill_mean: () => ({ action: 'fill_with_mean', filled: 0 }),
      fill_median: () => ({ action: 'fill_with_median', filled: 0 }),
      fill_mode: () => ({ action: 'fill_with_mode', filled: 0 }),
      interpolate: () => ({ action: 'interpolate', interpolated: 0 }),
      knn: () => ({ action: 'knn_imputation', neighbors: n_neighbors || 5 })
    };

    const result = strategies[strategy as keyof typeof strategies]?.() || { error: 'Unknown strategy' };

    return {
      success: true,
      strategy: strategy,
      result: result,
      groups: group_by
    };
  }

  async handleNormalizeData(args: any, _context: any): Promise<any> {
    const { columns, method, feature_range } = args;

    return {
      success: true,
      columns: columns,
      method: method,
      feature_range: feature_range,
      normalized_count: _context?.dataSize || 0
    };
  }

  async handleOutliers(args: any, _context: any): Promise<any> {
    const { columns, method, action, threshold } = args;

    return {
      success: true,
      columns: columns,
      method: method,
      action: action,
      threshold: threshold,
      outliers_found: 0,
      outliers_handled: 0
    };
  }

  async handlePandasOperation(args: any, _context: any): Promise<any> {
    const { code, description } = args;

    console.log('Executing pandas code:', code);

    return {
      success: true,
      description: description,
      code_executed: code,
      rows_affected: _context?.dataSize || 0,
      execution_time: '0.5s'
    };
  }

  async handleSmartLookup(args: any, _context: any): Promise<any> {
    const {
      columns_to_add: columnsToAddRaw,
      fuzzy_threshold = 0.9
    } = args as { lookup_file?: string; left_on?: string; right_on?: string; columns_to_add?: string[]; fuzzy_threshold?: number };

    const columns_to_add: string[] = Array.isArray(columnsToAddRaw) ? columnsToAddRaw : [];

    return {
      success: true,
      fuzzy_matches: 0,
      threshold_used: fuzzy_threshold,
      columns_added: (columns_to_add as any[]) || []
    };
  }

  async handleDataQualityAnalysis(args: any, context: any): Promise<any> {
    const { full_analysis = true } = args as { full_analysis?: boolean };

    const analysis: {
      total_rows: number;
      total_columns: number;
      missing_values: { total: number; by_column: Record<string, number> };
      duplicates: { full_duplicates: number; partial_duplicates: number };
      data_types: Record<string, string>;
      outliers: Record<string, string>;
      recommendations: string[];
    } = {
      total_rows: context.dataSize || 0,
      total_columns: context.columns?.length || 0,
      missing_values: {
        total: 0,
        by_column: {}
      },
      duplicates: {
        full_duplicates: 0,
        partial_duplicates: 0
      },
      data_types: {},
      outliers: {},
      recommendations: [] as string[]
    };

    if (full_analysis) {
      const recs: string[] = [
        'Рекомендую заполнить пропущенные значения',
        'Обнаружены потенциальные выбросы в числовых колонках',
        'Найдены дубликаты, требующие внимания'
      ];
      analysis.recommendations = recs;
    }

    return analysis;
  }

  async handleAccessSourceFile(args: any, _context: any): Promise<any> {
    const { filename, columns, condition } = args;

    if (!this.deps.context.source_files[filename]) {
      throw new Error(`Файл ${filename} не найден`);
    }

    let data = this.deps.context.source_files[filename];

    if (condition) {
      console.log(`Applying condition: ${condition}`);
    }

    if (columns && columns.length > 0) {
      data = data.map((row: any) => {
        const filtered: any = {};
        columns.forEach((col: string) => filtered[col] = row[col]);
        return filtered;
      });
    }

    return {
      success: true,
      data: data,
      rowCount: data.length
    };
  }

  async handleAddToWorkspace(args: any, _context: any): Promise<any> {
    const { data_source, operation } = args;

    return {
      success: true,
      operation: operation,
      data_source: data_source,
      workspace_size: this.deps.context.workspace_df?.length || 0
    };
  }

  // === Docker Agent инструменты ===
  async handleBashTool(args: any): Promise<any> {
    const dockerAgentServiceModule = await import('../dockerAgentService');
    const dockerAgentService = dockerAgentServiceModule.dockerAgentService;

    try {
      const result = await dockerAgentService.bashTool({
        command: args.command,
        description: args.description,
        working_dir: args.working_dir,
        timeout: args.timeout
      });

      return {
        success: result.success,
        stdout: result.stdout,
        stderr: result.stderr,
        returncode: result.returncode,
        execution_time: result.execution_time,
        command: result.command,
        error: result.error
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Ошибка выполнения команды в контейнере',
        command: args.command
      };
    }
  }

  async handleView(args: any): Promise<any> {
    const dockerAgentServiceModule = await import('../dockerAgentService');
    const dockerAgentService = dockerAgentServiceModule.dockerAgentService;

    try {
      const result = await dockerAgentService.view({
        path: args.path,
        view_range: args.view_range,
        description: args.description
      });

      return {
        success: true,
        type: result.type,
        path: result.path,
        content: result.content,
        lines: result.lines,
        view_range: result.view_range
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Ошибка просмотра файла',
        path: args.path
      };
    }
  }

  async handleCreateFile(args: any): Promise<any> {
    const dockerAgentServiceModule = await import('../dockerAgentService');
    const dockerAgentService = dockerAgentServiceModule.dockerAgentService;

    try {
      const result = await dockerAgentService.createFile({
        description: args.description,
        path: args.path,
        file_text: args.file_text
      });

      return {
        success: result.success,
        path: result.path,
        size: result.size,
        message: result.message || 'Файл успешно создан'
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Ошибка создания файла',
        path: args.path
      };
    }
  }

  async handleCreateArtifact(args: any): Promise<any> {
    const dockerAgentServiceModule = await import('../dockerAgentService');
    const dockerAgentService = dockerAgentServiceModule.dockerAgentService;

    try {
      // Автоматически создаем путь в /mnt/user-data/outputs
      const filename = args.filename;
      const artifactPath = `/mnt/user-data/outputs/${filename}`;

      // Создаем файл через create_file
      const result = await dockerAgentService.createFile({
        description: args.description || `Создаю artifact: ${filename}`,
        path: artifactPath,
        file_text: args.content
      });

      if (!result.success) {
        return {
          success: false,
          error: result.message || 'Ошибка создания artifact',
          filename
        };
      }

      // Определяем тип artifact
      const artifactType = args.type || this.detectArtifactType(filename);

      // Возвращаем результат
      return {
        success: true,
        filename,
        path: artifactPath,
        size: result.size,
        type: artifactType,
        message: `Artifact "${filename}" успешно создан. Artifact автоматически появится в ArtifactsViewer (кнопка с иконкой файла в шапке чата). Сообщи пользователю: "График создан. Открой ArtifactsViewer для просмотра."`
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Ошибка создания artifact',
        filename: args.filename
      };
    }
  }

  /**
   * Определить тип artifact по имени файла
   */
  private detectArtifactType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';

    switch (ext) {
      case 'md':
      case 'markdown':
        return 'markdown';
      case 'html':
      case 'htm':
        return 'html';
      case 'jsx':
      case 'tsx':
        return 'react';
      case 'svg':
        return 'svg';
      case 'mmd':
      case 'mermaid':
        return 'mermaid';
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'webp':
        return 'image';
      case 'json':
        return 'json';
      case 'py':
      case 'js':
      case 'ts':
      case 'css':
      case 'xml':
      case 'yaml':
      case 'yml':
        return 'code';
      case 'txt':
        return 'text';
      default:
        return 'text';
    }
  }

  async handleStrReplace(args: any): Promise<any> {
    const dockerAgentServiceModule = await import('../dockerAgentService');
    const dockerAgentService = dockerAgentServiceModule.dockerAgentService;

    try {
      const result = await dockerAgentService.strReplace({
        path: args.path,
        old_str: args.old_str,
        new_str: args.new_str || '',
        description: args.description
      });

      return {
        success: result.success,
        path: result.path,
        message: result.message || 'Замена выполнена успешно'
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Ошибка замены строки',
        path: args.path
      };
    }
  }
}
