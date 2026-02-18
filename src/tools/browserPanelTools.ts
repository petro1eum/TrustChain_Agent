/**
 * Browser Panel Tools — Agent-controlled embedded browser.
 * 
 * Full interaction toolkit: navigate, click, scroll, fill forms,
 * read page content, screenshot — all in the user-visible panel.
 * 
 * Unlike browser_navigate/browser_screenshot (Playwright headless),
 * these tools control the VISIBLE iframe panel that the user can see.
 * Every action gets an Ed25519 signature in the TrustChain audit log.
 */

import { browserActionService } from '../services/browserActionService';

// ─── Tool Definitions ───

export const browserPanelTools = [
    // ── Navigation ──
    {
        type: 'function' as const,
        function: {
            name: 'browser_panel_open',
            description: 'Open a URL in the TrustChain Browser panel (visible to the user). Use when the user asks to "show me a page" or "open a website". Action is cryptographically signed.',
            parameters: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'Full URL to open (e.g. https://example.com)' },
                    intent: { type: 'string', description: 'Why you are opening this page (for audit trail)' },
                },
                required: ['url'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'browser_panel_search',
            description: 'Search the web and show results in the embedded browser panel. Uses DuckDuckGo.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search query' },
                },
                required: ['query'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'browser_panel_back',
            description: 'Navigate back in the browser panel history.',
            parameters: { type: 'object', properties: {}, required: [] },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'browser_panel_forward',
            description: 'Navigate forward in the browser panel history.',
            parameters: { type: 'object', properties: {}, required: [] },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'browser_panel_refresh',
            description: 'Refresh/reload the current page in the browser panel.',
            parameters: { type: 'object', properties: {}, required: [] },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'browser_panel_close',
            description: 'Close the TrustChain Browser panel.',
            parameters: { type: 'object', properties: {}, required: [] },
        },
    },

    // ── Interaction ──
    {
        type: 'function' as const,
        function: {
            name: 'browser_panel_click',
            description: 'Click at specific coordinates or a CSS selector in the browser panel iframe. Coordinates are relative to the iframe viewport.',
            parameters: {
                type: 'object',
                properties: {
                    x: { type: 'number', description: 'X coordinate to click (pixels from left)' },
                    y: { type: 'number', description: 'Y coordinate to click (pixels from top)' },
                    selector: { type: 'string', description: 'CSS selector of element to click (alternative to coordinates)' },
                },
                required: [],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'browser_panel_scroll',
            description: 'Scroll the page in the browser panel.',
            parameters: {
                type: 'object',
                properties: {
                    direction: {
                        type: 'string',
                        enum: ['up', 'down', 'top', 'bottom'],
                        description: 'Scroll direction: up/down (by amount), top/bottom (to edge)',
                    },
                    amount: {
                        type: 'number',
                        description: 'Pixels to scroll (default 500). Ignored for top/bottom.',
                    },
                },
                required: ['direction'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'browser_panel_fill',
            description: 'Fill a form field in the browser panel by CSS selector.',
            parameters: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'CSS selector of the input element' },
                    value: { type: 'string', description: 'Value to fill into the field' },
                },
                required: ['selector', 'value'],
            },
        },
    },

    // ── Read / Observe ──
    {
        type: 'function' as const,
        function: {
            name: 'browser_panel_read',
            description: 'Read the visible text content of the current page in the browser panel. Returns the page text, title, URL, and selected element info.',
            parameters: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'Optional CSS selector to read specific element text (default: entire body)' },
                },
                required: [],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'browser_panel_status',
            description: 'Get the current state of the browser panel: URL, title, loading, history, action count.',
            parameters: { type: 'object', properties: {}, required: [] },
        },
    },
];

/** Tool names for routing */
export const BROWSER_PANEL_TOOL_NAMES = new Set(
    browserPanelTools.map(t => t.function.name)
);

// ─── Execution ───

