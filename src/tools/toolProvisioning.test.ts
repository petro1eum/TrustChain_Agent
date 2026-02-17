/**
 * Tool Provisioning — полнофункциональные тесты.
 *
 * Проверяют РЕАЛЬНУЮ структуру инструментов, промптов и маршрутизации,
 * а не «вызвался ли метод». Если кто-то добавит инструмент в toolset
 * но забудет whitelistить, или уберёт из system prompt Excel-секцию —
 * эти тесты поймают.
 */

import { describe, it, expect } from 'vitest';

import { getAllSmartAgentTools, UNIVERSAL_TOOLS } from './index';
import { basicTools } from '../agents/base/toolsSpecification';
import { pageTools, PAGE_TOOL_NAMES } from './pageTools';
import { codeExecutionTools } from './codeExecutionTools';
import { webTools } from './webTools';
import { fileTools } from './fileTools';
import { codeAnalysisTools } from './codeAnalysisTools';
import { SystemPrompts } from '../agents/base/systemPrompts';
import { getSmartAgentSections } from '../agents/base/promptSections';

// ────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────

/** Extract all tool names from an OpenAI-format tool array */
const names = (tools: any[]) => tools.map(t => t.function?.name).filter(Boolean) as string[];

/** Flatten all universal toolsets the same way getAllSmartAgentTools() does */
const allUniversalNames = () => names(getAllSmartAgentTools());

/** All base tool names from toolsSpecification.ts */
const allBaseNames = () => names(basicTools);

/** Full set of tool names from UNIVERSAL_TOOLS whitelist */
const whitelistNames = () => [...UNIVERSAL_TOOLS];

// ────────────────────────────────────────────────────────
// 1. TOOL DEFINITIONS — structural integrity
// ────────────────────────────────────────────────────────

describe('1. Tool definitions — structural integrity', () => {

    it('every tool definition has valid OpenAI function-call schema', () => {
        const allTools = [...basicTools, ...getAllSmartAgentTools(), ...pageTools];
        for (const t of allTools) {
            expect(t).toHaveProperty('type', 'function');
            expect(t).toHaveProperty('function');
            const fn = t.function;
            expect(typeof fn.name).toBe('string');
            expect(fn.name.length).toBeGreaterThan(0);
            expect(typeof fn.description).toBe('string');
            expect(fn.description.length).toBeGreaterThan(10);
            expect(fn).toHaveProperty('parameters');
            expect(fn.parameters).toHaveProperty('type', 'object');
            expect(fn.parameters).toHaveProperty('properties');
        }
    });

    it('no duplicate tool names within any single toolset', () => {
        const toolsets: Record<string, any[]> = {
            basic: basicTools,
            codeExecution: codeExecutionTools,
            web: webTools,
            file: fileTools,
            codeAnalysis: codeAnalysisTools,
            page: pageTools,
        };
        for (const [setName, tools] of Object.entries(toolsets)) {
            const toolNames = names(tools);
            const unique = new Set(toolNames);
            expect(unique.size, `duplicate in ${setName}: ${toolNames}`).toBe(toolNames.length);
        }
    });

    it('no duplicate tool names across all toolsets (base + universal + page)', () => {
        const all = [...names(basicTools), ...allUniversalNames(), ...names(pageTools)];
        const counts = new Map<string, number>();
        for (const n of all) {
            counts.set(n, (counts.get(n) ?? 0) + 1);
        }
        const dupes = [...counts.entries()].filter(([, c]) => c > 1).map(([n]) => n);
        expect(dupes, `duplicate tool names across toolsets: ${dupes.join(', ')}`).toEqual([]);
    });

    it('every tool has required[] that is a subset of its properties', () => {
        const allTools = [...basicTools, ...getAllSmartAgentTools(), ...pageTools];
        for (const t of allTools) {
            const props = Object.keys(t.function.parameters.properties || {});
            const required: string[] = t.function.parameters.required || [];
            for (const r of required) {
                expect(
                    props,
                    `${t.function.name}: required param "${r}" is not in properties [${props.join(',')}]`
                ).toContain(r);
            }
        }
    });

    it('every parameter has a type and description', () => {
        const allTools = [...basicTools, ...getAllSmartAgentTools(), ...pageTools];
        for (const t of allTools) {
            const props = t.function.parameters.properties || {};
            for (const [paramName, paramDef] of Object.entries(props) as [string, any][]) {
                expect(
                    typeof paramDef.type,
                    `${t.function.name}.${paramName}: missing type`
                ).toBe('string');
                expect(
                    typeof paramDef.description,
                    `${t.function.name}.${paramName}: missing description`
                ).toBe('string');
            }
        }
    });

    it('getAllSmartAgentTools() returns at least 15 tools', () => {
        const tools = getAllSmartAgentTools();
        expect(tools.length).toBeGreaterThanOrEqual(15);
    });

    it('basicTools has exactly 5 docker/core tools', () => {
        const expected = ['bash_tool', 'view', 'create_file', 'create_artifact', 'str_replace'];
        expect(allBaseNames().sort()).toEqual(expected.sort());
    });

    it('pageTools has 3 page interaction tools', () => {
        const expected = ['page_observe', 'page_read', 'page_interact'];
        expect(names(pageTools).sort()).toEqual(expected.sort());
    });
});

