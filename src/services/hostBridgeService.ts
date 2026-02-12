/**
 * Host Bridge Service
 * Enables TrustChain Agent (iframe) to communicate with the host application
 * via postMessage round-trip pattern.
 * 
 * Flow: Agent → postMessage(trustchain:bridge) → Host → postMessage(trustchain:bridge_result) → Agent
 */

export interface PageState {
    activeSection: string;
    activeSubSection?: string;
    visibleRecords: Array<{
        id: string;
        title: string;
        status?: string;
        date?: string;
        extra?: Record<string, any>;
    }>;
    recordCount: number;
    selectedRecord: any | null;
    openModals: string[];
    searchQuery: string;
    url?: string;
}

export interface BridgeResponse {
    requestId: string;
    method: string;
    version?: number;
    source?: string;
    success: boolean;
    data: any;
    error?: string | { code?: string; message?: string; details?: any };
}

type PendingRequest = {
    resolve: (value: BridgeResponse) => void;
    reject: (reason: any) => void;
    timer: ReturnType<typeof setTimeout>;
};

export class HostBridgeService {
    private pending = new Map<string, PendingRequest>();
    private static instance: HostBridgeService | null = null;
    private listenerAttached = false;
    private targetOrigin: string = '*';
    private protocolVersion = 2;
    private source = 'trustchain-panel';

    static getInstance(): HostBridgeService {
        if (!HostBridgeService.instance) {
            HostBridgeService.instance = new HostBridgeService();
        }
        return HostBridgeService.instance;
    }

    configure(opts: { targetOrigin?: string; version?: number; source?: string }): void {
        if (opts.targetOrigin) this.targetOrigin = opts.targetOrigin;
        if (opts.version) this.protocolVersion = opts.version;
        if (opts.source) this.source = opts.source;
    }

    /**
     * Attach the response listener. Must be called once from PanelApp.
     */
    attachListener(): void {
        if (this.listenerAttached) return;
        window.addEventListener('message', (e: MessageEvent) => {
            if (this.targetOrigin !== '*' && e.origin !== this.targetOrigin) return;
            if (e.data?.type === 'trustchain:bridge_result') {
                this.handleResponse(e.data as BridgeResponse);
            }
        });
        this.listenerAttached = true;
        console.log('[HostBridge] Listener attached');
    }

    /**
     * Observe the current page state (what's visible on screen).
     */
    async observe(): Promise<PageState> {
        const response = await this.sendRequest('observe', {});
        return response.data as PageState;
    }

    /**
     * Read a specific entity from the page.
     * @param target - Entity ID, CSS selector, row number, or natural description
     */
    async read(target: string): Promise<any> {
        const response = await this.sendRequest('read', { target });
        return response.data;
    }

    /**
     * Interact with the page UI.
     * @param action - 'click' | 'navigate' | 'open' | 'scroll' | 'select' | 'close'
     * @param target - What to interact with
     */
    async interact(action: string, target: string): Promise<any> {
        const response = await this.sendRequest('interact', { action, target });
        return response.data;
    }

    // ── Internal ──

    private sendRequest(method: string, params: Record<string, any>, timeoutMs = 5000): Promise<BridgeResponse> {
        return new Promise((resolve, reject) => {
            const requestId = `bridge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                // Return a graceful fallback instead of rejecting
                resolve({
                    requestId,
                    method,
                    version: this.protocolVersion,
                    source: this.source,
                    success: false,
                    data: null,
                    error: {
                        code: 'BRIDGE_TIMEOUT',
                        message: `Host did not respond within ${timeoutMs}ms. The host app may not support the bridge protocol.`,
                    }
                });
            }, timeoutMs);

            this.pending.set(requestId, { resolve, reject, timer });

            try {
                window.parent.postMessage({
                    type: 'trustchain:bridge',
                    version: this.protocolVersion,
                    source: this.source,
                    timestamp: new Date().toISOString(),
                    requestId,
                    method,
                    params,
                }, this.targetOrigin);
                console.log('[HostBridge] Sent request:', method, params);
            } catch (err) {
                clearTimeout(timer);
                this.pending.delete(requestId);
                resolve({
                    requestId,
                    method,
                    version: this.protocolVersion,
                    source: this.source,
                    success: false,
                    data: null,
                    error: {
                        code: 'POSTMESSAGE_FAILED',
                        message: `Failed to send postMessage: ${err}`
                    }
                });
            }
        });
    }

    private handleResponse(response: BridgeResponse): void {
        const pending = this.pending.get(response.requestId);
        if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(response.requestId);
            pending.resolve(response);
            console.log('[HostBridge] Received response:', response.method, response.success);
        }
    }
}
