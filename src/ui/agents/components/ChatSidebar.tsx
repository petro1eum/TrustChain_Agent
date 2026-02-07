/**
 * ChatSidebar — left panel with agent modes, tools, and action buttons.
 */

import React from 'react';
import {
    PanelLeftClose, PanelLeft, Settings, RefreshCw,
    Activity, ChevronRight
} from 'lucide-react';
import type { ChatMessage } from '../../../agents/types';
import type { ProcessingState, AgentModeConfig, AppContext } from '../types';
import type { ToolInfo } from '../hooks/useTools';

interface ChatSidebarProps {
    sidebarCollapsed: boolean;
    setSidebarCollapsed: (v: boolean) => void;
    agentModes: AgentModeConfig[];
    agentMode: string;
    tools: ToolInfo[];
    messages: ChatMessage[];
    processing: ProcessingState;
    appContext: AppContext;
    onAgentModeChange: (mode: string) => void;
    onToolToggle: (toolId: string) => void;
    onReloadAgent: () => void;
    onTestSystemStatus: () => void;
    onDiagnostics: () => void;
    onShowAgentSettings: () => void;
}

export const ChatSidebar: React.FC<ChatSidebarProps> = ({
    sidebarCollapsed,
    setSidebarCollapsed,
    agentModes,
    agentMode,
    tools,
    processing,
    onAgentModeChange,
    onToolToggle,
    onReloadAgent,
    onTestSystemStatus,
    onDiagnostics,
    onShowAgentSettings,
}) => {
    // Group tools by category
    const toolsByCategory = tools.reduce<Record<string, ToolInfo[]>>((acc, tool) => {
        const cat = tool.category || 'general';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(tool);
        return acc;
    }, {});

    if (sidebarCollapsed) {
        return (
            <div className="flex flex-col items-center py-3 px-1 bg-gray-850 border-r border-gray-700 w-10 shrink-0">
                <button
                    className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded mb-4 transition-colors"
                    onClick={() => setSidebarCollapsed(false)}
                    title="Развернуть панель"
                >
                    <PanelLeft className="w-4 h-4" />
                </button>

                {/* Mode Icons */}
                {agentModes.map(mode => (
                    <button
                        key={mode.id}
                        className={`p-1.5 mb-1 rounded transition-colors text-sm ${agentMode === mode.id
                                ? 'bg-indigo-600 text-white'
                                : 'text-gray-400 hover:bg-gray-700 hover:text-white'
                            }`}
                        onClick={() => onAgentModeChange(mode.id)}
                        title={mode.name}
                    >
                        {mode.icon}
                    </button>
                ))}
            </div>
        );
    }

    return (
        <div className="flex flex-col bg-gray-850 border-r border-gray-700 w-56 shrink-0 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Навигация</span>
                <button
                    className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                    onClick={() => setSidebarCollapsed(true)}
                    title="Свернуть панель"
                >
                    <PanelLeftClose className="w-4 h-4" />
                </button>
            </div>

            {/* Agent Modes */}
            <div className="px-2 py-2">
                <div className="text-xs text-gray-500 font-medium mb-1.5 px-1">Режим</div>
                {agentModes.map(mode => (
                    <button
                        key={mode.id}
                        className={`w-full text-left px-2 py-1.5 rounded text-sm mb-0.5 transition-colors flex items-center gap-2 ${agentMode === mode.id
                                ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                                : 'text-gray-300 hover:bg-gray-700/50'
                            }`}
                        onClick={() => onAgentModeChange(mode.id)}
                    >
                        <span>{mode.icon}</span>
                        <span className="truncate">{mode.name}</span>
                    </button>
                ))}
            </div>

            {/* Tools List */}
            <div className="flex-1 overflow-y-auto px-2 py-2 border-t border-gray-700/50">
                <div className="text-xs text-gray-500 font-medium mb-1.5 px-1">
                    Инструменты ({tools.filter(t => t.enabled).length}/{tools.length})
                </div>
                {Object.entries(toolsByCategory).map(([category, catTools]) => (
                    <div key={category} className="mb-2">
                        <div className="text-[10px] text-gray-600 uppercase tracking-wider px-1 mb-0.5">{category}</div>
                        {catTools.slice(0, 8).map(tool => (
                            <button
                                key={tool.id}
                                className={`w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center gap-1.5 ${tool.enabled ? 'text-gray-300 hover:bg-gray-700/50' : 'text-gray-600'
                                    }`}
                                onClick={() => onToolToggle(tool.id)}
                                title={tool.description}
                            >
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tool.enabled ? 'bg-green-500' : 'bg-gray-600'}`} />
                                <span className="truncate">{tool.name}</span>
                            </button>
                        ))}
                        {catTools.length > 8 && (
                            <div className="text-[10px] text-gray-600 px-2">+{catTools.length - 8} ещё</div>
                        )}
                    </div>
                ))}
            </div>

            {/* Action Buttons */}
            <div className="px-2 py-2 border-t border-gray-700/50 space-y-1">
                <button
                    className="w-full text-left px-2 py-1.5 rounded text-xs text-gray-300 hover:bg-gray-700/50 flex items-center gap-2 transition-colors"
                    onClick={onReloadAgent}
                    disabled={processing.isProcessing}
                >
                    <RefreshCw className="w-3 h-3" /> Перезагрузить агент
                </button>
                <button
                    className="w-full text-left px-2 py-1.5 rounded text-xs text-gray-300 hover:bg-gray-700/50 flex items-center gap-2 transition-colors"
                    onClick={onTestSystemStatus}
                >
                    <Activity className="w-3 h-3" /> Статус системы
                </button>
                <button
                    className="w-full text-left px-2 py-1.5 rounded text-xs text-gray-300 hover:bg-gray-700/50 flex items-center gap-2 transition-colors"
                    onClick={onDiagnostics}
                >
                    <ChevronRight className="w-3 h-3" /> Диагностика
                </button>
                <button
                    className="w-full text-left px-2 py-1.5 rounded text-xs text-gray-300 hover:bg-gray-700/50 flex items-center gap-2 transition-colors"
                    onClick={onShowAgentSettings}
                >
                    <Settings className="w-3 h-3" /> Настройки
                </button>
            </div>
        </div>
    );
};
