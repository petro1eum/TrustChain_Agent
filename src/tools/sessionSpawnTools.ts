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

// ─── Tool Execution Handler ───

import { sessionSpawnService, type SpawnConfig, type SpawnedSession } from '../services/agents/sessionSpawnService';

export interface SessionSpawnToolResult {
    success: boolean;
    data?: any;
    error?: string;
}

/**
 * Handle execution of session_spawn, session_status, session_result tools.
 * 
 * @param toolName - One of: session_spawn, session_status, session_result
 * @param args - Tool arguments from LLM
 * @param executor - Callback to actually run the sub-agent (provided by SmartAIAgent)
 */
export async function executeSessionSpawnTool(
    toolName: string,
    args: any,
    executor?: (
        session: SpawnedSession,
        config: SpawnConfig,
        onProgress: (progress: number, step: string) => void
    ) => Promise<{ result: string; signature?: string; toolsUsed?: string[] }>,
): Promise<SessionSpawnToolResult> {
    switch (toolName) {
        case 'session_spawn': {
            if (!executor) {
                return { success: false, error: 'No executor provided for session_spawn' };
            }
            if (!args.instruction) {
                return { success: false, error: 'Missing required field: instruction' };
            }

            const config: SpawnConfig = {
                name: args.name || 'sub-agent',
                instruction: args.instruction,
                tools: args.tools,
                priority: args.priority || 'normal',
            };

            try {
                const session = sessionSpawnService.spawn(config, executor);

                // Check if synchronous execution was requested
                const isSync = args.sync === true;

                if (isSync) {
                    // SYNCHRONOUS: Wait for sub-agent to finish, then return result
                    const timeout = config.timeout || 5 * 60 * 1000;
                    const completed = await sessionSpawnService.awaitCompletion(session.runId, timeout);

                    return {
                        success: completed.status === 'completed',
                        data: {
                            run_id: session.runId,
                            name: completed.name,
                            status: completed.status,
                            result: completed.result || completed.error || 'No output produced',
                            signature: completed.signature || null,
                            tools_used: completed.toolsUsed,
                            elapsed_seconds: completed.elapsedMs
                                ? (completed.elapsedMs / 1000).toFixed(1) : null,
                        },
                        error: completed.status === 'failed' ? completed.error : undefined,
                    };
                } else {
                    // ASYNCHRONOUS: Return immediately so the main agent can continue (Wave-based parallel orchestration)
                    return {
                        success: true,
                        data: {
                            run_id: session.runId,
                            name: session.name,
                            status: session.status,
                            message: 'Sub-agent spawned successfully in background. Use session_status(run_id) to check progress and session_result(run_id) to get the final result.',
                        },
                    };
                }
            } catch (err: any) {
                return { success: false, error: err.message };
            }
        }

        case 'session_status': {
            if (args.run_id) {
                const session = sessionSpawnService.getSession(args.run_id);
                if (!session) {
                    return { success: false, error: `Session not found: ${args.run_id}` };
                }
                return {
                    success: true,
                    data: {
                        run_id: session.runId,
                        name: session.name,
                        status: session.status,
                        progress: session.progress,
                        current_step: session.currentStep,
                        elapsed_seconds: session.elapsedMs ? (session.elapsedMs / 1000).toFixed(1) : null,
                        signed_ops: session.signedOpsCount,
                        certificate: session.certificateSerial || null,
                        has_result: session.status === 'completed',
                        error: session.error || null,
                    },
                };
            }

            // Summary of all sessions
            return {
                success: true,
                data: {
                    summary: sessionSpawnService.getSummary(),
                    active_count: sessionSpawnService.getActiveSessions().length,
                    can_spawn_more: sessionSpawnService.canSpawnMore(),
                    sessions: sessionSpawnService.getAllSessions().slice(0, 10).map(s => ({
                        run_id: s.runId,
                        name: s.name,
                        status: s.status,
                        progress: s.progress,
                    })),
                },
            };
        }

        case 'session_result': {
            if (!args.run_id) {
                return { success: false, error: 'Missing required field: run_id' };
            }

            const session = sessionSpawnService.getSession(args.run_id);
            if (!session) {
                return { success: false, error: `Session not found: ${args.run_id}` };
            }
            if (session.status !== 'completed') {
                return {
                    success: false,
                    error: `Session "${session.name}" is ${session.status}, not completed yet. ` +
                        `Progress: ${session.progress}%. Current step: ${session.currentStep}`,
                };
            }

            return {
                success: true,
                data: {
                    run_id: session.runId,
                    name: session.name,
                    result: session.result,
                    signature: session.signature || null,
                    certificate: session.certificateSerial || null,
                    signed_ops: session.signedOpsCount,
                    elapsed_seconds: session.elapsedMs ? (session.elapsedMs / 1000).toFixed(1) : null,
                    tools_used: session.toolsUsed,
                },
            };
        }

        default:
            return { success: false, error: `Unknown tool: ${toolName}` };
    }
}
