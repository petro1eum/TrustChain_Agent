import React, { useState, useRef, useEffect } from 'react';
import { Download, Copy, Maximize2, Minimize2, X, Eye, Code, Play, AlertTriangle } from 'lucide-react';
import type { Artifact } from './types';
import { ARTIFACT_META } from './constants';
import { renderFullMarkdown } from './MarkdownRenderer';

/**
 * Detect if artifact content is renderable HTML/React
 */
function isRenderableHTML(content: string): boolean {
    const trimmed = content.trim().toLowerCase();
    return (
        trimmed.startsWith('<!doctype html') ||
        trimmed.startsWith('<html') ||
        (trimmed.includes('<body') && trimmed.includes('<head')) ||
        (trimmed.includes('<div') && trimmed.includes('<style'))
    );
}

function isRenderableReact(content: string): boolean {
    return (
        content.includes('import React') ||
        content.includes('from "react"') ||
        content.includes("from 'react'") ||
        (content.includes('useState') && content.includes('return ('))
    );
}

/**
 * ArtifactsPanel — Right-side panel for viewing artifact content.
 * Supports live rendering of HTML/React artifacts with Preview/Code toggle.
 */
export const ArtifactsPanel: React.FC<{
    artifact: Artifact;
    onClose: () => void;
    isMaximized: boolean;
    onToggleMaximize: () => void;
}> = ({ artifact, onClose, isMaximized, onToggleMaximize }) => {
    const meta = ARTIFACT_META[artifact.type];
    const renderable = isRenderableHTML(artifact.content);
    const reactRenderable = isRenderableReact(artifact.content);
    const canRender = renderable || reactRenderable;

    const [viewMode, setViewMode] = useState<'preview' | 'code'>(canRender ? 'preview' : 'code');
    const [iframeHeight, setIframeHeight] = useState(500);
    const [iframeError, setIframeError] = useState<string | null>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);

    // Reset view mode when artifact changes
    useEffect(() => {
        const newCanRender = isRenderableHTML(artifact.content) || isRenderableReact(artifact.content);
        setViewMode(newCanRender ? 'preview' : 'code');
        setIframeError(null);
    }, [artifact.id]);

    // Build HTML for React content
    const getIframeContent = (): string => {
        if (renderable) {
            // Pure HTML — inject error handler
            return artifact.content.replace(
                '</head>',
                `<script>
                    window.onerror = function(msg, url, line) {
                        window.parent.postMessage({ type: 'artifact-error', message: msg, line: line }, '*');
                        return false;
                    };
                </script></head>`
            );
        }
        if (reactRenderable) {
            // Wrap React code in standalone HTML with CDN React + Babel
            return buildReactHTML(artifact.content);
        }
        return artifact.content;
    };

    // Listen for error messages from iframe
    useEffect(() => {
        const handler = (e: MessageEvent) => {
            if (e.data?.type === 'artifact-error') {
                setIframeError(`JS Error (line ${e.data.line}): ${e.data.message}`);
            }
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, []);

    // Auto-resize iframe
    useEffect(() => {
        if (viewMode !== 'preview' || !iframeRef.current) return;
        const iframe = iframeRef.current;
        const handleLoad = () => {
            try {
                const doc = iframe.contentDocument || iframe.contentWindow?.document;
                if (doc?.body) {
                    const h = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
                    setIframeHeight(Math.max(400, Math.min(h + 20, 2000)));
                }
            } catch { /* cross-origin */ }
        };
        iframe.addEventListener('load', handleLoad);
        return () => iframe.removeEventListener('load', handleLoad);
    }, [viewMode, artifact.content]);

    const handleDownload = () => {
        const ext = artifact.type === 'code' ? (artifact.language || 'txt') : 'md';
        const filename = `${artifact.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.${ext}`;

        if (window.parent !== window) {
            window.parent.postMessage({
                type: 'trustchain:download',
                version: 1,
                data: artifact.content,
                filename,
                mimeType: artifact.type === 'code' ? 'text/plain' : 'text/markdown',
                requestId: `art-dl-${Date.now()}`,
            }, '*');
        } else {
            const blob = new Blob([artifact.content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
        }
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(artifact.content);
    };

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

                    {/* Preview / Code toggle */}
                    {canRender && (
                        <div className="flex items-center mr-2 rounded-lg overflow-hidden border"
                            style={{ borderColor: 'var(--tc-border, rgba(55,55,80,0.6))' }}>
                            <button
                                onClick={() => setViewMode('preview')}
                                className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors ${viewMode === 'preview'
                                    ? 'bg-violet-500/20 text-violet-300'
                                    : 'tc-text-muted hover:text-gray-300'
                                    }`}
                                title="Live Preview"
                            >
                                <Play size={10} /> Preview
                            </button>
                            <button
                                onClick={() => setViewMode('code')}
                                className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors ${viewMode === 'code'
                                    ? 'bg-violet-500/20 text-violet-300'
                                    : 'tc-text-muted hover:text-gray-300'
                                    }`}
                                title="Source Code"
                            >
                                <Code size={10} /> Code
                            </button>
                        </div>
                    )}

                    <button
                        onClick={handleDownload}
                        className="tc-text-muted hover:tc-text p-1.5 rounded-lg tc-btn-hover transition-colors"
                        title="Download">
                        <Download size={14} />
                    </button>
                    <button
                        onClick={handleCopy}
                        className="tc-text-muted hover:tc-text p-1.5 rounded-lg tc-btn-hover transition-colors"
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

            {/* Error banner */}
            {iframeError && (
                <div className="px-3 py-2 text-xs flex items-center gap-2 shrink-0"
                    style={{
                        background: 'rgba(239,68,68,0.08)',
                        borderBottom: '1px solid rgba(239,68,68,0.2)',
                        color: '#f87171'
                    }}
                >
                    <AlertTriangle size={12} />
                    <span className="flex-1 truncate">{iframeError}</span>
                    <button onClick={() => setIframeError(null)} className="opacity-60 hover:opacity-100">✕</button>
                </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-auto tc-scrollbar" style={{ padding: viewMode === 'preview' ? 0 : '1.25rem' }}>
                {viewMode === 'preview' && canRender ? (
                    /* ═══ Live Preview ═══ */
                    <iframe
                        ref={iframeRef}
                        className="w-full border-0"
                        style={{
                            minHeight: '400px',
                            height: `${iframeHeight}px`,
                            display: 'block',
                            background: '#fff',
                            borderRadius: isMaximized ? 0 : '0 0 8px 0',
                        }}
                        title={artifact.title}
                        sandbox="allow-scripts allow-same-origin allow-popups"
                        srcDoc={getIframeContent()}
                    />
                ) : artifact.type === 'code' || viewMode === 'code' ? (
                    /* ═══ Source Code ═══ */
                    <div className="relative">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <span className="text-[11px] tc-text-secondary tc-surface px-2 py-0.5 rounded font-mono">
                                    {artifact.language || (renderable ? 'html' : reactRenderable ? 'jsx' : 'plaintext')}
                                </span>
                            </div>
                        </div>
                        <pre className="tc-code rounded-xl p-4 overflow-x-auto text-[13px] font-mono leading-relaxed border tc-scrollbar-h">
                            <code>{artifact.content}</code>
                        </pre>
                    </div>
                ) : (
                    /* ═══ Markdown / Text ═══ */
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
                {canRender && viewMode === 'preview' && (
                    <>
                        <span>·</span>
                        <span className="text-emerald-400/80 flex items-center gap-1">
                            <Play size={8} /> Live
                        </span>
                    </>
                )}
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

/**
 * Build standalone HTML page that renders React code via CDN
 */
function buildReactHTML(reactCode: string): string {
    // Strip import statements
    const processed = reactCode
        .replace(/^import\s+.*?from\s+['"][^'"]+['"];?\s*$/gm, '')
        .replace(/^export\s+default\s+/gm, 'const __ExportedComponent = ')
        .replace(/^export\s+/gm, '');

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    <script src="https://unpkg.com/@babel/standalone@7/babel.min.js"></script>
    <script>
        window.onerror = function(msg, url, line) {
            window.parent.postMessage({ type: 'artifact-error', message: msg, line: line }, '*');
            document.getElementById('root').innerHTML = '<div style="color:red;padding:20px;font-family:monospace">' + msg + '</div>';
            return false;
        };
    </script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        #root { min-height: 100vh; }
    </style>
</head>
<body>
    <div id="root"></div>
    <script type="text/babel">
        const { useState, useEffect, useRef, useMemo, useCallback, useReducer, useContext, createContext } = React;
        ${processed}
        
        // Try to find and render the component
        try {
            const Component = typeof __ExportedComponent !== 'undefined' ? __ExportedComponent 
                : typeof App !== 'undefined' ? App 
                : null;
            if (Component) {
                ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Component));
            }
        } catch(e) {
            window.parent.postMessage({ type: 'artifact-error', message: e.message, line: 0 }, '*');
            document.getElementById('root').innerHTML = '<div style="color:red;padding:20px;font-family:monospace">' + e.message + '</div>';
        }
    </script>
</body>
</html>`;
}
