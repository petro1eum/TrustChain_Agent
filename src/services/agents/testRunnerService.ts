/**
 * Gap E: Test Runner Service — Auto-run tests after code changes
 * 
 * Определяет тестовый фреймворк, запускает тесты через bash_tool,
 * парсит результаты и подготавливает контекст для self-correction.
 */

// ─── Типы ───

export interface TestFailure {
    testName: string;
    message: string;
    file?: string;
    line?: number;
    expected?: string;
    actual?: string;
}

export interface TestResult {
    framework: string;
    passed: number;
    failed: number;
    skipped: number;
    total: number;
    failures: TestFailure[];
    duration: number; // ms
    rawOutput: string;
    success: boolean;
}

export interface TestRunnerConfig {
    maxAutoCorrections: number;
    runOnCodeChange: boolean;
    testTimeout: number; // ms
}

// ─── Константы ───

const DEFAULT_CONFIG: TestRunnerConfig = {
    maxAutoCorrections: 2,
    runOnCodeChange: true,
    testTimeout: 60000 // 60 секунд
};

// Инструменты, которые модифицируют код
const CODE_MODIFYING_TOOLS = new Set([
    'bash_tool',
    'docker_agent/write',
    'docker_agent/str_replace',
    'create_artifact'
]);

// Паттерны файлов, которые считаются кодом
const CODE_FILE_PATTERNS = /\.(ts|tsx|js|jsx|py|go|rs|java|rb|php|vue|svelte)$/i;

// ─── Сервис ───

export class TestRunnerService {
    private config: TestRunnerConfig;
    private detectedFramework: string | null = null;
    private correctionCount: number = 0;

