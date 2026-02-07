/**
 * Сервис генерации ответов
 * Выделен из smart-ai-agent.ts для улучшения структуры кода
 */

import type { PlannedStep, ExecutionPlan } from '../../agents/types';

export class ResponseGeneratorService {
  /**
   * Генерация Pandas решения
   */
  generatePandasSolution(userQuestion: string, data: any, reflection: any): string {
    let answer = `# Pandas решение для: "${userQuestion}"\n\n`;
    
    answer += `## Анализ задачи:\n${reflection.analysis}\n\n`;
    answer += `## Рекомендуемый подход:\n${reflection.bestApproach}\n\n`;
    
    if (data.tables && data.tables.length > 0) {
      answer += `## Pandas код:\n\n`;
      answer += `\`\`\`python\nimport pandas as pd\nimport sqlite3\n\n`;
      answer += `# Загрузка данных из MDB файла\n`;
      answer += `# (предполагается, что файл уже конвертирован в SQLite)\n\n`;
      
      data.tables.slice(0, 5).forEach((table: any) => {
        const tableName = table.name.replace(/[^a-zA-Z0-9_]/g, '_');
        answer += `df_${tableName} = pd.read_sql_query("SELECT * FROM [${table.name}]", connection)\n`;
      });
      
      answer += `\n# Информация о структуре\n`;
      answer += `tables_info = {\n`;
      data.tables.forEach((table: any, i: number) => {
        answer += `    "${table.name}": {"rows": ${table.rowCount || 0}, "columns": ${table.columns?.length || 0}},\n`;
        if (i > 10) {
          answer += `    # ... еще ${data.tables.length - i - 1} таблиц\n`;
          return false;
        }
      });
      answer += `}\n\n`;
      
      answer += `# Вывод структуры всех таблиц\n`;
      answer += `for table_name, info in tables_info.items():\n`;
      answer += `    print(f"{table_name}: {info['rows']} строк, {info['columns']} столбцов")\n`;
      answer += `\`\`\`\n\n`;
    }
    
    answer += `## Альтернативы:\n`;
    reflection.alternativeOptions?.forEach((option: string) => {
      answer += `- ${option}\n`;
    });
    
    answer += `\n---\n\n`;
    answer += this.generateMarkdownTablesList(data.tables || [], data.fileName || 'файла');
    
    return answer;
  }

  /**
   * Генерация кастомного ответа
   */
  generateCustomAnswer(userQuestion: string, data: any, reflection: any): string {
    let answer = `# Ответ на вопрос: "${userQuestion}"\n\n`;
    
    answer += `## Анализ:\n${reflection.analysis}\n\n`;
    answer += `## Рассуждения:\n${reflection.reasoning}\n\n`;
    
    if (data.tables) {
      answer += this.generateMarkdownTablesList(data.tables, data.fileName || 'файла');
    }
    
    return answer;
  }

  /**
   * УНИВЕРСАЛЬНАЯ генерация Pandas решения
   */
  generateUniversalPandasSolution(userQuestion: string, allResults: any[], reflection: any): string {
    let answer = `# Pandas решение для: "${userQuestion}"\n\n`;
    
    answer += `## Что хочет пользователь:\n${reflection.userWants}\n\n`;
    answer += `## Анализ данных:\n${reflection.dataAnalysis}\n\n`;
    answer += `## Рекомендуемый подход:\n${reflection.bestApproach}\n\n`;
    
    const dataForPandas = this.extractDataForPandas(allResults);
    
    if (dataForPandas.length > 0) {
      answer += `## Pandas код:\n\n\`\`\`python\nimport pandas as pd\n\n`;
      
      dataForPandas.forEach((dataset, i) => {
        answer += `# Датасет ${i + 1}: ${dataset.name}\n`;
        answer += `df_${i + 1} = pd.DataFrame(${JSON.stringify(dataset.sample, null, 2)})\n\n`;
      });
      
      answer += `# Анализ структуры\nfor i, df in enumerate([${dataForPandas.map((_, i) => `df_${i + 1}`).join(', ')}], 1):\n`;
      answer += `    print(f"Датасет {i}: {df.shape[0]} строк, {df.shape[1]} столбцов")\n`;
      answer += `    print(df.info())\n    print("---")\n\`\`\`\n\n`;
    }
    
    answer += `## Альтернативы:\n`;
    reflection.alternativeOptions?.forEach((option: string) => {
      answer += `- ${option}\n`;
    });
    
    return answer;
  }

  /**
   * УНИВЕРСАЛЬНАЯ генерация Markdown
   */
  generateUniversalMarkdown(userQuestion: string, allResults: any[], reflection: any): string {
    let answer = `# ${userQuestion}\n\n`;
    
    answer += `## Анализ:\n${reflection.userWants}\n\n`;
    
    for (const result of allResults) {
      if (result.data?.metadata?.tables) {
        answer += this.generateMarkdownTablesList(result.data.metadata.tables, result.data.metadata.fileName || 'файла');
        break;
      } else if (result.data?.tables) {
        answer += this.generateMarkdownTablesList(result.data.tables, 'файла');
        break;
      }
    }
    
    return answer;
  }

