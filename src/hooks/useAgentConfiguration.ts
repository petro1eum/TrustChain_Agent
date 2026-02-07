/**
 * useAgentConfiguration — manages agent model, temperature, mode, and provider normalization.
 * Enhanced with AI Studio patterns: multi-model support, provider normalization, temperature maps.
 */

import { useState, useCallback, useMemo } from 'react';

export type ViewMode = 'chat' | 'code' | 'data';
export type AgentMode = 'general' | 'search_expert' | 'code' | 'data';

export interface AgentInfo {
    id: string;
    name: string;
    description: string;
    icon?: string;
}

export interface AgentConfigReturn {
    viewMode: ViewMode;
    setViewMode: React.Dispatch<React.SetStateAction<ViewMode>>;
    currentAgentName: string;
    setCurrentAgentName: React.Dispatch<React.SetStateAction<string>>;
    currentModel: string;
    setCurrentModel: (model: string) => void;
    agentMode: AgentMode;
    setAgentMode: React.Dispatch<React.SetStateAction<AgentMode>>;
    showThinking: boolean;
    setShowThinking: React.Dispatch<React.SetStateAction<boolean>>;
    availableAgents: AgentInfo[];
    getAgentTemperature: (agentId: string) => number;
    getNormalizedModel: () => string;
    reloadAgent: () => void;
}

/** Per-agent temperature defaults */
const TEMPERATURE_MAP: Record<string, number> = {
    'smart-agent': 0.3,
    'code-agent': 0.1,
    'data-agent': 0.2,
    'search-agent': 0.1,
};

const DEFAULT_AGENTS: AgentInfo[] = [
    { id: 'smart-agent', name: 'Smart Agent', description: 'Primary AI agent with full toolset', icon: '🤖' },
    { id: 'code-agent', name: 'Code Agent', description: 'Specialized for code generation & analysis', icon: '💻' },
    { id: 'data-agent', name: 'Data Agent', description: 'Specialized for data processing', icon: '📊' },
    { id: 'search-agent', name: 'Search Agent', description: 'Expert search & retrieval', icon: '🔍' },
];

/**
 * Normalize model identifiers across providers.
 * Handles OpenRouter (prefix/model) vs direct API (model-only) format.
 */
function normalizeModel(modelId: string): string {
    const baseUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_OPENAI_BASE_URL) || '';
    const isOpenRouter = baseUrl.includes('openrouter.ai');

    if (isOpenRouter) {
        // OpenRouter expects provider/model format
        if (modelId.includes('/')) return modelId;
        if (modelId.startsWith('gpt-')) return `openai/${modelId}`;
        if (modelId.startsWith('claude-')) return `anthropic/${modelId}`;
        if (modelId.startsWith('gemini-')) return `google/${modelId}`;
        return modelId;
    }

    // Direct API — strip provider prefix
    if (modelId.startsWith('openai/')) return modelId.replace('openai/', '');
    if (modelId.startsWith('anthropic/')) return modelId.replace('anthropic/', '');
    if (modelId.startsWith('google/')) return modelId.replace('google/', '');
    return modelId;
}

export function useAgentConfiguration(): AgentConfigReturn {
    const [viewMode, setViewMode] = useState<ViewMode>('chat');
    const [currentAgentName, setCurrentAgentName] = useState(
        () => localStorage.getItem('tc_agent_name') || 'smart-agent'
    );
    const [currentModel, setCurrentModelRaw] = useState(
        () => localStorage.getItem('tc_model') || 'google/gemini-2.5-flash'
    );
    const [agentMode, setAgentMode] = useState<AgentMode>('general');
    const [showThinking, setShowThinking] = useState(true);

    const availableAgents = useMemo(() => DEFAULT_AGENTS, []);

    /** Set model and persist to localStorage */
    const setCurrentModel = useCallback((model: string) => {
        setCurrentModelRaw(model);
        localStorage.setItem('tc_model', model);
    }, []);

    /** Get temperature for a given agent */
    const getAgentTemperature = useCallback((agentId: string): number => {
        return TEMPERATURE_MAP[agentId] || 0.2;
    }, []);

    /** Get the model ID normalized for the current provider */
    const getNormalizedModel = useCallback(() => {
        return normalizeModel(currentModel);
    }, [currentModel]);

    /** Force agent re-initialization */
    const reloadAgent = useCallback(() => {
        console.log('[AgentConfig] Reloading agent:', currentAgentName, 'model:', getNormalizedModel());
        // Trigger re-render by toggling a state change
        setCurrentAgentName(prev => prev);
    }, [currentAgentName, getNormalizedModel]);

    return {
        viewMode, setViewMode,
        currentAgentName, setCurrentAgentName,
        currentModel, setCurrentModel,
        agentMode, setAgentMode,
        showThinking, setShowThinking,
        availableAgents,
        getAgentTemperature,
        getNormalizedModel,
        reloadAgent,
    };
}
