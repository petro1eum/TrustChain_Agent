/**
 * Базовые инструменты для AIAgent
 * 
 * ПРИМЕЧАНИЕ: Устаревшие инструменты обработки данных (text_processing, semantic_analysis,
 * handle_missing_data, normalize_data, handle_outliers, execute_pandas_operation,
 * smart_lookup_and_merge, analyze_data_quality, access_source_file, add_to_workspace)
 * были удалены - они не используются в KB Agent.
 */

export const basicTools = [
  // === Инструменты Docker контейнера ===
  {
    type: "function",
    function: {
      name: "bash_tool",
      description: "Выполнить bash команду в изолированном Docker контейнере. КРИТИЧНО: Используй bash_tool для создания Excel (.xlsx), PDF (.pdf) и Word (.docx) файлов через Python код (pandas/openpyxl для Excel, reportlab/fpdf для PDF, python-docx для Word). Файлы должны создаваться в /mnt/user-data/outputs/. НЕ используй create_artifact для Excel/PDF/Word - используй bash_tool! Пример для Excel: bash_tool({command: 'python3 -c \"import pandas as pd; df = pd.DataFrame([...]); df.to_excel(\\\"/mnt/user-data/outputs/file.xlsx\\\", index=False, engine=\\\"openpyxl\\\")\"', description: 'Создаю Excel файл', working_dir: '/mnt/user-data/outputs'}).",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "Bash команда для выполнения. Для Excel файлов используй Python код с pandas/openpyxl, например: python3 -c \"import pandas as pd; df = pd.DataFrame([...]); df.to_excel('/mnt/user-data/outputs/file.xlsx', index=False, engine='openpyxl')\""
          },
          description: {
            type: "string",
            description: "Объяснение зачем выполняется эта команда (ОБЯЗАТЕЛЬНО). Например: 'Создаю Excel файл с результатами поиска'"
          },
          working_dir: {
            type: "string",
            description: "Рабочая директория в контейнере (по умолчанию /home/kb). Для Excel/PDF/Word файлов используй '/mnt/user-data/outputs'"
          },
          timeout: {
            type: "number",
            description: "Таймаут выполнения в секундах (1-300, по умолчанию 30)"
          }
        },
        required: ["command", "description"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "view",
      description: "Просмотреть содержимое файла или директории в Docker контейнере. Поддерживает текстовые файлы, изображения и директории. Вложения из чата ищи в /mnt/user-data/outputs.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Абсолютный путь к файлу или директории в контейнере"
          },
          view_range: {
            type: "array",
            items: { type: "number" },
            description: "Диапазон строк для текстовых файлов [start, end]. Используй [-1] для просмотра до конца файла"
          },
          description: {
            type: "string",
            description: "Зачем просматриваю этот файл/директорию (ОБЯЗАТЕЛЬНО)"
          }
        },
        required: ["path", "description"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_file",
      description: "Создать новый файл в Docker контейнере. ВСЕГДА создавай файлы когда нужно, а не просто показывай код!",
      parameters: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description: "Зачем создаю этот файл (ОБЯЗАТЕЛЬНО, указывай ПЕРВЫМ)"
          },
          path: {
            type: "string",
            description: "Абсолютный путь к создаваемому файлу в контейнере (ОБЯЗАТЕЛЬНО, указывай ВТОРЫМ)"
          },
          file_text: {
            type: "string",
            description: "Полное содержимое файла (ОБЯЗАТЕЛЬНО, указывай ПОСЛЕДНИМ)"
          }
        },
        required: ["description", "path", "file_text"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_artifact",
      description: "🎨 ИСПОЛЬЗУЙ ДЛЯ ГРАФИКОВ! Создать artifact (график параболы, диаграмму, визуализацию, HTML страницу, мок графика). ⚠️ ОБЯЗАТЕЛЬНО используй этот инструмент когда пользователь просит: 'график', 'парабола', 'диаграмма', 'визуализация', 'мок', 'chart', 'построй уравнение'. ❌ НЕ используй create_category_index для графиков! create_category_index только для категорий ТОВАРОВ (kran, truba). ❌ ЗАПРЕЩЕНО: НЕ используй create_artifact для Excel (.xlsx), PDF (.pdf) или Word (.docx) файлов! Для Excel/PDF/Word используй bash_tool с Python кодом! КРИТИЧНО: ArtifactsViewer - это НАША система для просмотра визуализаций. Создавай готовую HTML/React визуализацию, НЕ CSV! Для графиков используй .html (Chart.js/D3.js из CDN) или .jsx (React с recharts). Artifact автоматически появится в ArtifactsViewer (кнопка с иконкой файла).",
      parameters: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description: "Описание artifact - что это за файл и для чего он создан"
          },
          filename: {
            type: "string",
            description: "Имя файла artifact (например: report.md, chart.html, data.json). Расширение определяет тип artifact."
          },
          content: {
            type: "string",
            description: "Содержимое artifact (текст, HTML, Markdown, JSON, код, etc.)"
          },
          type: {
            type: "string",
            enum: ["markdown", "html", "react", "svg", "mermaid", "code", "text", "json", "image"],
            description: "Тип artifact (опционально, определяется автоматически по расширению если не указан)"
          }
        },
        required: ["description", "filename", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "str_replace",
      description: "Заменить уникальную строку в файле в Docker контейнере. Строка для замены должна встречаться РОВНО ОДИН РАЗ в файле.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Абсолютный путь к файлу в контейнере"
          },
          old_str: {
            type: "string",
            description: "Строка для замены (должна быть уникальной в файле)"
          },
          new_str: {
            type: "string",
            description: "Новая строка (пустая строка = удаление)"
          },
          description: {
            type: "string",
            description: "Зачем делаю эту замену (ОБЯЗАТЕЛЬНО)"
          }
        },
        required: ["path", "old_str", "description"]
      }
    }
  }
];

// Инструменты поиска, экспорта и категорий определены в agents/tools/ (searchTools.ts и др.)
// и подключаются через SmartAIAgent.getToolsSpecification()

