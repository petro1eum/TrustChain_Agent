/**
 * Утилита для форматирования вывода инструментов
 */

export function formatToolOutput(output: any): string {
  if (typeof output === 'string') {
    return output;
  }

  if (output && typeof output === 'object') {
    if (typeof (output as any).stdout === 'string' || typeof (output as any).stderr === 'string') {
      const stdout = String((output as any).stdout || '').trim();
      const stderr = String((output as any).stderr || '').trim();
      if (stdout && stderr) {
        return `stdout:\n${stdout}\n\nstderr:\n${stderr}`;
      }
      if (stdout) {
        return `stdout:\n${stdout}`;
      }
      if (stderr) {
        return `stderr:\n${stderr}`;
      }
    }
    const data = (output as any).data && typeof (output as any).data === 'object'
      ? (output as any).data
      : output;

    // Обработка массивов items (часто приходят в data.items)
    if (Array.isArray((data as any).items)) {
      const arr = (data as any).items as any[];
      const formatted = arr.slice(0, 10).map((item, idx) => {
        if (item && typeof item === 'object') {
          const name = item.name || item.title || item.id || `Элемент ${idx + 1}`;
          const article = item.article ? ` (арт. ${item.article})` : '';
          const vendor = item.vendor ? ` — ${item.vendor}` : '';
          return `• ${name}${article}${vendor}`;
        }
        return String(item);
      }).join('\n');
      const total = (data as any).total || arr.length;
      const message = (data as any).message ? String((data as any).message) : `Найдено ${total} элементов`;
      const suffix = arr.length > 10 ? '\nПоказаны первые 10.' : '';
      return `${message}\n${formatted}${suffix}`;
    }

    // Обработка массивов preview
    if (Array.isArray((data as any).preview)) {
      const arr = (data as any).preview as any[];
      const formatted = arr.slice(0, 20).map((item) => {
        if (item && typeof item === 'object') {
          return JSON.stringify(item).slice(0, 100);
        }
        return String(item);
      }).join('\n');
      return `preview (${arr.length}):\n${formatted}`;
    }

    // Обработка массивов hits
    if (Array.isArray((data as any).hits)) {
      const arr = (data as any).hits as any[];
      return `hits (${arr.length}):\n${arr.slice(0, 20).map((h: any) => h?.path || JSON.stringify(h)).join('\n')}`;
    }

    if ((data as any).diagnostics && typeof (data as any).diagnostics === 'object') {
      const diag = JSON.stringify((data as any).diagnostics);
      const desc = (data as any).description ? String((data as any).description) : 'Инструмент выполнен';
      return `${desc}\n\nДиагностика:\n${diag}`;
    }

    const keys = Object.keys(data as Record<string, any>);
    if (keys.length === 0) {
      return 'Инструмент вернул пустой результат.';
    }
    if (keys.length === 1 && keys[0] === 'success') {
      return 'Инструмент завершился успешно, но не вернул данных.';
    }

    // Общий случай - JSON с ограничением длины
    const json = JSON.stringify(data);
    return json.length > 1000 ? `${json.slice(0, 1000)}...` : json;
  }

  return 'Инструмент выполнен';
}

