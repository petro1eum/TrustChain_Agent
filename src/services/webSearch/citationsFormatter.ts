/**
 * Форматирование citations для включения в ответы агента
 */

import type { Citation } from './types';

/**
 * Форматирует citations в текстовый формат для включения в ответ
 * 
 * @param citations - Массив citations
 * @returns Отформатированная строка с citations
 */
export function formatCitations(citations: Citation[]): string {
  if (!citations || citations.length === 0) {
    return '';
  }
  
  const formatted = citations.map((citation, index) => {
    const num = citation.index !== undefined ? citation.index + 1 : index + 1;
    const title = citation.title || 'Без названия';
    const url = citation.url;
    
    return `[${num}] ${title} - ${url}`;
  });
  
  return `\n\nИсточники:\n${formatted.join('\n')}`;
}

/**
 * Форматирует citations в markdown формат
 * 
 * @param citations - Массив citations
 * @returns Отформатированная строка в markdown
 */
export function formatCitationsMarkdown(citations: Citation[]): string {
  if (!citations || citations.length === 0) {
    return '';
  }
  
  const formatted = citations.map((citation, index) => {
    const num = citation.index !== undefined ? citation.index + 1 : index + 1;
    const title = citation.title || 'Без названия';
    const url = citation.url;
    
    return `${num}. [${title}](${url})`;
  });
  
  return `\n\n**Источники:**\n${formatted.join('\n')}`;
}

/**
 * Форматирует citations в HTML формат
 * 
 * @param citations - Массив citations
 * @returns Отформатированная строка в HTML
 */
export function formatCitationsHTML(citations: Citation[]): string {
  if (!citations || citations.length === 0) {
    return '';
  }
  
  const items = citations.map((citation, index) => {
    const num = citation.index !== undefined ? citation.index + 1 : index + 1;
    const title = citation.title || 'Без названия';
    const url = citation.url;
    
    return `<li><a href="${url}" target="_blank" rel="noopener noreferrer">[${num}] ${title}</a></li>`;
  });
  
  return `<ol>${items.join('')}</ol>`;
}

