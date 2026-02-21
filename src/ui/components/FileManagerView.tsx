/**
 * FileManagerView — Full-pane file manager (Finder-like).
 * 
 * Two-pane layout:
 *   Left:  folder tree (collapsible)
 *   Right: file listing for selected directory (with columns: Name, Size, Modified)
 * 
 * Top: breadcrumb path bar + actions toolbar
 * Bottom: status bar (items count, storage usage)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    Folder, FolderOpen, File, ChevronRight, ChevronDown,
    Upload, FolderPlus, RefreshCw, X, Trash2, Eye, Download,
    ArrowLeft, ArrowRight, Home, Search,
    FileText, FileJson, FileCode, Image as ImageIcon,
    HardDrive, LayoutGrid, List, PanelLeftClose, PanelLeft,
    Puzzle, Wrench, Lock, Globe, ShieldCheck, ShieldAlert, Star, Check
} from 'lucide-react';
import { userStorageService, virtualStorageService, MOUNT_SKILLS, MOUNT_TOOLS, type FileEntry } from '../../services/storage';
import { skillMarketplace, type MarketSkill } from '../../services/skillMarketplace';

// ── Helpers ──

function formatSize(bytes: number): string {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ts: number): string {
    if (!ts) return '—';
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return `Today at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

function getFileIcon(name: string, size = 16) {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    if (['json', 'jsonl'].includes(ext)) return <FileJson size={size} className="text-amber-400 flex-shrink-0" />;
    if (['ts', 'tsx', 'js', 'jsx', 'py', 'sh', 'css', 'html'].includes(ext)) return <FileCode size={size} className="text-emerald-400 flex-shrink-0" />;
    if (['md', 'txt', 'log', 'csv'].includes(ext)) return <FileText size={size} className="text-blue-300 flex-shrink-0" />;
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return <ImageIcon size={size} className="text-pink-400 flex-shrink-0" />;
    return <File size={size} className="text-slate-400 flex-shrink-0" />;
}

function getKind(entry: FileEntry): string {
    if (entry.type === 'directory') return 'Folder';
    const ext = entry.name.split('.').pop()?.toLowerCase() || '';
    const kinds: Record<string, string> = {
        json: 'JSON', jsonl: 'JSON Lines', ts: 'TypeScript', tsx: 'TypeScript JSX',
        js: 'JavaScript', jsx: 'JavaScript JSX', py: 'Python', sh: 'Shell Script',
        css: 'Stylesheet', html: 'HTML', md: 'Markdown', txt: 'Plain Text',
        log: 'Log File', csv: 'CSV', png: 'PNG Image', jpg: 'JPEG Image',
        jpeg: 'JPEG Image', gif: 'GIF Image', svg: 'SVG Image', webp: 'WebP Image',
    };
    return kinds[ext] || 'File';
}

// ── Tree Node (left pane) ──

interface TreeNodeData {
    path: string;
    name: string;
    children?: TreeNodeData[];
    isOpen?: boolean;
    depth: number;
}

const SidebarTreeNode: React.FC<{
    node: TreeNodeData;
    selectedDir: string;
    onSelect: (path: string) => void;
    onToggle: (path: string) => void;
}> = ({ node, selectedDir, onSelect, onToggle }) => {
    const isSelected = node.path === selectedDir;

    return (
        <>
            <div
                className={`flex items-center gap-1 px-2 py-[3px] cursor-pointer rounded-md transition-all text-[12px]
                    ${isSelected ? 'bg-blue-500/20 text-blue-300 font-medium' : 'tc-text-muted hover:bg-white/5 hover:tc-text'}`}
                style={{ paddingLeft: `${8 + node.depth * 16}px` }}
                onClick={() => { onSelect(node.path); onToggle(node.path); }}
            >
                {node.children && node.children.length > 0 ? (
                    node.isOpen
                        ? <ChevronDown size={10} className="flex-shrink-0 opacity-60" />
                        : <ChevronRight size={10} className="flex-shrink-0 opacity-60" />
                ) : (
                    <span className="w-[10px] flex-shrink-0" />
                )}
                {node.isOpen
                    ? <FolderOpen size={13} className="text-amber-500 flex-shrink-0" />
                    : <Folder size={13} className="text-amber-500 flex-shrink-0" />
                }
                <span className="truncate">{node.name}</span>
            </div>
            {node.isOpen && node.children?.map(child => (
                <SidebarTreeNode
                    key={child.path}
                    node={child}
                    selectedDir={selectedDir}
                    onSelect={onSelect}
                    onToggle={onToggle}
                />
            ))}
        </>
    );
};

// ── Marketplace Pane ──

const MarketplacePane: React.FC = () => {
    const [skills, setSkills] = useState<MarketSkill[]>([]);
    const [loading, setLoading] = useState(true);
    const [downloading, setDownloading] = useState<string | null>(null);
    const [statusMsgs, setStatusMsgs] = useState<Record<string, string>>({});

    useEffect(() => {
        skillMarketplace.fetchSkills().then(res => {
            setSkills(res);
            setLoading(false);
        });
    }, []);

    const handleDownload = async (skill: MarketSkill) => {
        setDownloading(skill.id);
        setStatusMsgs(prev => ({ ...prev, [skill.id]: 'Verifying signature...' }));

        // Slight delay for UX
        await new Promise(r => setTimeout(r, 600));

        const res = await skillMarketplace.installSkill(skill);
        setStatusMsgs(prev => ({ ...prev, [skill.id]: res.message }));
        setDownloading(null);
    };

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <div className="text-[12px] tc-text-muted animate-pulse">Loading verified skills...</div>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-y-auto p-6 bg-[var(--tc-bg,#0a0b1a)]">
            <div className="max-w-4xl mx-auto space-y-6">
                <div>
                    <h2 className="text-lg font-semibold text-emerald-400 flex items-center gap-2">
                        <ShieldCheck size={20} />
                        Trusted Skills Marketplace
                    </h2>
                    <p className="text-xs tc-text-muted mt-1">
                        Cryptographically signed python skills dynamically loaded into the agent's tool registry.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {skills.map(skill => {
                        const isVerified = skillMarketplace.verifySkillSignature(skill);
                        return (
                            <div key={skill.id} className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 flex flex-col gap-3">
                                <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex flex-col items-center justify-center">
                                            <Puzzle size={20} className="text-emerald-400" />
                                        </div>
                                        <div>
                                            <h3 className="text-sm font-semibold tc-text-heading">{skill.name}</h3>
                                            <div className="flex items-center gap-2 text-[10px] tc-text-muted font-mono mt-0.5">
                                                <span>v{skill.version}</span>
                                                <span>•</span>
                                                <span className="text-emerald-400/80">{skill.author}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 text-[10px] tc-text-muted">
                                        <span className="flex items-center gap-0.5"><Star size={10} className="text-amber-400" /> {skill.rating}</span>
                                        <span className="flex items-center gap-0.5"><Download size={10} /> {skill.downloads}</span>
                                    </div>
                                </div>

                                <p className="text-[11px] tc-text-secondary leading-relaxed line-clamp-2">
                                    {skill.description}
                                </p>

                                <div className="mt-auto pt-3 border-t border-slate-700/50 flex items-center justify-between">
                                    <div className="flex items-center gap-1.5">
                                        {isVerified ? (
                                            <span className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">
                                                <Check size={10} /> Verified Publisher
                                            </span>
                                        ) : (
                                            <span className="flex items-center gap-1 text-[10px] text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full">
                                                <ShieldAlert size={10} /> Invalid Signature
                                            </span>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => handleDownload(skill)}
                                        disabled={downloading === skill.id}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors disabled:opacity-50"
                                    >
                                        {downloading === skill.id ? (
                                            <>Installing...</>
                                        ) : (
                                            <><Download size={12} /> Install</>
                                        )}
                                    </button>
                                </div>
                                {statusMsgs[skill.id] && (
                                    <div className={`text-[10px] mt-1 ${statusMsgs[skill.id].includes('failed') ? 'text-red-400' : 'text-emerald-400'}`}>
                                        {statusMsgs[skill.id]}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

// ── Main Component ──

interface FileManagerViewProps {
    onClose: () => void;
    /** Open file in the Artifact Panel with edit/save support */
    onOpenFileArtifact?: (path: string, content: string) => void;
}

