/**
 * FileManagerPanel — file explorer for the Storage accordion.
 * 
 * UX:
 * - Single click folder → navigate into it
 * - Single click file → select it (actions appear in toolbar)
 * - Double click file → preview it
 * - Right-click → context menu
 * - Breadcrumbs for path navigation
 * - Upload/New Folder into current directory
 * - File preview modal rendered via Portal (escapes sidebar overflow)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
    Folder, File, ChevronRight, Upload, FolderPlus, RefreshCw,
    X, Trash2, Eye, Download, ArrowLeft, Home,
    FileText, FileJson, FileCode, Image as ImageIcon
} from 'lucide-react';
import { userStorageService, type FileEntry } from '../../services/storage';

// ── Helpers ──

function formatSize(bytes: number): string {
    if (bytes === 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(name: string) {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    if (['json', 'jsonl'].includes(ext)) return <FileJson size={14} className="text-amber-400" />;
    if (['ts', 'tsx', 'js', 'jsx', 'py', 'sh', 'css', 'html'].includes(ext)) return <FileCode size={14} className="text-emerald-400" />;
    if (['md', 'txt', 'log', 'csv'].includes(ext)) return <FileText size={14} className="text-blue-300" />;
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return <ImageIcon size={14} className="text-pink-400" />;
    return <File size={14} className="text-slate-400" />;
}

// ── File Preview Modal (rendered via Portal at body level) ──

const FilePreview: React.FC<{
    path: string;
    onClose: () => void;
}> = ({ path, onClose }) => {
    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        userStorageService.readFile(path).then(c => {
            setContent(c);
            setLoading(false);
        }).catch(() => {
            setContent('Could not read file');
            setLoading(false);
        });
    }, [path]);

    // Escape key to close
    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose]);

    const fileName = path.split('/').pop() || path;

    // Render via portal to escape any parent overflow clipping
    return createPortal(
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center"
            style={{ backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
            onClick={onClose}
        >
            <div
                className="bg-[#1a1b2e] border border-white/10 rounded-xl shadow-2xl flex flex-col mx-4"
                style={{ width: '520px', maxHeight: '70vh' }}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                        {getFileIcon(fileName)}
                        <span className="text-[13px] font-mono text-white truncate">{fileName}</span>
                        <span className="text-[10px] text-white/40 ml-1">{path}</span>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-white/40 hover:text-white p-1 rounded-md hover:bg-white/10 transition-colors"
                    >
                        <X size={14} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto p-4" style={{ maxHeight: 'calc(70vh - 48px)' }}>
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <div className="text-[12px] text-white/40 animate-pulse">Loading...</div>
                        </div>
                    ) : (
                        <pre className="text-[12px] font-mono text-white/90 whitespace-pre-wrap break-words leading-relaxed select-text">
                            {content}
                        </pre>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

// ── Context Menu (rendered via Portal) ──

const ContextMenu: React.FC<{
    x: number;
    y: number;
    entry: FileEntry;
    onView: () => void;
    onDownload: () => void;
    onDelete: () => void;
    onClose: () => void;
}> = ({ x, y, entry, onView, onDownload, onDelete, onClose }) => {
    const menuRef = useRef<HTMLDivElement>(null);
    const isDir = entry.type === 'directory';

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [onClose]);

    return createPortal(
        <div
            ref={menuRef}
            className="fixed z-[9999] bg-[#1a1b2e] border border-white/10 rounded-lg shadow-xl py-1.5 min-w-[150px] text-[12px]"
            style={{ left: x, top: y }}
        >
            {!isDir && (
                <button onClick={onView} className="w-full text-left px-3 py-1.5 hover:bg-white/5 text-white/80 flex items-center gap-2">
                    <Eye size={13} /> View
                </button>
            )}
            {!isDir && (
                <button onClick={onDownload} className="w-full text-left px-3 py-1.5 hover:bg-white/5 text-white/80 flex items-center gap-2">
                    <Download size={13} /> Download
                </button>
            )}
            <div className="border-t border-white/5 my-1" />
            <button onClick={onDelete} className="w-full text-left px-3 py-1.5 hover:bg-white/5 text-red-400 flex items-center gap-2">
                <Trash2 size={13} /> Delete
            </button>
        </div>,
        document.body
    );
};

// ── File/Folder Row ──

const FileRow: React.FC<{
    entry: FileEntry;
    isSelected: boolean;
    onClick: () => void;
    onDoubleClick: () => void;
    onContextMenu: (e: React.MouseEvent) => void;
}> = ({ entry, isSelected, onClick, onDoubleClick, onContextMenu }) => {
    const isDir = entry.type === 'directory';

    return (
        <div
            className={`flex items-center gap-2 px-2 py-[5px] rounded-md cursor-pointer transition-all
                ${isSelected
                    ? 'bg-blue-500/15 ring-1 ring-blue-500/30'
                    : 'hover:bg-white/5'}`}
            onClick={e => { e.stopPropagation(); onClick(); }}
            onDoubleClick={e => { e.stopPropagation(); onDoubleClick(); }}
            onContextMenu={e => {
                e.preventDefault();
                e.stopPropagation();
                onContextMenu(e);
            }}
        >
            {/* Icon */}
            {isDir
                ? <Folder size={14} className="text-amber-500 flex-shrink-0" />
                : getFileIcon(entry.name)
            }

            {/* Name */}
            <span className={`text-[11px] font-mono truncate flex-1 ${isSelected ? 'tc-text font-medium' : 'tc-text'}`}>
                {entry.name}
            </span>

            {/* Size */}
            <span className="text-[9px] tc-text-muted flex-shrink-0 w-[44px] text-right">
                {isDir ? '' : formatSize(entry.size)}
            </span>
        </div>
    );
};