    constructor(config?: Partial<TestRunnerConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    // ──────────────────────────────────────────────
    // Framework Detection
    // ──────────────────────────────────────────────

    /**
     * Определяет тестовый фреймворк по содержимому проекта
     */
    detectTestFramework(packageJsonContent?: string): string {
        if (this.detectedFramework) return this.detectedFramework;

        if (packageJsonContent) {
            const pkg = typeof packageJsonContent === 'string'
                ? JSON.parse(packageJsonContent)
                : packageJsonContent;

            const deps = {
                ...pkg.devDependencies,
                ...pkg.dependencies
            };

            if (deps.vitest) {
                this.detectedFramework = 'vitest';
                return 'vitest';
            }
            if (deps.jest) {
                this.detectedFramework = 'jest';
                return 'jest';
            }
            if (deps.mocha) {
                this.detectedFramework = 'mocha';
                return 'mocha';
            }

            // Check scripts
            if (pkg.scripts?.test) {
                const testCmd = pkg.scripts.test;
                if (testCmd.includes('vitest')) return 'vitest';
                if (testCmd.includes('jest')) return 'jest';
                if (testCmd.includes('mocha')) return 'mocha';
                if (testCmd.includes('pytest')) return 'pytest';
            }
        }

        return 'unknown';
    }

    /**
     * Возвращает команду для запуска тестов
     */
    getTestCommand(framework?: string, scope?: string): string {
        const fw = framework || this.detectedFramework || 'unknown';

        switch (fw) {
            case 'vitest':
                return scope
                    ? `npx vitest run ${scope} --reporter=verbose`
                    : 'npx vitest run --reporter=verbose';
            case 'jest':
                return scope
                    ? `npx jest ${scope} --verbose`
                    : 'npx jest --verbose';
            case 'pytest':
                return scope
                    ? `python -m pytest ${scope} -v`
                    : 'python -m pytest -v';
            case 'go':
                return scope
                    ? `go test -v ${scope}`
                    : 'go test -v ./...';
            default:
                return 'npm test';
        }
    }

    // ──────────────────────────────────────────────
    // Test Output Parsing
    // ──────────────────────────────────────────────

    /**
     * Парсит вывод тестов в структурированный результат
     */
    parseTestResults(output: string, framework?: string): TestResult {
        const fw = framework || this.detectedFramework || 'unknown';
        const failures: TestFailure[] = [];
        let passed = 0;
        let failed = 0;
        let skipped = 0;

        switch (fw) {
            case 'vitest':
                ({ passed, failed, skipped } = this.parseVitestOutput(output, failures));
                break;
            case 'jest':
                ({ passed, failed, skipped } = this.parseJestOutput(output, failures));
                break;
            case 'pytest':
                ({ passed, failed, skipped } = this.parsePytestOutput(output, failures));
                break;
            default:
                // Generic: count lines with ✓/✗ or PASS/FAIL
                passed = (output.match(/✓|PASS|passed/gi) || []).length;
                failed = (output.match(/✗|✕|FAIL|failed/gi) || []).length;
        }

        return {
            framework: fw,
            passed,
            failed,
            skipped,
            total: passed + failed + skipped,
            failures,
            duration: this.extractDuration(output),
            rawOutput: output.slice(0, 5000), // Ограничиваем для контекста
            success: failed === 0
        };
    }

    private parseVitestOutput(output: string, failures: TestFailure[]): { passed: number; failed: number; skipped: number } {
        let passed = 0, failed = 0, skipped = 0;

        // Summary line: Tests  X passed | Y failed | Z skipped
        const summaryMatch = output.match(/Tests\s+(\d+)\s+passed.*?(\d+)\s+failed/);
        if (summaryMatch) {
            passed = parseInt(summaryMatch[1]);
            failed = parseInt(summaryMatch[2]);
        }

        const skipMatch = output.match(/(\d+)\s+skipped/);
        if (skipMatch) skipped = parseInt(skipMatch[1]);

        // Extract failures
        const failureBlocks = output.split(/FAIL\s+/);
        for (let i = 1; i < failureBlocks.length; i++) {
            const block = failureBlocks[i];
            const nameMatch = block.match(/^(.+?)[\n\r]/);
            const messageMatch = block.match(/Error:\s*(.+?)[\n\r]/);
            const fileMatch = block.match(/at\s+(.+?):(\d+)/);

            failures.push({
                testName: nameMatch?.[1]?.trim() || `Test ${i}`,
                message: messageMatch?.[1]?.trim() || 'Unknown error',
                file: fileMatch?.[1],
                line: fileMatch?.[2] ? parseInt(fileMatch[2]) : undefined
            });
        }

        return { passed, failed, skipped };
    }

    private parseJestOutput(output: string, failures: TestFailure[]): { passed: number; failed: number; skipped: number } {
        let passed = 0, failed = 0, skipped = 0;

        const summaryMatch = output.match(/Tests:\s+(\d+)\s+passed.*?(\d+)\s+failed/);
        if (summaryMatch) {
            passed = parseInt(summaryMatch[1]);
            failed = parseInt(summaryMatch[2]);
        } else {
            const passMatch = output.match(/Tests:\s+(\d+)\s+passed/);
            if (passMatch) passed = parseInt(passMatch[1]);
        }

        // Extract FAIL blocks
        const failLines = output.match(/●\s+(.+)/g);
        if (failLines) {
            for (const line of failLines) {
                const match = line.match(/●\s+(.+)/);
                failures.push({
                    testName: match?.[1]?.trim() || 'Unknown',
                    message: line
                });
            }
        }

        return { passed, failed, skipped };
    }

    private parsePytestOutput(output: string, failures: TestFailure[]): { passed: number; failed: number; skipped: number } {
        let passed = 0, failed = 0, skipped = 0;

        const summaryMatch = output.match(/(\d+)\s+passed.*?(\d+)\s+failed/);
        if (summaryMatch) {
            passed = parseInt(summaryMatch[1]);
            failed = parseInt(summaryMatch[2]);
        } else {
            const passMatch = output.match(/(\d+)\s+passed/);
            if (passMatch) passed = parseInt(passMatch[1]);
        }

        const skipMatch = output.match(/(\d+)\s+skipped/);
        if (skipMatch) skipped = parseInt(skipMatch[1]);

        // Extract FAILED tests
        const failedTests = output.match(/FAILED\s+(.+)/g);
        if (failedTests) {
            for (const line of failedTests) {
                const match = line.match(/FAILED\s+(.+?)(?:\s+-|$)/);
                failures.push({
                    testName: match?.[1]?.trim() || 'Unknown',
                    message: line
                });
            }
        }

        return { passed, failed, skipped };
    }

    private extractDuration(output: string): number {
        // Common patterns: "Time: 1.234s", "Duration: 1234ms", "in 1.23s"
        const match = output.match(/(?:Time|Duration|in)\s*:?\s*([\d.]+)\s*(s|ms|seconds)/i);
        if (match) {
            const value = parseFloat(match[1]);
            return match[2] === 'ms' ? value : value * 1000;
        }
        return 0;
    }

    // ──────────────────────────────────────────────
    // Decision Logic
    // ──────────────────────────────────────────────

    /**
     * Определяет, нужно ли запускать тесты после вызова инструмента
     */
    shouldAutoRunTests(toolName: string, args?: any): boolean {
        if (!this.config.runOnCodeChange) return false;

        // Прямые модификаторы кода
        if (CODE_MODIFYING_TOOLS.has(toolName)) {
            // Для bash_tool — проверяем, что команда модифицирует файлы
            if (toolName === 'bash_tool' && args?.command) {
                const cmd = args.command.toLowerCase();
                return /\b(sed|awk|tee|>|>>|mv|cp|rm|cat\s+>)\b/.test(cmd) &&
                    CODE_FILE_PATTERNS.test(cmd);
            }
            return true;
        }

        return false;
    }

    /**
     * Формирует контекст ошибок тестов для LLM self-correction
     */
    formatFailuresForCorrection(result: TestResult): string {
        if (result.success) return '';

        const lines = [`⚠️ Тесты провалены: ${result.failed} из ${result.total}\n`];

        for (const failure of result.failures.slice(0, 5)) { // Max 5 failures
            lines.push(`❌ ${failure.testName}`);
            lines.push(`   ${failure.message}`);
            if (failure.file) {
                lines.push(`   📁 ${failure.file}${failure.line ? `:${failure.line}` : ''}`);
            }
            lines.push('');
        }

        if (result.failures.length > 5) {
            lines.push(`...и ещё ${result.failures.length - 5} ошибок`);
        }

        return lines.join('\n');
    }

    /**
     * Проверяет, стоит ли пытаться автокоррекцию
     */
    canAutoCorrect(): boolean {
        return this.correctionCount < this.config.maxAutoCorrections;
    }

    /**
     * Инкрементирует счётчик автокоррекций
     */
    recordCorrectionAttempt(): void {
        this.correctionCount++;
    }

    /**
     * Сбрасывает счётчик автокоррекций
     */
    resetCorrections(): void {
        this.correctionCount = 0;
    }
}
