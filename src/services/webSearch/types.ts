/**
 * Типы для Web Search с поддержкой Citations
 */

export interface Citation {
  /** URL источника */
  url: string;
  
  /** Заголовок страницы (если доступен) */
  title?: string;
  
  /** Сниппет или краткое описание */
  snippet?: string;
  
  /** Индекс цитирования (для форматирования) */
  index?: number;
}

export interface WebSearchResultWithCitations {
  /** Результаты поиска */
  results: Citation[];
  
  /** Массив citations для форматирования */
  citations: Citation[];
  
  /** Общее количество результатов */
  totalResults?: number;
  
  /** Поисковый запрос */
  query?: string;
}

