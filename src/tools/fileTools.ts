/**
 * File Operations инструменты для SmartAIAgent
 */

export const fileTools = [
  {
    type: "function",
    function: {
      name: "get_synonyms_preview",
      description: "Вернуть первые N синонимов из источников проекта (autoreplace.json / compiled)",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Сколько элементов вернуть (по умолчанию 20)" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_files_by_name",
      description: "Поиск файла по подстроке в известной структуре проекта (categories, descriptors, mixins, atomic)",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Подстрока для поиска в пути/имени" } },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_project_file",
      description: "Прочитать файл проекта по пути (YAML: через API; JSON: локальный /atomic/...), вернуть первые N строк/элементов",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Путь к файлу (напр. descriptors/diameter/diameter_master.yaml или autoreplace.json)" },
          limit: { type: "number", description: "Ограничение строк/элементов для предпросмотра", minimum: 1, maximum: 200 }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "extract_table_to_excel",
      description: "Извлечь СЫРУЮ таблицу из PDF-страниц и сохранить «как есть» в Excel (БЕЗ поиска в каталоге). Используй ТОЛЬКО если пользователь просит скопировать/перенести таблицу из PDF в Excel. НЕ используй для поиска товаров — для этого есть match_specification_to_catalog.",
      parameters: {
        type: "object",
        properties: {
          filename: { type: "string", description: "Имя файла из вложений (как указано в [ВЛОЖЕНИЯ])" },
          page_start: { type: "number", description: "Начальная страница (1-based)" },
          page_end: { type: "number", description: "Конечная страница (1-based)" },
          sheet_name: { type: "string", description: "Имя листа (опционально)" },
          user_query: { type: "string", description: "Запрос пользователя для визуального анализа (опционально)" }
        },
        required: ["filename", "page_start", "page_end"]
      }
    }
  }
];

