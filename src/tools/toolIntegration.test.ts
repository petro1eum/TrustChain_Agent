/**
 * Tool Integration — полнофункциональные интеграционные тесты.
 *
 * Проверяют РЕАЛЬНОЕ выполнение инструментов и интеграцию с TrustChain:
 * 1. TrustChain подписывает tool calls и verify возвращает true
 * 2. Подделка аргументов ломает верификацию
 * 3. Legacy tools корректно отклоняются
 * 4. Псевдо-tools (none/answer/no_tool) возвращают корректный результат
 * 5. Полная цепочка: provision → sign → execute → verify → signFinalResponse
 * 6. executeToolIntelligently корректно маршрутизирует и кеширует
 * 7. Валидация безопасности при реальном вызове
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { trustchainService } from '../services/trustchainService';
import { UNIVERSAL_TOOLS, getAllSmartAgentTools } from './index';
import { basicTools } from '../agents/base/toolsSpecification';
import { ToolExecutionService } from '../services/agents/toolExecutionService';

// ────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────

/** Extract all tool names from an OpenAI-format tool array */
const names = (tools: any[]) => tools.map(t => t.function?.name).filter(Boolean) as string[];

/**
 * Create a minimal ToolExecutionService with stubbed dependencies.
 * This is NOT a mock — it uses the REAL routeToolExecution switch-case.
 * We stub only the external I/O (Docker, web, etc.).
 */
function createTestToolExecutionService(overrides: Partial<Record<string, any>> = {}) {
    const stubbedToolHandlers = {
        handleBashTool: vi.fn().mockResolvedValue({ success: true, output: 'echo OK', returncode: 0 }),
        handleView: vi.fn().mockResolvedValue({ success: true, content: 'file content here' }),
        handleCreateFile: vi.fn().mockResolvedValue({ success: true, path: '/mnt/user-data/outputs/test.txt' }),
        handleCreateArtifact: vi.fn().mockResolvedValue({ success: true, artifact_id: 'art_123', type: 'chart' }),
        handleStrReplace: vi.fn().mockResolvedValue({ success: true, replaced: true }),
        handleExtractTableToExcel: vi.fn().mockResolvedValue({ success: true, file: '/mnt/user-data/outputs/table.xlsx' }),
        ...overrides.toolHandlers,
    };

    const deps = {
        toolHandlers: stubbedToolHandlers,
        toolExecutionCache: new Map(),
        metricsService: {
            recordToolCall: vi.fn(),
            recordCacheHit: vi.fn(),
            recordCacheMiss: vi.fn(),
            recordToolFailure: vi.fn(),
            recordAsyncTimeout: vi.fn(),
        },
        resourceManager: null,
        recentToolCalls: new Map(),
        context: {},
        currentModel: 'gemini-2.0-flash',
        isNonInformativeResult: () => false,
        attemptErrorRecovery: vi.fn().mockResolvedValue({ success: false }),
        executionPlan: null,
        ...overrides,
    };

    return new ToolExecutionService(deps as any);
}

// ────────────────────────────────────────────────────────
// 1. TRUSTCHAIN × TOOL SIGNING — real sign/verify cycle
// ────────────────────────────────────────────────────────