  /**
   * Генерация прямого ответа
   */
  generateDirectAnswer(userQuestion: string, allResults: any[], reflection: any): string {
    if ((reflection as any).shortAnswer || (reflection as any).extendedAnswer) {
      return this.composeDirectAnswer(userQuestion, reflection as any);
    }

    const preview = this.extractPreviewFromResults(allResults);
    const hasSynNotFound = allResults.some(r => r?.data?.error === 'synonyms_not_found');

    let short = hasSynNotFound
      ? 'Синонимы не найдены.'
      : (reflection as any).bestApproach || this.extractKeyData(allResults) || (preview
      ? `Нашёл ${preview.total} элементов, показываю первые ${preview.lines.length}.`
      : 'Готово.');

    let extended = '';
    if (preview && preview.lines.length) {
      extended += preview.title + '\n' + preview.lines.map((line: string) => `- ${line}`).join('\n');
    }
    if (hasSynNotFound) {
      extended += (extended ? '\n\n' : '') + 'Источник недоступен: не удалось получить синонимы ни из API, ни из локального файла. Попробуйте уточнить файл/путь или откройте /atomic/autoreplace.json.';
    }
    if ((reflection as any).reasoning) extended += (extended ? '\n\n' : '') + `Причина: ${(reflection as any).reasoning}`;
    if ((reflection as any).alternativeOptions?.length) {
      extended += `\n\nАльтернативы:\n` + (reflection as any).alternativeOptions.map((o: string) => `- ${o}`).join('\n');
    }
    return this.composeDirectAnswer(userQuestion, { shortAnswer: short, extendedAnswer: extended } as any);
  }

  composeDirectAnswer(userQuestion: string, payload: { shortAnswer?: string; extendedAnswer?: string }): string {
    const short = (payload.shortAnswer || '').trim();
    const extended = (payload.extendedAnswer || '').trim();
    let out = '';
    if (short) {
      out += `**Короткий ответ:** ${short}\n`;
    }
    if (extended) {
      out += `\n**Расширенный ответ:**\n${extended}`;
    }
    if (!out) out = `**Ответ:** ${userQuestion}`;
    return out;
  }

  /**
   * УНИВЕРСАЛЬНАЯ генерация кастомного ответа  
   */
  generateUniversalCustomAnswer(userQuestion: string, allResults: any[], reflection: any): string {
    let answer = `# ${userQuestion}\n\n`;
    
    answer += `## Анализ:\n${reflection.dataAnalysis}\n\n`;
    answer += `## Подход:\n${reflection.bestApproach}\n\n`;
    answer += `## Обоснование:\n${reflection.reasoning}\n\n`;
    
    answer += `## Данные:\n`;
    allResults.forEach((result, i) => {
      if (result.success) {
        answer += `### ${i + 1}. ${result.tool}\n`;
        answer += `${result.thought || 'Операция выполнена'}\n\n`;
      }
    });
    
    return answer;
  }

  /**
   * УНИВЕРСАЛЬНЫЙ отчет
   */
  generateUniversalReport(userQuestion: string, allResults: any[], reflection: any): string {
    let answer = `# Анализ: "${userQuestion}"\n\n`;
    
    answer += `## Что искал пользователь:\n${reflection.userWants}\n\n`;
    answer += `## Что я нашел:\n${reflection.dataAnalysis}\n\n`;
    answer += `## Мой подход:\n${reflection.bestApproach}\n\n`;
    answer += `## Обоснование:\n${reflection.reasoning}\n\n`;
    
    answer += `## Выполненные операции:\n`;
    allResults.forEach((result, i) => {
      const status = result.success ? '' : '';
      answer += `${i + 1}. ${status} **${result.tool}** - ${result.thought?.substring(0, 100)}...\n`;
    });
    
    answer += `\n## Альтернативные подходы:\n`;
    reflection.alternativeOptions?.forEach((option: string) => {
      answer += `- ${option}\n`;
    });
    
    return answer;
  }

  /**
   * Извлечение данных для pandas
   */
  extractDataForPandas(allResults: any[]): any[] {
    const datasets: any[] = [];
    
    allResults.forEach(result => {
      if (result.data?.metadata?.tables) {
        datasets.push({
          name: result.data.metadata.fileName || 'Dataset',
          sample: result.data.metadata.tables.slice(0, 3),
          type: 'tables'
        });
      } else if (result.data?.data) {
        datasets.push({
          name: 'Data',
          sample: Array.isArray(result.data.data) ? result.data.data.slice(0, 3) : [result.data.data],
          type: 'raw'
        });
      }
    });
    
    return datasets;
  }

