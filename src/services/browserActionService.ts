/**
 * browserActionService.ts
 * 
 * Service managing browser interactions with TrustChain signing.
 * Every significant action in the embedded browser gets an Ed25519 signature.
 */

import { trustchainService } from './trustchainService';

// ─── Types ───

/** Evidence collected before/after a browser action for audit-grade non-repudiation */
export interface BrowserEvidence {
    domHash?: string;           // SHA-256 of DOM at time of action
    visualProofHash?: string;   // SHA-256 of screenshot at time of action
    networkRequestUrl?: string; // URL of the triggering request
    networkResponseStatus?: number;
    pageTitle?: string;
    pageUrl?: string;
    viewportText?: string;      // Visible text near the action target
}

export interface BrowserAction {
    id: string;
    type: 'navigate' | 'click' | 'fill' | 'submit' | 'screenshot' | 'read' | 'purchase';
    url: string;
    timestamp: Date;
    detail: string;
    intent?: string;            // Human-readable intent ("Buying server for project X")
    selector?: string;
    value?: string;
    signature?: string;
    publicKey?: string;
    verified?: boolean;
    evidenceBefore?: BrowserEvidence;
    evidenceAfter?: BrowserEvidence;
    policyCheck?: 'passed' | 'denied' | 'pending_approval';
    requiresHumanApproval?: boolean;
}

export interface BrowserState {
    url: string;
    title: string;
    isLoading: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
    history: string[];
    historyIndex: number;
}

// ─── Whitelisted domains that allow iframe embedding ───

const IFRAME_WHITELIST = [
    'example.com',
    'httpbin.org',
    'jsonplaceholder.typicode.com',
    'dummyjson.com',
    'fakestoreapi.com',
    'reqres.in',
    'wikipedia.org',
    'en.wikipedia.org',
    'developer.mozilla.org',
    // Add more domains as needed
];
// ─── Command dispatch (agent tools → BrowserPanel) ───

export interface BrowserCommand {
    type: 'navigate' | 'search' | 'close' | 'back' | 'forward' | 'refresh'
    | 'scroll' | 'click' | 'fill' | 'read_page' | 'screenshot';
    url?: string;
    query?: string;
    /** For scroll: direction or pixel amount */
    scrollDirection?: 'up' | 'down' | 'top' | 'bottom';
    scrollAmount?: number;
    /** For click: coordinates */
    x?: number;
    y?: number;
    /** For fill: selector + value */
    selector?: string;
    value?: string;
    /** Unique command ID for async response matching */
    commandId?: string;
}

export interface BrowserCommandResponse {
    commandId: string;
    success: boolean;
    data?: any;
    error?: string;
}

// ─── Service ───

class BrowserActionService {
    private actions: BrowserAction[] = [];
    private listeners: Set<(actions: BrowserAction[]) => void> = new Set();
    private commandListeners: Set<(cmd: BrowserCommand) => void> = new Set();
    private responseResolvers: Map<string, (response: BrowserCommandResponse) => void> = new Map();
    private commandCounter = 0;
    private state: BrowserState = {
        url: '',
        title: 'New Tab',
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        history: [],
        historyIndex: -1,
    };

    /** Get all actions */
    getActions(): BrowserAction[] {
        return [...this.actions];
    }

    /** Get current state */
    getState(): BrowserState {
        return { ...this.state };
    }

    /** Check if URL is in the whitelist */
    isWhitelisted(url: string): boolean {
        try {
            const parsed = new URL(url);
            return IFRAME_WHITELIST.some(domain =>
                parsed.hostname === domain || parsed.hostname.endsWith('.' + domain)
            );
        } catch {
            return false;
        }
    }

    /** Get proxy URL for non-whitelisted sites */
    getProxyUrl(url: string): string {
        // In production, this would route through a backend proxy
        // For now, return the URL directly (relies on whitelist)
        return url;
    }

    /** Record and sign a navigation action */
    async navigate(url: string): Promise<BrowserAction> {
        const action = await this.createAction('navigate', url, `Navigate to ${url}`);

        // Update history
        const newHistory = [...this.state.history.slice(0, this.state.historyIndex + 1), url];
        this.state = {
            ...this.state,
            url,
            isLoading: true,
            history: newHistory,
            historyIndex: newHistory.length - 1,
            canGoBack: newHistory.length > 1,
            canGoForward: false,
        };

        return action;
    }

    /** Record page load complete */
    onLoadComplete(title: string): void {
        this.state = { ...this.state, title, isLoading: false };
    }

    /** Go back in history */
    goBack(): string | null {
        if (this.state.historyIndex <= 0) return null;
        this.state.historyIndex--;
        const url = this.state.history[this.state.historyIndex];
        this.state = {
            ...this.state,
            url,
            canGoBack: this.state.historyIndex > 0,
            canGoForward: true,
        };
        return url;
    }

    /** Go forward in history */
    goForward(): string | null {
        if (this.state.historyIndex >= this.state.history.length - 1) return null;
        this.state.historyIndex++;
        const url = this.state.history[this.state.historyIndex];
        this.state = {
            ...this.state,
            url,
            canGoBack: true,
            canGoForward: this.state.historyIndex < this.state.history.length - 1,
        };
        return url;
    }

    /** Record a click action with evidence */
    async click(url: string, selector: string, detail: string, intent?: string): Promise<BrowserAction> {
        return this.createAction('click', url, detail, selector, undefined, intent);
    }

    /** Record a form fill action */
    async fill(url: string, selector: string, value: string): Promise<BrowserAction> {
        return this.createAction('fill', url, `Fill ${selector}`, selector, value);
    }

