/**
 * useTools — provides tool list from toolsService with reactivity on forceUpdate.
 */

import { useState, useEffect } from 'react';
import { toolsService } from '../../../services/toolsService';

export interface ToolInfo {
    id: string;
    name: string;
    description?: string;
    category?: string;
    enabled: boolean;
}

export interface UseToolsReturn {
    tools: ToolInfo[];
}

export function useTools(forceUpdate: number): UseToolsReturn {
    const [tools, setTools] = useState<ToolInfo[]>([]);

    useEffect(() => {
        try {
            const allTools = toolsService.getAllTools?.() ?? [];
            const toolInfos: ToolInfo[] = allTools.map((t: any) => ({
                id: t.id || t.name || String(Math.random()),
                name: t.name || t.id || 'Unknown',
                description: t.description || '',
                category: t.category || 'general',
                enabled: t.enabled !== false,
            }));
            setTools(toolInfos);
        } catch (err) {
            console.warn('[useTools] Failed to load tools:', err);
            setTools([]);
        }
    }, [forceUpdate]);

    return { tools };
}
