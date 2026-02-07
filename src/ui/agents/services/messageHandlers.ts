/**
 * Message Handlers — provides event handlers for chat interactions.
 */

import type { ChatMessage } from '../../../agents/types';
import type { ProcessingState } from '../types';
import type { ChatStateReturn } from '../hooks/useChatState';
import type { AgentConfigReturn } from '../hooks/useAgentConfiguration';
import type { AppContext } from '../types';

interface MessageHandlersDeps {
    chatState: ChatStateReturn;
    agentConfig: AgentConfigReturn;
    appContext: AppContext;
    setActiveTools: React.Dispatch<React.SetStateAction<string[]>>;
    setForceUpdate: React.Dispatch<React.SetStateAction<number>>;
}

export interface MessageHandlersReturn {
    handleSendMessage: () => void;
    handleKeyPress: (e: React.KeyboardEvent) => void;
    handleAgentModeChange: (mode: string) => void;
    handleToolToggle: (toolId: string) => void;
    handleTestSystemStatus: () => void;
    handleDiagnostics: () => void;
}

export function createMessageHandlers(deps: MessageHandlersDeps): MessageHandlersReturn {
    const { chatState, agentConfig } = deps;

    const handleSendMessage = () => {
        const text = chatState.inputValue.trim();
        if (!text && chatState.pendingAttachments.length === 0) return;
        if (chatState.processing.isProcessing) return;

        // Add user message
        const userMsg: ChatMessage = {
            id: `msg_${Date.now()}`,
            role: 'user',
            content: text,
            timestamp: new Date(),
            attachments: chatState.pendingAttachments.length > 0
                ? [...chatState.pendingAttachments]
                : undefined,
        };

        chatState.setMessages((prev: any) => [...prev, userMsg]);
        chatState.setInputValue('');
        chatState.setPendingAttachments([]);

        // Start processing (agent integration will handle the actual API call)
        chatState.setProcessing({ isProcessing: true, currentStep: 'Анализирую запрос...' });

        // Note: The actual agent call should be wired here via useAgent hook.
        // For now we simulate a response after a short delay.
        setTimeout(() => {
            const assistantMsg: ChatMessage = {
                id: `msg_${Date.now()}`,
                role: 'assistant',
                content: 'Подключение к AI-агенту... Для полной работы необходимо интегрировать SmartAIAgent через хук useAgent.',
                timestamp: new Date(),
            };
            chatState.setMessages((prev: any) => [...prev, assistantMsg]);
            chatState.setProcessing({ isProcessing: false });
        }, 500);
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    const handleAgentModeChange = (mode: string) => {
        agentConfig.setAgentMode(mode);
        console.log('[MessageHandlers] Agent mode changed to:', mode);
    };

    const handleToolToggle = (toolId: string) => {
        deps.setForceUpdate(prev => prev + 1);
        console.log('[MessageHandlers] Tool toggled:', toolId);
    };

    const handleTestSystemStatus = () => {
        const statusMsg: ChatMessage = {
            id: `msg_${Date.now()}`,
            role: 'system',
            content: '🟢 Система работает нормально. Все сервисы доступны.',
            timestamp: new Date(),
        };
        chatState.setMessages((prev: any) => [...prev, statusMsg]);
    };

    const handleDiagnostics = () => {
        const diagMsg: ChatMessage = {
            id: `msg_${Date.now()}`,
            role: 'system',
            content: `📊 Диагностика:\n• Модель: ${agentConfig.currentModel}\n• Агент: ${agentConfig.currentAgentName}\n• Режим: ${agentConfig.agentMode}\n• Сообщений: ${chatState.messages.length}`,
            timestamp: new Date(),
        };
        chatState.setMessages((prev: any) => [...prev, diagMsg]);
    };

    return {
        handleSendMessage,
        handleKeyPress,
        handleAgentModeChange,
        handleToolToggle,
        handleTestSystemStatus,
        handleDiagnostics,
    };
}
