/**
 * Browser Panel Tools — Agent-controlled embedded browser.
 * 
 * HYBRID architecture:
 *   • iframe panel — for VISUAL display (user sees the page)
 *   • Playwright MCP — for INTERACTION (click, fill, read, scroll)
 * 
 * Navigation commands go to both: iframe shows the page, Playwright syncs.
 * Interaction commands go through Playwright (full DOM access, no cross-origin limits).
 * If Playwright is unavailable, falls back to iframe contentDocument (same-origin only).
 *
 * Every action gets an Ed25519 signature in the TrustChain audit log.
 */

import { browserActionService } from '../services/browserActionService';
import type { MCPClientService } from '../services/agents/mcpClientService';

// ─── Tool Definitions ───

export const browserPanelTools = [
    // ── Navigation ──
    {
        type: 'function' as const,
        function: {
            name: 'browser_panel_open',
            description: 'Open a URL in the TrustChain Browser panel (visible to the user). Also syncs the headless Playwright browser for interaction. Use when the user asks to "show me a page" or "open a website". Action is cryptographically signed.',
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
            description: 'Search the web and show results in the embedded browser panel. Uses Google by default.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search query' },
                    engine: { type: 'string', enum: ['google', 'duckduckgo', 'yandex'], description: 'Search engine (default: google)' },
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

    // ── Interaction (via Playwright when available) ──
    {
        type: 'function' as const,
        function: {
            name: 'browser_panel_click',
            description: 'Click an element on the current page. Uses Playwright headless browser for reliable cross-origin interaction. Provide either a CSS selector or descriptive text of the element to click.',
            parameters: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'CSS selector of element to click (e.g. "button.search", "#submit")' },
                    text: { type: 'string', description: 'Visible text of the element to click (e.g. "Search", "Log in"). Playwright will find by text content.' },
                    ref: { type: 'string', description: 'Element ref from a previous browser_panel_snapshot result' },
                    x: { type: 'number', description: 'X coordinate to click (pixels, fallback)' },
                    y: { type: 'number', description: 'Y coordinate to click (pixels, fallback)' },
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
            description: 'Fill a form field on the page. Uses Playwright for reliable cross-origin interaction.',
            parameters: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'CSS selector of the input element' },
                    ref: { type: 'string', description: 'Element ref from a previous browser_panel_snapshot result' },
                    value: { type: 'string', description: 'Value to type into the field' },
                },
                required: ['value'],
            },
        },
    },

    // ── Read / Observe ──
    {
        type: 'function' as const,
        function: {
            name: 'browser_panel_read',
            description: 'Read the page content using Playwright accessibility snapshot. Returns structured text of what is visible on the page. Works on any site regardless of cross-origin restrictions.',
            parameters: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'Optional CSS selector to read specific element text (default: entire page)' },
                },
                required: [],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'browser_panel_snapshot',
            description: 'Get an accessibility snapshot of the current page via Playwright. Returns element refs that can be used in click/fill/select actions. Essential for interacting with complex pages.',
            parameters: {
                type: 'object',
                properties: {},
                required: [],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'browser_panel_screenshot',
            description: 'Take a screenshot of the current page via Playwright. Returns a base64-encoded image.',
            parameters: {
                type: 'object',
                properties: {},
                required: [],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'sandbox_screenshot',
            description: 'Take a raw X11 screenshot of the entire VNC Docker sandbox. Essential for seeing GUI applications like LibreOffice or terminal windows that are invisible to the DOM browser.',
            parameters: {
                type: 'object',
                properties: {},
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

// ─── Playwright MCP Helper ───

/**
 * Try to call a Playwright MCP tool.
 * Returns null if Playwright is not connected.
 */
async function callPlaywright(
    mcpClient: MCPClientService | undefined,
    toolName: string,
    args: Record<string, any>,
): Promise<any | null> {
    if (!mcpClient) return null;

    // Check if Playwright is connected
    const connections = mcpClient.getConnections?.() || [];
    const pwConn = Array.isArray(connections)
        ? connections.find((c: any) => c.config?.id === 'playwright' && c.status === 'connected')
        : null;

    if (!pwConn) return null;

    try {
        console.log(`[BrowserPanel→Playwright] Calling ${toolName}`, args);
        const result = await mcpClient.callTool('playwright', toolName, args);
        console.log(`[BrowserPanel→Playwright] ${toolName} result:`, typeof result === 'string' ? result.slice(0, 200) : '(object)');
        return result;
    } catch (err: any) {
        console.warn(`[BrowserPanel→Playwright] ${toolName} failed:`, err.message);
        return null;
    }
}

/**
 * Extract text content from Playwright MCP response.
 */
function extractPlaywrightText(result: any): string {
    if (!result) return '';
    if (typeof result === 'string') return result;
    if (Array.isArray(result)) {
        return result
            .filter((c: any) => c?.type === 'text')
            .map((c: any) => c.text || '')
            .join('\n');
    }
    if (result.content) return extractPlaywrightText(result.content);
    if (result.text) return String(result.text);
    return JSON.stringify(result).slice(0, 2000);
}

// ─── Execution ───

export async function executeBrowserPanelTool(
    name: string,
    args: Record<string, any>,
    mcpClient?: MCPClientService,
): Promise<Record<string, any>> {
    switch (name) {
        // ── Navigation ──

        case 'browser_panel_open': {
            const url = args.url as string;
            if (!url) return { success: false, message: 'URL is required' };

            // 1. Show in iframe panel (visual)
            await browserActionService.navigate(url);
            browserActionService.dispatchCommand({ type: 'navigate', url });

            // 2. Sync Playwright headless browser to same URL
            const pwResult = await callPlaywright(mcpClient, 'browser_navigate', { url });

            const whitelisted = browserActionService.isWhitelisted(url);
            return {
                success: true,
                url,
                playwrightSynced: !!pwResult,
                message: whitelisted
                    ? `Opened ${url} in browser panel (signed).${pwResult ? ' Playwright synced — you can now click/fill/read on this page.' : ''}`
                    : `Opened ${url} — site may block iframe embedding.${pwResult ? ' Playwright synced for interaction.' : ''}`,
            };
        }

        case 'browser_panel_search': {
            const query = args.query as string;
            if (!query) return { success: false, message: 'Search query is required' };

            const engine = (args.engine as string) || 'google';
            let searchUrl: string;
            // The UI proxy gets blocked by Google (429 Too Many Requests). 
            // We map the visual proxy to DuckDuckGo to guarantee the user sees results.
            switch (engine) {
                case 'yandex':
                    searchUrl = `https://yandex.ru/search/?text=${encodeURIComponent(query)}`;
                    break;
                case 'google':
                case 'duckduckgo':
                default:
                    searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
            }
            await browserActionService.navigate(searchUrl);
            browserActionService.dispatchCommand({ type: 'search', url: searchUrl, query });

            // Sync Playwright - Playwright can use Google fine because it's a real browser
            const headlessSearchUrl = engine === 'google'
                ? `https://www.google.com/search?q=${encodeURIComponent(query)}`
                : searchUrl;
            await callPlaywright(mcpClient, 'browser_navigate', { url: headlessSearchUrl });

            return { success: true, url: headlessSearchUrl, engine, message: `Searching "${query}" via ${engine} (signed).` };
        }

        case 'browser_panel_back': {
            browserActionService.dispatchCommand({ type: 'back' });
            await callPlaywright(mcpClient, 'browser_go_back', {});
            return { success: true, message: 'Navigated back.' };
        }

        case 'browser_panel_forward': {
            browserActionService.dispatchCommand({ type: 'forward' });
            await callPlaywright(mcpClient, 'browser_go_forward', {});
            return { success: true, message: 'Navigated forward.' };
        }

        case 'browser_panel_refresh': {
            browserActionService.dispatchCommand({ type: 'refresh' });
            return { success: true, message: 'Page refreshed.' };
        }

        case 'browser_panel_close': {
            browserActionService.dispatchCommand({ type: 'close' });
            await callPlaywright(mcpClient, 'browser_close', {});
            return { success: true, message: 'Browser panel closed.' };
        }

        // ── Interaction (Playwright-first, iframe fallback) ──

        case 'browser_panel_click': {
            const { selector, text, ref, x, y } = args;

            // Try Playwright first
            if (mcpClient) {
                // If we have a ref from snapshot, use it directly
                if (ref) {
                    const pwResult = await callPlaywright(mcpClient, 'browser_click', { element: ref, ref });
                    if (pwResult !== null) {
                        return {
                            success: true,
                            via: 'playwright',
                            message: `Clicked element ref="${ref}" via Playwright.`,
                            result: extractPlaywrightText(pwResult),
                        };
                    }
                }
                // If we have text, use Playwright's text-based selector
                if (text) {
                    const pwResult = await callPlaywright(mcpClient, 'browser_click', {
                        element: `text="${text}"`, ref: text,
                    });
                    if (pwResult !== null) {
                        return {
                            success: true,
                            via: 'playwright',
                            message: `Clicked "${text}" via Playwright.`,
                            result: extractPlaywrightText(pwResult),
                        };
                    }
                }
                // If we have a CSS selector, use Playwright
                if (selector) {
                    const pwResult = await callPlaywright(mcpClient, 'browser_click', {
                        element: selector, ref: selector,
                    });
                    if (pwResult !== null) {
                        return {
                            success: true,
                            via: 'playwright',
                            message: `Clicked "${selector}" via Playwright.`,
                            result: extractPlaywrightText(pwResult),
                        };
                    }
                }
                // Coordinate-based click via Playwright
                if (x !== undefined && y !== undefined) {
                    const pwResult = await callPlaywright(mcpClient, 'browser_click', {
                        element: `coordinates [${x}, ${y}]`, ref: `[${x},${y}]`,
                    });
                    if (pwResult !== null) {
                        return {
                            success: true,
                            via: 'playwright',
                            message: `Clicked at (${x}, ${y}) via Playwright.`,
                            result: extractPlaywrightText(pwResult),
                        };
                    }
                }
            }

            // Fallback: iframe contentDocument (same-origin only)
            if (!selector && (x === undefined || y === undefined)) {
                return { success: false, message: 'Provide selector, text, ref, or (x, y) coordinates. Playwright MCP is not connected — interaction requires it for cross-origin sites.' };
            }

            await browserActionService.navigate(browserActionService.getState().url);
            const response = await browserActionService.dispatchCommandAsync({
                type: 'click', x, y, selector,
            });

            return {
                success: response.success,
                via: 'iframe',
                message: response.success
                    ? `Clicked ${selector ? `on "${selector}"` : `at (${x}, ${y})`} via iframe.`
                    : `Click failed: ${response.error}. Consider using Playwright MCP for cross-origin pages.`,
                ...response.data,
            };
        }

        case 'browser_panel_scroll': {
            const direction = args.direction as string;
            const amount = args.amount ?? 500;

            // Try Playwright scroll
            if (mcpClient) {
                const scrollMap: Record<string, [number, number]> = {
                    'down': [0, amount],
                    'up': [0, -amount],
                    'top': [0, -99999],
                    'bottom': [0, 99999],
                };
                const [dx, dy] = scrollMap[direction] || [0, amount];
                const pwResult = await callPlaywright(mcpClient, 'browser_evaluate', {
                    expression: `window.scrollBy(${dx}, ${dy}); JSON.stringify({ scrollY: window.scrollY, scrollHeight: document.documentElement.scrollHeight })`,
                });
                if (pwResult !== null) {
                    return {
                        success: true,
                        via: 'playwright',
                        message: `Scrolled ${direction} ${direction === 'top' || direction === 'bottom' ? '' : `${amount}px`} via Playwright.`,
                        result: extractPlaywrightText(pwResult),
                    };
                }
            }

            // Fallback: iframe
            browserActionService.dispatchCommand({
                type: 'scroll',
                scrollDirection: direction as any,
                scrollAmount: amount,
            });

            return { success: true, via: 'iframe', message: `Scrolled ${direction} ${direction === 'top' || direction === 'bottom' ? '' : `${amount}px`}.` };
        }

        case 'browser_panel_fill': {
            const { selector, ref, value } = args;
            if (value === undefined) {
                return { success: false, message: 'value is required.' };
            }

            // Try Playwright first
            if (mcpClient) {
                const element = ref || selector;
                if (element) {
                    const pwResult = await callPlaywright(mcpClient, 'browser_type', {
                        element, ref: element, text: value,
                    });
                    if (pwResult !== null) {
                        // Press Enter after typing if it looks like a search
                        return {
                            success: true,
                            via: 'playwright',
                            message: `Filled "${element}" with "${value}" via Playwright.`,
                            result: extractPlaywrightText(pwResult),
                        };
                    }
                }
            }

            // Fallback: iframe
            if (!selector) {
                return { success: false, message: 'selector or ref is required. Playwright MCP not connected.' };
            }

            const response = await browserActionService.dispatchCommandAsync({
                type: 'fill', selector, value,
            });

            return {
                success: response.success,
                via: 'iframe',
                message: response.success
                    ? `Filled "${selector}" with value via iframe.`
                    : `Fill failed: ${response.error}. Consider using Playwright MCP for cross-origin pages.`,
            };
        }

        // ── Read / Observe ──

        case 'browser_panel_read': {
            // Try Playwright accessibility snapshot first (works cross-origin)
            if (mcpClient) {
                const pwResult = await callPlaywright(mcpClient, 'browser_snapshot', {});
                if (pwResult !== null) {
                    const text = extractPlaywrightText(pwResult);
                    return {
                        success: true,
                        via: 'playwright',
                        url: browserActionService.getState().url,
                        text,
                        message: `Read page content via Playwright snapshot (${text.length} chars).`,
                    };
                }
            }

            // Fallback: iframe contentDocument (same-origin only)
            const response = await browserActionService.dispatchCommandAsync({
                type: 'read_page',
                selector: args.selector,
            }, 8000);

            if (!response.success) {
                return {
                    success: false,
                    message: `Could not read page: ${response.error}. Start Playwright MCP (npx @playwright/mcp@latest --port 8931) for cross-origin page reading.`,
                };
            }

            return {
                success: true,
                via: 'iframe',
                url: response.data?.url,
                title: response.data?.title,
                text: response.data?.text,
                message: `Read page content (${response.data?.text?.length || 0} chars).`,
            };
        }

        case 'browser_panel_snapshot': {
            if (!mcpClient) {
                return {
                    success: false,
                    message: 'Playwright MCP is required for page snapshots. Start it with: npx @playwright/mcp@latest --port 8931',
                };
            }
            const pwResult = await callPlaywright(mcpClient, 'browser_snapshot', {});
            if (pwResult === null) {
                return { success: false, message: 'Playwright MCP not connected or snapshot failed.' };
            }
            const text = extractPlaywrightText(pwResult);
            return {
                success: true,
                via: 'playwright',
                snapshot: text,
                message: `Page snapshot captured (${text.length} chars). Use element refs from this snapshot in click/fill/select actions.`,
            };
        }

        case 'browser_panel_screenshot': {
            if (!mcpClient) {
                return {
                    success: false,
                    message: 'Playwright MCP is required for screenshots. Start it with: npx @playwright/mcp@latest --port 8931',
                };
            }
            const pwResult = await callPlaywright(mcpClient, 'browser_screenshot', {});
            if (pwResult === null) {
                return { success: false, message: 'Playwright MCP not connected or screenshot failed.' };
            }
            return {
                success: true,
                via: 'playwright',
                result: pwResult,
                message: 'Screenshot captured via Playwright.',
            };
        }

        case 'sandbox_screenshot': {
            try {
                // Determine API URL based on environment
                const apiUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_URL)
                    ? import.meta.env.VITE_BACKEND_URL
                    : 'http://localhost:8000';

                const response = await fetch(`${apiUrl}/api/sandbox/screenshot`);
                if (!response.ok) throw new Error(`HTTP ${response.status}: Failed to fetch X11 screenshot`);

                const arrayBuffer = await response.arrayBuffer();
                // Check if buffer is valid
                if (!arrayBuffer || arrayBuffer.byteLength === 0) {
                    throw new Error('Received empty image buffer from sandbox');
                }

                // Polyfill Buffer conversion for browser environment
                let base64 = '';
                const bytes = new Uint8Array(arrayBuffer);
                for (let i = 0; i < bytes.byteLength; i++) {
                    base64 += String.fromCharCode(bytes[i]);
                }
                const b64encoded = btoa(base64);

                return {
                    success: true,
                    via: 'x11',
                    result: {
                        content: [
                            { type: "image", data: b64encoded, mimeType: "image/png" }
                        ]
                    },
                    message: 'Raw X11 Sandbox Screenshot captured successfully. You can now see LibreOffice and all windows.',
                };
            } catch (err: any) {
                return { success: false, message: 'Sandbox screenshot failed: ' + err.message };
            }
        }

        case 'browser_panel_status': {
            const state = browserActionService.getState();
            const actions = browserActionService.getActions();
            const signedCount = actions.filter(a => a.verified).length;

            // Check Playwright status
            let playwrightConnected = false;
            if (mcpClient) {
                const connections = mcpClient.getConnections?.() || [];
                playwrightConnected = Array.isArray(connections)
                    && connections.some((c: any) => c.config?.id === 'playwright' && c.status === 'connected');
            }

            return {
                success: true,
                url: state.url || undefined,
                title: state.title,
                isLoading: state.isLoading,
                canGoBack: state.canGoBack,
                canGoForward: state.canGoForward,
                historyLength: state.history.length,
                signedActions: signedCount,
                playwrightConnected,
                message: state.url
                    ? `Currently viewing: ${state.title} (${state.url}). ${signedCount} signed actions. Playwright: ${playwrightConnected ? '✅ connected' : '❌ not connected'}.`
                    : `Browser panel open — no page loaded. Playwright: ${playwrightConnected ? '✅ connected' : '❌ not connected'}.`,
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
