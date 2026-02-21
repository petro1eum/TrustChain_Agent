import React, { useState, useRef, useEffect, useCallback } from 'react';
// @ts-ignore
import RFB from '@novnc/novnc/core/rfb';
import { Download, Copy, Maximize2, Minimize2, X, Eye, Code, Play, AlertTriangle, Edit3, Save, Table, FileJson } from 'lucide-react';
import type { Artifact } from './types';
import { ARTIFACT_META } from './constants';
import { renderFullMarkdown } from './MarkdownRenderer';
import { userStorageService } from '../../services/storage';

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


// ── Embedded VNC viewer (same RFB approach as BrowserPanel) ──
const VncViewer: React.FC = () => {
    const containerRef = useRef<HTMLDivElement>(null);
    const rfbRef = useRef<any>(null);
    const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
    const resizeTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

    const resizeVnc = useCallback(async (w: number, h: number) => {
        try {
            await fetch('/api/sandbox/resize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ width: w, height: h }),
            });
        } catch (e) {
            console.warn('[VncViewer] Resize failed:', e);
        }
    }, []);

    // ── Auto-resize observer ──
    useEffect(() => {
        if (!containerRef.current || status !== 'connected') return;
        const observer = new ResizeObserver((entries) => {
            const { width, height } = entries[0].contentRect;
            if (width < 100 || height < 100) return; // ignore collapsed states

            clearTimeout(resizeTimeoutRef.current);
            resizeTimeoutRef.current = setTimeout(() => {
                resizeVnc(Math.floor(width), Math.floor(height));
            }, 500); // 500ms debounce
        });

        observer.observe(containerRef.current);
        return () => {
            observer.disconnect();
            clearTimeout(resizeTimeoutRef.current);
        };
    }, [status, resizeVnc]);

    useEffect(() => {
        if (!containerRef.current) return;
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${wsProtocol}//${window.location.hostname}:6080`;
        try {
            const rfb = new RFB(containerRef.current, url, { credentials: { password: '' } });
            rfb.addEventListener('connect', () => {
                rfb.scaleViewport = true;
                rfb.resizeSession = false;
                rfb.clipViewport = true;
                rfb.viewOnly = false;
                setStatus('connected');
            });
            rfb.addEventListener('disconnect', () => setStatus('error'));
            rfbRef.current = rfb;
        } catch (e) {
            console.error('[VncViewer] RFB error:', e);
            setStatus('error');
        }
        return () => {
            try { rfbRef.current?.disconnect?.(); } catch { }
        };
    }, []);

    return (
        <div
            ref={containerRef}
            className="flex-1 w-full relative bg-black flex items-center justify-center overflow-hidden"
            style={{ minHeight: '500px' }}
        >
            {status === 'connecting' && (
                <div className="absolute inset-0 flex items-center justify-center bg-[#1a1b2e] z-10 pointer-events-none">
                    <div className="text-[12px] tc-text-muted animate-pulse">Подключение к LibreOffice...</div>
                </div>
            )}
            {status === 'error' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#1a1b2e] z-10 gap-3">
                    <div className="text-[13px] tc-text-muted">VNC недоступен</div>
                    <button
                        className="text-[11px] text-blue-400 underline"
                        onClick={() => window.open(`http://${window.location.hostname}:6080/vnc.html?autoconnect=true`, '_blank')}
                    >
                        Открыть в новой вкладке
                    </button>
                </div>
            )}
        </div>
    );
};

/**
 * ArtifactsPanel — Right-side panel for viewing artifact content.
 * Supports live rendering of HTML/React artifacts with Preview/Code toggle.
 */