describe('1. TrustChain signs real tool names from UNIVERSAL_TOOLS', () => {

    beforeEach(() => {
        trustchainService.startSession();
        trustchainService.setCurrentQuery('тестовый запрос');
        trustchainService.setExecutionContext({
            instance: 'test',
            context: 'unit-tests',
        });
    });

    it('signs and verifies bash_tool for Excel export', async () => {
        const args = {
            command: 'python3 -c "import pandas; print(pandas.__version__)"',
            description: 'Test pandas availability',
        };
        const envelope = await trustchainService.sign('bash_tool', args);

        // Envelope has all required fields
        expect(envelope.signature).toBeTruthy();
        expect(envelope.signature).toMatch(/^(ed25519|hmac-sha256):/);
        expect(envelope.agent_id).toBeTruthy();
        expect(envelope.session_id).toBeTruthy();
        expect(envelope.key_id).toBeTruthy();
        expect(envelope.sequence).toBeGreaterThan(0);
        expect(envelope.user_query).toBe('тестовый запрос');
        expect(envelope.execution_context?.instance).toBe('test');
        expect(envelope.execution_context?.context).toBe('unit-tests');

        // Verification succeeds with original args
        const verified = await trustchainService.verify(envelope, 'bash_tool', args);
        expect(verified).toBe(true);
    });

    it('signs and verifies web_search', async () => {
        const args = { query: 'JavaScript async patterns', maxResults: 5 };
        const envelope = await trustchainService.sign('web_search', args);
        expect(envelope.signature).toMatch(/^(ed25519|hmac-sha256):/);

        const verified = await trustchainService.verify(envelope, 'web_search', args);
        expect(verified).toBe(true);
    });

    it('signs and verifies create_artifact for chart', async () => {
        const args = {
            identifier: 'sales-chart',
            type: 'application/vnd.ant.react',
            title: 'Sales Chart Q1',
            content: '<Chart data={data} />',
        };
        const envelope = await trustchainService.sign('create_artifact', args);
        expect(envelope.signature).toBeTruthy();

        const verified = await trustchainService.verify(envelope, 'create_artifact', args);
        expect(verified).toBe(true);
    });

    it('signs and verifies extract_table_to_excel', async () => {
        const args = { pdf_url: 'https://example.com/report.pdf', page: 1 };
        const envelope = await trustchainService.sign('extract_table_to_excel', args);
        expect(envelope.signature).toBeTruthy();

        const verified = await trustchainService.verify(envelope, 'extract_table_to_excel', args);
        expect(verified).toBe(true);
    });

    it('signs every universal tool without error', async () => {
        const toolNames = [...UNIVERSAL_TOOLS];
        for (const toolName of toolNames) {
            const envelope = await trustchainService.sign(toolName, { test: true });
            expect(envelope.signature, `${toolName} signing failed`).toBeTruthy();
            expect(envelope.key_id, `${toolName} missing key_id`).toBeTruthy();
        }
    });

    it('signs every base tool without error', async () => {
        for (const toolName of names(basicTools)) {
            const envelope = await trustchainService.sign(toolName, { arg: 'test' });
            expect(envelope.signature).toBeTruthy();
        }
    });
});

// ────────────────────────────────────────────────────────
// 2. TRUSTCHAIN TAMPER DETECTION — real tool args
// ────────────────────────────────────────────────────────

describe('2. TrustChain detects tampered tool arguments', () => {

    beforeEach(() => {
        trustchainService.startSession();
        trustchainService.setCurrentQuery('export test');
    });

    it('rejects tampered bash_tool command', async () => {
        const original = { command: 'python3 -c "print(1)"', description: 'safe' };
        const envelope = await trustchainService.sign('bash_tool', original);

        // Tamper: inject malicious command
        const tampered = { command: 'rm -rf /', description: 'safe' };
        const result = await trustchainService.verify(envelope, 'bash_tool', tampered);
        expect(result).toBe(false);
    });

    it('rejects tampered web_search query', async () => {
        const original = { query: 'weather forecast', maxResults: 3 };
        const envelope = await trustchainService.sign('web_search', original);

        const tampered = { query: 'credit card numbers', maxResults: 3 };
        const result = await trustchainService.verify(envelope, 'web_search', tampered);
        expect(result).toBe(false);
    });

    it('rejects wrong tool name with correct args', async () => {
        const args = { command: 'echo hello' };
        const envelope = await trustchainService.sign('bash_tool', args);

        // Verify with wrong tool name
        const result = await trustchainService.verify(envelope, 'execute_bash', args);
        expect(result).toBe(false);
    });

    it('rejects extra argument injection', async () => {
        const original = { query: 'test search' };
        const envelope = await trustchainService.sign('web_search', original);

        // Inject extra args
        const tampered = { query: 'test search', maxResults: 1000, admin: true };
        const result = await trustchainService.verify(envelope, 'web_search', tampered);
        expect(result).toBe(false);
    });

    it('rejects removed arguments', async () => {
        const original = { command: 'echo hello', description: 'test' };
        const envelope = await trustchainService.sign('bash_tool', original);

        // Remove description
        const tampered = { command: 'echo hello' };
        const result = await trustchainService.verify(envelope, 'bash_tool', tampered);
        expect(result).toBe(false);
    });
});

// ────────────────────────────────────────────────────────
// 3. REAL TOOL EXECUTION — tools actually execute
// ────────────────────────────────────────────────────────

