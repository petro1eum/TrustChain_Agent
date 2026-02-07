/**
 * Gap G: Browser Service — Headless Web Browsing
 *
 * Интеграция с headless браузером для навигации, скриншотов,
 * извлечения контента и взаимодействия с веб-страницами.
 * 
 * Работает через bash_tool в Docker (Playwright).
 */

// ─── Типы ───

export interface BrowserAction {
    type: 'navigate' | 'screenshot' | 'extract' | 'click' | 'fill' | 'wait';
    params: Record<string, any>;
}

export interface BrowserResult {
    success: boolean;
    data?: any;
    screenshot?: string; // base64
    error?: string;
    url?: string;
    title?: string;
}

export interface BrowserConfig {
    headless: boolean;
    timeout: number;
    viewport: { width: number; height: number };
    userAgent?: string;
    /** Path to persist cookies/localStorage between sessions */
    storageStatePath?: string;
    /** Custom cookies to inject */
    cookies?: Array<{ name: string; value: string; domain: string; path?: string }>;
}

// ─── Константы ───

const DEFAULT_CONFIG: BrowserConfig = {
    headless: true,
    timeout: 30000,
    viewport: { width: 1280, height: 720 },
    storageStatePath: '/tmp/pw-storage-state.json'
};

// ─── Сервис ───

export class BrowserService {
    private config: BrowserConfig;

    constructor(config?: Partial<BrowserConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Генерирует bash-команду для Playwright действия
     */
    generatePlaywrightCommand(action: BrowserAction): string {
        const baseCmd = 'npx playwright';

        switch (action.type) {
            case 'navigate':
                return `${baseCmd} open "${action.params.url}" --browser chromium`;

            case 'screenshot':
                return this.buildScreenshotScript(action.params.url, action.params.outputPath);

            case 'extract':
                return this.buildExtractScript(action.params.url, action.params.selector);

            case 'click':
                return this.buildClickScript(action.params.url, action.params.selector);

            case 'fill':
                return this.buildFillScript(
                    action.params.url,
                    action.params.selector,
                    action.params.value
                );

            default:
                return `echo "Unknown browser action: ${action.type}"`;
        }
    }

    /**
     * Генерирует Playwright скрипт для скриншота
     */
    private buildScreenshotScript(url: string, outputPath: string = '/tmp/screenshot.png'): string {
        return `node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: ${JSON.stringify(this.config.viewport)} });
  await page.goto('${url}', { waitUntil: 'networkidle', timeout: ${this.config.timeout} });
  await page.screenshot({ path: '${outputPath}', fullPage: true });
  console.log(JSON.stringify({ title: await page.title(), url: page.url() }));
  await browser.close();
})();"`;
    }

    /**
     * Генерирует Playwright скрипт для извлечения контента
     */
    private buildExtractScript(url: string, selector?: string): string {
        const selectorCode = selector
            ? `await page.locator('${selector}').textContent()`
            : `await page.content()`;

        return `node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('${url}', { waitUntil: 'networkidle', timeout: ${this.config.timeout} });
  const content = ${selectorCode};
  console.log(JSON.stringify({ title: await page.title(), url: page.url(), content }));
  await browser.close();
})();"`;
    }

    /**
     * Генерирует Playwright скрипт для клика
     */
    private buildClickScript(url: string, selector: string): string {
        return `node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('${url}', { waitUntil: 'networkidle', timeout: ${this.config.timeout} });
  await page.click('${selector}');
  await page.waitForLoadState('networkidle');
  const content = await page.content();
  console.log(JSON.stringify({ title: await page.title(), url: page.url(), clicked: true }));
  await browser.close();
})();"`;
    }

    /**
     * Генерирует Playwright скрипт для заполнения формы
     */
    private buildFillScript(url: string, selector: string, value: string): string {
        return `node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('${url}', { waitUntil: 'networkidle', timeout: ${this.config.timeout} });
  await page.fill('${selector}', '${value}');
  console.log(JSON.stringify({ title: await page.title(), url: page.url(), filled: true }));
  await browser.close();
})();"`;
    }

    /**
     * Парсит результат Playwright скрипта
     */
    parseResult(output: string): BrowserResult {
        try {
            const lines = output.trim().split('\n');
            const lastLine = lines[lines.length - 1];
            const data = JSON.parse(lastLine);
            return {
                success: true,
                data,
                url: data.url,
                title: data.title
            };
        } catch {
            return {
                success: false,
                error: output.slice(0, 500)
            };
        }
    }

    /**
     * Возвращает tool definitions для OpenAI function calling
     */
    getToolDefinitions(): Array<{ type: 'function'; function: any }> {
        return [
            {
                type: 'function',
                function: {
                    name: 'browser_navigate',
                    description: 'Navigate to a URL and get page content',
                    parameters: {
                        type: 'object',
                        properties: {
                            url: { type: 'string', description: 'URL to navigate to' }
                        },
                        required: ['url']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'browser_screenshot',
                    description: 'Take a screenshot of a web page',
                    parameters: {
                        type: 'object',
                        properties: {
                            url: { type: 'string', description: 'URL to screenshot' },
                            outputPath: { type: 'string', description: 'Path to save screenshot' }
                        },
                        required: ['url']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'browser_extract',
                    description: 'Extract text content from a web page, optionally using a CSS selector',
                    parameters: {
                        type: 'object',
                        properties: {
                            url: { type: 'string', description: 'URL to extract from' },
                            selector: { type: 'string', description: 'Optional CSS selector' }
                        },
                        required: ['url']
                    }
                }
            }
        ];
    }
}
