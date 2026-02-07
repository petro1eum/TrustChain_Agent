/**
 * Сервис для безопасного выполнения кода агентом
 * Поддерживает TypeScript/JavaScript выполнение в изолированной среде
 */

// Безопасные глобальные объекты для выполнения кода
const SAFE_GLOBALS = {
  console: {
    log: (...args: any[]) => console.log('[Agent Code]', ...args),
    error: (...args: any[]) => console.error('[Agent Code]', ...args),
    warn: (...args: any[]) => console.warn('[Agent Code]', ...args),
    info: (...args: any[]) => console.info('[Agent Code]', ...args),
  },
  JSON: {
    parse: JSON.parse,
    stringify: JSON.stringify,
  },
  Math: Math,
  Date: Date,
  Array: Array,
  Object: Object,
  String: String,
  Number: Number,
  Boolean: Boolean,
  RegExp: RegExp,
  Error: Error,
  Promise: Promise,
  Map: Map,
  Set: Set,
  WeakMap: WeakMap,
  WeakSet: WeakSet,
};

// Запрещённые ключевые слова и паттерны
const FORBIDDEN_PATTERNS = [
  /eval\s*\(/i,
  /Function\s*\(/i,
  /setTimeout\s*\(/i,
  /setInterval\s*\(/i,
  /import\s*\(/i,
  /require\s*\(/i,
  /fetch\s*\(/i,
  /XMLHttpRequest/i,
  /WebSocket/i,
  /Worker/i,
  /localStorage/i,
  /sessionStorage/i,
  /document/i,
  /window/i,
  /global/i,
  /process/i,
];

export interface CodeExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
  logs: string[];
  executionTime: number;
}

export class CodeExecutionService {
  private executionContext: Map<string, any> = new Map();
  private logs: string[] = [];

  /**
   * Выполнить код в безопасной среде
   */
  async executeCode(
    code: string,
    context?: Record<string, any>,
    timeout: number = 5000
  ): Promise<CodeExecutionResult> {
    const startTime = Date.now();
    this.logs = [];

    // Проверка на запрещённые паттерны
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(code)) {
        return {
          success: false,
          error: `Запрещённый паттерн обнаружен: ${pattern}`,
          logs: [],
          executionTime: Date.now() - startTime,
        };
      }
    }

    try {
      // Создаём безопасный контекст выполнения
      const safeContext = {
        ...SAFE_GLOBALS,
        ...context,
        // Переменные из предыдущих выполнений
        ...Object.fromEntries(this.executionContext),
        // Логирование
        _log: (message: string) => {
          this.logs.push(message);
          console.log('[Agent Code]', message);
        },
        // Сохранение переменных
        _save: (name: string, value: any) => {
          this.executionContext.set(name, value);
        },
        // Получение переменных
        _get: (name: string) => {
          return this.executionContext.get(name);
        },
        // Список переменных
        _list: () => {
          return Array.from(this.executionContext.keys());
        },
      };

      // Обёртка для выполнения с таймаутом
      const executeWithTimeout = async () => {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error('Execution timeout'));
          }, timeout);

          try {
            // Создаём функцию из кода
            const func = new Function(
              ...Object.keys(safeContext),
              `
              try {
                ${code}
              } catch (error) {
                throw new Error('Code execution error: ' + error.message);
              }
            `
            );

            // Выполняем функцию
            const result = func(...Object.values(safeContext));
            
            clearTimeout(timer);
            
            // Если результат - Promise, ждём его
            if (result instanceof Promise) {
              result.then(resolve).catch(reject);
            } else {
              resolve(result);
            }
          } catch (error) {
            clearTimeout(timer);
            reject(error);
          }
        });
      };

      const result = await executeWithTimeout();

      return {
        success: true,
        result,
        logs: this.logs,
        executionTime: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error),
        logs: this.logs,
        executionTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Импортировать инструмент из файла
   */
  async importTool(toolPath: string): Promise<any> {
    try {
      // В браузере мы не можем напрямую импортировать файлы
      // Нужно использовать динамический импорт или fetch
      const response = await fetch(toolPath);
      if (!response.ok) {
        throw new Error(`Failed to load tool: ${response.statusText}`);
      }
      
      const code = await response.text();
      
      // Выполняем код инструмента
      const result = await this.executeCode(code);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to execute tool');
      }
      
      return result.result;
    } catch (error: any) {
      throw new Error(`Failed to import tool: ${error.message}`);
    }
  }

  /**
   * Сохранить инструмент в файл
   */
  async saveTool(toolName: string, code: string, basePath: string = '/agent-tools'): Promise<string> {
    try {
      // В браузере мы не можем напрямую писать файлы
      // Используем localStorage или отправляем на backend
      const toolKey = `${basePath}/${toolName}.ts`;
      const toolData = {
        name: toolName,
        code,
        createdAt: new Date().toISOString(),
        version: '1.0.0',
      };
      
      // Сохраняем в localStorage как временное решение
      const tools = JSON.parse(localStorage.getItem('agent_tools') || '{}');
      tools[toolName] = toolData;
      localStorage.setItem('agent_tools', JSON.stringify(tools));
      
      return toolKey;
    } catch (error: any) {
      throw new Error(`Failed to save tool: ${error.message}`);
    }
  }

  /**
   * Получить список доступных инструментов
   */
  getAvailableTools(): string[] {
    try {
      const tools = JSON.parse(localStorage.getItem('agent_tools') || '{}');
      return Object.keys(tools);
    } catch {
      return [];
    }
  }

  /**
   * Загрузить инструмент
   */
  async loadTool(toolName: string): Promise<string> {
    try {
      const tools = JSON.parse(localStorage.getItem('agent_tools') || '{}');
      const tool = tools[toolName];
      
      if (!tool) {
        throw new Error(`Tool "${toolName}" not found`);
      }
      
      return tool.code;
    } catch (error: any) {
      throw new Error(`Failed to load tool: ${error.message}`);
    }
  }

  /**
   * Очистить контекст выполнения
   */
  clearContext(): void {
    this.executionContext.clear();
    this.logs = [];
  }

  /**
   * Получить текущий контекст
   */
  getContext(): Record<string, any> {
    return Object.fromEntries(this.executionContext);
  }
}

export const codeExecutionService = new CodeExecutionService();