export const ArtifactsPanel: React.FC<{
    artifact: Artifact;
    onClose: () => void;
    isMaximized: boolean;
    onToggleMaximize: () => void;
    onArtifactUpdate?: (artifact: Artifact) => void;
    readOnly?: boolean;
}> = ({ artifact, onClose, isMaximized, onToggleMaximize, onArtifactUpdate, readOnly = false }) => {
    const meta = ARTIFACT_META[artifact.type];
    const renderable = isRenderableHTML(artifact.content);
    const reactRenderable = isRenderableReact(artifact.content);
    const canRender = renderable || reactRenderable;
    const isFileBacked = !!artifact.storagePath;
    const fileExt = artifact.storagePath?.split('.').pop()?.toLowerCase() || '';
    const isCsv = fileExt === 'csv';
    const isSpreadsheet = ['xlsx', 'xls', 'xlsm', 'xlsb', 'ods'].includes(fileExt);
    const isJson = fileExt === 'json' || fileExt === 'jsonl';
    const isMarkdown = fileExt === 'md';

    const [viewMode, setViewMode] = useState<'preview' | 'code' | 'edit'>(
        canRender ? 'preview' : (isMarkdown || isCsv || isSpreadsheet) ? 'preview' : 'code'
    );
    const [editContent, setEditContent] = useState(artifact.content);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [iframeHeight, setIframeHeight] = useState(500);
    const [iframeError, setIframeError] = useState<string | null>(null);
    const libreOpenedRef = useRef<string | null>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Reset view mode and edit content when artifact changes
    useEffect(() => {
        const newCanRender = isRenderableHTML(artifact.content) || isRenderableReact(artifact.content);
        const ext = artifact.storagePath?.split('.').pop()?.toLowerCase() || '';
        const md = ext === 'md';
        const csv = ext === 'csv';
        const spreadsheet = ['xlsx', 'xls', 'xlsm', 'xlsb', 'ods'].includes(ext);
        setViewMode(newCanRender ? 'preview' : (md || csv || spreadsheet) ? 'preview' : 'code');
        setEditContent(artifact.content);
        setIframeError(null);
        setSaved(false);
    }, [artifact.id, artifact.storagePath]);

    // ── Auto-launch LibreOffice when xlsx artifact is opened ──
    useEffect(() => {
        if (!isSpreadsheet || !artifact.storagePath) return;
        // Guard: only launch once per artifact
        const key = `${artifact.id}:${artifact.storagePath}`;
        if (libreOpenedRef.current === key) return;
        libreOpenedRef.current = key;
        const containerPath = `/mnt/user-data/default/${artifact.storagePath}`;
        fetch('/api/sandbox/open', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: containerPath }),
        }).catch(err => console.warn('[ArtifactsPanel] LibreOffice auto-open error:', err));
    }, [isSpreadsheet, artifact.storagePath, artifact.id]);

    // Save handler for file-backed artifacts
    const handleSave = useCallback(async () => {
        if (!artifact.storagePath) return;
        setSaving(true);
        try {
            await userStorageService.writeFile(artifact.storagePath, editContent);
            // Update artifact in parent state
            if (onArtifactUpdate) {
                onArtifactUpdate({ ...artifact, content: editContent });
            }
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (err) {
            console.error('[ArtifactsPanel] Save failed:', err);
        } finally {
            setSaving(false);
        }
    }, [artifact, editContent, onArtifactUpdate]);

    // Ctrl+S / Cmd+S to save
    useEffect(() => {
        if (!isFileBacked || viewMode !== 'edit') return;
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault();
                handleSave();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [isFileBacked, viewMode, handleSave]);

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

                    {/* View mode toggle */}
                    {(canRender || isFileBacked) && (
                        <div className="flex items-center mr-2 rounded-lg overflow-hidden border"
                            style={{ borderColor: 'var(--tc-border, rgba(55,55,80,0.6))' }}>
                            {(canRender || isMarkdown || isCsv || isSpreadsheet) && (
                                <button
                                    onClick={() => setViewMode('preview')}
                                    className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors ${viewMode === 'preview'
                                        ? 'bg-violet-500/20 text-violet-300'
                                        : 'tc-text-muted hover:text-gray-300'
                                        }`}
                                    title="Preview"
                                >
                                    <Eye size={10} /> Preview
                                </button>
                            )}
                            <button
                                onClick={() => setViewMode('code')}
                                className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors ${viewMode === 'code'
                                    ? 'bg-violet-500/20 text-violet-300'
                                    : 'tc-text-muted hover:text-gray-300'
                                    }`}
                                title="Source"
                            >
                                <Code size={10} /> Source
                            </button>
                            {isFileBacked && !readOnly && (
                                <button
                                    onClick={() => { setViewMode('edit'); setEditContent(artifact.content); }}
                                    className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors ${viewMode === 'edit'
                                        ? 'bg-emerald-500/20 text-emerald-300'
                                        : 'tc-text-muted hover:text-gray-300'
                                        }`}
                                    title="Edit"
                                >
                                    <Edit3 size={10} /> Edit
                                </button>
                            )}
                        </div>
                    )}

                    {/* Save button (edit mode) */}
                    {viewMode === 'edit' && isFileBacked && !readOnly && (
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors disabled:opacity-50 mr-1"
                            title="Save (⌘S)"
                        >
                            <Save size={10} />
                            {saving ? 'Saving...' : saved ? 'Saved ✓' : 'Save'}
                        </button>
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
            <div className="flex-1 overflow-auto tc-scrollbar flex flex-col" style={{ padding: viewMode === 'preview' ? 0 : '1.25rem' }}>
                {viewMode === 'edit' ? (
                    /* ═══ Edit Mode ═══ */
                    <textarea
                        ref={textareaRef}
                        value={editContent}
                        onChange={e => setEditContent(e.target.value)}
                        className="w-full h-full min-h-[400px] p-4 text-[13px] font-mono leading-relaxed tc-text tc-surface resize-none focus:outline-none tc-scrollbar"
                        style={{ background: 'transparent', border: 'none' }}
                        spellCheck={false}
                    />
                ) : viewMode === 'preview' && canRender ? (
                    /* ═══ Live Preview (HTML/React) ═══ */
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
                ) : viewMode === 'preview' && isSpreadsheet ? (
                    /* ═══ Spreadsheet — Embedded LibreOffice via VNC (direct RFB) ═══ */
                    <VncViewer key={artifact.id} />
                ) : viewMode === 'preview' && isCsv ? (
                    /* ═══ CSV Table Preview ═══ */
                    <div className="overflow-auto tc-scrollbar">
                        {(() => {
                            const lines = artifact.content.trim().split('\n');
                            if (lines.length === 0) return <div className="text-sm tc-text-muted p-4">Empty CSV</div>;
                            const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
                            const rows = lines.slice(1).map(l => l.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
                            return (
                                <table className="w-full text-[12px] border-collapse">
                                    <thead>
                                        <tr className="border-b tc-border">
                                            {header.map((h, i) => (
                                                <th key={i} className="text-left px-3 py-2 font-semibold tc-text-heading bg-white/[0.03] whitespace-nowrap">{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((row, ri) => (
                                            <tr key={ri} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                                                {row.map((cell, ci) => (
                                                    <td key={ci} className="px-3 py-1.5 tc-text whitespace-nowrap">{cell}</td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            );
                        })()}
                    </div>
                ) : viewMode === 'preview' && (isMarkdown || isJson) ? (
                    /* ═══ Markdown / JSON Preview ═══ */
                    <div className="p-5">
                        {isJson ? (
                            <pre className="tc-code rounded-xl p-4 overflow-x-auto text-[13px] font-mono leading-relaxed border tc-scrollbar-h">
                                <code>{(() => {
                                    try { return JSON.stringify(JSON.parse(artifact.content), null, 2); }
                                    catch { return artifact.content; }
                                })()}</code>
                            </pre>
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
                ) : artifact.type === 'code' || viewMode === 'code' ? (
                    /* ═══ Source Code ═══ */
                    <div className="relative">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <span className="text-[11px] tc-text-secondary tc-surface px-2 py-0.5 rounded font-mono">
                                    {artifact.language || fileExt || (renderable ? 'html' : reactRenderable ? 'jsx' : 'plaintext')}
                                </span>
                            </div>
                        </div>
                        <pre className="tc-code rounded-xl p-4 overflow-x-auto text-[13px] font-mono leading-relaxed border tc-scrollbar-h">
                            <code>{artifact.content}</code>
                        </pre>
                    </div>
                ) : (
                    /* ═══ Markdown / Text fallback ═══ */
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
                {isFileBacked && (
                    <>
                        <span>·</span>
                        <span className="text-blue-400/80 font-mono truncate max-w-[200px]" title={artifact.storagePath}>
                            {artifact.storagePath}
                        </span>
                    </>
                )}
                {viewMode === 'edit' && (
                    <>
                        <span>·</span>
                        <span className="text-amber-400/80">⌘S to save</span>
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