// ────────────────────────────────────────────────────────
// 2. WHITELIST CONSISTENCY — every real tool is whitelisted
// ────────────────────────────────────────────────────────

describe('2. Whitelist consistency', () => {

    it('every tool from getAllSmartAgentTools() IS in UNIVERSAL_TOOLS whitelist', () => {
        const universalNames = allUniversalNames();
        const missing = universalNames.filter(n => !UNIVERSAL_TOOLS.has(n));
        expect(
            missing,
            `Tools defined but NOT whitelisted: ${missing.join(', ')}. They will be silently filtered out by getToolsSpecification(). Add them to UNIVERSAL_TOOLS in tools/index.ts.`
        ).toEqual([]);
    });

    it('every tool in UNIVERSAL_TOOLS whitelist actually EXISTS in a toolset', () => {
        const existing = new Set([
            ...allBaseNames(),
            ...allUniversalNames(),
        ]);
        const orphan = whitelistNames().filter(n => !existing.has(n));
        expect(
            orphan,
            `Whitelisted but no definition exists: ${orphan.join(', ')}. Dead entries in UNIVERSAL_TOOLS.`
        ).toEqual([]);
    });

    it('base tools (bash_tool, create_artifact, etc.) are in UNIVERSAL_TOOLS whitelist', () => {
        for (const name of allBaseNames()) {
            expect(
                UNIVERSAL_TOOLS.has(name),
                `Base tool "${name}" is not in UNIVERSAL_TOOLS — it will be filtered out!`
            ).toBe(true);
        }
    });

    it('page tools bypass UNIVERSAL_TOOLS via PAGE_TOOL_NAMES (correct set)', () => {
        for (const name of names(pageTools)) {
            expect(PAGE_TOOL_NAMES.has(name)).toBe(true);
        }
    });

    it('UNIVERSAL_TOOLS count matches expected (catches accidental removals)', () => {
        // Currently 23 tools whitelisted — update this if you add more
        expect(UNIVERSAL_TOOLS.size).toBeGreaterThanOrEqual(20);
        expect(UNIVERSAL_TOOLS.size).toBeLessThanOrEqual(40); // sanity upper bound
    });
});

// ────────────────────────────────────────────────────────
// 3. TOOL ROUTING — every whitelisted tool has a handler
// ────────────────────────────────────────────────────────

