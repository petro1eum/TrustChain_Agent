/**
 * Code Execution инструменты для SmartAIAgent
 */

export const codeExecutionTools = [
  {
    type: "function",
    function: {
      name: "execute_code",
      description: "Выполнить TypeScript/JavaScript код в безопасной изолированной среде. Код имеет доступ к переменным из предыдущих выполнений через _get(name), может сохранять переменные через _save(name, value), логировать через _log(message). Возвращает результат выполнения.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "Код для выполнения (TypeScript/JavaScript)" },
          context: { type: "object", description: "Дополнительный контекст (переменные) для выполнения кода" },
          timeout: { type: "number", description: "Таймаут выполнения в миллисекундах (по умолчанию 5000)" }
        },
        required: ["code"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "execute_bash",
      description: "Выполнить bash команду в терминале безопасно. Команда выполняется в изолированной рабочей директории агента с whitelist разрешенных команд, timeout и ограничением размера вывода. Поддерживает сохранение состояния рабочей директории между командами. Примеры: execute_bash('ls -la'), execute_bash('pwd'), execute_bash('cat file.txt'). ВАЖНО: опасные команды (rm, mkfs, sudo и т.д.) запрещены по умолчанию.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Bash команда для выполнения (например 'ls -la', 'pwd', 'cat file.txt')" },
          working_dir: { type: "string", description: "Рабочая директория (относительно agent_workspace, опционально)" },
          timeout: { type: "number", description: "Таймаут выполнения в секундах (1-300, по умолчанию 30)" }
        },
        required: ["command"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "import_tool",
      description: "Импортировать и выполнить инструмент из файла. Инструменты хранятся как TypeScript файлы. Возвращает результат выполнения инструмента.",
      parameters: {
        type: "object",
        properties: {
          toolPath: { type: "string", description: "Путь к файлу инструмента (например, '/agent-tools/my-tool.ts')" }
        },
        required: ["toolPath"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "save_tool",
      description: "Сохранить созданный инструмент как TypeScript файл для последующего переиспользования. Инструмент будет доступен через import_tool.",
      parameters: {
        type: "object",
        properties: {
          toolName: { type: "string", description: "Имя инструмента (без расширения)" },
          code: { type: "string", description: "Код инструмента (TypeScript/JavaScript)" },
          basePath: { type: "string", description: "Базовый путь для сохранения (по умолчанию '/agent-tools')" }
        },
        required: ["toolName", "code"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_tools",
      description: "Получить список всех доступных инструментов, сохранённых агентом.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "load_tool",
      description: "Загрузить код инструмента по имени для просмотра или модификации.",
      parameters: {
        type: "object",
        properties: {
          toolName: { type: "string", description: "Имя инструмента" }
        },
        required: ["toolName"]
      }
    }
  }
];