export async function executeBrowserPanelTool(
    name: string,
    args: Record<string, any>,
): Promise<Record<string, any>> {
    switch (name) {
        // ── Navigation ──

        case 'browser_panel_open': {
            const url = args.url as string;
            if (!url) return { success: false, message: 'URL is required' };

            await browserActionService.navigate(url);
            browserActionService.dispatchCommand({ type: 'navigate', url });

            const whitelisted = browserActionService.isWhitelisted(url);
            return {
                success: true,
                url,
                message: whitelisted
                    ? `Opened ${url} in browser panel (signed).`
                    : `Opened ${url} — site may block iframe embedding.`,
            };
        }

        case 'browser_panel_search': {
            const query = args.query as string;
            if (!query) return { success: false, message: 'Search query is required' };

            const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
            await browserActionService.navigate(searchUrl);
            browserActionService.dispatchCommand({ type: 'search', url: searchUrl, query });

            return { success: true, url: searchUrl, message: `Searching "${query}" (signed).` };
        }

        case 'browser_panel_back': {
            browserActionService.dispatchCommand({ type: 'back' });
            return { success: true, message: 'Navigated back.' };
        }

        case 'browser_panel_forward': {
            browserActionService.dispatchCommand({ type: 'forward' });
            return { success: true, message: 'Navigated forward.' };
        }

        case 'browser_panel_refresh': {
            browserActionService.dispatchCommand({ type: 'refresh' });
            return { success: true, message: 'Page refreshed.' };
        }

        case 'browser_panel_close': {
            browserActionService.dispatchCommand({ type: 'close' });
            return { success: true, message: 'Browser panel closed.' };
        }

        // ── Interaction ──

        case 'browser_panel_click': {
            const { x, y, selector } = args;
            if (!selector && (x === undefined || y === undefined)) {
                return { success: false, message: 'Provide either (x, y) coordinates or a CSS selector.' };
            }

            await browserActionService.navigate(browserActionService.getState().url);
            const response = await browserActionService.dispatchCommandAsync({
                type: 'click', x, y, selector,
            });

            return {
                success: response.success,
                message: response.success
                    ? `Clicked ${selector ? `on "${selector}"` : `at (${x}, ${y})`} (signed).`
                    : `Click failed: ${response.error}`,
                ...response.data,
            };
        }

        case 'browser_panel_scroll': {
            const direction = args.direction as string;
            const amount = args.amount ?? 500;

            browserActionService.dispatchCommand({
                type: 'scroll',
                scrollDirection: direction as any,
                scrollAmount: amount,
            });

            return { success: true, message: `Scrolled ${direction} ${direction === 'top' || direction === 'bottom' ? '' : `${amount}px`}.` };
        }

        case 'browser_panel_fill': {
            const { selector, value } = args;
            if (!selector || value === undefined) {
                return { success: false, message: 'Both selector and value are required.' };
            }

            const response = await browserActionService.dispatchCommandAsync({
                type: 'fill', selector, value,
            });

            return {
                success: response.success,
                message: response.success
                    ? `Filled "${selector}" with value (signed).`
                    : `Fill failed: ${response.error}`,
            };
        }

        // ── Read / Observe ──

        case 'browser_panel_read': {
            const response = await browserActionService.dispatchCommandAsync({
                type: 'read_page',
                selector: args.selector,
            }, 8000);

            if (!response.success) {
                return {
                    success: false,
                    message: `Could not read page: ${response.error}. This may be due to cross-origin restrictions.`,
                };
            }

            return {
                success: true,
                url: response.data?.url,
                title: response.data?.title,
                text: response.data?.text,
                message: `Read page content (${response.data?.text?.length || 0} chars).`,
            };
        }

        case 'browser_panel_status': {
            const state = browserActionService.getState();
            const actions = browserActionService.getActions();
            const signedCount = actions.filter(a => a.verified).length;
            return {
                success: true,
                url: state.url || undefined,
                title: state.title,
                isLoading: state.isLoading,
                canGoBack: state.canGoBack,
                canGoForward: state.canGoForward,
                historyLength: state.history.length,
                signedActions: signedCount,
                message: state.url
                    ? `Currently viewing: ${state.title} (${state.url}). ${signedCount} signed actions.`
                    : 'Browser panel open — no page loaded (welcome screen).',
                recentActions: actions.slice(-5).map(a => ({
                    type: a.type, url: a.url, detail: a.detail,
                    verified: a.verified, time: a.timestamp.toISOString(),
                })),
            };
        }

        default:
            return { success: false, message: `Unknown browser panel tool: ${name}` };
    }
}
