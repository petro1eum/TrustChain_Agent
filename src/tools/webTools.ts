/**
 * Web Search инструменты для SmartAIAgent
 */

export const webTools = [
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Выполнить веб‑поиск и вернуть список URL (DuckDuckGo via r.jina.ai)",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Поисковый запрос" },
          maxResults: { type: "number", description: "Макс. число ссылок (1-10)", minimum: 1, maximum: 10 }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "web_fetch",
      description: "Загрузить страницу и вернуть текст (через r.jina.ai)",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL страницы" }
        },
        required: ["url"]
      }
    }
  }
];

