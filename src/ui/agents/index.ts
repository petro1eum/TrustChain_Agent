/**
 * agents/index.ts — barrel export for the agent UI module.
 * Re-exports hooks, components, and services used by ChatAgent.tsx.
 */

// Hooks
export { useChatState } from './hooks/useChatState';
export { useAgentConfiguration } from './hooks/useAgentConfiguration';
export { useDragAndResize } from './hooks/useDragAndResize';
export { useTools } from './hooks/useTools';

// Components
export { ChatHeader } from './components/ChatHeader';
export { ChatSidebar } from './components/ChatSidebar';
export { ChatArea } from './components/ChatArea';
export { InputPanel } from './components/InputPanel';

// Services
export { createMessageHandlers } from './services/messageHandlers';
export { createAgentCallbacksService } from './services/agentCallbacksService';

// Types
export type { ChatAgentProps, AppContext, ProcessingState, AgentModeConfig, ViewMode } from './types';
export type { ChatStateReturn } from './hooks/useChatState';
export type { AgentConfigReturn } from './hooks/useAgentConfiguration';
export type { DragResizeReturn } from './hooks/useDragAndResize';
export type { UseToolsReturn, ToolInfo } from './hooks/useTools';
export type { MessageHandlersReturn } from './services/messageHandlers';
export type { AgentCallbacksServiceReturn } from './services/agentCallbacksService';