export const FileManagerView: React.FC<FileManagerViewProps> = ({ onClose, onOpenFileArtifact }) => {
    // State
    const [currentDir, setCurrentDir] = useState('');
    const [entries, setEntries] = useState<FileEntry[]>([]);
    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(false);
    const [sidebarTree, setSidebarTree] = useState<TreeNodeData[]>([]);
    const [openDirs, setOpenDirs] = useState<Set<string>>(new Set(['']));
    const [showNewFolder, setShowNewFolder] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [showSidebar, setShowSidebar] = useState(true);
    const [navHistory, setNavHistory] = useState<string[]>(['']);
    const [navIndex, setNavIndex] = useState(0);
    const [sortBy, setSortBy] = useState<'name' | 'size' | 'modified'>('name');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

    // Check if current path is virtual
    const isVirtual = virtualStorageService.isVirtualPath(currentDir);
    const isReadOnly = isVirtual && virtualStorageService.isReadOnly(currentDir);

    // Load tree for sidebar (user storage dirs only — virtual mounts are static)
    const loadTree = useCallback(async () => {
        try {
            const root = await userStorageService.listDir('');
            const dirs = root.filter(e => e.type === 'directory');
            const treeNodes: TreeNodeData[] = [];

            for (const dir of dirs) {
                const node: TreeNodeData = { path: dir.path, name: dir.name, depth: 0, children: [] };
                if (openDirs.has(dir.path)) {
                    node.isOpen = true;
                    try {
                        const children = await userStorageService.listDir(dir.path);
                        node.children = children
                            .filter(c => c.type === 'directory')
                            .map(c => ({ path: c.path, name: c.name, depth: 1, children: [] }));
                    } catch { /* ignore */ }
                }
                treeNodes.push(node);
            }
            setSidebarTree(treeNodes);
        } catch { /* ignore */ }
    }, [openDirs]);

    // Load virtual tree children for skills/tools mounts
    const [virtualSkillsTree, setVirtualSkillsTree] = useState<TreeNodeData[]>([]);
    const [virtualToolsTree, setVirtualToolsTree] = useState<TreeNodeData[]>([]);

    const loadVirtualTree = useCallback(async (mount: string, setter: React.Dispatch<React.SetStateAction<TreeNodeData[]>>) => {
        try {
            const items = await virtualStorageService.listDir(mount);
            const nodes = items.filter(e => e.type === 'directory').map(e => ({
                path: e.path,
                name: e.name,
                depth: 1,
                children: [] as TreeNodeData[],
                isOpen: openDirs.has(e.path),
            }));
            setter(nodes);
        } catch { /* ignore */ }
    }, [openDirs]);

    useEffect(() => { loadVirtualTree(MOUNT_SKILLS, setVirtualSkillsTree); }, [loadVirtualTree]);
    useEffect(() => { loadVirtualTree(MOUNT_TOOLS, setVirtualToolsTree); }, [loadVirtualTree]);

    // Load entries for content area — routes through virtualStorageService for virtual paths
    const loadEntries = useCallback(async (path: string) => {
        setLoading(true);
        try {
            if (virtualStorageService.isVirtualPath(path)) {
                const items = await virtualStorageService.listDir(path);
                setEntries(items);
            } else {
                const items = await userStorageService.listDir(path);
                setEntries(items);
            }
        } catch {
            setEntries([]);
        } finally {
            setLoading(false);
        }
    }, []);

    // Initial load
    useEffect(() => { loadTree(); }, [loadTree]);
    useEffect(() => { loadEntries(currentDir); }, [currentDir, loadEntries]);

    // Sort entries
    const sortedEntries = [...entries].sort((a, b) => {
        // Directories first always
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        const m = sortDir === 'asc' ? 1 : -1;
        if (sortBy === 'name') return a.name.localeCompare(b.name) * m;
        if (sortBy === 'size') return ((a.size || 0) - (b.size || 0)) * m;
        if (sortBy === 'modified') return ((a.modified || 0) - (b.modified || 0)) * m;
        return 0;
    });

    // Navigation
    const navigateTo = useCallback((path: string) => {
        setCurrentDir(path);
        setSelectedPaths(new Set());
        setNavHistory(prev => {
            const newHist = prev.slice(0, navIndex + 1);
            newHist.push(path);
            return newHist;
        });
        setNavIndex(prev => prev + 1);
    }, [navIndex]);

    const canGoBack = navIndex > 0;
    const canGoForward = navIndex < navHistory.length - 1;

    const goBack = useCallback(() => {
        if (!canGoBack) return;
        const newIdx = navIndex - 1;
        setNavIndex(newIdx);
        setCurrentDir(navHistory[newIdx]);
        setSelectedPaths(new Set());
    }, [canGoBack, navIndex, navHistory]);

    const goForward = useCallback(() => {
        if (!canGoForward) return;
        const newIdx = navIndex + 1;
        setNavIndex(newIdx);
        setCurrentDir(navHistory[newIdx]);
        setSelectedPaths(new Set());
    }, [canGoForward, navIndex, navHistory]);

    // Tree sidebar actions
    const handleTreeSelect = useCallback((path: string) => {
        navigateTo(path);
    }, [navigateTo]);

    const handleTreeToggle = useCallback((path: string) => {
        setOpenDirs(prev => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });
    }, []);

    // File actions
    const handleOpen = useCallback(async (entry: FileEntry) => {
        if (entry.type === 'directory') {
            navigateTo(entry.path);
            setOpenDirs(prev => new Set(prev).add(entry.path));
        } else if (onOpenFileArtifact) {
            // Load file content — route through virtual service for virtual paths
            try {
                const content = virtualStorageService.isVirtualPath(entry.path)
                    ? await virtualStorageService.readFile(entry.path)
                    : await userStorageService.readFile(entry.path);
                onOpenFileArtifact(entry.path, content);
            } catch (err) {
                console.error('[FileManager] Failed to read file:', err);
            }
        }
    }, [navigateTo, onOpenFileArtifact]);

    const handleSelect = useCallback((path: string, e: React.MouseEvent) => {
        if (e.metaKey || e.ctrlKey) {
            setSelectedPaths(prev => {
                const next = new Set(prev);
                if (next.has(path)) next.delete(path);
                else next.add(path);
                return next;
            });
        } else {
            setSelectedPaths(new Set([path]));
        }
    }, []);

    const handleDelete = useCallback(async () => {
        const paths = Array.from(selectedPaths);
        if (!paths.length) return;
        const msg = paths.length === 1
            ? `Delete "${paths[0].split('/').pop()}"?`
            : `Delete ${paths.length} items?`;
        if (!confirm(msg)) return;
        for (const p of paths) {
            try { await userStorageService.deleteFile(p); } catch { /* skip */ }
        }
        setSelectedPaths(new Set());
        await loadEntries(currentDir);
        await loadTree();
    }, [selectedPaths, currentDir, loadEntries, loadTree]);

    const handleDownload = useCallback(async () => {
        for (const path of selectedPaths) {
            try {
                const content = await userStorageService.readFile(path);
                const blob = new Blob([content], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = path.split('/').pop() || 'file';
                a.click();
                URL.revokeObjectURL(url);
            } catch { /* skip */ }
        }
    }, [selectedPaths]);

    const handleUpload = useCallback(() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.onchange = async () => {
            if (!input.files) return;
            for (const file of Array.from(input.files)) {
                try {
                    const buffer = await file.arrayBuffer();
                    const dest = currentDir ? `${currentDir}/${file.name}` : file.name;
                    await userStorageService.writeBinary(dest, buffer);
                } catch (err) {
                    console.error('[FileManager] Upload failed for', file.name, err);
                }
            }
            await loadEntries(currentDir);
            await loadTree();
        };
        input.click();
    }, [currentDir, loadEntries, loadTree]);

    const handleCreateFolder = useCallback(async () => {
        if (!newFolderName.trim()) return;
        const folderPath = currentDir
            ? `${currentDir}/${newFolderName.trim()}`
            : newFolderName.trim();
        try {
            await userStorageService.writeFile(`${folderPath}/.keep`, '');
            setShowNewFolder(false);
            setNewFolderName('');
            await loadEntries(currentDir);
            await loadTree();
        } catch (err) {
            console.error('[FileManager] Create folder failed:', err);
        }
    }, [newFolderName, currentDir, loadEntries, loadTree]);

    const handleSort = useCallback((col: 'name' | 'size' | 'modified') => {
        if (sortBy === col) {
            setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(col);
            setSortDir('asc');
        }
    }, [sortBy]);

    // Breadcrumbs — handle virtual path prefixes nicely
    const getBreadcrumbs = () => {
        if (currentDir === '__marketplace__') {
            return { prefix: '🌐 Marketplace', segments: [], basePath: '__marketplace__' };
        }
        if (currentDir.startsWith(MOUNT_SKILLS)) {
            const sub = currentDir.slice(MOUNT_SKILLS.length);
            return { prefix: '🧩 Skills', segments: sub ? sub.split('/') : [], basePath: MOUNT_SKILLS };
        }
        if (currentDir.startsWith(MOUNT_TOOLS)) {
            const sub = currentDir.slice(MOUNT_TOOLS.length);
            return { prefix: '🔧 Tools', segments: sub ? sub.split('/') : [], basePath: MOUNT_TOOLS };
        }
        return { prefix: null, segments: currentDir ? currentDir.split('/') : [], basePath: '' };
    };
    const { prefix: mountPrefix, segments: breadcrumbs, basePath } = getBreadcrumbs();

    const selectedEntries = entries.filter(e => selectedPaths.has(e.path));
    const hasFileSelected = selectedEntries.some(e => e.type === 'file');

    const SortIcon = ({ col }: { col: string }) => {
        if (sortBy !== col) return null;
        return <span className="text-[8px] ml-0.5">{sortDir === 'asc' ? '▲' : '▼'}</span>;
    };

    return (
        <div className="flex flex-col h-full bg-[var(--tc-bg,#0a0b1a)]">
            {/* ═══ Top toolbar ═══ */}
            <div className="flex items-center gap-2 px-3 py-2 border-b tc-border-light bg-[var(--tc-surface,#10112a)]">
                {/* Navigation */}
                <div className="flex items-center gap-0.5">
                    <button
                        onClick={goBack}
                        disabled={!canGoBack}
                        className={`p-1 rounded-md transition-colors ${canGoBack ? 'tc-text-muted hover:tc-text hover:bg-white/5' : 'text-white/10'}`}
                        title="Back"
                    >
                        <ArrowLeft size={16} />
                    </button>
                    <button
                        onClick={goForward}
                        disabled={!canGoForward}
                        className={`p-1 rounded-md transition-colors ${canGoForward ? 'tc-text-muted hover:tc-text hover:bg-white/5' : 'text-white/10'}`}
                        title="Forward"
                    >
                        <ArrowRight size={16} />
                    </button>
                </div>

                {/* Breadcrumb path */}
                <div className="flex items-center gap-1 flex-1 min-w-0">
                    <button
                        onClick={() => navigateTo('')}
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[12px] font-medium transition-colors
                            ${!currentDir ? 'text-blue-400' : 'tc-text-muted hover:tc-text hover:bg-white/5'}`}
                    >
                        <HardDrive size={13} />
                        Storage
                    </button>
                    {mountPrefix && (
                        <>
                            <ChevronRight size={10} className="tc-text-muted opacity-40 flex-shrink-0" />
                            <button
                                onClick={() => navigateTo(basePath)}
                                className={`text-[12px] font-medium rounded-md px-1 py-0.5 transition-colors
                                    ${breadcrumbs.length === 0 ? 'tc-text' : 'tc-text-muted hover:tc-text hover:bg-white/5'}`}
                            >
                                {mountPrefix}
                            </button>
                        </>
                    )}
                    {breadcrumbs.map((seg: string, i: number) => {
                        const segPath = basePath + breadcrumbs.slice(0, i + 1).join('/');
                        const isLast = i === breadcrumbs.length - 1;
                        return (
                            <React.Fragment key={segPath}>
                                <ChevronRight size={10} className="tc-text-muted opacity-40 flex-shrink-0" />
                                <button
                                    onClick={() => navigateTo(segPath)}
                                    className={`text-[12px] font-mono rounded-md px-1 py-0.5 truncate max-w-[120px] transition-colors
                                        ${isLast ? 'tc-text font-medium' : 'tc-text-muted hover:tc-text hover:bg-white/5'}`}
                                >
                                    {seg}
                                </button>
                            </React.Fragment>
                        );
                    })}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1">
                    {isReadOnly && (
                        <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-amber-400/80 bg-amber-500/10 rounded-md mr-1">
                            <Lock size={10} /> Read-only
                        </span>
                    )}
                    {!isVirtual && (
                        <>
                            <button
                                onClick={handleUpload}
                                className="flex items-center gap-1 px-2 py-1 text-[11px] tc-text-muted hover:tc-text rounded-md hover:bg-white/5 transition-colors"
                                title="Upload files"
                            >
                                <Upload size={13} /> Upload
                            </button>
                            <button
                                onClick={() => setShowNewFolder(true)}
                                className="flex items-center gap-1 px-2 py-1 text-[11px] tc-text-muted hover:tc-text rounded-md hover:bg-white/5 transition-colors"
                                title="New folder"
                            >
                                <FolderPlus size={13} /> New Folder
                            </button>
                        </>
                    )}
                    <div className="w-px h-4 bg-white/10 mx-1" />

                    {/* Selected file actions */}
                    {hasFileSelected && (
                        <>
                            <button
                                onClick={async () => {
                                    const f = selectedEntries.find(e => e.type === 'file');
                                    if (f && onOpenFileArtifact) {
                                        try {
                                            const content = await userStorageService.readFile(f.path);
                                            onOpenFileArtifact(f.path, content);
                                        } catch { /* skip */ }
                                    }
                                }}
                                className="p-1.5 tc-text-muted hover:text-blue-400 rounded-md hover:bg-white/5 transition-colors"
                                title="View"
                            >
                                <Eye size={14} />
                            </button>
                            <button
                                onClick={handleDownload}
                                className="p-1.5 tc-text-muted hover:text-emerald-400 rounded-md hover:bg-white/5 transition-colors"
                                title="Download"
                            >
                                <Download size={14} />
                            </button>
                        </>
                    )}
                    {selectedPaths.size > 0 && !isReadOnly && (
                        <button
                            onClick={handleDelete}
                            className="p-1.5 tc-text-muted hover:text-red-400 rounded-md hover:bg-white/5 transition-colors"
                            title="Delete"
                        >
                            <Trash2 size={14} />
                        </button>
                    )}
                    <div className="w-px h-4 bg-white/10 mx-1" />

                    <button
                        onClick={() => setShowSidebar(!showSidebar)}
                        className="p-1.5 tc-text-muted hover:tc-text rounded-md hover:bg-white/5 transition-colors"
                        title={showSidebar ? 'Hide sidebar' : 'Show sidebar'}
                    >
                        {showSidebar ? <PanelLeftClose size={14} /> : <PanelLeft size={14} />}
                    </button>
                    <button
                        onClick={() => { loadEntries(currentDir); loadTree(); }}
                        className="p-1.5 tc-text-muted hover:tc-text rounded-md hover:bg-white/5 transition-colors"
                        title="Refresh"
                    >
                        <RefreshCw size={14} />
                    </button>
                    <button
                        onClick={onClose}
                        className="p-1.5 tc-text-muted hover:tc-text rounded-md hover:bg-white/5 transition-colors"
                        title="Close File Manager"
                    >
                        <X size={14} />
                    </button>
                </div>
            </div>

            {/* ═══ New folder form ═══ */}
            {showNewFolder && (
                <div className="flex items-center gap-2 px-4 py-2 border-b tc-border-light bg-[var(--tc-surface,#10112a)]">
                    <Folder size={14} className="text-amber-500" />
                    <input
                        autoFocus
                        value={newFolderName}
                        onChange={e => setNewFolderName(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter') handleCreateFolder();
                            if (e.key === 'Escape') { setShowNewFolder(false); setNewFolderName(''); }
                        }}
                        placeholder="New folder name..."
                        className="flex-1 max-w-[240px] px-2 py-1 text-[12px] tc-surface border tc-border-light rounded-md tc-text font-mono focus:outline-none focus:ring-1 focus:ring-blue-500/40"
                    />
                    <button
                        onClick={handleCreateFolder}
                        className="px-3 py-1 text-[11px] font-medium bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
                    >
                        Create
                    </button>
                    <button
                        onClick={() => { setShowNewFolder(false); setNewFolderName(''); }}
                        className="p-1 tc-text-muted hover:tc-text rounded-md"
                    >
                        <X size={12} />
                    </button>
                </div>
            )}

            {/* ═══ Main content: sidebar + listing ═══ */}
            <div className="flex-1 flex min-h-0 overflow-hidden">
                {/* Left sidebar — folder tree */}
                {showSidebar && (
                    <div className="w-[180px] flex-shrink-0 border-r tc-border-light overflow-y-auto tc-scrollbar py-2 bg-[var(--tc-bg,#0a0b1a)]">
                        {/* ── Storage root ── */}
                        <div
                            className={`flex items-center gap-1.5 px-3 py-[3px] cursor-pointer rounded-md text-[12px] mx-1 transition-all
                                ${currentDir === '' ? 'bg-blue-500/20 text-blue-300 font-medium' : 'tc-text-muted hover:bg-white/5 hover:tc-text'}`}
                            onClick={() => navigateTo('')}
                        >
                            <HardDrive size={13} className="text-blue-400 flex-shrink-0" />
                            <span>Storage</span>
                        </div>

                        <div className="mt-1 mx-1">
                            {sidebarTree.map(node => (
                                <SidebarTreeNode
                                    key={node.path}
                                    node={node}
                                    selectedDir={currentDir}
                                    onSelect={handleTreeSelect}
                                    onToggle={handleTreeToggle}
                                />
                            ))}
                        </div>

                        {/* ── Divider ── */}
                        <div className="mx-3 my-2 border-t tc-border-light" />

                        {/* ── Skills mount ── */}
                        <div
                            className={`flex items-center gap-1.5 px-3 py-[3px] cursor-pointer rounded-md text-[12px] mx-1 transition-all
                                ${currentDir === MOUNT_SKILLS ? 'bg-purple-500/20 text-purple-300 font-medium' : 'tc-text-muted hover:bg-white/5 hover:tc-text'}`}
                            onClick={() => navigateTo(MOUNT_SKILLS)}
                        >
                            <Puzzle size={13} className="text-purple-400 flex-shrink-0" />
                            <span>Skills</span>
                        </div>
                        {(currentDir.startsWith(MOUNT_SKILLS) || openDirs.has(MOUNT_SKILLS)) && (
                            <div className="mt-0.5 mx-1">
                                {virtualSkillsTree.map(node => (
                                    <SidebarTreeNode
                                        key={node.path}
                                        node={node}
                                        selectedDir={currentDir}
                                        onSelect={handleTreeSelect}
                                        onToggle={handleTreeToggle}
                                    />
                                ))}
                            </div>
                        )}

                        {/* ── Tools mount ── */}
                        <div
                            className={`flex items-center gap-1.5 px-3 py-[3px] cursor-pointer rounded-md text-[12px] mx-1 mt-1 transition-all
                                ${currentDir === MOUNT_TOOLS ? 'bg-orange-500/20 text-orange-300 font-medium' : 'tc-text-muted hover:bg-white/5 hover:tc-text'}`}
                            onClick={() => navigateTo(MOUNT_TOOLS)}
                        >
                            <Wrench size={13} className="text-orange-400 flex-shrink-0" />
                            <span>Tools</span>
                        </div>
                        {(currentDir.startsWith(MOUNT_TOOLS) || openDirs.has(MOUNT_TOOLS)) && (
                            <div className="mt-0.5 mx-1">
                                {virtualToolsTree.map(node => (
                                    <SidebarTreeNode
                                        key={node.path}
                                        node={node}
                                        selectedDir={currentDir}
                                        onSelect={handleTreeSelect}
                                        onToggle={handleTreeToggle}
                                    />
                                ))}
                            </div>
                        )}

                        {/* ── Divider ── */}
                        <div className="mx-3 my-2 border-t tc-border-light" />

                        {/* ── Marketplace ── */}
                        <div
                            className={`flex items-center gap-1.5 px-3 py-[3px] cursor-pointer rounded-md text-[12px] mx-1 mt-1 transition-all
                                ${currentDir === '__marketplace__' ? 'bg-emerald-500/20 text-emerald-300 font-medium' : 'tc-text-muted hover:bg-white/5 hover:tc-text'}`}
                            onClick={() => navigateTo('__marketplace__')}
                        >
                            <Globe size={13} className="text-emerald-400 flex-shrink-0" />
                            <span>Marketplace</span>
                        </div>
                    </div>
                )}

                {/* Right content — file listing */}
                <div className="flex-1 flex flex-col min-w-0 overflow-hidden" onClick={() => setSelectedPaths(new Set())}>
                    {currentDir === '__marketplace__' ? (
                        <MarketplacePane />
                    ) : (
                        <>
                            {/* Column headers */}
                            <div className="flex items-center px-3 py-1.5 border-b tc-border-light text-[11px] tc-text-muted bg-[var(--tc-surface,#10112a)] select-none">
                                <button
                                    className="flex items-center gap-1 flex-1 min-w-0 text-left hover:tc-text transition-colors"
                                    onClick={() => handleSort('name')}
                                >
                                    Name <SortIcon col="name" />
                                </button>
                                <button
                                    className="flex items-center gap-1 w-[140px] flex-shrink-0 text-left hover:tc-text transition-colors"
                                    onClick={() => handleSort('modified')}
                                >
                                    Date Modified <SortIcon col="modified" />
                                </button>
                                <button
                                    className="flex items-center gap-1 w-[80px] flex-shrink-0 text-right justify-end hover:tc-text transition-colors"
                                    onClick={() => handleSort('size')}
                                >
                                    Size <SortIcon col="size" />
                                </button>
                                <span className="w-[90px] flex-shrink-0 text-right">Kind</span>
                            </div>

                            {/* File rows */}
                            <div className="flex-1 overflow-y-auto tc-scrollbar">
                                {loading ? (
                                    <div className="flex items-center justify-center py-12">
                                        <div className="text-[12px] tc-text-muted animate-pulse">Loading...</div>
                                    </div>
                                ) : sortedEntries.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-16 gap-2">
                                        <Folder size={40} className="tc-text-muted opacity-20" />
                                        <div className="text-[13px] tc-text-muted">
                                            {currentDir ? 'This folder is empty' : 'No files yet'}
                                        </div>
                                        <div className="text-[11px] tc-text-muted opacity-60">
                                            Use Upload or New Folder to add files
                                        </div>
                                    </div>
                                ) : (
                                    sortedEntries.map(entry => {
                                        const isSelected = selectedPaths.has(entry.path);
                                        const isDir = entry.type === 'directory';
                                        return (
                                            <div
                                                key={entry.path}
                                                className={`flex items-center px-3 py-[5px] cursor-pointer transition-all border-b border-transparent
                                            ${isSelected
                                                        ? 'bg-blue-500/15 border-blue-500/20'
                                                        : 'hover:bg-white/[0.03]'}`}
                                                onClick={e => { e.stopPropagation(); handleSelect(entry.path, e); }}
                                                onDoubleClick={() => handleOpen(entry)}
                                            >
                                                {/* Expand arrow for dirs */}
                                                {isDir ? (
                                                    <ChevronRight size={10} className="tc-text-muted mr-1 flex-shrink-0 opacity-40" />
                                                ) : (
                                                    <span className="w-[10px] mr-1 flex-shrink-0" />
                                                )}

                                                {/* Icon + Name */}
                                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                                    {isDir
                                                        ? <Folder size={16} className="text-amber-500 flex-shrink-0" />
                                                        : getFileIcon(entry.name)}
                                                    <span className={`text-[12px] truncate ${isSelected ? 'tc-text font-medium' : 'tc-text'}`}>
                                                        {entry.name}
                                                    </span>
                                                </div>

                                                {/* Date Modified */}
                                                <span className="text-[11px] tc-text-muted w-[140px] flex-shrink-0">
                                                    {formatDate(entry.modified)}
                                                </span>

                                                {/* Size */}
                                                <span className="text-[11px] tc-text-muted w-[80px] flex-shrink-0 text-right">
                                                    {isDir ? '—' : formatSize(entry.size)}
                                                </span>

                                                {/* Kind */}
                                                <span className="text-[11px] tc-text-muted w-[90px] flex-shrink-0 text-right">
                                                    {getKind(entry)}
                                                </span>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* ═══ Status bar ═══ */}
            <div className="flex items-center justify-between px-4 py-1.5 border-t tc-border-light text-[11px] tc-text-muted bg-[var(--tc-surface,#10112a)]">
                <span>{sortedEntries.length} item{sortedEntries.length !== 1 ? 's' : ''}{isReadOnly ? ' (read-only)' : ''}</span>
                {selectedPaths.size > 0 && (
                    <span>{selectedPaths.size} selected</span>
                )}
                <span>
                    {mountPrefix
                        ? `${mountPrefix}${breadcrumbs.length > 0 ? ' › ' + breadcrumbs.join(' › ') : ''}`
                        : breadcrumbs.length > 0 ? breadcrumbs.join(' › ') : 'Storage Root'}
                </span>
            </div>
        </div>
    );
};

export default FileManagerView;
