/**
 * AgentSettings — modal for configuring agent parameters.
 */

import React, { useState } from 'react';
import { X, Settings, Sliders, Zap, Brain, Shield } from 'lucide-react';

interface AgentSettingsProps {
    isOpen: boolean;
    onClose: () => void;
    currentAgentId: string;
    onAgentChange: (agentId: string) => void;
}

const MODELS = [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', desc: 'Быстрый и экономичный' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', desc: 'Максимальное качество' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', desc: 'Предыдущее поколение' },
];

const AgentSettings: React.FC<AgentSettingsProps> = ({
    isOpen,
    onClose,
    currentAgentId,
    onAgentChange,
}) => {
    const [temperature, setTemperature] = useState(0.7);
    const [maxTokens, setMaxTokens] = useState(8192);
    const [selectedModel, setSelectedModel] = useState('gemini-2.5-flash');
    const [trustchainEnabled, setTrustchainEnabled] = useState(true);
    const [thinkingEnabled, setThinkingEnabled] = useState(true);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md max-h-[85vh] flex flex-col shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
                    <div className="flex items-center gap-2">
                        <Settings className="w-5 h-5 text-indigo-400" />
                        <h2 className="text-sm font-semibold text-gray-200">Настройки агента</h2>
                    </div>
                    <button
                        className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                        onClick={onClose}
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Settings Body */}
                <div className="flex-1 overflow-y-auto p-4 space-y-5">
                    {/* Model Selection */}
                    <div>
                        <label className="text-xs font-medium text-gray-400 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                            <Zap className="w-3.5 h-3.5" /> Модель
                        </label>
                        <div className="space-y-1.5">
                            {MODELS.map(model => (
                                <button
                                    key={model.id}
                                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors border ${selectedModel === model.id
                                            ? 'border-indigo-500 bg-indigo-600/10 text-indigo-300'
                                            : 'border-gray-700 text-gray-300 hover:bg-gray-800'
                                        }`}
                                    onClick={() => setSelectedModel(model.id)}
                                >
                                    <div className="font-medium">{model.name}</div>
                                    <div className="text-xs text-gray-500">{model.desc}</div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Temperature */}
                    <div>
                        <label className="text-xs font-medium text-gray-400 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                            <Sliders className="w-3.5 h-3.5" /> Temperature: {temperature.toFixed(1)}
                        </label>
                        <input
                            type="range"
                            min="0"
                            max="2"
                            step="0.1"
                            value={temperature}
                            onChange={e => setTemperature(parseFloat(e.target.value))}
                            className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                        />
                        <div className="flex justify-between text-[10px] text-gray-600 mt-1">
                            <span>Точный (0)</span>
                            <span>Креативный (2.0)</span>
                        </div>
                    </div>

                    {/* Max Tokens */}
                    <div>
                        <label className="text-xs font-medium text-gray-400 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                            Max Tokens: {maxTokens.toLocaleString()}
                        </label>
                        <input
                            type="range"
                            min="1024"
                            max="65536"
                            step="1024"
                            value={maxTokens}
                            onChange={e => setMaxTokens(parseInt(e.target.value))}
                            className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                        />
                        <div className="flex justify-between text-[10px] text-gray-600 mt-1">
                            <span>1K</span>
                            <span>65K</span>
                        </div>
                    </div>

                    {/* Toggles */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Brain className="w-4 h-4 text-purple-400" />
                                <div>
                                    <div className="text-sm text-gray-200">Internal Reasoning</div>
                                    <div className="text-[10px] text-gray-500">Включить цепочку рассуждений</div>
                                </div>
                            </div>
                            <button
                                className={`w-10 h-5 rounded-full transition-colors ${thinkingEnabled ? 'bg-indigo-600' : 'bg-gray-600'}`}
                                onClick={() => setThinkingEnabled(!thinkingEnabled)}
                            >
                                <div className={`w-4 h-4 bg-white rounded-full transition-transform mx-0.5 ${thinkingEnabled ? 'translate-x-5' : ''}`} />
                            </button>
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Shield className="w-4 h-4 text-green-400" />
                                <div>
                                    <div className="text-sm text-gray-200">TrustChain</div>
                                    <div className="text-[10px] text-gray-500">Криптографическая верификация</div>
                                </div>
                            </div>
                            <button
                                className={`w-10 h-5 rounded-full transition-colors ${trustchainEnabled ? 'bg-green-600' : 'bg-gray-600'}`}
                                onClick={() => setTrustchainEnabled(!trustchainEnabled)}
                            >
                                <div className={`w-4 h-4 bg-white rounded-full transition-transform mx-0.5 ${trustchainEnabled ? 'translate-x-5' : ''}`} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-4 py-3 border-t border-gray-700 flex justify-end gap-2">
                    <button
                        className="px-3 py-1.5 text-sm text-gray-400 hover:text-white transition-colors"
                        onClick={onClose}
                    >
                        Отмена
                    </button>
                    <button
                        className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors"
                        onClick={() => {
                            console.log('[AgentSettings] Saving:', { selectedModel, temperature, maxTokens, thinkingEnabled, trustchainEnabled });
                            onClose();
                        }}
                    >
                        Сохранить
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AgentSettings;