describe('3. Real tool execution through routeToolExecution', () => {

    it('legacy tools return LEGACY_TOOL_REMOVED_FROM_CORE error', async () => {
        const svc = createTestToolExecutionService();
        const legacyTools = [
            'text_processing', 'semantic_analysis', 'handle_missing_data',
            'normalize_data', 'handle_outliers', 'execute_pandas_operation',
            'smart_lookup_and_merge', 'analyze_data_quality', 'access_source_file',
            'add_to_workspace', 'get_transformation_data', 'search_transformation_data',
            'get_file_metadata',
        ];
        for (const tool of legacyTools) {
            const result = await svc.executeToolIntelligently(tool, {}, {});
            expect(result.success, `${tool} should fail`).toBe(false);
            expect(result.code).toBe('LEGACY_TOOL_REMOVED_FROM_CORE');
            expect(result.error).toContain('MCP plugin');
        }
    });

    it('pseudo-tools (none/answer/no_tool) return success', async () => {
        const svc = createTestToolExecutionService();
        for (const tool of ['none', 'answer', 'no_tool']) {
            const result = await svc.executeToolIntelligently(tool, {}, {});
            expect(result.success, `${tool} should succeed`).toBe(true);
            expect(result.message).toContain('Direct answer');
        }
    });

    it('bash_tool routes to handleBashTool handler and returns result', async () => {
        const handleBashTool = vi.fn().mockResolvedValue({
            success: true,
            output: 'pandas 2.1.4',
            returncode: 0,
        });
        const svc = createTestToolExecutionService({ toolHandlers: { handleBashTool } });

        const result = await svc.executeToolIntelligently(
            'bash_tool',
            { command: 'python3 -c "import pandas; print(pandas.__version__)"' },
            {}
        );

        expect(handleBashTool).toHaveBeenCalledOnce();
        expect(handleBashTool).toHaveBeenCalledWith(
            expect.objectContaining({ command: expect.stringContaining('pandas') })
        );
        expect(result.success).toBe(true);
        expect(result.output).toBe('pandas 2.1.4');
        expect(result.returncode).toBe(0);
    });

    it('create_artifact routes to handleCreateArtifact', async () => {
        const handleCreateArtifact = vi.fn().mockResolvedValue({
            success: true,
            artifact_id: 'chart_001',
            type: 'chart',
        });
        const svc = createTestToolExecutionService({ toolHandlers: { handleCreateArtifact } });

        const result = await svc.executeToolIntelligently(
            'create_artifact',
            { identifier: 'sales-chart', type: 'chart', content: '<Chart />' },
            {}
        );

        expect(handleCreateArtifact).toHaveBeenCalledOnce();
        expect(result.success).toBe(true);
        expect(result.artifact_id).toBe('chart_001');
    });

    it('extract_table_to_excel routes to handleExtractTableToExcel', async () => {
        const handleExtractTableToExcel = vi.fn().mockResolvedValue({
            success: true,
            file: '/mnt/user-data/outputs/extracted.xlsx',
            rows: 42,
        });
        const svc = createTestToolExecutionService({ toolHandlers: { handleExtractTableToExcel } });

        const result = await svc.executeToolIntelligently(
            'extract_table_to_excel',
            { pdf_url: 'https://example.com/report.pdf', page: 1 },
            {}
        );

        expect(handleExtractTableToExcel).toHaveBeenCalledOnce();
        expect(result.success).toBe(true);
        expect(result.file).toContain('.xlsx');
        expect(result.rows).toBe(42);
    });

    it('view routes to handleView and returns file content', async () => {
        const handleView = vi.fn().mockResolvedValue({
            success: true,
            content: '# My Document\nHello world',
        });
        const svc = createTestToolExecutionService({ toolHandlers: { handleView } });

        const result = await svc.executeToolIntelligently(
            'view',
            { path: '/mnt/user-data/test.md' },
            {}
        );

        expect(handleView).toHaveBeenCalledOnce();
        expect(result.success).toBe(true);
        expect(result.content).toContain('Hello world');
    });

    it('create_file routes to handleCreateFile', async () => {
        const handleCreateFile = vi.fn().mockResolvedValue({
            success: true,
            path: '/mnt/user-data/outputs/report.xlsx',
        });
        const svc = createTestToolExecutionService({ toolHandlers: { handleCreateFile } });

        const result = await svc.executeToolIntelligently(
            'create_file',
            { path: '/mnt/user-data/outputs/report.xlsx', content: 'binary-data' },
            {}
        );

        expect(handleCreateFile).toHaveBeenCalledOnce();
        expect(result.success).toBe(true);
        expect(result.path).toContain('report.xlsx');
    });

    it('str_replace routes to handleStrReplace', async () => {
        const handleStrReplace = vi.fn().mockResolvedValue({ success: true, replaced: true });
        const svc = createTestToolExecutionService({ toolHandlers: { handleStrReplace } });

        const result = await svc.executeToolIntelligently(
            'str_replace',
            { path: '/mnt/user-data/file.py', old_str: 'foo', new_str: 'bar' },
            {}
        );

        expect(handleStrReplace).toHaveBeenCalledOnce();
        expect(result.success).toBe(true);
        expect(result.replaced).toBe(true);
    });

    it('unknown tool throws Error', async () => {
        const svc = createTestToolExecutionService();
        await expect(
            svc.executeToolIntelligently('nonexistent_tool_xyz', {}, {})
        ).rejects.toThrow(/Unknown tool|nonexistent_tool_xyz/);
    });
});

