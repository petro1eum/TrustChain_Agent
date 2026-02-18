/**
 * Сервис анализа контекста
 * Выделен из smart-ai-agent.ts для улучшения структуры кода
 */

import type { AppActions, DataProcessingContext } from '../../agents/types';

export interface ContextAnalyzerServiceDependencies {
  appActions?: AppActions;
  context: DataProcessingContext;
}

export class ContextAnalyzerService {
  constructor(private deps: ContextAnalyzerServiceDependencies) { }

  /**
   * Анализ доступного контекста для SELF-AWARENESS
   */
  async analyzeAvailableContext(userPrompt: string): Promise<{ summary: string, details: string, canAnswerDirectly: boolean }> {
    try {
      // БЫСТРАЯ ПРОВЕРКА: простые запросы не требуют анализа файлов
      const simplePatterns = [
        /^привет|^здравствуй|^добрый день|^hi|^hello/i,
        /^спасибо|^благодарю|^thank/i,
        /^пока|^до свидания|^bye/i,
        /^как дела|^how are you/i
      ];

      const isSimpleGreeting = simplePatterns.some(pattern => pattern.test(userPrompt.trim()));

      if (isSimpleGreeting) {
        return {
          summary: "Простое приветствие/благодарность",
          details: "Не требует работы с данными",
          canAnswerDirectly: true
        };
      }

      // Анализируем что у нам есть в контексте приложения
      if (!this.deps.appActions) {
        return {
          summary: "Доступна навигация, API бэкенда и встроенный браузер",
          details: "Используй инструменты: get_app_structure, navigate_to_tab, backend_api_call, get_yaml_file, browser_panel_open, browser_panel_click, browser_panel_fill, browser_panel_read, browser_panel_scroll, browser_panel_search, browser_panel_snapshot, browser_panel_screenshot, web_search, web_fetch, bash_tool",
          canAnswerDirectly: false
        };
      }

      // Попытаемся получить информацию о файлах через appActions
      let availableFiles: any[] = [];

      try {
        availableFiles = await this.deps.appActions.getAvailableFiles();
      } catch (e) {
        // Тихо игнорируем - возможно коллбеки не настроены, это нормально
      }

      // Анализируем запрос пользователя
      const isStructureRequest = userPrompt.toLowerCase().includes('список таблиц') ||
        userPrompt.toLowerCase().includes('структура') ||
        userPrompt.toLowerCase().includes('поля') ||
        userPrompt.toLowerCase().includes('tables') ||
        userPrompt.toLowerCase().includes('схема');

      const isFileSpecific = userPrompt.toLowerCase().includes('cable.mdb') ||
        userPrompt.toLowerCase().includes('файл');

      let summary = '';
      let details = '';
      let canAnswerDirectly = false;

      if (availableFiles.length > 0) {
        const fileWithContent = availableFiles.find(f => f.hasContent);

        if (fileWithContent && isStructureRequest) {
          summary = `У меня есть загруженный файл ${fileWithContent.name} со структурой`;
          details = `Файл: ${fileWithContent.name}, ID: ${fileWithContent.id}, записей: ${fileWithContent.rows || 'неизвестно'}`;

          // Пытаемся получить структуру файла
          try {
            const metadata = await this.deps.appActions.getFileMetadata(fileWithContent.id.toString());
            if (metadata.success && metadata.tables) {
              canAnswerDirectly = true;
              details += `\nСТРУКТУРА ДОСТУПНА: ${metadata.tables.length} таблиц с полями`;
              summary = `ДАННЫЕ УЖЕ ЕСТЬ! Могу сразу показать ${metadata.tables.length} таблиц из ${fileWithContent.name}`;
            }
          } catch (e) {
            console.log(`Внимание: SELF-AWARE: Не удалось получить метаданные файла`);
          }
        } else {
          summary = `Доступно файлов: ${availableFiles.length}`;
          details = availableFiles.map(f => `${f.name} (ID: ${f.id}, ${f.hasContent ? 'с данными' : 'метаданные'})`).join(', ');
        }
      } else {
        summary = "Файлы данных недоступны";
        details = "Нет загруженных файлов в приложении";
      }

      return { summary, details, canAnswerDirectly };

    } catch (error: any) {
      console.error('Ошибка анализа контекста:', error);
      return {
        summary: "Ошибка анализа контекста",
        details: `Ошибка: ${error.message}`,
        canAnswerDirectly: false
      };
    }
  }

  /**
   * Анализ текущего контекста
   */
  analyzeContext(): any {
    return {
      workspace_size: this.deps.context.workspace_df?.length || 0,
      loaded_files: this.deps.context.loaded_files,
      history_length: this.deps.context.history_stack.length,
      available_data: Object.keys(this.deps.context.source_files)
    };
  }
}