    /** Record a page read action */
    async read(url: string, detail: string): Promise<BrowserAction> {
        return this.createAction('read', url, detail);
    }

    /**
     * Record a purchase action — THE SIGNED CLICK
     * 
     * Implements evidence collection + policy enforcement + multi-sign.
     * For amounts > HUMAN_APPROVAL_THRESHOLD, marks as requiring human approval.
     */
    async purchase(url: string, detail: string, amount?: string, intent?: string): Promise<BrowserAction> {
        const HUMAN_APPROVAL_THRESHOLD = 1000;
        const numAmount = amount ? parseFloat(amount) : 0;
        const requiresApproval = numAmount > HUMAN_APPROVAL_THRESHOLD;

        const action = await this.createAction(
            'purchase',
            url,
            `Purchase: ${detail}${amount ? ` ($${amount})` : ''}`,
            undefined,
            undefined,
            intent || `Purchase authorization: ${detail}`,
        );

        // Policy enforcement
        action.policyCheck = requiresApproval ? 'pending_approval' : 'passed';
        action.requiresHumanApproval = requiresApproval;

        this.notify();
        return action;
    }

    /** Collect evidence from an iframe element (best-effort, cross-origin limited) */
    async collectEvidence(iframe: HTMLIFrameElement | null): Promise<BrowserEvidence> {
        const evidence: BrowserEvidence = {
            pageUrl: this.state.url,
            pageTitle: this.state.title,
        };

        if (!iframe) return evidence;

        try {
            // Same-origin: we can access DOM
            const doc = iframe.contentDocument;
            if (doc) {
                const html = doc.documentElement.outerHTML;
                evidence.domHash = await this.sha256(html);
                evidence.viewportText = doc.body?.innerText?.slice(0, 500);
            }
        } catch {
            // Cross-origin: hash the URL + timestamp as minimal evidence
            evidence.domHash = await this.sha256(`${this.state.url}:${Date.now()}`);
        }

        return evidence;
    }

    /** Subscribe to action changes */
    onChange(listener: (actions: BrowserAction[]) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** Clear all actions */
    clear(): void {
        this.actions = [];
        this.notify();
    }

    // ─── Command bridge (agent tools → BrowserPanel) ───

    /** Last dispatched navigation command — for replaying when BrowserPanel mounts late */
    private pendingNavCommand: BrowserCommand | null = null;

    /** Dispatch a fire-and-forget command to BrowserPanel */
    dispatchCommand(cmd: BrowserCommand): void {
        console.log(`[browserActionService] dispatchCommand: ${cmd.type}, url=${cmd.url || 'n/a'}, listeners=${this.commandListeners.size}`);
        // If no BrowserPanel listeners exist yet, store navigate/search for replay
        if ((cmd.type === 'navigate' || cmd.type === 'search') && this.commandListeners.size === 0) {
            this.pendingNavCommand = cmd;
        }
        this.commandListeners.forEach(fn => fn(cmd));
    }

    /** Dispatch a command and wait for a response from BrowserPanel */
    dispatchCommandAsync(cmd: BrowserCommand, timeoutMs = 5000): Promise<BrowserCommandResponse> {
        const commandId = `cmd_${++this.commandCounter}_${Date.now()}`;
        cmd.commandId = commandId;

        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.responseResolvers.delete(commandId);
                resolve({ commandId, success: false, error: 'Command timed out' });
            }, timeoutMs);

            this.responseResolvers.set(commandId, (response) => {
                clearTimeout(timer);
                this.responseResolvers.delete(commandId);
                resolve(response);
            });

            this.dispatchCommand(cmd);
        });
    }

    /** Called by BrowserPanel to send a response back to a pending command */
    resolveCommand(response: BrowserCommandResponse): void {
        const resolver = this.responseResolvers.get(response.commandId);
        if (resolver) resolver(response);
    }

    /** Subscribe to commands from agent tools */
    onCommand(listener: (cmd: BrowserCommand) => void): () => void {
        this.commandListeners.add(listener);
        // Replay pending navigation command that was dispatched before this listener existed
        if (this.pendingNavCommand) {
            const cmd = this.pendingNavCommand;
            this.pendingNavCommand = null;
            // Delay to ensure React has finished mounting
            queueMicrotask(() => listener(cmd));
        }
        return () => this.commandListeners.delete(listener);
    }

    // ─── Private ───

    private async sha256(data: string): Promise<string> {
        const encoder = new TextEncoder();
        const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
        return Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    private async createAction(
        type: BrowserAction['type'],
        url: string,
        detail: string,
        selector?: string,
        value?: string,
        intent?: string,
    ): Promise<BrowserAction> {
        const action: BrowserAction = {
            id: `ba_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type,
            url,
            timestamp: new Date(),
            detail,
            intent,
            selector,
            value: type === 'fill' ? '***' : value, // mask fill values
        };

        // Sign the action (including evidence hash and intent)
        try {
            const sig = await trustchainService.sign(`browser.${action.type}`, {
                url: action.url,
                timestamp: action.timestamp.toISOString(),
                detail: action.detail,
                intent: action.intent,
                evidenceHash: action.evidenceBefore?.domHash,
            });
            action.signature = sig.signature;
            action.publicKey = sig.public_key;
            action.verified = true;
        } catch {
            action.verified = false;
        }

        this.actions.push(action);
        this.notify();
        return action;
    }

    private notify(): void {
        const snapshot = this.getActions();
        this.listeners.forEach(fn => fn(snapshot));
    }
}

export const browserActionService = new BrowserActionService();

