/**
 * useAgent — React hook that bridges SmartAIAgent to the TrustChainAgentApp UI.
 *
 * Responsibilities:
 * 1. Lazy-instantiate SmartAIAgent when an API key is available
 * 2. Convert SmartAIAgent.analyzeAndProcess() calls into React state updates
 * 3. Map ProgressEvent stream → MessageEvent[] for ThinkingContainer rendering
 * 4. Expose available tools list for the Agent panel
 */

import { useState, useRef, useCallback, useMemo } from 'react';
import {
    loadEnabledToolIds,
    saveEnabledToolIds,
    getLockedToolIds,
    getDefaultEnabledToolIds,
    getToolRegistry,
} from '../tools/toolRegistry';
import { SmartAIAgent } from '../agents/smart-ai-agent';
import type {
    ChatMessage as AgentChatMessage,
    ProgressEvent,
    MessageEvent,
    ThinkingEvent,
    ToolCallEvent,
    ToolResultEvent,
    AIAgentConfig,
    ChatAttachment,
} from '../agents/types';

// ─── Public Types ───

export interface AgentConfig {
    apiKey: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
}

export interface AgentTool {
    name: string;
    description?: string;
    category?: string;
}

/** Mirrors the UI's Message interface so the hook can provide ready-to-render data */
export interface UIMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
    signature?: string;
    verified?: boolean;
    events?: MessageEvent[];      // for ThinkingContainer
    isStreaming?: boolean;         // true while agent is still generating
}

export type AgentStatus = 'disconnected' | 'ready' | 'thinking' | 'error';

export interface UseAgentReturn {
    /** Send a user message to the agent. Returns the result directly. */
    sendMessage: (text: string, attachments?: ChatAttachment[], chatHistory?: Array<{ role: string; content: string }>) => Promise<{ text: string; events: MessageEvent[] }>;
    /** Current agent status */
    status: AgentStatus;
    /** Error message, if any */
    error: string | null;
    /** Available tools from the agent */
    tools: AgentTool[];
    /** Whether the agent has been initialized */
    isInitialized: boolean;
    /** Initialize or re-initialize the agent with new config */
    initialize: (config: AgentConfig) => void;
    /** Current streaming events for the in-progress message */
    streamingEvents: MessageEvent[];
    /** Current streaming text being assembled */
    streamingText: string;
    /** Abort current operation */
    abort: () => void;
    // ── Tool Management ──
    /** Set of currently enabled tool IDs */
    enabledTools: Set<string>;
    /** Toggle a single tool on/off */
    setToolEnabled: (toolId: string, enabled: boolean) => void;
    /** Enable or disable all non-locked tools */
    setAllToolsEnabled: (enabled: boolean) => void;
    /** Reset enabled tools to defaults */
    resetToolsToDefaults: () => void;
}

// ─── Tool Category Mapping (universal tools only) ───
// MCP tools auto-categorize as 'MCP' — no need to list them here.

const TOOL_CATEGORIES: Record<string, string> = {
    search_files_by_name: 'File Ops', read_project_file: 'File Ops', get_synonyms_preview: 'File Ops',
    extract_table_to_excel: 'File Ops',
    web_search: 'Web Search', web_fetch: 'Web Search',
    execute_code: 'Code Execution', execute_bash: 'Code Execution', bash_tool: 'Code Execution',
    view: 'Code Execution', create_file: 'Code Execution', str_replace: 'Code Execution',
    import_tool: 'Code Execution', save_tool: 'Code Execution', list_tools: 'Code Execution',
    load_tool: 'Code Execution',
    create_artifact: 'Artifacts',
    analyze_code_structure: 'Code Analysis', search_code_symbols: 'Code Analysis',
    get_code_dependencies: 'Code Analysis',
    browser_navigate: 'Browser', browser_screenshot: 'Browser', browser_extract: 'Browser',
};

// ─── Hook ───

