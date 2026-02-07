/**
 * Команда для просмотра логов отладки агента
 * Используйте в консоли браузера: window.showDebugLogs()
 */

export function showDebugLogs() {
  const STORAGE_KEY = 'alma_agent_debug_logs';
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      console.log('❌ Логи не найдены в localStorage');
      return null;
    }
    
    const sessions = JSON.parse(stored);
    console.log(`✅ Найдено сессий: ${sessions.length}`);
    
    // Сортируем по времени (новые первыми)
    const sortedSessions = sessions.sort((a: any, b: any) => 
      new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );
    
    // Показываем последнюю сессию
    const lastSession = sortedSessions[0];
    if (lastSession) {
      console.log('\n📋 ПОСЛЕДНЯЯ СЕССИЯ:');
      console.log(`ID: ${lastSession.sessionId}`);
      console.log(`Запрос: "${lastSession.userQuery}"`);
      console.log(`Время начала: ${new Date(lastSession.startTime).toLocaleString('ru-RU')}`);
      if (lastSession.endTime) {
        console.log(`Время окончания: ${new Date(lastSession.endTime).toLocaleString('ru-RU')}`);
      }
      console.log(`Всего записей: ${lastSession.entries.length}`);
      
      if (lastSession.summary) {
        console.log(`\n📊 СТАТИСТИКА:`);
        console.log(`  - Мыслей: ${lastSession.summary.totalThoughts}`);
        console.log(`  - Вызовов инструментов: ${lastSession.summary.totalToolCalls}`);
        console.log(`  - Ошибок: ${lastSession.summary.errorCount || 0}`);
        console.log(`  - Успешность: ${lastSession.summary.successRate?.toFixed(1) || 0}%`);
        console.log(`  - Средняя уверенность: ${lastSession.summary.averageConfidence?.toFixed(2) || 0}`);
        console.log(`  - Время выполнения: ${lastSession.summary.executionTime?.toFixed(2) || 0}с`);
      }
      
      console.log(`\n📝 ПОСЛЕДНИЕ ЗАПИСИ (10):`);
      lastSession.entries.slice(-10).forEach((entry: any) => {
        const time = new Date(entry.timestamp).toLocaleTimeString('ru-RU');
        console.log(`\n[${time}] ${entry.type.toUpperCase()}`);
        
        if (entry.type === 'error') {
          console.log(`  Ошибка: ${entry.error || entry.content}`);
          if (entry.context) console.log(`  Контекст:`, entry.context);
        } else if (entry.type === 'tool_call' && entry.tool) {
          console.log(`  Инструмент: ${entry.tool.name}`);
          console.log(`  Аргументы:`, entry.tool.args);
        } else if (entry.type === 'tool_response' && entry.tool) {
          console.log(`  Инструмент: ${entry.tool.name}`);
          const result = typeof entry.tool.result === 'string' 
            ? entry.tool.result.substring(0, 200) + (entry.tool.result.length > 200 ? '...' : '')
            : JSON.stringify(entry.tool.result).substring(0, 200);
          console.log(`  Результат: ${result}`);
          if (entry.tool.executionTime) {
            console.log(`  Время: ${entry.tool.executionTime}мс`);
          }
        } else if (entry.type === 'thinking' && entry.thoughts) {
          console.log(`  Рассуждение: ${entry.thoughts.reasoning}`);
          console.log(`  Действие: ${entry.thoughts.action}`);
        } else if (entry.content) {
          console.log(`  ${entry.content.substring(0, 200)}${entry.content.length > 200 ? '...' : ''}`);
        }
      });
    }
    
    return sortedSessions;
  } catch (error) {
    console.error('❌ Ошибка чтения логов:', error);
    return null;
  }
}

// Делаем функцию доступной глобально для использования в консоли
declare global {
  interface Window {
    showDebugLogs: () => any;
  }
}

if (typeof window !== 'undefined') {
  window.showDebugLogs = showDebugLogs;
  console.log('✅ Команда showDebugLogs() доступна в консоли. Используйте: showDebugLogs()');
}

