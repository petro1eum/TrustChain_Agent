/**
 * Backend API Tools — tool definitions for API interactions
 */

export const backendApiTools = [
    {
        type: 'function',
        function: {
            name: 'list_api_endpoints',
            description: 'List all available backend API endpoints',
            parameters: { type: 'object', properties: {}, required: [] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_data_files',
            description: 'List available data files on the server',
            parameters: { type: 'object', properties: { path: { type: 'string', description: 'Directory path' } }, required: [] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'backend_api_call',
            description: 'Make a call to a backend API endpoint',
            parameters: {
                type: 'object',
                properties: {
                    endpoint: { type: 'string', description: 'API endpoint path' },
                    method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'] },
                    body: { type: 'object', description: 'Request body' },
                },
                required: ['endpoint'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_yaml_file',
            description: 'Read a YAML configuration file',
            parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'save_yaml_file',
            description: 'Save a YAML configuration file',
            parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'object' } }, required: ['path', 'content'] },
        },
    },
];
