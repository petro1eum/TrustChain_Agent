/**
 * Types for the ChatAgent UI module
 */

import type { ChatMessage, ChatAttachment } from '../../agents/types';

export interface ChatAgentProps {
    isOpen: boolean;
    onClose: () => void;
    isMinimized: boolean;
    onToggleMinimize: () => void;
    appContext: AppContext;
    isEmbedded?: boolean;
}

export interface AppContext {
    currentView: string;
    selectedClient: any;
    selectedFile: any;
    dataFiles: any;
    setCurrentView: (view: string) => void;
    setSelectedClient: (client: any) => void;
    setSelectedFile: (file: any) => void;
    setDataFiles: (files: any) => void;
    [key: string]: any;
}

export interface ProcessingState {
    isProcessing: boolean;
    currentStep?: string;
    progress?: number;
    startedAt?: Date;
}

export interface AgentModeConfig {
    id: string;
    name: string;
    description: string;
    icon: string;
    defaultTools?: string[];
    color?: string;
}

export type ViewMode = 'chat' | 'artifacts' | 'tools' | 'settings';
