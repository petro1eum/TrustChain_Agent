/**
 * BrowserPanel.tsx
 * 
 * Embedded TrustChain-aware browser panel.
 * Shows a URL bar, iframe browser view, and signed action log.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
    Globe, ArrowLeft, ArrowRight, RotateCw, X, Shield,
    ExternalLink, Lock, ChevronDown, ChevronUp, Clock,
    ShoppingCart, MousePointer, FileText, Eye,
    BookOpen, Code2, FlaskConical, LayoutList, Package,
} from 'lucide-react';
import { browserActionService, type BrowserAction } from '../../services/browserActionService';

// ─── Quick-launch sites ───

const QUICK_SITES = [
    { label: 'Wikipedia', url: 'https://en.wikipedia.org', icon: <BookOpen size={14} className="text-blue-400" /> },
    { label: 'MDN Docs', url: 'https://developer.mozilla.org', icon: <Code2 size={14} className="text-orange-400" /> },
    { label: 'httpbin', url: 'https://httpbin.org', icon: <FlaskConical size={14} className="text-green-400" /> },
    { label: 'JSON Placeholder', url: 'https://jsonplaceholder.typicode.com', icon: <LayoutList size={14} className="text-purple-400" /> },
    { label: 'DummyJSON', url: 'https://dummyjson.com', icon: <Package size={14} className="text-amber-400" /> },
    { label: 'Example.com', url: 'https://example.com', icon: <Globe size={14} className="text-cyan-400" /> },
];

// ─── Action type → icon mapping ───

const ACTION_ICONS: Record<string, React.ReactNode> = {
    navigate: <Globe size={10} />,
    click: <MousePointer size={10} />,
    fill: <FileText size={10} />,
    read: <Eye size={10} />,
    purchase: <ShoppingCart size={10} />,
};

// ─── Sub-components ───

const ActionLogItem: React.FC<{ action: BrowserAction }> = ({ action }) => {
    const timeStr = action.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    return (
        <div className="flex items-start gap-2 py-1.5 px-2 text-[10px] border-b tc-border opacity-80 hover:opacity-100 transition-opacity">
            <span className="tc-text-muted mt-0.5 flex-shrink-0">
                {ACTION_ICONS[action.type] || <Globe size={10} />}
            </span>
            <div className="flex-1 min-w-0">
                <div className="tc-text truncate">{action.detail}</div>
                <div className="flex items-center gap-2 mt-0.5">
                    <span className="tc-text-muted flex items-center gap-1">
                        <Clock size={7} /> {timeStr}
                    </span>
                    {action.verified && (
                        <span className="flex items-center gap-0.5 text-emerald-400">
                            <Shield size={7} /> signed
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};

// ─── Welcome screen (no URL loaded) ───

const BrowserWelcome: React.FC<{ onNavigate: (url: string) => void }> = ({ onNavigate }) => (
    <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/30
            flex items-center justify-center mb-4 shadow-lg shadow-cyan-500/10">
            <Globe size={24} className="text-cyan-400" />
        </div>
        <h3 className="text-base font-semibold tc-text mb-1">TrustChain Browser</h3>
        <p className="text-xs tc-text-muted text-center mb-6 max-w-[240px]">
            Browse the web with cryptographically signed actions. Every navigation, click, and interaction is recorded in your TrustChain.
        </p>

        <div className="w-full max-w-[280px]">
            <div className="text-[10px] tc-text-muted uppercase tracking-wider mb-2 font-medium">Quick Launch</div>
            <div className="grid grid-cols-2 gap-2">
                {QUICK_SITES.map(site => (
                    <button
                        key={site.url}
                        onClick={() => onNavigate(site.url)}
                        className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs
                            tc-surface tc-border border hover:border-cyan-500/40
                            tc-text transition-all duration-200 text-left group"
                    >
                        <span className="flex-shrink-0">{site.icon}</span>
                        <span className="truncate group-hover:text-cyan-300 transition-colors">{site.label}</span>
                    </button>
                ))}
            </div>
        </div>

        <div className="mt-6 flex items-center gap-1.5 text-[10px] tc-text-muted">
            <Lock size={9} />
            <span>Ed25519 signed · All actions logged</span>
        </div>
    </div>
);

// ─── Main BrowserPanel ───

export const BrowserPanel: React.FC<{
    onClose?: () => void;
    initialUrl?: string;
}> = ({ onClose, initialUrl }) => {
    const [url, setUrl] = useState(initialUrl || '');
    const [inputUrl, setInputUrl] = useState(initialUrl || '');
    const [isLoading, setIsLoading] = useState(false);
    const [pageTitle, setPageTitle] = useState('New Tab');
    const [actions, setActions] = useState<BrowserAction[]>([]);
    const [showLog, setShowLog] = useState(false);
    const [isWhitelisted, setIsWhitelisted] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const urlInputRef = useRef<HTMLInputElement>(null);

    // Subscribe to action log
    useEffect(() => {
        return browserActionService.onChange(setActions);
    }, []);

    // Sync URL from browserActionService state on mount (catches commands missed during React strict-mode remount)
    useEffect(() => {
        const currentState = browserActionService.getState();
        if (currentState.url && currentState.url !== url) {
            console.log('[BrowserPanel] Syncing URL from service state:', currentState.url);
            const whitelisted = browserActionService.isWhitelisted(currentState.url);
            setIsWhitelisted(whitelisted);
            if (whitelisted) {
                setError(null);
                setUrl(currentState.url);
                setInputUrl(currentState.url);
                setIsLoading(true);
            } else {
                setError(`This site doesn't allow iframe embedding.`);
                setUrl('');
                setInputUrl(currentState.url);
            }
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Subscribe to commands from agent tools (full interaction set)
    useEffect(() => {
        return browserActionService.onCommand((cmd) => {
            console.log('[BrowserPanel] Received command:', cmd.type, cmd.url || '');
            switch (cmd.type) {
                case 'navigate':
                case 'search':
                    if (cmd.url) {
                        const whitelisted = browserActionService.isWhitelisted(cmd.url);
                        setIsWhitelisted(whitelisted);
                        if (!whitelisted) {
                            setError(`This site doesn't allow iframe embedding.`);
                            setUrl('');
                            setInputUrl(cmd.url);
                        } else {
                            setError(null);
                            setUrl(cmd.url);
                            setInputUrl(cmd.url);
                            setIsLoading(true);
                        }
                    }
                    break;

                case 'close':
                    onClose?.();
                    break;

                case 'back':
                    window.history.back();
                    break;

                case 'forward':
                    window.history.forward();
                    break;

                case 'refresh':
                    if (iframeRef.current) {
                        iframeRef.current.src = iframeRef.current.src;
                        setIsLoading(true);
                    }
                    break;

                case 'scroll':
                    try {
                        const iframe = iframeRef.current;
                        if (iframe?.contentWindow) {
                            const amount = cmd.scrollAmount ?? 500;
                            switch (cmd.scrollDirection) {
                                case 'down': iframe.contentWindow.scrollBy(0, amount); break;
                                case 'up': iframe.contentWindow.scrollBy(0, -amount); break;
                                case 'top': iframe.contentWindow.scrollTo(0, 0); break;
                                case 'bottom': iframe.contentWindow.scrollTo(0, 999999); break;
                            }
                        }
                    } catch { /* cross-origin — silently ignore */ }
                    break;

                case 'click':
                    try {
                        const doc = iframeRef.current?.contentDocument;
                        if (doc && cmd.selector) {
                            const el = doc.querySelector(cmd.selector) as HTMLElement;
                            if (el) {
                                el.click();
                                if (cmd.commandId) browserActionService.resolveCommand({ commandId: cmd.commandId, success: true, data: { clicked: cmd.selector } });
                            } else {
                                if (cmd.commandId) browserActionService.resolveCommand({ commandId: cmd.commandId, success: false, error: `Element "${cmd.selector}" not found` });
                            }
                        } else if (doc && cmd.x !== undefined && cmd.y !== undefined) {
                            const el = doc.elementFromPoint(cmd.x, cmd.y) as HTMLElement;
                            if (el) {
                                el.click();
                                if (cmd.commandId) browserActionService.resolveCommand({ commandId: cmd.commandId, success: true, data: { clicked: `element at (${cmd.x}, ${cmd.y}): <${el.tagName.toLowerCase()}>` } });
                            } else {
                                if (cmd.commandId) browserActionService.resolveCommand({ commandId: cmd.commandId, success: false, error: `No element at (${cmd.x}, ${cmd.y})` });
                            }
                        } else {
                            if (cmd.commandId) browserActionService.resolveCommand({ commandId: cmd.commandId, success: false, error: 'Cross-origin: cannot access iframe content' });
                        }
                    } catch {
                        if (cmd.commandId) browserActionService.resolveCommand({ commandId: cmd.commandId, success: false, error: 'Cross-origin restriction: cannot interact with this page directly. Use headless browser tools instead.' });
                    }
                    break;

                case 'fill':
                    try {
                        const doc = iframeRef.current?.contentDocument;
                        if (doc && cmd.selector) {
                            const el = doc.querySelector(cmd.selector) as HTMLInputElement;
                            if (el) {
                                el.value = cmd.value ?? '';
                                el.dispatchEvent(new Event('input', { bubbles: true }));
                                el.dispatchEvent(new Event('change', { bubbles: true }));
                                if (cmd.commandId) browserActionService.resolveCommand({ commandId: cmd.commandId, success: true });
                            } else {
                                if (cmd.commandId) browserActionService.resolveCommand({ commandId: cmd.commandId, success: false, error: `Element "${cmd.selector}" not found` });
                            }
                        } else {
                            if (cmd.commandId) browserActionService.resolveCommand({ commandId: cmd.commandId, success: false, error: 'Cross-origin: cannot access iframe content' });
                        }
                    } catch {
                        if (cmd.commandId) browserActionService.resolveCommand({ commandId: cmd.commandId, success: false, error: 'Cross-origin restriction.' });
                    }
                    break;

                case 'read_page':
                    try {
                        const doc = iframeRef.current?.contentDocument;
                        if (doc) {
                            const targetEl = cmd.selector ? doc.querySelector(cmd.selector) : doc.body;
                            const text = targetEl?.textContent?.slice(0, 10000) ?? '';
                            if (cmd.commandId) browserActionService.resolveCommand({
                                commandId: cmd.commandId,
                                success: true,
                                data: {
                                    url: iframeRef.current?.src,
                                    title: doc.title,
                                    text: text.trim(),
                                },
                            });
                        } else {
                            if (cmd.commandId) browserActionService.resolveCommand({ commandId: cmd.commandId, success: false, error: 'Cross-origin: cannot read page content' });
                        }
                    } catch {
                        if (cmd.commandId) browserActionService.resolveCommand({
                            commandId: cmd.commandId,
                            success: false,
                            error: 'Cross-origin restriction: cannot read this page. Use headless browser tools instead.',
                        });
                    }
                    break;

                case 'screenshot':
                    // Screenshot of cross-origin iframe is not possible via canvas
                    if (cmd.commandId) browserActionService.resolveCommand({
                        commandId: cmd.commandId,
                        success: false,
                        error: 'Screenshot of embedded browser requires headless browser tools.',
                    });
                    break;
            }
        });
    }, [onClose]);

    // Navigate to URL
    const navigateTo = useCallback(async (targetUrl: string) => {
        if (!targetUrl.trim()) return;

        // Ensure protocol
        let normalized = targetUrl.trim();
        if (!/^https?:\/\//i.test(normalized)) {
            normalized = 'https://' + normalized;
        }

        // Check whitelist
        const whitelisted = browserActionService.isWhitelisted(normalized);
        setIsWhitelisted(whitelisted);

        if (!whitelisted) {
            setError(`This site doesn't allow iframe embedding. Use the agent to browse via Playwright tools instead.`);
            setUrl('');
            setInputUrl(normalized);
            setIsLoading(false);
            return;
        }

        setError(null);
        setUrl(normalized);
        setInputUrl(normalized);
        setIsLoading(true);

        // Sign the navigation
        await browserActionService.navigate(normalized);
    }, []);

    // Handle iframe load
    const onIframeLoad = useCallback(() => {
        setIsLoading(false);
        try {
            const title = iframeRef.current?.contentDocument?.title || '';
            if (title) {
                setPageTitle(title);
                browserActionService.onLoadComplete(title);
            }
        } catch {
            // Cross-origin — can't access title
            setPageTitle(url ? new URL(url).hostname : 'Page');
            browserActionService.onLoadComplete(pageTitle);
        }
    }, [url, pageTitle]);

    // Navigation controls
    const goBack = () => {
        const prev = browserActionService.goBack();
        if (prev) {
            setUrl(prev);
            setInputUrl(prev);
        }
    };

    const goForward = () => {
        const next = browserActionService.goForward();
        if (next) {
            setUrl(next);
            setInputUrl(next);
        }
    };

    const refresh = () => {
        if (iframeRef.current && url) {
            setIsLoading(true);
            iframeRef.current.src = url;
        }
    };

    // URL bar submit
    const handleUrlSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        navigateTo(inputUrl);
    };

    const state = browserActionService.getState();
    const signedCount = actions.filter(a => a.verified).length;

    return (
        <div className="flex flex-col h-full tc-surface-alt">
            {/* ── Header ── */}
            <div className="flex items-center gap-1 px-2 py-1.5 border-b tc-border">
                <div className="flex items-center gap-0.5">
                    <button
                        onClick={goBack}
                        disabled={!state.canGoBack}
                        className="p-1.5 rounded-md tc-text-muted hover:tc-text disabled:opacity-30 transition-all"
                        title="Back"
                    >
                        <ArrowLeft size={13} />
                    </button>
                    <button
                        onClick={goForward}
                        disabled={!state.canGoForward}
                        className="p-1.5 rounded-md tc-text-muted hover:tc-text disabled:opacity-30 transition-all"
                        title="Forward"
                    >
                        <ArrowRight size={13} />
                    </button>
                    <button
                        onClick={refresh}
                        disabled={!url}
                        className={`p-1.5 rounded-md tc-text-muted hover:tc-text disabled:opacity-30 transition-all
                            ${isLoading ? 'animate-spin' : ''}`}
                        title="Refresh"
                    >
                        <RotateCw size={13} />
                    </button>
                </div>

                {/* URL bar */}
                <form onSubmit={handleUrlSubmit} className="flex-1 mx-1">
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg tc-surface border tc-border
                        focus-within:border-cyan-500/50 transition-colors">
                        {url && isWhitelisted ? (
                            <Lock size={10} className="text-emerald-400 flex-shrink-0" />
                        ) : (
                            <Globe size={10} className="tc-text-muted flex-shrink-0" />
                        )}
                        <input
                            ref={urlInputRef}
                            type="text"
                            value={inputUrl}
                            onChange={e => setInputUrl(e.target.value)}
                            placeholder="Enter URL or search..."
                            className="flex-1 bg-transparent border-none outline-none text-[11px] tc-text
                                placeholder:tc-text-muted"
                        />
                        {isLoading && (
                            <div className="w-3 h-3 border border-cyan-400/50 border-t-cyan-400 rounded-full animate-spin flex-shrink-0" />
                        )}
                    </div>
                </form>

                {/* Right controls */}
                <div className="flex items-center gap-0.5">
                    {signedCount > 0 && (
                        <button
                            onClick={() => setShowLog(!showLog)}
                            className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px]
                                text-emerald-400 hover:bg-emerald-400/10 transition-all"
                            title="Action log"
                        >
                            <Shield size={10} />
                            <span>{signedCount}</span>
                            {showLog ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
                        </button>
                    )}
                    {url && (
                        <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded-md tc-text-muted hover:tc-text transition-all"
                            title="Open in new tab"
                        >
                            <ExternalLink size={12} />
                        </a>
                    )}
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="p-1.5 rounded-md tc-text-muted hover:text-red-400 transition-all"
                            title="Close browser"
                        >
                            <X size={13} />
                        </button>
                    )}
                </div>
            </div>

            {/* ── Action log (collapsible) ── */}
            {showLog && actions.length > 0 && (
                <div className="max-h-[200px] overflow-y-auto border-b tc-border tc-surface">
                    <div className="px-2 py-1 text-[9px] tc-text-muted uppercase tracking-wider font-medium
                        border-b tc-border sticky top-0 tc-surface">
                        Action Trail · {signedCount}/{actions.length} signed
                    </div>
                    {[...actions].reverse().map(action => (
                        <ActionLogItem key={action.id} action={action} />
                    ))}
                </div>
            )}

            {/* ── Browser content ── */}
            {!url ? (
                <BrowserWelcome onNavigate={navigateTo} />
            ) : error ? (
                <div className="flex-1 flex flex-col items-center justify-center p-6">
                    <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30
                        flex items-center justify-center mb-3">
                        <Globe size={20} className="text-amber-400" />
                    </div>
                    <h4 className="text-sm font-medium tc-text mb-1">Cannot embed this site</h4>
                    <p className="text-[11px] tc-text-muted text-center max-w-[280px] mb-4">{error}</p>
                    <div className="flex gap-2">
                        <a
                            href={inputUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs
                                bg-cyan-500/10 border border-cyan-500/30 text-cyan-300
                                hover:bg-cyan-500/20 transition-all"
                        >
                            <ExternalLink size={11} /> Open in new tab
                        </a>
                        <button
                            onClick={() => { setError(null); setUrl(''); setInputUrl(''); }}
                            className="px-3 py-1.5 rounded-lg text-xs tc-surface-hover tc-text-muted
                                border tc-border transition-all"
                        >
                            Back
                        </button>
                    </div>
                </div>
            ) : (
                <iframe
                    ref={iframeRef}
                    src={url}
                    onLoad={onIframeLoad}
                    className="flex-1 w-full border-none bg-white"
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                    title="TrustChain Browser"
                />
            )}

            {/* ── Bottom status bar ── */}
            <div className="flex items-center justify-between px-2.5 py-1 border-t tc-border text-[9px] tc-text-muted">
                <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1">
                        <Shield size={8} className="text-emerald-400" />
                        {signedCount} signed actions
                    </span>
                    {url && (
                        <span className="flex items-center gap-1">
                            <Lock size={8} />
                            {isWhitelisted ? 'Trusted' : 'Proxied'}
                        </span>
                    )}
                </div>
                <span className="truncate max-w-[150px]">{pageTitle}</span>
            </div>
        </div>
    );
};
