/**
 * Search Tools — tool definitions for product search
 */

export const searchTools = [
    {
        type: 'function',
        function: {
            name: 'search_products',
            description: 'Search for products in the catalog',
            parameters: { type: 'object', properties: { query: { type: 'string' }, category: { type: 'string' } }, required: ['query'] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'analyze_search_params',
            description: 'Analyze and optimize search parameters',
            parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'compare_products',
            description: 'Compare multiple products',
            parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'quick_search',
            description: 'Quick fuzzy search across products',
            parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        },
    },
];
