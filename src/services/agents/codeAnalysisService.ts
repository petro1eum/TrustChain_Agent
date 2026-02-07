/**
 * Code Analysis Service
 * Gap #6: Code-aware tools via AST parsing in Docker
 * 
 * Uses tree-sitter CLI / ast-grep / regex fallback in Docker container
 * for structural code analysis (functions, classes, imports, dependencies)
 */

import { dockerAgentService } from '../dockerAgentService';

export interface CodeStructure {
    functions: Array<{ name: string; line: number; params?: string; returnType?: string }>;
    classes: Array<{ name: string; line: number; methods: string[] }>;
    imports: Array<{ name: string; source: string; line: number }>;
    exports: Array<{ name: string; line: number }>;
    totalLines: number;
    language: string;
}

export interface SymbolSearchResult {
    file: string;
    symbol: string;
    type: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'import' | 'export';
    line: number;
    context?: string;
}

export interface DependencyNode {
    file: string;
    imports: Array<{ source: string; names: string[]; isRelative: boolean }>;
    importedBy?: string[];
}

// Cache parsed structures to avoid re-parsing
const structureCache = new Map<string, { structure: CodeStructure; timestamp: number }>();
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

export class CodeAnalysisService {

    /**
     * Parse file structure — returns functions, classes, imports
     * Tries tree-sitter CLI first, falls back to regex parsing
     */
    async parseFileStructure(filePath: string): Promise<CodeStructure> {
        // Check cache
        const cached = structureCache.get(filePath);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
            return cached.structure;
        }

        const language = this.detectLanguage(filePath);
        let structure: CodeStructure;

        try {
            // Try AST-based parsing first (ast-grep or tree-sitter)
            structure = await this.parseWithAstGrep(filePath, language);
        } catch {
            // Fallback to regex-based parsing
            structure = await this.parseWithRegex(filePath, language);
        }

