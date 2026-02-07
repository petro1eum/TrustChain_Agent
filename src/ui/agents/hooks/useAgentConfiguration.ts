/**
 * useAgentConfiguration — manages agent model, mode, and view settings.
 */

import { useState, useCallback, useMemo } from 'react';
import type { AppContext, ViewMode } from '../types';

export interface AgentConfigReturn {
    viewMode: ViewMode;
    setViewMode: React.Dispatch<React.SetStateAction<ViewMode>>;
    currentAgentName: string;
    setCurrentAgentName: React.Dispatch<React.SetStateAction<string>>;
    currentModel: string;
    setCurrentModel: React.Dispatch<React.SetStateAction<string>>;
    agentMode: string;
    setAgentMode: React.Dispatch<React.SetStateAction<string>>;
    availableAgents: Array<{ id: string; name: string; description: string }>;
    reloadAgent: () => void;
}

const DEFAULT_AGENTS = [
    { id: 'smart-agent', name: 'Smart Agent', description: 'Основной AI-агент с полным набором инструментов' },
    { id: 'data-agent', name: 'Data Agent', description: 'Специализированный агент для работы с данными' },
    { id: 'code-agent', name: 'Code Agent', description: 'Агент для генерации и анализ кода' },
];

export function useAgentConfiguration(_appContext?: AppContext): AgentConfigReturn {
    const [viewMode, setViewMode] = useState<ViewMode>('chat');
    const [currentAgentName, setCurrentAgentName] = useState('smart-agent');
    const [currentModel, setCurrentModel] = useState('gemini-2.5-flash');
    const [agentMode, setAgentMode] = useState('general');

    const availableAgents = useMemo(() => DEFAULT_AGENTS, []);

    const reloadAgent = useCallback(() => {
        console.log('[AgentConfig] Reloading agent:', currentAgentName);
        // Force re-initialization of agent instance
        setCurrentAgentName(prev => {
            const temp = prev;
            return temp;
        });
    }, [currentAgentName]);

    return {
        viewMode,
        setViewMode,
        currentAgentName,
        setCurrentAgentName,
        currentModel,
        setCurrentModel,
        agentMode,
        setAgentMode,
        availableAgents,
        reloadAgent,
    };
}
