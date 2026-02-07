/**
 * Agent Callbacks Service — manages callbacks between agent core and app context.
 */

import type { AppContext } from '../types';

export interface AgentCallbacksServiceReturn {
    setAppContext: (ctx: AppContext) => void;
    getAppContext: () => AppContext | null;
}

export function createAgentCallbacksService(_initialContext?: AppContext): AgentCallbacksServiceReturn {
    let currentContext: AppContext | null = _initialContext || null;

    const setAppContext = (ctx: AppContext) => {
        currentContext = ctx;
        console.log('[AgentCallbacks] App context updated:', {
            currentView: ctx.currentView,
            hasSelectedClient: !!ctx.selectedClient,
            hasSelectedFile: !!ctx.selectedFile,
        });
    };

    const getAppContext = () => currentContext;

    return {
        setAppContext,
        getAppContext,
    };
}
