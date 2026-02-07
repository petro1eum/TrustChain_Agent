/**
 * Category Management Tools — tool definitions for managing categories
 */

export const categoryManagementTools = [
    {
        type: 'function',
        function: {
            name: 'create_category_index',
            description: 'Create search index for a category',
            parameters: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'load_category_data',
            description: 'Load data for a category',
            parameters: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_atomic_file',
            description: 'Get an atomic configuration file',
            parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'save_atomic_file',
            description: 'Save an atomic configuration file',
            parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
        },
    },
];