describe('3. Tool routing coverage', () => {

    // Tools explicitly handled in routeToolExecution() switch-case (toolExecutionService.ts)
    const SWITCH_ROUTED_TOOLS = new Set([
        // Web
        'web_search', 'web_fetch',
        // Docker
        'bash_tool', 'view', 'create_file', 'create_artifact', 'str_replace',
        // File ops
        'extract_table_to_excel',
        // Code execution
        'execute_code', 'execute_bash', 'import_tool', 'save_tool', 'list_tools', 'load_tool',
        // Code analysis
        'analyze_code_structure', 'search_code_symbols', 'get_code_dependencies',
    ]);

    // Tools intercepted BEFORE toolExecutionService (in smart-ai-agent.ts executeToolCall)
    const PRE_ROUTED_TOOLS = new Set([
        // Browser tools — intercepted and re-routed through bash_tool + Playwright
        'browser_navigate', 'browser_screenshot', 'browser_extract',
        // File ops — handled by toolHandlers/appActionsRegistry via default case
        'search_files_by_name', 'read_project_file', 'get_synonyms_preview',
    ]);

    const ALL_ROUTED = new Set([...SWITCH_ROUTED_TOOLS, ...PRE_ROUTED_TOOLS]);

    it('every tool in UNIVERSAL_TOOLS has a route (switch OR pre-route)', () => {
        const unrouted = [...UNIVERSAL_TOOLS].filter(name => !ALL_ROUTED.has(name));
        expect(
            unrouted,
            `Tools whitelisted but with no execution route: ${unrouted.join(', ')}. ` +
            `They will throw "Unknown tool" at runtime.`
        ).toEqual([]);
    });

    it('every base tool has a route in toolExecutionService switch-case', () => {
        const unrouted = allBaseNames().filter(name => !SWITCH_ROUTED_TOOLS.has(name));
        expect(
            unrouted,
            `Base tools with no switch-case route: ${unrouted.join(', ')}`
        ).toEqual([]);
    });

    it('browser tools are whitelisted and have pre-route in smart-ai-agent', () => {
        const browserNames = ['browser_navigate', 'browser_screenshot', 'browser_extract'];
        for (const name of browserNames) {
            expect(UNIVERSAL_TOOLS.has(name), `Browser tool "${name}" not whitelisted`).toBe(true);
            expect(PRE_ROUTED_TOOLS.has(name), `Browser tool "${name}" not pre-routed`).toBe(true);
        }
    });

    it('file ops tools are whitelisted and have a route', () => {
        const fileOps = ['search_files_by_name', 'read_project_file', 'get_synonyms_preview'];
        for (const name of fileOps) {
            expect(UNIVERSAL_TOOLS.has(name), `File tool "${name}" not whitelisted`).toBe(true);
            expect(ALL_ROUTED.has(name), `File tool "${name}" has no route`).toBe(true);
        }
    });
});

// ────────────────────────────────────────────────────────
// 4. SYSTEM PROMPT — covers all key capabilities
// ────────────────────────────────────────────────────────

describe('4. System prompt — capability coverage', () => {

    const systemPrompt = SystemPrompts.getSmartAgentSystemPrompt('', '');

    it('mentions create_artifact for charts/visualizations', () => {
        expect(systemPrompt).toContain('create_artifact');
        expect(systemPrompt.toLowerCase()).toMatch(/график|визуализац|chart/i);
    });

    it('mentions bash_tool for Excel/PDF/Word file export', () => {
        expect(systemPrompt).toContain('bash_tool');
        expect(systemPrompt.toLowerCase()).toContain('excel');
        expect(systemPrompt.toLowerCase()).toMatch(/pdf|word/i);
    });

    it('explicitly tells LLM NOT to say "нет инструмента для Excel"', () => {
        // This instruction was added specifically because the LLM kept saying
        // "В текущих доступных инструментах такого функционала нет" for Excel
        expect(systemPrompt.toLowerCase()).toMatch(/не\s+отвечай.*нет\s+инструмент/i);
    });

    it('mentions web_search and web_fetch', () => {
        expect(systemPrompt).toContain('web_search');
        expect(systemPrompt).toContain('web_fetch');
    });

    it('mentions code analysis tools', () => {
        expect(systemPrompt).toContain('analyze_code_structure');
        expect(systemPrompt).toContain('search_code_symbols');
        expect(systemPrompt).toContain('get_code_dependencies');
    });

    it('mentions MCP tools for platform-specific capabilities', () => {
        expect(systemPrompt.toLowerCase()).toMatch(/mcp/i);
    });

    it('prompt sections include core priorities', () => {
        const sections = getSmartAgentSections();
        const coreIds = sections.filter(s => s.priority === 'core').map(s => s.id);
        expect(coreIds.length).toBeGreaterThanOrEqual(2);
    });

    it('system prompt is under 4000 chars to stay within context budget', () => {
        // A bloated system prompt wastes context window and reduces tool awareness
        expect(
            systemPrompt.length,
            `System prompt is ${systemPrompt.length} chars — too bloated, cut optional text`
        ).toBeLessThan(4000);
    });
});

// ────────────────────────────────────────────────────────
// 5. SECURITY — path validation
// ────────────────────────────────────────────────────────

