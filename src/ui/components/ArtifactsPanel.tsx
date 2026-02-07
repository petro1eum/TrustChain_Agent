import React from 'react';
import { Download, Copy, Maximize2, Minimize2, X } from 'lucide-react';
import type { Artifact } from './types';
import { ARTIFACT_META } from './constants';
import { renderFullMarkdown } from './MarkdownRenderer';

/**
 * ArtifactsPanel — Right-side panel for viewing artifact content.
 */
export const ArtifactsPanel: React.FC<{
    artifact: Artifact;
    onClose: () => void;
    isMaximized: boolean;
    onToggleMaximize: () => void;
}> = ({ artifact, onClose, isMaximized, onToggleMaximize }) => {
    const meta = ARTIFACT_META[artifact.type];

    return (
        <div className="h-full flex flex-col tc-artifact-panel border-l">
            {/* Panel header */}
            <div className="h-12 shrink-0 border-b tc-border flex items-center px-4 gap-2">
                <div className={`${meta.color}`}>{meta.icon}</div>
                <span className="text-sm tc-text-heading font-medium flex-1 truncate">{artifact.title}</span>
                <div className="flex items-center gap-1">
                    {artifact.signature && (
                        <span className="text-[10px] font-mono mr-2 px-2 py-0.5 rounded-full border tc-verified">
                            ✓ {artifact.signature.substring(0, 8)}
                        </span>
                    )}
                    {artifact.version > 1 && (
                        <span className="text-[10px] tc-text-muted mr-2">v{artifact.version}</span>
                    )}
                    <button className="tc-text-muted hover:tc-text p-1.5 rounded-lg tc-btn-hover transition-colors"
                        title="Download">
                        <Download size={14} />
                    </button>
                    <button className="tc-text-muted hover:tc-text p-1.5 rounded-lg tc-btn-hover transition-colors"
                        title="Copy">
                        <Copy size={14} />
                    </button>
                    <button
                        onClick={onToggleMaximize}
                        className="tc-text-muted hover:tc-text p-1.5 rounded-lg tc-btn-hover transition-colors"
                        title={isMaximized ? 'Restore' : 'Maximize'}
                    >
                        {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                    </button>
                    <button
                        onClick={onClose}
                        className="tc-text-muted hover:tc-text p-1.5 rounded-lg tc-btn-hover transition-colors"
                    >
                        <X size={14} />
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-5 tc-scrollbar">
                {artifact.type === 'code' ? (
                    <div className="relative">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <span className="text-[11px] tc-text-secondary tc-surface px-2 py-0.5 rounded font-mono">
                                    {artifact.language || 'plaintext'}
                                </span>
                            </div>
                        </div>
                        <pre className="tc-code rounded-xl p-4 overflow-x-auto text-[13px] font-mono leading-relaxed border tc-scrollbar-h">
                            <code>{artifact.content}</code>
                        </pre>
                    </div>
                ) : (
                    <div className="tc-prose prose-sm max-w-none
            [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:mb-4 [&_h1]:pb-2 [&_h1]:border-b
            [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-6 [&_h2]:mb-3
            [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2
            [&_p]:leading-relaxed
            [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono
            [&_pre]:rounded-xl [&_pre]:border
            [&_input[type=checkbox]]:mr-2 [&_input[type=checkbox]]:accent-violet-500">
                        {renderFullMarkdown(artifact.content)}
                    </div>
                )}
            </div>

            {/* Panel footer */}
            <div className="h-10 shrink-0 border-t tc-border flex items-center px-4 text-[10px] tc-text-muted gap-3">
                <span>{artifact.createdAt.toLocaleTimeString()}</span>
                <span>·</span>
                <span>{artifact.content.split('\n').length} lines</span>
                {artifact.type === 'code' && artifact.language && (
                    <>
                        <span>·</span>
                        <span>{artifact.language}</span>
                    </>
                )}
            </div>
        </div>
    );
};