// ── Main Panel ──

export const FileManagerPanel: React.FC = () => {
    const [currentPath, setCurrentPath] = useState('');
    const [entries, setEntries] = useState<FileEntry[]>([]);
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [previewPath, setPreviewPath] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [showNewFolder, setShowNewFolder] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: FileEntry } | null>(null);

    // Load entries for current directory
    const loadEntries = useCallback(async (path: string) => {
        setLoading(true);
        setSelectedPath(null);
        setContextMenu(null);
        try {
            const items = await userStorageService.listDir(path);
            items.sort((a, b) => {
                if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
                return a.name.localeCompare(b.name);
            });
            setEntries(items);
        } catch {
            setEntries([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadEntries(currentPath);
    }, [currentPath, loadEntries]);

    // Navigate into directory
    const navigateTo = useCallback((path: string) => {
        setCurrentPath(path);
        setContextMenu(null);
    }, []);

    // Go up one level
    const navigateUp = useCallback(() => {
        if (!currentPath) return;
        const parts = currentPath.split('/');
        parts.pop();
        setCurrentPath(parts.join('/'));
    }, [currentPath]);

    // Click handler: folder → navigate in, file → select
    const handleClick = useCallback((entry: FileEntry) => {
        if (entry.type === 'directory') {
            navigateTo(entry.path);
        } else {
            setSelectedPath(prev => prev === entry.path ? null : entry.path);
        }
    }, [navigateTo]);

    // Double-click handler: file → preview
    const handleDoubleClick = useCallback((entry: FileEntry) => {
        if (entry.type === 'directory') {
            navigateTo(entry.path);
        } else {
            setPreviewPath(entry.path);
        }
    }, [navigateTo]);

    // Delete
    const handleDelete = useCallback(async (path: string) => {
        const name = path.split('/').pop() || path;
        if (!confirm(`Delete "${name}"?`)) return;
        try {
            await userStorageService.deleteFile(path);
            setSelectedPath(null);
            setContextMenu(null);
            await loadEntries(currentPath);
        } catch (err) {
            console.error('[FileManager] Delete failed:', err);
        }
    }, [currentPath, loadEntries]);

    // Download
    const handleDownload = useCallback(async (path: string) => {
        try {
            const content = await userStorageService.readFile(path);
            const blob = new Blob([content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = path.split('/').pop() || 'file';
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('[FileManager] Download failed:', err);
        }
        setContextMenu(null);
    }, []);

    // Upload
    const handleUpload = useCallback(() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.onchange = async () => {
            if (!input.files) return;
            for (const file of Array.from(input.files)) {
                const text = await file.text();
                const dest = currentPath ? `${currentPath}/${file.name}` : file.name;
                await userStorageService.writeFile(dest, text);
            }
            await loadEntries(currentPath);
        };
        input.click();
    }, [currentPath, loadEntries]);

    // Create folder
    const handleCreateFolder = useCallback(async () => {
        if (!newFolderName.trim()) return;
        const folderPath = currentPath
            ? `${currentPath}/${newFolderName.trim()}`
            : newFolderName.trim();
        try {
            await userStorageService.writeFile(`${folderPath}/.keep`, '');
            setShowNewFolder(false);
            setNewFolderName('');
            await loadEntries(currentPath);
        } catch (err) {
            console.error('[FileManager] Create folder failed:', err);
        }
    }, [newFolderName, currentPath, loadEntries]);

    // Breadcrumb segments
    const breadcrumbs = currentPath ? currentPath.split('/') : [];
    const selectedEntry = selectedPath ? entries.find(e => e.path === selectedPath) : null;

    return (
        <div className="space-y-1" onClick={() => { setSelectedPath(null); setContextMenu(null); }}>
            {/* Breadcrumbs */}
            <div className="flex items-center gap-0.5 px-0.5 min-h-[20px] overflow-hidden">
                {currentPath && (
                    <button
                        onClick={e => { e.stopPropagation(); navigateUp(); }}
                        className="p-0.5 tc-text-muted hover:text-blue-400 transition-colors flex-shrink-0 rounded hover:bg-white/5"
                        title="Back"
                    >
                        <ArrowLeft size={11} />
                    </button>
                )}
                <button
                    onClick={e => { e.stopPropagation(); navigateTo(''); }}
                    className={`p-0.5 flex-shrink-0 rounded hover:bg-white/5 transition-colors
                        ${!currentPath ? 'text-blue-400' : 'tc-text-muted hover:text-blue-400'}`}
                    title="Root"
                >
                    <Home size={11} />
                </button>
                {breadcrumbs.map((seg, i) => {
                    const segPath = breadcrumbs.slice(0, i + 1).join('/');
                    const isLast = i === breadcrumbs.length - 1;
                    return (
                        <React.Fragment key={segPath}>
                            <ChevronRight size={8} className="tc-text-muted flex-shrink-0 opacity-40" />
                            <button
                                onClick={e => { e.stopPropagation(); navigateTo(segPath); }}
                                className={`text-[10px] font-mono truncate max-w-[60px] rounded px-0.5 transition-colors
                                    ${isLast ? 'tc-text font-medium' : 'tc-text-muted hover:text-blue-400 hover:bg-white/5'}`}
                            >
                                {seg}
                            </button>
                        </React.Fragment>
                    );
                })}
            </div>

            {/* Toolbar */}
            <div className="flex items-center gap-0.5 border-b tc-border-light pb-1">
                <button
                    onClick={e => { e.stopPropagation(); handleUpload(); }}
                    className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] tc-text-muted hover:text-blue-400 transition-colors rounded-md hover:bg-white/5"
                    title="Upload to current folder"
                >
                    <Upload size={10} /> Upload
                </button>
                <button
                    onClick={e => { e.stopPropagation(); setShowNewFolder(true); }}
                    className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] tc-text-muted hover:text-blue-400 transition-colors rounded-md hover:bg-white/5"
                    title="New folder"
                >
                    <FolderPlus size={10} /> New
                </button>
                <div className="flex-1" />

                {/* Actions for selected file */}
                {selectedEntry && selectedEntry.type === 'file' && (
                    <>
                        <button
                            onClick={e => { e.stopPropagation(); setPreviewPath(selectedEntry.path); }}
                            className="p-1 tc-text-muted hover:text-blue-400 rounded hover:bg-white/5 transition-colors"
                            title="View file"
                        >
                            <Eye size={11} />
                        </button>
                        <button
                            onClick={e => { e.stopPropagation(); handleDownload(selectedEntry.path); }}
                            className="p-1 tc-text-muted hover:text-emerald-400 rounded hover:bg-white/5 transition-colors"
                            title="Download"
                        >
                            <Download size={11} />
                        </button>
                        <button
                            onClick={e => { e.stopPropagation(); handleDelete(selectedEntry.path); }}
                            className="p-1 tc-text-muted hover:text-red-400 rounded hover:bg-white/5 transition-colors"
                            title="Delete"
                        >
                            <Trash2 size={11} />
                        </button>
                        <div className="w-px h-3 bg-white/10 mx-0.5" />
                    </>
                )}

                <button
                    onClick={e => { e.stopPropagation(); loadEntries(currentPath); }}
                    className="p-1 tc-text-muted hover:text-blue-400 transition-colors rounded hover:bg-white/5"
                    title="Refresh"
                >
                    <RefreshCw size={10} />
                </button>
            </div>

            {/* New folder form */}
            {showNewFolder && (
                <div className="flex items-center gap-1 px-1" onClick={e => e.stopPropagation()}>
                    <Folder size={12} className="text-amber-500 flex-shrink-0" />
                    <input
                        autoFocus
                        value={newFolderName}
                        onChange={e => setNewFolderName(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter') handleCreateFolder();
                            if (e.key === 'Escape') { setShowNewFolder(false); setNewFolderName(''); }
                        }}
                        placeholder="folder name"
                        className="flex-1 px-1.5 py-0.5 text-[11px] tc-surface border tc-border-light rounded tc-text font-mono placeholder:tc-text-muted focus:outline-none focus:ring-1 focus:ring-blue-500/30"
                    />
                    <button
                        onClick={handleCreateFolder}
                        className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                    >
                        OK
                    </button>
                    <button
                        onClick={() => { setShowNewFolder(false); setNewFolderName(''); }}
                        className="p-0.5 tc-text-muted hover:tc-text"
                    >
                        <X size={10} />
                    </button>
                </div>
            )}

            {/* File listing */}
            <div className="max-h-[240px] overflow-y-auto tc-scrollbar">
                {loading ? (
                    <div className="flex items-center justify-center py-4">
                        <div className="text-[10px] tc-text-muted animate-pulse">Loading...</div>
                    </div>
                ) : entries.length === 0 ? (
                    <div className="text-[10px] tc-text-muted text-center py-4">
                        {currentPath ? 'Empty folder' : 'No files yet'}
                    </div>
                ) : (
                    <div className="space-y-px">
                        {/* ".." parent directory link */}
                        {currentPath && (
                            <div
                                className="flex items-center gap-2 px-2 py-[5px] rounded-md cursor-pointer hover:bg-white/5 tc-text-muted"
                                onClick={e => { e.stopPropagation(); navigateUp(); }}
                            >
                                <ArrowLeft size={12} className="flex-shrink-0" />
                                <span className="text-[11px] font-mono">..</span>
                            </div>
                        )}

                        {entries.map(entry => (
                            <FileRow
                                key={entry.path}
                                entry={entry}
                                isSelected={selectedPath === entry.path}
                                onClick={() => handleClick(entry)}
                                onDoubleClick={() => handleDoubleClick(entry)}
                                onContextMenu={e => {
                                    setContextMenu({
                                        x: Math.min(e.clientX, window.innerWidth - 170),
                                        y: Math.min(e.clientY, window.innerHeight - 140),
                                        entry,
                                    });
                                    if (entry.type === 'file') setSelectedPath(entry.path);
                                }}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Status bar */}
            <div className="flex items-center justify-between text-[9px] tc-text-muted px-1 pt-0.5 border-t tc-border-light">
                <span>{entries.length} item{entries.length !== 1 ? 's' : ''}</span>
                {selectedEntry && (
                    <span className="truncate max-w-[120px]">
                        {selectedEntry.name} · {formatSize(selectedEntry.size)}
                    </span>
                )}
            </div>

            {/* Context menu (portal) */}
            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    entry={contextMenu.entry}
                    onView={() => { setPreviewPath(contextMenu.entry.path); setContextMenu(null); }}
                    onDownload={() => handleDownload(contextMenu.entry.path)}
                    onDelete={() => handleDelete(contextMenu.entry.path)}
                    onClose={() => setContextMenu(null)}
                />
            )}

            {/* File preview (portal) */}
            {previewPath && (
                <FilePreview
                    path={previewPath}
                    onClose={() => setPreviewPath(null)}
                />
            )}
        </div>
    );
};

export default FileManagerPanel;
