/**
 * Code Analysis Tools
 * Gap #6: Code-aware tools for structural code analysis
 * 
 * Provides AST-level understanding of code files via Docker
 */

export const codeAnalysisTools = [
    {
        type: 'function',
        function: {
            name: 'analyze_code_structure',
            description: 'Парсит файл и возвращает его структуру: функции, классы, импорты, экспорты. ' +
                'Поддерживает TypeScript, Python, Rust, Go, Java, C/C++. ' +
                'Используй для понимания структуры кода перед анализом или рефакторингом.',
            parameters: {
                type: 'object',
                properties: {
                    file_path: {
                        type: 'string',
                        description: 'Путь к файлу в рабочем пространстве (напр. /mnt/workspace/src/app.ts)'
                    }
                },
                required: ['file_path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'search_code_symbols',
            description: 'Семантический поиск символов в коде: функции, классы, интерфейсы, типы. ' +
                'В отличие от текстового grep, ищет именно определения (не использования). ' +
                'Используй для навигации по кодовой базе и поиска определений.',
            parameters: {
                type: 'object',
                properties: {
                    pattern: {
                        type: 'string',
                        description: 'Имя символа или паттерн для поиска (напр. "handleRequest", "Service")'
                    },
                    scope: {
                        type: 'string',
                        description: 'Директория для поиска (по умолчанию /mnt/workspace)'
                    },
                    symbol_type: {
                        type: 'string',
                        enum: ['function', 'class', 'interface', 'type'],
                        description: 'Тип символа для фильтрации (необязательно)'
                    }
                },
                required: ['pattern']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_code_dependencies',
            description: 'Возвращает граф зависимостей файла: что он импортирует и кто его импортирует. ' +
                'Используй для анализа связей между модулями и оценки влияния изменений.',
            parameters: {
                type: 'object',
                properties: {
                    file_path: {
                        type: 'string',
                        description: 'Путь к файлу (напр. /mnt/workspace/src/services/auth.ts)'
                    }
                },
                required: ['file_path']
            }
        }
    }
];
