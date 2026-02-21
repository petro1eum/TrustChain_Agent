/**
 * Session Spawn Tools — LLM-callable tools for sub-agent management
 * 
 * Three tools that allow the main agent to spawn, monitor, and retrieve
 * results from background sub-agent sessions via function calling.
 * 
 * Usage in OpenRouter / Claude / GPT function calling:
 *   session_spawn   → start a new sub-agent
 *   session_status  → check progress by run_id
 *   session_result  → get final result by run_id
 */

// ─── Tool Definitions (OpenAI function calling format) ───

export const SESSION_SPAWN_TOOL = {
    type: 'function' as const,
    function: {
        name: 'session_spawn',
        description:
            'Spawn a background sub-agent session for a long-running or independent task. ' +
            'The sub-agent works asynchronously without blocking the current conversation. ' +
            'Returns a run_id for tracking. Use for: parallel research, code analysis, ' +
            'web scraping, document processing, any task that can run independently. ' +
            'Each sub-agent gets its own TrustChain X.509 certificate for signed operations.',
        parameters: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Short name for the session (e.g. "code-review", "web-research", "data-analysis")',
                },
                instruction: {
                    type: 'string',
                    description: 'Detailed task instruction for the sub-agent. Be specific about what to do and what result to return.',
                },
                tools: {
                    type: 'array',
                    items: { type: 'string' },
                    description:
                        'Whitelist of tool names available to the sub-agent. ' +
                        'Options: bash_tool, view, create_file, str_replace, web_search, web_fetch, ' +
                        'browser_navigate, browser_screenshot, browser_extract, search_files_by_name, ' +
                        'read_project_file, analyze_code_structure, memory_save, memory_recall. ' +
                        'If empty, sub-agent gets all tools.',
                },
                priority: {
                    type: 'string',
                    enum: ['low', 'normal', 'high'],
                    description: 'Execution priority (default: normal)',
                },
                sync: {
                    type: 'boolean',
                    description: 'If true, wait for the sub-agent to finish (synchronous). If false (default), return immediately and let it run in background. Use false for true parallel orchestration.',
                },
            },
            required: ['name', 'instruction'],
        },
    },
};

export const SESSION_STATUS_TOOL = {
    type: 'function' as const,
    function: {
        name: 'session_status',
        description:
            'Check the status and progress of a spawned sub-agent session. ' +
            'Returns status (pending/running/completed/failed), progress %, ' +
            'current step, elapsed time, and signed operations count. ' +
            'Call with no arguments to get a summary of ALL active sessions.',
        parameters: {
            type: 'object',
            properties: {
                run_id: {
                    type: 'string',
                    description: 'Run ID of the session to check. If omitted, returns summary of all sessions.',
                },
            },
            required: [],
        },
    },
};

export const SESSION_RESULT_TOOL = {
    type: 'function' as const,
    function: {
        name: 'session_result',
        description:
            'Get the final result of a completed sub-agent session. ' +
            'Only works for sessions with status "completed". ' +
            'Returns the result text, Ed25519 signature, and verification status.',
        parameters: {
            type: 'object',
            properties: {
                run_id: {
                    type: 'string',
                    description: 'Run ID of the completed session',
                },
            },
            required: ['run_id'],
        },
    },
};

/** All session spawn tools for registration. */
export const SESSION_SPAWN_TOOLS = [
    SESSION_SPAWN_TOOL,
    SESSION_STATUS_TOOL,
    SESSION_RESULT_TOOL,
];

// Execution is now handled entirely by the Python backend via tool tunneling