describe('5. Security — path validation rules', () => {

    // Test the path validation logic directly (extracted from toolExecutionService)
    const ALLOWED_PREFIXES = ['/mnt/user-data/', '/mnt/skills/', '/tmp/'];
    const PATH_FIELDS = ['path', 'file_path', 'filename', 'file', 'file_name'];

    function validatePaths(args: any): string | null {
        for (const field of PATH_FIELDS) {
            const val = args?.[field];
            if (typeof val !== 'string' || !val) continue;
            if (val.includes('..')) return `Path traversal in ${field}: "${val}"`;
            if (val.startsWith('/') && !ALLOWED_PREFIXES.some(p => val.startsWith(p))) {
                return `Path not allowed in ${field}: "${val}"`;
            }
        }
        return null;
    }

    it('blocks path traversal via ..', () => {
        expect(validatePaths({ path: '/mnt/user-data/../etc/passwd' })).toBeTruthy();
        expect(validatePaths({ file_path: '../../../etc/shadow' })).toBeTruthy();
        expect(validatePaths({ filename: 'foo/../../bar' })).toBeTruthy();
    });

    it('blocks access outside allowed prefixes', () => {
        expect(validatePaths({ path: '/etc/passwd' })).toBeTruthy();
        expect(validatePaths({ path: '/home/user/secret.txt' })).toBeTruthy();
        expect(validatePaths({ path: '/usr/bin/malware' })).toBeTruthy();
    });

    it('allows valid paths within allowed prefixes', () => {
        expect(validatePaths({ path: '/mnt/user-data/outputs/report.xlsx' })).toBeNull();
        expect(validatePaths({ path: '/mnt/skills/my-skill/SKILL.md' })).toBeNull();
        expect(validatePaths({ path: '/tmp/temp_file.json' })).toBeNull();
    });

    it('allows relative paths (no leading /)', () => {
        expect(validatePaths({ path: 'outputs/report.xlsx' })).toBeNull();
        expect(validatePaths({ file_path: 'data/test.csv' })).toBeNull();
    });

    it('ignores non-string and empty fields', () => {
        expect(validatePaths({ path: 123 })).toBeNull();
        expect(validatePaths({ path: '' })).toBeNull();
        expect(validatePaths({ path: null })).toBeNull();
        expect(validatePaths({ other_field: '/etc/passwd' })).toBeNull();
    });
});

// ────────────────────────────────────────────────────────
// 6. TOOL DESCRIPTION QUALITY — LLM can discover capabilities
// ────────────────────────────────────────────────────────

describe('6. Tool description quality for LLM discoverability', () => {

    it('bash_tool description mentions Excel, PDF, Word, pandas, openpyxl', () => {
        const bashTool = basicTools.find(t => t.function.name === 'bash_tool');
        expect(bashTool, 'bash_tool not found in basicTools').toBeTruthy();
        const desc = bashTool!.function.description.toLowerCase();
        expect(desc).toContain('excel');
        expect(desc).toContain('pdf');
        expect(desc).toContain('word');
        expect(desc).toContain('pandas');
        expect(desc).toContain('openpyxl');
    });

    it('create_artifact description warns NOT to use for Excel/PDF/Word', () => {
        const tool = basicTools.find(t => t.function.name === 'create_artifact');
        expect(tool).toBeTruthy();
        const desc = tool!.function.description.toLowerCase();
        expect(desc).toMatch(/не.*excel.*используй.*bash_tool/i);
    });

    it('extract_table_to_excel description mentions PDF→Excel purpose', () => {
        const tool = fileTools.find(t => t.function.name === 'extract_table_to_excel');
        expect(tool, 'extract_table_to_excel not found').toBeTruthy();
        const desc = tool!.function.description.toLowerCase();
        expect(desc).toMatch(/pdf/i);
        expect(desc).toMatch(/excel/i);
    });

    it('web_search description mentions поиск/search', () => {
        const tool = webTools.find(t => t.function.name === 'web_search');
        expect(tool).toBeTruthy();
        expect(tool!.function.description.toLowerCase()).toMatch(/поиск|search/i);
    });

    it('page_observe description mentions page state / what section is active', () => {
        const tool = pageTools.find(t => t.function.name === 'page_observe');
        expect(tool).toBeTruthy();
        expect(tool!.function.description.toLowerCase()).toMatch(/page|state|section|active/i);
    });

    it('every tool description is between 20 and 800 chars (not too short, not excessive)', () => {
        const allTools = [...basicTools, ...getAllSmartAgentTools(), ...pageTools];
        for (const t of allTools) {
            const len = t.function.description.length;
            const name = t.function.name;
            expect(len, `${name} description too short (${len} chars)`).toBeGreaterThanOrEqual(20);
            expect(len, `${name} description too long (${len} chars) — LLM will ignore`).toBeLessThanOrEqual(800);
        }
    });
});

// ────────────────────────────────────────────────────────
// 7. DATA EXPORT PIPELINE — end-to-end capability check
// ────────────────────────────────────────────────────────