export function useAgent(): UseAgentReturn {
    const agentRef = useRef<SmartAIAgent | null>(null);
    const abortRef = useRef(false);
    const [status, setStatus] = useState<AgentStatus>('disconnected');
    const [error, setError] = useState<string | null>(null);
    const [tools, setTools] = useState<AgentTool[]>([]);
    const [isInitialized, setIsInitialized] = useState(false);
    const [streamingEvents, setStreamingEvents] = useState<MessageEvent[]>([]);
    const [streamingText, setStreamingText] = useState('');
    const [enabledTools, setEnabledTools] = useState<Set<string>>(() => loadEnabledToolIds());

    // ── Initialize Agent ──
    const initialize = useCallback((config: AgentConfig) => {
        try {
            const agentConfig: Partial<AIAgentConfig> = {
                defaultModel: config.model || 'google/gemini-2.5-flash',
                fallbackModel: 'google/gemini-2.5-flash-lite',
                temperature: config.temperature ?? 0.3,
                maxTokens: config.maxTokens ?? 4096,
                maxProcessingSteps: 10,
                chatHistoryLimit: 20,
                batchSizeThreshold: 5,
                defaultFuzzyThreshold: 0.7,
                defaultTimeIntervalHours: 24,
                streamingLimits: {
                    maxThinkIterations: 5,
                    maxPlanIterations: 3,
                },
            };

            agentRef.current = new SmartAIAgent(config.apiKey, agentConfig);

            // Extract available tools
            const specs = (agentRef.current as any).getToolsSpecification?.() || [];
            const seen = new Set<string>();
            const toolList: AgentTool[] = [];
            for (const spec of specs) {
                const name = spec?.function?.name;
                if (typeof name === 'string' && name && !seen.has(name)) {
                    seen.add(name);
                    toolList.push({
                        name,
                        description: spec?.function?.description,
                        category: TOOL_CATEGORIES[name] || 'Other',
                    });
                }
            }
            setTools(toolList.sort((a, b) => a.name.localeCompare(b.name)));
            setStatus('ready');
            setError(null);
            setIsInitialized(true);
            console.log(`[useAgent] ✅ Initialized with ${toolList.length} tools, model: ${agentConfig.defaultModel}`);
        } catch (err: any) {
            setStatus('error');
            setError(err.message || 'Failed to initialize agent');
            setIsInitialized(false);
            console.error('[useAgent] ❌ Init failed:', err);
        }
    }, []);

    // ── Send Message ──
    const sendMessage = useCallback(async (
        text: string,
        attachments?: ChatAttachment[],
        chatHistory?: Array<{ role: string; content: string }>
    ): Promise<{ text: string; events: MessageEvent[] }> => {
        if (!agentRef.current) {
            setError('Agent not initialized. Please set API key in settings.');
            return { text: '', events: [] };
        }

        abortRef.current = false;
        setStatus('thinking');
        setError(null);
        setStreamingEvents([]);
        setStreamingText('');

        // Accumulate events as they come in from ProgressEvent callbacks
        const events: MessageEvent[] = [];
        let currentToolCallId: string | null = null;
        let accumulatedText = '';

        const progressCallback = (event: ProgressEvent) => {
            if (abortRef.current) return;

            switch (event.type) {
                case 'reasoning_step': {
                    const thinkingEvent: ThinkingEvent = {
                        type: 'thinking',
                        id: `think_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        content: event.reasoning_text || event.message,
                        title: event.message,
                        isExpanded: false,
                        isStreaming: false,
                        timestamp: new Date(),
                    };
                    events.push(thinkingEvent);
                    setStreamingEvents([...events]);
                    break;
                }

                case 'tool_call': {
                    currentToolCallId = `tc_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                    const toolEvent: ToolCallEvent = {
                        type: 'tool_call',
                        id: currentToolCallId,
                        name: event.event_data?.name || event.message,
                        arguments: event.event_data?.args || {},
                        timestamp: new Date(),
                        status: 'running',
                    };
                    events.push(toolEvent);
                    setStreamingEvents([...events]);
                    break;
                }

                case 'tool_response': {
                    const resultEvent: ToolResultEvent = {
                        type: 'tool_result',
                        id: `tr_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        toolCallId: currentToolCallId || '',
                        result: event.event_data?.result || event.message,
                        error: event.event_data?.error,
                        timestamp: new Date(),
                        signature: event.event_data?.signature,
                        certificate: event.event_data?.certificate,
                    };
                    events.push(resultEvent);

                    // Mark the corresponding tool_call as completed
                    for (let i = events.length - 1; i >= 0; i--) {
                        if (events[i].type === 'tool_call' && (events[i] as ToolCallEvent).id === currentToolCallId) {
                            (events[i] as ToolCallEvent).status = 'completed';
                            break;
                        }
                    }
                    currentToolCallId = null;
                    setStreamingEvents([...events]);
                    break;
                }

                case 'text_delta':
                case 'streaming_text': {
                    accumulatedText = event.streamingContent || (accumulatedText + (event.message || ''));
                    setStreamingText(accumulatedText);
                    break;
                }

                case 'error': {
                    // Mark current tool call as error if one is in progress
                    if (currentToolCallId) {
                        for (let i = events.length - 1; i >= 0; i--) {
                            if (events[i].type === 'tool_call' && (events[i] as ToolCallEvent).id === currentToolCallId) {
                                (events[i] as ToolCallEvent).status = 'error';
                                break;
                            }
                        }
                    }
                    const errorThinking: ThinkingEvent = {
                        type: 'thinking',
                        id: `err_${Date.now()}`,
                        content: `Error: ${event.message}`,
                        title: 'Error',
                        isExpanded: true,
                        isStreaming: false,
                        timestamp: new Date(),
                    };
                    events.push(errorThinking);
                    setStreamingEvents([...events]);
                    break;
                }

                case 'start':
                case 'api_call':
                case 'completion':
                case 'finished':
                    // These are lifecycle events, no UI rendering needed
                    break;

                default:
                    // rule_start, rule_step_start, etc. — add as thinking
                    if (event.message) {
                        const genericThinking: ThinkingEvent = {
                            type: 'thinking',
                            id: `gen_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                            content: event.message,
                            isExpanded: false,
                            isStreaming: false,
                            timestamp: new Date(),
                        };
                        events.push(genericThinking);
                        setStreamingEvents([...events]);
                    }
                    break;
            }
        };

        try {
            // Convert UI chat history to agent ChatMessage format
            const agentHistory: AgentChatMessage[] = (chatHistory || []).map(m => ({
                role: m.role as 'user' | 'assistant' | 'system',
                content: m.content,
                timestamp: new Date(),
            }));

            const result = await agentRef.current.analyzeAndProcess(
                text,
                agentHistory,
                progressCallback,
                attachments
            );

            if (abortRef.current) return { text: '', events: [] };

            // The result.messages contains the final response
            // We store the final events snapshot and text for the caller to consume
            setStreamingEvents([...events]);

            // Extract final text from result messages
            const finalMsg = result.messages?.find(
                (m: AgentChatMessage) => m.role === 'assistant' && m.content
            );
            const finalText = finalMsg?.content || accumulatedText || '';
            if (finalText) {
                setStreamingText(finalText);
            }

            setStatus('ready');
            return { text: finalText, events: [...events] };
        } catch (err: any) {
            if (abortRef.current) return { text: '', events: [] };
            setStatus('error');
            setError(err.message || 'Agent execution failed');
            console.error('[useAgent] ❌ Execution error:', err);
            return { text: `Error: ${err.message}`, events: [...events] };
        }
    }, []);

    // ── Abort ──
    const abort = useCallback(() => {
        abortRef.current = true;
        setStatus('ready');
    }, []);

    // ── Tool Management ──
    const setToolEnabled = useCallback((toolId: string, enabled: boolean) => {
        setEnabledTools(prev => {
            const next = new Set(prev);
            if (enabled) next.add(toolId);
            else if (!getLockedToolIds().has(toolId)) next.delete(toolId);
            saveEnabledToolIds(next);
            return next;
        });
    }, []);

    const setAllToolsEnabled = useCallback((enabled: boolean) => {
        if (enabled) {
            const all = getDefaultEnabledToolIds();
            // Enable everything from registry
            for (const t of getToolRegistry()) all.add(t.id);
            saveEnabledToolIds(all);
            setEnabledTools(all);
        } else {
            // Disable all except locked
            const locked = getLockedToolIds();
            saveEnabledToolIds(new Set(locked));
            setEnabledTools(new Set(locked));
        }
    }, []);

    const resetToolsToDefaults = useCallback(() => {
        const defaults = getDefaultEnabledToolIds();
        saveEnabledToolIds(defaults);
        setEnabledTools(defaults);
    }, []);

    return {
        sendMessage,
        status,
        error,
        tools,
        isInitialized,
        initialize,
        streamingEvents,
        streamingText,
        abort,
        enabledTools,
        setToolEnabled,
        setAllToolsEnabled,
        resetToolsToDefaults,
    };
}