        structureCache.set(filePath, { structure, timestamp: Date.now() });
        return structure;
    }

    /**
     * Search for code symbols across files  
     * Uses grep with structural awareness
     */
    async searchSymbols(
        pattern: string,
        scope: string = '/mnt/workspace',
        type?: 'function' | 'class' | 'interface' | 'type'
    ): Promise<SymbolSearchResult[]> {
        const typePatterns: Record<string, string> = {
            function: `(function|const|let|var|async\\s+function|def|fn)\\s+${pattern}`,
            class: `(class|struct|enum)\\s+${pattern}`,
            interface: `(interface|type|trait)\\s+${pattern}`,
            type: `(type|interface|typedef)\\s+${pattern}`
        };

        const grepPattern = type
            ? typePatterns[type] || pattern
            : `(function|class|interface|type|const|let|var|def|fn|struct|enum|trait|async\\s+function)\\s+${pattern}`;

        const command = `grep -rnE '${grepPattern}' ${scope} --include='*.ts' --include='*.tsx' --include='*.js' --include='*.py' --include='*.rs' -l 2>/dev/null | head -20 | while read f; do grep -nE '${grepPattern}' "$f" | head -5; done 2>/dev/null | head -50`;

        const result = await dockerAgentService.bashTool({
            command,
            description: `Search symbols: ${pattern}`,
            timeout: 15000
        });

        if (!result.success || !result.stdout.trim()) {
            return [];
        }

        return this.parseGrepResults(result.stdout, pattern);
    }

    /**
     * Get dependency graph for a file (imports and who imports it)
     */
    async getDependencyGraph(filePath: string): Promise<DependencyNode> {
        const structure = await this.parseFileStructure(filePath);

        // Find files that import this file
        const basename = filePath.split('/').pop()?.replace(/\.(ts|tsx|js|jsx|py)$/, '') || '';
        const searchDir = filePath.split('/').slice(0, -1).join('/') || '/mnt/workspace';

        const importedByResult = await dockerAgentService.bashTool({
            command: `grep -rl "from.*['\\"./]*${basename}['\\".]" ${searchDir} --include='*.ts' --include='*.tsx' --include='*.js' 2>/dev/null | head -20`,
            description: `Find dependents of ${basename}`,
            timeout: 10000
        });

        const importedBy = importedByResult.success
            ? importedByResult.stdout.trim().split('\n').filter(Boolean)
            : [];

        return {
            file: filePath,
            imports: structure.imports.map(imp => ({
                source: imp.source,
                names: [imp.name],
                isRelative: imp.source.startsWith('.') || imp.source.startsWith('/')
            })),
            importedBy
        };
    }

    // ============================
    // Private Methods
    // ============================

    /**
     * AST-based parsing using ast-grep or tree-sitter CLI
     */
    private async parseWithAstGrep(filePath: string, language: string): Promise<CodeStructure> {
        // Try ast-grep first (npm install -g @ast-grep/cli)
        const checkResult = await dockerAgentService.bashTool({
            command: `which ast-grep 2>/dev/null || which sg 2>/dev/null || echo "NOT_FOUND"`,
            description: 'Check ast-grep availability',
            timeout: 5000
        });

        if (checkResult.stdout.includes('NOT_FOUND')) {
            throw new Error('ast-grep not available');
        }

        // Use ast-grep to extract structure  
        const sgBin = checkResult.stdout.trim().split('\n')[0];
        const patterns: Record<string, string> = {
            functions: language === 'python'
                ? `${sgBin} run -p 'def $NAME($$$)' ${filePath} --json 2>/dev/null`
                : `${sgBin} run -p 'function $NAME($$$)' ${filePath} --json 2>/dev/null`,
            classes: `${sgBin} run -p 'class $NAME' ${filePath} --json 2>/dev/null`,
        };

        const results = await Promise.allSettled([
            dockerAgentService.bashTool({ command: patterns.functions, description: 'Parse functions', timeout: 10000 }),
            dockerAgentService.bashTool({ command: patterns.classes, description: 'Parse classes', timeout: 10000 }),
            dockerAgentService.bashTool({ command: `wc -l < ${filePath}`, description: 'Count lines', timeout: 5000 })
        ]);

        const functionsOut = results[0].status === 'fulfilled' ? results[0].value : null;
        const classesOut = results[1].status === 'fulfilled' ? results[1].value : null;
        const linesOut = results[2].status === 'fulfilled' ? results[2].value : null;

        return {
            functions: this.parseAstGrepOutput(functionsOut?.stdout || '', 'function'),
            classes: this.parseAstGrepClasses(classesOut?.stdout || ''),
            imports: await this.parseImportsWithGrep(filePath, language),
            exports: await this.parseExportsWithGrep(filePath, language),
            totalLines: parseInt(linesOut?.stdout?.trim() || '0', 10),
            language
        };
    }

    /**
     * Regex-based parsing fallback
     */
    private async parseWithRegex(filePath: string, language: string): Promise<CodeStructure> {
        const fileResult = await dockerAgentService.bashTool({
            command: `cat ${filePath} 2>/dev/null`,
            description: `Read file ${filePath}`,
            timeout: 10000
        });

        if (!fileResult.success || !fileResult.stdout) {
            return { functions: [], classes: [], imports: [], exports: [], totalLines: 0, language };
        }

        const content = fileResult.stdout;
        const lines = content.split('\n');

        return {
            functions: this.extractFunctions(lines, language),
            classes: this.extractClasses(lines, language),
            imports: this.extractImports(lines, language),
            exports: this.extractExports(lines, language),
            totalLines: lines.length,
            language
        };
    }

    private extractFunctions(lines: string[], language: string): CodeStructure['functions'] {
        const results: CodeStructure['functions'] = [];
        const patterns: Record<string, RegExp> = {
            typescript: /(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>|(\w+)\s*\([^)]*\)\s*(?::\s*\S+\s*)?\{)/,
            python: /^\s*(?:async\s+)?def\s+(\w+)\s*\(/,
            rust: /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/,
        };

        const pattern = patterns[language] || patterns.typescript;

        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(pattern);
            if (match) {
                const name = match[1] || match[2] || match[3];
                if (name && !['if', 'for', 'while', 'switch', 'catch', 'constructor'].includes(name)) {
                    results.push({ name, line: i + 1 });
                }
            }
        }
        return results;
    }

    private extractClasses(lines: string[], language: string): CodeStructure['classes'] {
        const results: CodeStructure['classes'] = [];
        const classPattern = language === 'python'
            ? /^\s*class\s+(\w+)/
            : /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/;

        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(classPattern);
            if (match) {
                const methods: string[] = [];
                // Scan ahead for methods within this class (simple heuristic)
                for (let j = i + 1; j < Math.min(i + 200, lines.length); j++) {
                    if (/^\s*\}/.test(lines[j]) && !/^\s*\}\s*(else|catch|finally)/.test(lines[j])) {
                        // Possible class end
                        const indent = (lines[j].match(/^\s*/) || [''])[0].length;
                        if (indent <= (lines[i].match(/^\s*/) || [''])[0].length) break;
                    }
                    const methodMatch = lines[j].match(/^\s+(?:async\s+)?(?:static\s+)?(?:private\s+|protected\s+|public\s+)?(\w+)\s*\(/);
                    if (methodMatch && methodMatch[1] !== 'if' && methodMatch[1] !== 'for' && methodMatch[1] !== 'constructor') {
                        methods.push(methodMatch[1]);
                    }
                }
                results.push({ name: match[1], line: i + 1, methods });
            }
        }
        return results;
    }

    private extractImports(lines: string[], language: string): CodeStructure['imports'] {
        const results: CodeStructure['imports'] = [];
        const importPatterns: Record<string, RegExp> = {
            typescript: /import\s+(?:{([^}]+)}|(\w+))\s+from\s+['"]([^'"]+)['"]/,
            python: /(?:from\s+(\S+)\s+import\s+(.+)|import\s+(\S+))/,
            rust: /use\s+([^;]+);/,
        };

        const pattern = importPatterns[language] || importPatterns.typescript;

        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(pattern);
            if (match) {
                if (language === 'python') {
                    results.push({ name: match[2] || match[3] || '', source: match[1] || match[3] || '', line: i + 1 });
                } else if (language === 'rust') {
                    results.push({ name: match[1].split('::').pop() || '', source: match[1], line: i + 1 });
                } else {
                    results.push({ name: match[1] || match[2] || '', source: match[3] || '', line: i + 1 });
                }
            }
        }
        return results;
    }

    private extractExports(lines: string[], language: string): CodeStructure['exports'] {
        const results: CodeStructure['exports'] = [];
        if (language !== 'typescript' && language !== 'javascript') return results;

        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(/export\s+(?:default\s+)?(?:class|function|const|let|var|type|interface|enum|abstract\s+class)\s+(\w+)/);
            if (match) {
                results.push({ name: match[1], line: i + 1 });
            }
        }
        return results;
    }

    private async parseImportsWithGrep(filePath: string, language: string): Promise<CodeStructure['imports']> {
        const pattern = language === 'python' ? 'from|^import' : '^import';
        const result = await dockerAgentService.bashTool({
            command: `grep -n '${pattern}' ${filePath} 2>/dev/null | head -30`,
            description: 'Parse imports',
            timeout: 5000
        });

        if (!result.success || !result.stdout.trim()) return [];
        return this.extractImports(result.stdout.split('\n'), language);
    }

    private async parseExportsWithGrep(filePath: string, language: string): Promise<CodeStructure['exports']> {
        if (language !== 'typescript' && language !== 'javascript') return [];
        const result = await dockerAgentService.bashTool({
            command: `grep -n '^export' ${filePath} 2>/dev/null | head -30`,
            description: 'Parse exports',
            timeout: 5000
        });

        if (!result.success || !result.stdout.trim()) return [];
        return this.extractExports(result.stdout.split('\n'), language);
    }

    private parseAstGrepOutput(stdout: string, type: string): CodeStructure['functions'] {
        try {
            const matches = JSON.parse(stdout);
            if (!Array.isArray(matches)) return [];
            return matches.map((m: any) => ({
                name: m.metaVariables?.NAME?.text || m.text?.match(/\w+/)?.[0] || 'unknown',
                line: m.range?.start?.line || 0
            }));
        } catch {
            return [];
        }
    }

    private parseAstGrepClasses(stdout: string): CodeStructure['classes'] {
        try {
            const matches = JSON.parse(stdout);
            if (!Array.isArray(matches)) return [];
            return matches.map((m: any) => ({
                name: m.metaVariables?.NAME?.text || 'unknown',
                line: m.range?.start?.line || 0,
                methods: []
            }));
        } catch {
            return [];
        }
    }

    private parseGrepResults(stdout: string, pattern: string): SymbolSearchResult[] {
        const results: SymbolSearchResult[] = [];
        for (const line of stdout.split('\n').filter(Boolean)) {
            const match = line.match(/^(.+?):(\d+):(.*)/);
            if (match) {
                const context = match[3].trim();
                let type: SymbolSearchResult['type'] = 'variable';
                if (/\bfunction\b|\bdef\b|\bfn\b/.test(context)) type = 'function';
                else if (/\bclass\b/.test(context)) type = 'class';
                else if (/\binterface\b/.test(context)) type = 'interface';
                else if (/\btype\b/.test(context)) type = 'type';
                else if (/\bimport\b/.test(context)) type = 'import';
                else if (/\bexport\b/.test(context)) type = 'export';

                results.push({
                    file: match[1],
                    symbol: pattern,
                    type,
                    line: parseInt(match[2], 10),
                    context
                });
            }
        }
        return results;
    }

    private detectLanguage(filePath: string): string {
        const ext = filePath.split('.').pop()?.toLowerCase() || '';
        const map: Record<string, string> = {
            ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
            py: 'python', rs: 'rust', go: 'go', java: 'java',
            cpp: 'cpp', c: 'c', h: 'c', hpp: 'cpp'
        };
        return map[ext] || 'typescript';
    }

    /**
     * Clear structure cache
     */
    clearCache(): void {
        structureCache.clear();
    }
}