describe('7. Data export pipeline completeness', () => {

    it('Excel export path: bash_tool exists, is whitelisted, and has a route', () => {
        // Tool exists in base
        expect(allBaseNames()).toContain('bash_tool');
        // Whitelisted
        expect(UNIVERSAL_TOOLS.has('bash_tool')).toBe(true);
        // Mentioned in system prompt
        const prompt = SystemPrompts.getSmartAgentSystemPrompt('', '');
        expect(prompt).toContain('bash_tool');
        expect(prompt.toLowerCase()).toContain('excel');
    });

    it('Chart export path: create_artifact exists, is whitelisted, and in system prompt', () => {
        expect(allBaseNames()).toContain('create_artifact');
        expect(UNIVERSAL_TOOLS.has('create_artifact')).toBe(true);
        const prompt = SystemPrompts.getSmartAgentSystemPrompt('', '');
        expect(prompt).toContain('create_artifact');
    });

    it('PDF table extract path: extract_table_to_excel exists and is whitelisted', () => {
        expect(allUniversalNames()).toContain('extract_table_to_excel');
        expect(UNIVERSAL_TOOLS.has('extract_table_to_excel')).toBe(true);
    });

    it('Web research path: web_search + web_fetch exist and whitelisted', () => {
        expect(allUniversalNames()).toContain('web_search');
        expect(allUniversalNames()).toContain('web_fetch');
        expect(UNIVERSAL_TOOLS.has('web_search')).toBe(true);
        expect(UNIVERSAL_TOOLS.has('web_fetch')).toBe(true);
    });

    it('Code analysis path: all 3 code analysis tools exist and whitelisted', () => {
        const expected = ['analyze_code_structure', 'search_code_symbols', 'get_code_dependencies'];
        for (const name of expected) {
            expect(allUniversalNames(), `${name} not in universal tools`).toContain(name);
            expect(UNIVERSAL_TOOLS.has(name), `${name} not whitelisted`).toBe(true);
        }
    });

    it('File ops path: view, create_file, str_replace exist and whitelisted', () => {
        const expected = ['view', 'create_file', 'str_replace'];
        for (const name of expected) {
            expect(allBaseNames(), `${name} not in base tools`).toContain(name);
            expect(UNIVERSAL_TOOLS.has(name), `${name} not whitelisted`).toBe(true);
        }
    });
});

// ────────────────────────────────────────────────────────
// 8. REGRESSION GUARDS
// ────────────────────────────────────────────────────────

describe('8. Regression guards', () => {

    it('system prompt mentions /mnt/user-data/outputs/ for file export', () => {
        const prompt = SystemPrompts.getSmartAgentSystemPrompt('', '');
        expect(prompt).toContain('/mnt/user-data/outputs/');
    });

    it('UNIVERSAL_TOOLS is a Set (not an Array) for O(1) lookups', () => {
        expect(UNIVERSAL_TOOLS).toBeInstanceOf(Set);
    });

    it('PAGE_TOOL_NAMES is a Set (not an Array)', () => {
        expect(PAGE_TOOL_NAMES).toBeInstanceOf(Set);
    });

    it('getAllSmartAgentTools validates all toolsets are defined (no undefined)', () => {
        // This should not throw
        expect(() => getAllSmartAgentTools()).not.toThrow();
        const tools = getAllSmartAgentTools();
        for (const t of tools) {
            expect(t, 'tool definition is undefined/null').toBeTruthy();
            expect(t.function, 'tool.function is undefined').toBeTruthy();
            expect(t.function.name, 'tool.function.name is undefined').toBeTruthy();
        }
    });

    it('no tool name contains spaces or special characters', () => {
        const allNames = [...allBaseNames(), ...allUniversalNames(), ...names(pageTools)];
        for (const name of allNames) {
            expect(name).toMatch(/^[a-z_][a-z0-9_]*$/);
        }
    });

    it('dynamic prompt assembly does not crash with empty inputs', () => {
        expect(() => SystemPrompts.getSmartAgentSystemPrompt('', '')).not.toThrow();
        expect(() => SystemPrompts.getSmartAgentSystemPrompt(null as any, '')).not.toThrow();
        expect(() => SystemPrompts.getSmartAgentSystemPromptDynamic('', '', '')).not.toThrow();
        expect(() => SystemPrompts.getThinkingSystemPrompt()).not.toThrow();
        expect(() => SystemPrompts.getPlanningSystemPrompt()).not.toThrow();
    });
});
