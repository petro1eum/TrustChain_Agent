/**
 * Category Tools — tool definitions for category diagnostics
 */

export const categoryTools = [
    {
        type: 'function',
        function: {
            name: 'run_category_diagnostic',
            description: 'Run diagnostics on a product category',
            parameters: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'test_category_search',
            description: 'Test search functionality for a category',
            parameters: { type: 'object', properties: { slug: { type: 'string' }, query: { type: 'string' } }, required: ['slug', 'query'] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_category_info',
            description: 'Get information about a category',
            parameters: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_category_config',
            description: 'Get configuration for a category',
            parameters: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] },
        },
    },
];
