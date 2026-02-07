/**
 * Frontend Navigation Tools — tool definitions for UI navigation
 */

export const frontendTools = [
    {
        type: 'function',
        function: {
            name: 'get_app_structure',
            description: 'Get the application structure and available views',
            parameters: { type: 'object', properties: {}, required: [] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_current_screen',
            description: 'Get information about the currently visible screen',
            parameters: { type: 'object', properties: {}, required: [] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'navigate_to_tab',
            description: 'Navigate to a specific tab in the application',
            parameters: { type: 'object', properties: { tab: { type: 'string' } }, required: ['tab'] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'navigate_to_subtab',
            description: 'Navigate to a subtab within the current view',
            parameters: { type: 'object', properties: { subtab: { type: 'string' } }, required: ['subtab'] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'select_category',
            description: 'Select a product category',
            parameters: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'select_product',
            description: 'Select a specific product',
            parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'search_ui',
            description: 'Search for content in the UI',
            parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'apply_filters',
            description: 'Apply filters to the current view',
            parameters: { type: 'object', properties: { filters: { type: 'object' } }, required: ['filters'] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_screen_data',
            description: 'Get data displayed on the current screen',
            parameters: { type: 'object', properties: {}, required: [] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_selected_items',
            description: 'Get currently selected items',
            parameters: { type: 'object', properties: {}, required: [] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'click_element',
            description: 'Click a UI element by selector or ID',
            parameters: { type: 'object', properties: { selector: { type: 'string' } }, required: ['selector'] },
        },
    },
];
