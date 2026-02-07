/**
 * ChatHeader — top bar of the chat window.
 * Shows model selector, agent name, window controls, and action menu.
 */

import React, { useState } from 'react';
import {
    X, Minus, Maximize2, Minimize2, MoreVertical,
    ChevronDown, Bug, History, FileText, Bot
} from 'lucide-react';
import type { ChatMessage } from '../../../agents/types';
import type { ProcessingState, ViewMode } from '../types';

interface ChatHeaderProps {
    isMinimized: boolean;
    processing: ProcessingState;
    onClose: () => void;
    onToggleMinimize: () => void;
    onMouseDown?: (e: React.MouseEvent) => void;
    viewMode: ViewMode;
    setViewMode: React.Dispatch<React.SetStateAction<ViewMode>>;
    currentAgentName: string;
    setCurrentAgentName: React.Dispatch<React.SetStateAction<string>>;
    currentModel: string;
    setCurrentModel: React.Dispatch<React.SetStateAction<string>>;
    availableAgents: Array<{ id: string; name: string; description: string }>;
    messages: ChatMessage[];
    setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
    onClearChat: () => void;
    onExportChat: () => void;
    onShowDebugViewer: () => void;
    onShowChatHistoryViewer: () => void;
    onShowArtifactsViewer: () => void;
    isExpanded: boolean;
    onToggleExpanded: () => void;
}

const AVAILABLE_MODELS = [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', tier: 'fast' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', tier: 'pro' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', tier: 'fast' },
];

export const ChatHeader: React.FC<ChatHeaderProps> = ({
    isMinimized,
    processing,
    onClose,
    onToggleMinimize,
    onMouseDown,
    currentAgentName,
    setCurrentAgentName,
    currentModel,
    setCurrentModel,
    availableAgents,
    onClearChat,
    onExportChat,
    onShowDebugViewer,
    onShowChatHistoryViewer,
    onShowArtifactsViewer,
    isExpanded,
    onToggleExpanded,
}) => {
    const [showMenu, setShowMenu] = useState(false);
    const [showModelDropdown, setShowModelDropdown] = useState(false);
    const [showAgentDropdown, setShowAgentDropdown] = useState(false);

    const selectedModel = AVAILABLE_MODELS.find(m => m.id === currentModel) || AVAILABLE_MODELS[0];
    const selectedAgent = availableAgents.find(a => a.id === currentAgentName) || availableAgents[0];

    return (
        <div
            className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700 cursor-grab select-none shrink-0"
            onMouseDown={onMouseDown}
        >
            {/* Left: Agent + Model selectors */}
            <div className="flex items-center gap-2 min-w-0">
                <Bot className="w-4 h-4 text-indigo-400 shrink-0" />

                {/* Agent Selector */}
                <div className="relative">
                    <button
                        className="flex items-center gap-1 text-sm text-gray-200 hover:text-white transition-colors"
                        onClick={(e) => { e.stopPropagation(); setShowAgentDropdown(!showAgentDropdown); }}
                    >
                        <span className="truncate max-w-[100px]">{selectedAgent?.name || 'Agent'}</span>
                        <ChevronDown className="w-3 h-3 text-gray-400" />
                    </button>
                    {showAgentDropdown && (
                        <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50 min-w-[200px]">
                            {availableAgents.map(agent => (
                                <button
                                    key={agent.id}
                                    className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-700 transition-colors ${agent.id === currentAgentName ? 'text-indigo-400' : 'text-gray-300'}`}
                                    onClick={(e) => { e.stopPropagation(); setCurrentAgentName(agent.id); setShowAgentDropdown(false); }}
                                >
                                    <div className="font-medium">{agent.name}</div>
                                    <div className="text-xs text-gray-500">{agent.description}</div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <span className="text-gray-600 mx-1">•</span>

                {/* Model Selector */}
                <div className="relative">
                    <button
                        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 transition-colors"
                        onClick={(e) => { e.stopPropagation(); setShowModelDropdown(!showModelDropdown); }}
                    >
                        <span className="truncate max-w-[120px]">{selectedModel.name}</span>
                        <ChevronDown className="w-3 h-3" />
                    </button>
                    {showModelDropdown && (
                        <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50 min-w-[180px]">
                            {AVAILABLE_MODELS.map(model => (
                                <button
                                    key={model.id}
                                    className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-700 transition-colors ${model.id === currentModel ? 'text-indigo-400' : 'text-gray-300'}`}
                                    onClick={(e) => { e.stopPropagation(); setCurrentModel(model.id); setShowModelDropdown(false); }}
                                >
                                    {model.name}
                                    <span className="ml-2 text-xs text-gray-500">{model.tier}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Processing indicator */}
                {processing.isProcessing && (
                    <span className="ml-2 text-xs text-yellow-400 animate-pulse">
                        ● {processing.currentStep || 'Обработка...'}
                    </span>
                )}
            </div>

            {/* Right: Controls */}
            <div className="flex items-center gap-1 shrink-0">
                {/* Menu */}
                <div className="relative">
                    <button
                        className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                        onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
                        title="Меню"
                    >
                        <MoreVertical className="w-4 h-4" />
                    </button>
                    {showMenu && (
                        <div className="absolute top-full right-0 mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50 min-w-[180px] py-1">
                            <button className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2" onClick={() => { onShowDebugViewer(); setShowMenu(false); }}>
                                <Bug className="w-4 h-4" /> Debug
                            </button>
                            <button className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2" onClick={() => { onShowChatHistoryViewer(); setShowMenu(false); }}>
                                <History className="w-4 h-4" /> История чатов
                            </button>
                            <button className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2" onClick={() => { onShowArtifactsViewer(); setShowMenu(false); }}>
                                <FileText className="w-4 h-4" /> Артефакты
                            </button>
                            <hr className="border-gray-700 my-1" />
                            <button className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700" onClick={() => { onExportChat(); setShowMenu(false); }}>
                                📤 Экспорт чата
                            </button>
                            <button className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-gray-700" onClick={() => { onClearChat(); setShowMenu(false); }}>
                                🗑️ Очистить чат
                            </button>
                        </div>
                    )}
                </div>

                {/* Expand/Collapse */}
                {!isMinimized && (
                    <button
                        className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                        onClick={(e) => { e.stopPropagation(); onToggleExpanded(); }}
                        title={isExpanded ? 'Свернуть размер' : 'Развернуть'}
                    >
                        {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                    </button>
                )}

                {/* Minimize */}
                <button
                    className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                    onClick={(e) => { e.stopPropagation(); onToggleMinimize(); }}
                    title={isMinimized ? 'Развернуть' : 'Свернуть'}
                >
                    <Minus className="w-4 h-4" />
                </button>

                {/* Close */}
                <button
                    className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded transition-colors"
                    onClick={(e) => { e.stopPropagation(); onClose(); }}
                    title="Закрыть"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
};