  /**
   * Извлечение ключевых данных
   */
  extractKeyData(allResults: any[]): string {
    for (const result of allResults) {
      if (result.data?.metadata?.totalTables) {
        return `${result.data.metadata.totalTables} таблиц в файле ${result.data.metadata.fileName}`;
      } else if (result.data?.rowCount) {
        return `${result.data.rowCount} записей обработано`;
      } else if (Array.isArray(result.data?.items)) {
        const n = (result.data.items as any[]).length;
        return n ? `Найдено элементов: ${n}` : '';
      } else if (Array.isArray(result.data?.preview)) {
        const n = (result.data.preview as any[]).length;
        return n ? `Предпросмотр строк: ${n}` : '';
      } else if (Array.isArray(result.data?.hits)) {
        const n = (result.data.hits as any[]).length;
        return n ? `Найдено совпадений: ${n}` : '';
      } else if (result.data?.success) {
        return 'Операция выполнена успешно';
      }
    }
    return '';
  }

  extractPreviewFromResults(allResults: any[]): { title: string; lines: string[]; total: number } | null {
    for (const r of allResults) {
      const data = r?.data || {};
      if (Array.isArray(data.items)) {
        const items = (data.items as any[]).map(v => String(v));
        return { title: '**Элементы:**', lines: items.slice(0, 20), total: items.length };
      }
      if (Array.isArray(data.preview)) {
        const lines = (data.preview as any[]).map(v => String(v));
        return { title: '**Предпросмотр:**', lines: lines.slice(0, 20), total: lines.length };
      }
      if (Array.isArray(data.hits)) {
        const lines = (data.hits as any[]).map((h: any) => h?.path || JSON.stringify(h));
        return { title: '**Найденные файлы:**', lines: lines.slice(0, 20), total: lines.length };
      }
    }
    return null;
  }

  /**
   * Генерация Markdown списка таблиц
   */
  generateMarkdownTablesList(tables: any[], fileName: string): string {
    let markdown = `# Структура файла \`${fileName}\`\n\n`;
    markdown += `**Всего таблиц:** ${tables.length}\n\n`;
    
    tables.forEach((table, index) => {
      markdown += `## ${index + 1}. ${table.name}\n\n`;
      
      if (table.columns && table.columns.length > 0) {
        markdown += `**Столбцы:**\n`;
        table.columns.forEach((column: string) => {
          markdown += `- \`${column}\`\n`;
        });
      } else {
        markdown += `*Информация о столбцах недоступна*\n`;
      }
      
      if (table.rowCount !== undefined) {
        markdown += `\n**Количество записей:** ${table.rowCount.toLocaleString()}\n`;
      }
      
      markdown += `\n---\n\n`;
    });
    
    markdown += `\n## Сводка\n\n`;
    const totalRows = tables.reduce((sum, table) => sum + (table.rowCount || 0), 0);
    markdown += `- **Общее количество таблиц:** ${tables.length}\n`;
    markdown += `- **Общее количество записей:** ${totalRows.toLocaleString()}\n`;
    
    const tablesWithData = tables.filter(t => t.rowCount > 0);
    markdown += `- **Таблиц с данными:** ${tablesWithData.length}\n`;
    
    if (totalRows > 0) {
      const largestTable = tables.reduce((max, table) => 
        (table.rowCount || 0) > (max.rowCount || 0) ? table : max
      );
      markdown += `- **Самая большая таблица:** "${largestTable.name}" (${(largestTable.rowCount || 0).toLocaleString()} записей)\n`;
    }
    
    return markdown;
  }

  /**
   * Простой анализ результатов без GPT (fallback)
   */
  generateSimpleAnalysis(executedSteps: PlannedStep[], instruction: string): string {
    let report = `## АНАЛИЗ РЕЗУЛЬТАТОВ (Базовый режим)\n\n`;
    
    const successfulSteps = executedSteps.filter(s => s.result?.success !== false);
    const failedSteps = executedSteps.filter(s => s.result?.success === false);
    
    report += `### ОБЩИЕ РЕЗУЛЬТАТЫ:\n`;
    report += `**Успешных шагов:** ${successfulSteps.length}/${executedSteps.length}\n`;
    if (failedSteps.length > 0) {
      report += `**Неудачных шагов:** ${failedSteps.length}\n`;
    }
    
    report += `\n### ВЫПОЛНЕННЫЕ ОПЕРАЦИИ:\n`;
    executedSteps.forEach((step, i) => {
      const status = step.result?.success !== false ? '' : '';
      report += `${i + 1}. ${status} **${step.action.tool}** - ${step.thought?.substring(0, 100)}...\n`;
    });
    
    report += `\n### ВЫВОДЫ:\n`;
    if (successfulSteps.length === executedSteps.length) {
      report += `Все операции выполнены успешно! Задача решена полностью.\n`;
    } else if (successfulSteps.length > 0) {
      report += `Внимание: Задача выполнена частично. Некоторые операции требуют доработки.\n`;
    } else {
      report += `Задача не выполнена. Требуется пересмотр подхода.\n`;
    }
    
    return report;
  }
}

