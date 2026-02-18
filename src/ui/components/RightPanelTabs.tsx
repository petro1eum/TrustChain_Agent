/**
 * RightPanelTabs.tsx
 * 
 * Tab bar for the right panel — switch between open artifacts and browser.
 * Each open artifact and the browser are separate tabs.
 */

import React from 'react';
import { X, Globe, FileCode2, FileText, BarChart3, Table2 } from 'lucide-react';

// ─── Types ───

export interface PanelTab {
    id: string;
    type: 'artifact' | 'browser';
    label: string;
    /** Artifact subtype for icon selection */
    artifactType?: string;
}

interface RightPanelTabsProps {
    tabs: PanelTab[];
    activeTabId: string | null;
    onSelectTab: (id: string) => void;
    onCloseTab: (id: string) => void;
}

// ─── Icon by artifact type ───

function TabIcon({ tab }: { tab: PanelTab }) {
    if (tab.type === 'browser') return <Globe size={12} className="text-cyan-400" />;

    switch (tab.artifactType) {
        case 'text/html':
        case 'application/code':
            return <FileCode2 size={12} className="text-amber-400" />;
        case 'application/chart':
            return <BarChart3 size={12} className="text-purple-400" />;
        case 'application/table':
            return <Table2 size={12} className="text-green-400" />;
        default:
            return <FileText size={12} className="text-blue-400" />;
    }
}

// ─── Component ───

export const RightPanelTabs: React.FC<RightPanelTabsProps> = ({
    tabs,
    activeTabId,
    onSelectTab,
    onCloseTab,
}) => {
    if (tabs.length === 0) return null;

    return (
        <div className="flex items-center gap-0 border-b tc-border tc-surface overflow-x-auto
            scrollbar-none" style={{ scrollbarWidth: 'none' }}>
            {tabs.map(tab => {
                const isActive = tab.id === activeTabId;
                return (
                    <button
                        key={tab.id}
                        onClick={() => onSelectTab(tab.id)}
                        className={`group flex items-center gap-1.5 pl-2.5 pr-1 py-1.5 text-[11px]
                            border-r tc-border whitespace-nowrap min-w-0 max-w-[160px] transition-all
                            ${isActive
                                ? 'tc-surface-alt tc-text border-b-2 border-b-cyan-500'
                                : 'tc-text-muted hover:tc-text hover:bg-white/5'
                            }`}
                    >
                        <TabIcon tab={tab} />
                        <span className="truncate">{tab.label}</span>
                        <span
                            onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
                            className="ml-auto p-0.5 rounded opacity-0 group-hover:opacity-100
                                hover:bg-white/10 transition-all flex-shrink-0 cursor-pointer"
                        >
                            <X size={10} />
                        </span>
                    </button>
                );
            })}
        </div>
    );
};
