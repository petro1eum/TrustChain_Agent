/**
 * Page Tools — Universal frontend interaction tools for TrustChain Agent.
 * 
 * These tools enable the agent to observe, read, and interact with 
 * the host application's UI via the postMessage bridge.
 * 
 * Tier 1: Always loaded, project-agnostic. Any host app that implements
 * the trustchain:bridge protocol will work.
 */

export const pageTools = [
    {
        type: 'function' as const,
        function: {
            name: 'page_observe',
            description: 'Observe the current page state: what section is active, what records/data are visible on screen, any open modals/dialogs. Use this FIRST when the user asks "what do you see?" or before interacting with page elements. Returns structured page snapshot.',
            parameters: {
                type: 'object',
                properties: {},
                required: [],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'page_read',
            description: 'Read a specific entity or element from the page. Use this to get detailed information about a particular record, row, or UI element. The target can be: an entity ID (e.g. "INB-2023-01021"), a row number (e.g. "row:3"), or a natural description (e.g. "последний документ", "первая задача").',
            parameters: {
                type: 'object',
                properties: {
                    target: {
                        type: 'string',
                        description: 'What to read: entity ID, row number (row:N), or natural description',
                    },
                },
                required: ['target'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'page_interact',
            description: 'Interact with the host application UI: click buttons, open records, navigate between sections, close modals. Use this when the user asks to open, click, navigate, or perform any UI action.',
            parameters: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['click', 'navigate', 'open', 'close', 'scroll', 'select'],
                        description: 'Type of interaction: click (button/link), navigate (to section), open (record/modal), close (modal/panel), scroll (up/down), select (record/row)',
                    },
                    target: {
                        type: 'string',
                        description: 'What to interact with: section name, entity ID, button label, row number (row:N), or natural description',
                    },
                },
                required: ['action', 'target'],
            },
        },
    },
];

/** Tool names for whitelist */
export const PAGE_TOOL_NAMES = new Set(pageTools.map(t => t.function.name));
