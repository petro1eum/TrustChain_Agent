// Простая служба веб-поиска/загрузки контента без ключей
// Использует r.jina.ai для обхода CORS и извлечения текста со страниц

import type { Citation, WebSearchResultWithCitations } from './webSearch/types';
import { formatCitations } from './webSearch/citationsFormatter';

export type WebSearchResult = {
  title?: string;
  url: string;
  snippet?: string;
};

async function safeFetchText(url: string): Promise<string> {
  const resp = await fetch(url, { method: 'GET' });
  if (!resp || !resp.ok) {
    throw new Error(`Failed to fetch ${url}: ${resp ? resp.status : 'No response'}`);
  }
  return await resp.text();
}

function toJinaUrl(rawUrl: string): string {
  // r.jina.ai ожидает целевой URL после http://
  const cleaned = rawUrl.replace(/^https?:\/\//i, '');
  return `https://r.jina.ai/http://${cleaned}`;
}

function extractLinksFromText(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s)]+/g;
  const found = text.match(urlRegex) || [];
  // Фильтрация служебных ссылок поисковиков
  const deny = ['googleusercontent.com', 'gstatic.com', 'schema.org', 'duckduckgo.com', 'bing.com'];
  const uniq = Array.from(new Set(found));
  return uniq.filter(u => !deny.some(d => u.includes(d)));
}

/**
 * Извлекает заголовок из HTML контента
 */
function extractTitleFromContent(content: string): string | undefined {
  const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    return titleMatch[1].trim();
  }
  
  // Попытка найти заголовок в тексте
  const h1Match = content.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1Match) {
    return h1Match[1].trim();
  }
  
  return undefined;
}

/**
 * Извлекает сниппет из HTML контента
 */
function extractSnippetFromContent(content: string, maxLength: number = 200): string | undefined {
  // Убираем HTML теги
  const text = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  
  if (text.length <= maxLength) {
    return text;
  }
  
  // Берем первые maxLength символов и добавляем ...
  return text.substring(0, maxLength) + '...';
}

export const webSearchService = {
  /**
   * Базовый поиск без citations (для обратной совместимости)
   */
  async search(query: string, maxResults: number = 5): Promise<WebSearchResult[]> {
    // Используем DuckDuckGo html как источник результатов и извлекаем ссылки из текста
    const searchUrl = toJinaUrl(`duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
    const text = await safeFetchText(searchUrl);
    const links = extractLinksFromText(text).slice(0, Math.max(1, Math.min(maxResults, 10)));
    return links.map(url => ({ url }));
  },

  /**
   * Поиск с citations
   * Загружает страницы и извлекает метаданные для цитирования
   */
  async searchWithCitations(
    query: string, 
    maxResults: number = 5
  ): Promise<WebSearchResultWithCitations> {
    // Сначала получаем список URL через базовый поиск
    const basicResults = await this.search(query, maxResults);
    
    // Загружаем метаданные для каждого результата
    const citations: Citation[] = await Promise.all(
      basicResults.map(async (result, index) => {
        try {
          // Пытаемся загрузить страницу для извлечения заголовка и сниппета
          const pageData = await this.fetchPage(result.url);
          const title = extractTitleFromContent(pageData.content) || result.title;
          const snippet = extractSnippetFromContent(pageData.content) || result.snippet;
          
          return {
            url: result.url,
            title,
            snippet,
            index
          };
        } catch (error) {
          // Если не удалось загрузить - используем базовые данные
          return {
            url: result.url,
            title: result.title,
            snippet: result.snippet,
            index
          };
        }
      })
    );
    
    return {
      results: citations,
      citations,
      totalResults: citations.length,
      query
    };
  },

  /**
   * Загружает страницу и возвращает контент
   */
  async fetchPage(url: string): Promise<{ url: string; content: string }>{
    const jinaUrl = toJinaUrl(url);
    const content = await safeFetchText(jinaUrl);
    return { url, content };
  },

  /**
   * Форматирует citations для включения в ответ
   */
  formatCitations(citations: Citation[]): string {
    return formatCitations(citations);
  }
};

export default webSearchService;