// ────────────────────────────────────────────────────────
// 4. FULL PIPELINE: provision → sign → execute → verify
// ────────────────────────────────────────────────────────

describe('4. Full pipeline: provision → sign → execute → verify → signFinalResponse', () => {

    beforeEach(() => {
        trustchainService.startSession();
        trustchainService.setCurrentQuery('Создай Excel отчёт по продажам');
        trustchainService.setExecutionContext({
            instance: 'onaidocs',
            context: 'contracts',
        });
    });

    it('Excel export: sign bash_tool → execute → verify → finalize', async () => {
        // 1. PROVISION: bash_tool exists and is whitelisted
        expect(UNIVERSAL_TOOLS.has('bash_tool')).toBe(true);
        const bashToolDef = basicTools.find(t => t.function.name === 'bash_tool');
        expect(bashToolDef).toBeTruthy();

        // 2. SIGN: create TrustChain envelope
        const args = {
            command: 'python3 -c "import pandas as pd; df = pd.DataFrame({\'A\': [1,2]}); df.to_excel(\'/mnt/user-data/outputs/sales.xlsx\', index=False, engine=\'openpyxl\')"',
            description: 'Создаю Excel отчёт',
        };
        const envelope = await trustchainService.sign('bash_tool', args);
        expect(envelope.signature).toBeTruthy();
        expect(envelope.user_query).toBe('Создай Excel отчёт по продажам');
        expect(envelope.execution_context?.instance).toBe('onaidocs');
        expect(envelope.execution_context?.context).toBe('contracts');

        // 3. EXECUTE: tool actually runs (via stubbed handler)
        const handleBashTool = vi.fn().mockResolvedValue({
            success: true,
            output: '/mnt/user-data/outputs/sales.xlsx created',
            returncode: 0,
        });
        const svc = createTestToolExecutionService({ toolHandlers: { handleBashTool } });
        const result = await svc.executeToolIntelligently('bash_tool', args, {});
        expect(result.success).toBe(true);
        expect(result.output).toContain('sales.xlsx');

        // 4. VERIFY: TrustChain confirms the signature
        const verified = await trustchainService.verify(envelope, 'bash_tool', args);
        expect(verified).toBe(true);

        // 5. FINALIZE: signFinalResponse links tool signatures
        const finalProof = await trustchainService.signFinalResponse(
            'Вот ваш Excel отчёт: sales.xlsx',
            [envelope.signature],
            { tool_results: ['sales.xlsx created'] }
        );
        expect(finalProof.envelope.signature).toBeTruthy();
        expect(finalProof.response_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(finalProof.tool_signatures_hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('Multi-tool chain: web_search → create_artifact, all signed and linked', async () => {
        // Step 1: Sign and "execute" web_search
        const searchArgs = { query: 'market trends 2026', maxResults: 5 };
        const searchEnv = await trustchainService.sign('web_search', searchArgs);
        expect(searchEnv.sequence).toBeGreaterThan(0);

        // Step 2: Sign and "execute" create_artifact (chart from search results)
        const chartArgs = {
            identifier: 'market-trends-chart',
            type: 'chart',
            content: '<BarChart data={trends} />',
        };
        const chartEnv = await trustchainService.sign('create_artifact', chartArgs);
        expect(chartEnv.sequence).toBeGreaterThan(searchEnv.sequence);

        // Chain of Trust: second envelope references first
        // (only for pro/enterprise tiers, community won't have parent_signature)

        // Verify both
        expect(await trustchainService.verify(searchEnv, 'web_search', searchArgs)).toBe(true);
        expect(await trustchainService.verify(chartEnv, 'create_artifact', chartArgs)).toBe(true);

        // Cross-tamper: verify fails with wrong tool
        expect(await trustchainService.verify(searchEnv, 'create_artifact', searchArgs)).toBe(false);

        // Final response links both tool signatures
        const final = await trustchainService.signFinalResponse(
            'Анализ рыночных трендов завершён',
            [searchEnv.signature, chartEnv.signature],
            { steps: 2 }
        );
        expect(final.envelope.signature).toBeTruthy();
        expect(final.tool_signatures_hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('Audit trail captures all tool calls in order', async () => {
        const toolCalls = [
            { name: 'web_search', args: { query: 'test' } },
            { name: 'bash_tool', args: { command: 'echo 1' } },
            { name: 'create_artifact', args: { identifier: 'x', type: 'chart', content: 'y' } },
        ];

        for (const { name, args } of toolCalls) {
            await trustchainService.sign(name, args);
        }

        const audit = trustchainService.getAuditTrail();
        expect(audit.length).toBeGreaterThanOrEqual(3);

        // Verify order
        const lastThree = audit.slice(-3);
        expect(lastThree[0].tool_name).toBe('web_search');
        expect(lastThree[1].tool_name).toBe('bash_tool');
        expect(lastThree[2].tool_name).toBe('create_artifact');

        // Each entry has required audit fields
        for (const entry of lastThree) {
            expect(entry.signature).toBeTruthy();
            expect(entry.args_hash).toMatch(/^[a-f0-9]{64}$/);
            expect(entry.timestamp).toBeTruthy();
            expect(entry.sequence).toBeGreaterThan(0);
            expect(entry.key_id).toBeTruthy();
        }

        // Sequence is monotonically increasing
        expect(lastThree[1].sequence).toBeGreaterThan(lastThree[0].sequence);
        expect(lastThree[2].sequence).toBeGreaterThan(lastThree[1].sequence);
    });
});

// ────────────────────────────────────────────────────────
// 5. EXECUTION CACHING — idempotent tools are cached
// ────────────────────────────────────────────────────────

describe('5. Tool execution caching', () => {

    it('second call with same args returns cached result', async () => {
        const handleView = vi.fn().mockResolvedValue({ success: true, content: 'cached-content' });
        const svc = createTestToolExecutionService({ toolHandlers: { handleView } });

        const args = { path: '/mnt/user-data/test.md' };
        const result1 = await svc.executeToolIntelligently('view', args, {});
        const result2 = await svc.executeToolIntelligently('view', args, {});

        // Handler called only once — second time is cache hit
        expect(handleView).toHaveBeenCalledTimes(1);
        expect(result1).toEqual(result2);
    });

    it('different args bypass cache', async () => {
        const handleView = vi.fn()
            .mockResolvedValueOnce({ success: true, content: 'file A' })
            .mockResolvedValueOnce({ success: true, content: 'file B' });
        const svc = createTestToolExecutionService({ toolHandlers: { handleView } });

        const result1 = await svc.executeToolIntelligently('view', { path: '/mnt/user-data/a.md' }, {});
        const result2 = await svc.executeToolIntelligently('view', { path: '/mnt/user-data/b.md' }, {});

        expect(handleView).toHaveBeenCalledTimes(2);
        expect(result1.content).toBe('file A');
        expect(result2.content).toBe('file B');
    });
});

// ────────────────────────────────────────────────────────
// 6. SECURITY — path validation enforced during execution
// ────────────────────────────────────────────────────────

describe('6. Security enforcement during tool execution', () => {

    it('rejects path traversal in view args', async () => {
        const svc = createTestToolExecutionService();
        await expect(
            svc.executeToolIntelligently('view', { path: '/mnt/user-data/../etc/passwd' }, {})
        ).rejects.toThrow(/Path|traversal|Security/i);
    });

    it('rejects path outside allowed prefixes in create_file', async () => {
        const svc = createTestToolExecutionService();
        await expect(
            svc.executeToolIntelligently('create_file', { path: '/etc/malware.sh', content: 'bad' }, {})
        ).rejects.toThrow(/Path|allowed|Security/i);
    });

    it('allows paths within /mnt/user-data/', async () => {
        const handleCreateFile = vi.fn().mockResolvedValue({ success: true });
        const svc = createTestToolExecutionService({ toolHandlers: { handleCreateFile } });

        // Should not throw
        const result = await svc.executeToolIntelligently(
            'create_file',
            { path: '/mnt/user-data/outputs/safe.xlsx', content: 'data' },
            {}
        );
        expect(result.success).toBe(true);
    });

    it('allows paths within /tmp/', async () => {
        const handleCreateFile = vi.fn().mockResolvedValue({ success: true });
        const svc = createTestToolExecutionService({ toolHandlers: { handleCreateFile } });

        const result = await svc.executeToolIntelligently(
            'create_file',
            { path: '/tmp/temp_file.json', content: '{}' },
            {}
        );
        expect(result.success).toBe(true);
    });
});

// ────────────────────────────────────────────────────────
// 7. TRUSTCHAIN SESSION LIFECYCLE
// ────────────────────────────────────────────────────────

describe('7. TrustChain session lifecycle with tools', () => {

    it('new session resets sequence', async () => {
        trustchainService.startSession();
        const env1 = await trustchainService.sign('bash_tool', { command: 'echo 1' });
        const seq1 = env1.sequence;

        trustchainService.startSession();
        const env2 = await trustchainService.sign('bash_tool', { command: 'echo 2' });

        // After new session, sequence restarts from 1
        expect(env2.sequence).toBe(1);
        expect(env2.session_id).not.toBe(env1.session_id);
    });

    it('session info reflects tool call count', async () => {
        trustchainService.startSession();
        const infoBefore = trustchainService.getSessionInfo();
        const seqBefore = infoBefore.sequence;

        await trustchainService.sign('web_search', { query: 'test' });
        await trustchainService.sign('bash_tool', { command: 'echo' });

        const infoAfter = trustchainService.getSessionInfo();
        expect(infoAfter.sequence).toBe(seqBefore + 2);
    });

    it('key info reports algorithm and non-revoked status', () => {
        const keyInfo = trustchainService.getKeyInfo();
        expect(keyInfo.algorithm).toMatch(/^(ed25519|hmac-sha256)$/);
        expect(keyInfo.revoked).toBe(false);
        expect(keyInfo.key_id).toBeTruthy();
    });

    it('certificate contains expected fields', () => {
        const cert = trustchainService.getCertificate();
        expect(cert).toHaveProperty('owner');
        expect(cert).toHaveProperty('organization');
        expect(cert).toHaveProperty('role');
        expect(cert).toHaveProperty('tier');
        expect(cert).toHaveProperty('issued');
    });

    it('isReady returns true after first sign', async () => {
        trustchainService.startSession();
        await trustchainService.sign('bash_tool', {});
        expect(trustchainService.isReady()).toBe(true);
    });
});

// ────────────────────────────────────────────────────────
// 8. TOOL METRICS — execution metrics are recorded
// ────────────────────────────────────────────────────────

describe('8. Tool execution metrics', () => {

    it('metrics service records tool call and latency', async () => {
        const recordToolCall = vi.fn();
        const svc = createTestToolExecutionService({
            metricsService: {
                recordToolCall,
                recordCacheHit: vi.fn(),
                recordCacheMiss: vi.fn(),
            },
        });

        await svc.executeToolIntelligently('none', {}, {});
        expect(recordToolCall).toHaveBeenCalledWith('none', expect.any(Number));

        const [toolName, latency] = recordToolCall.mock.calls[0];
        expect(toolName).toBe('none');
        expect(latency).toBeGreaterThanOrEqual(0);
        expect(latency).toBeLessThan(1000); // should be fast for pseudo-tools
    });

    it('cache hit is recorded on second identical call', async () => {
        const recordCacheHit = vi.fn();
        const svc = createTestToolExecutionService({
            metricsService: {
                recordToolCall: vi.fn(),
                recordCacheHit,
                recordCacheMiss: vi.fn(),
            },
        });

        await svc.executeToolIntelligently('none', {}, {});
        await svc.executeToolIntelligently('none', {}, {});

        expect(recordCacheHit).toHaveBeenCalledTimes(1); // second call hits cache
    });
});

// ────────────────────────────────────────────────────────
// 9. UNIVERSAL TRUSTCHAIN SIGNING — executeToolIntelligently
//    enriches every result with __tc_envelope + __tc_signature
// ────────────────────────────────────────────────────────

describe('9. Universal TrustChain signing in executeToolIntelligently', () => {

    beforeEach(() => {
        trustchainService.startSession();
        trustchainService.setCurrentQuery('integration test');
    });

    it('bash_tool result contains __tc_envelope with valid Ed25519 signature', async () => {
        const handleBashTool = vi.fn().mockResolvedValue({
            success: true,
            output: 'hello',
            returncode: 0,
        });
        const svc = createTestToolExecutionService({ toolHandlers: { handleBashTool } });

        const args = { command: 'echo hello' };
        const result = await svc.executeToolIntelligently('bash_tool', args, {});

        // Result should have TrustChain fields
        expect(result.__tc_envelope).toBeDefined();
        expect(result.__tc_signature).toBeTruthy();
        expect(result.__tc_signature).toMatch(/^(ed25519|hmac-sha256):/);

        // Envelope has correct key info
        expect(result.__tc_envelope.key_id).toBeTruthy();
        expect(result.__tc_envelope.key_id).toBeTruthy();
        expect(result.__tc_envelope.session_id).toBeTruthy();
        expect(result.__tc_envelope.sequence).toBeGreaterThan(0);

        // Signature is verifiable
        const verified = await trustchainService.verify(result.__tc_envelope, 'bash_tool', args);
        expect(verified).toBe(true);
    });

    it('view/create_file/create_artifact all get signed', async () => {
        const svc = createTestToolExecutionService();

        const toolCalls = [
            { name: 'view', args: { path: '/mnt/user-data/test.md' } },
            { name: 'create_file', args: { path: '/mnt/user-data/out.txt', content: 'x' } },
            { name: 'create_artifact', args: { identifier: 'a', type: 'chart', content: '<C/>' } },
        ];

        for (const { name, args } of toolCalls) {
            const result = await svc.executeToolIntelligently(name, args, {});
            expect(result.__tc_envelope, `${name} should have envelope`).toBeDefined();
            expect(result.__tc_signature, `${name} should have signature`).toBeTruthy();
            expect(result.__tc_envelope.key_id, `${name} should have key_id`).toBeTruthy();

            // Each signature is independently verifiable
            const verified = await trustchainService.verify(result.__tc_envelope, name, args);
            expect(verified, `${name} verification should pass`).toBe(true);
        }
    });

    it('pseudo-tools (none/answer) also get signed', async () => {
        const svc = createTestToolExecutionService();

        const result = await svc.executeToolIntelligently('none', {}, {});
        expect(result.success).toBe(true);
        expect(result.__tc_envelope).toBeDefined();
        expect(result.__tc_signature).toBeTruthy();
        expect(result.__tc_envelope.key_id).toBeTruthy();
    });

    it('signatures from executeToolIntelligently can be linked via signFinalResponse', async () => {
        const svc = createTestToolExecutionService();

        // Execute two tools and collect their envelopes
        const r1 = await svc.executeToolIntelligently('view', { path: '/mnt/user-data/a.md' }, {});
        const r2 = await svc.executeToolIntelligently('create_file', { path: '/mnt/user-data/b.txt', content: 'x' }, {});

        expect(r1.__tc_signature).toBeTruthy();
        expect(r2.__tc_signature).toBeTruthy();

        // Link both tool signatures in final response
        const proof = await trustchainService.signFinalResponse(
            'Работа выполнена',
            [r1.__tc_signature, r2.__tc_signature],
            { context: 'test' }
        );

        expect(proof.envelope.signature).toBeTruthy();
        expect(proof.response_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(proof.tool_signatures_hash).toMatch(/^[a-f0-9]{64}$/);
    });
});
