/**
 * Agent Orchestrator Service — Multi-Agent Decomposition
 *
 * UNIVERSAL orchestrator that decomposes complex tasks into sub-tasks
 * and distributes them across specialized sub-agents.
 *
 * Agent specialties are DYNAMIC — host apps inject their own
 * specializations via trustchain:agent_config postMessage.
 * The orchestrator ships with a universal set of built-in specialties
 * (code, analysis, data, general) and merges host-provided ones.
 */

import type { ProgressEvent } from '../../agents/types';

// ─── Types ───

/** Specialty name — any string. Built-in: 'code', 'analysis', 'data', 'general'. */
export type AgentSpecialty = string;

/** Custom specialty definition injected by host app. */
export interface CustomSpecialty {
    name: string;        // e.g. 'document-specialist', 'hr-specialist'
    patterns: string[];  // Regex-safe keywords: ['документ', 'входящ', 'document']
    description?: string; // Human-readable: 'Handling documents and correspondence'
}

export interface SubTask {
    id: string;
    description: string;
    specialist: AgentSpecialty;
    dependencies: string[];
    priority: number;
    status: 'pending' | 'running' | 'completed' | 'failed';
    result?: any;
}

export interface DecompositionResult {
    originalInstruction: string;
    subTasks: SubTask[];
    strategy: 'sequential' | 'parallel' | 'mixed';
    estimatedComplexity: number; // 1-10
}

export interface OrchestratorConfig {
    maxParallelAgents: number;
    enableDecomposition: boolean;
    decompositionThreshold: number; // Minimum complexity to decompose
}

// ─── Constants ───

const DEFAULT_CONFIG: OrchestratorConfig = {
    maxParallelAgents: 3,
    enableDecomposition: true,
    decompositionThreshold: 5   // Tasks with complexity >= 5 get decomposed
};

/** Built-in universal specialties that always work, even without host config. */
const BUILTIN_SPECIALTIES: CustomSpecialty[] = [
    { name: 'code-specialist', patterns: ['код', 'скрипт', 'функци', 'баг', 'ошибк', 'code', 'debug', 'refactor', 'script'] },
    { name: 'analysis-specialist', patterns: ['анализ', 'рассчитай', 'статистик', 'метрик', 'analyz', 'calculat', 'report'] },
    { name: 'data-specialist', patterns: ['данные', 'таблиц', 'excel', 'csv', 'json', 'обработ', 'data', 'import', 'export'] },
];

// ─── Service ───

export class AgentOrchestratorService {
    private config: OrchestratorConfig;
    private activeSubTasks: Map<string, SubTask> = new Map();
    private customSpecialties: CustomSpecialty[] = [];
    private customComplexityKeywords: string[] = [];

    constructor(config?: Partial<OrchestratorConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    // ─── Host App Configuration ───

    /**
     * Register custom specialties from host app.
     * Called when receiving trustchain:agent_config postMessage.
     * Merges with built-in specialties (host specialties take priority).
     */
    setCustomSpecialties(specialties: CustomSpecialty[]): void {
        this.customSpecialties = specialties;
        console.log(`[Orchestrator] Registered ${specialties.length} custom specialties:`,
            specialties.map(s => s.name).join(', '));
    }

    /**
     * Set domain-specific keywords that increase complexity score.
     * E.g. ['документооборот', 'contract management', 'workflow']
     */
    setComplexityKeywords(keywords: string[]): void {
        this.customComplexityKeywords = keywords;
        console.log(`[Orchestrator] Registered ${keywords.length} complexity keywords`);
    }

    /**
     * Sync from shared window config set by PanelApp's trustchain:agent_config handler.
     * This bridges the postMessage world to the orchestrator instance.
     */
    private syncFromSharedConfig(): void {
        const cfg = (typeof window !== 'undefined') && (window as any).__trustchain_agent_config;
        if (!cfg) return;

        if (cfg.specialties && cfg.specialties !== this._lastSyncedSpecialties) {
            this.setCustomSpecialties(cfg.specialties);
            this._lastSyncedSpecialties = cfg.specialties;
        }
        if (cfg.complexityKeywords && cfg.complexityKeywords !== this._lastSyncedKeywords) {
            this.setComplexityKeywords(cfg.complexityKeywords);
            this._lastSyncedKeywords = cfg.complexityKeywords;
        }
    }

    private _lastSyncedSpecialties: any = null;
    private _lastSyncedKeywords: any = null;

    // ─── Core Logic ───

    /**
     * Get all active specialties (built-in + custom).
     * Custom specialties override built-in ones with the same name.
     */
    private getAllSpecialties(): CustomSpecialty[] {
        const merged = new Map<string, CustomSpecialty>();
        for (const s of BUILTIN_SPECIALTIES) merged.set(s.name, s);
        for (const s of this.customSpecialties) merged.set(s.name, s);
        return Array.from(merged.values());
    }

    /**
     * Analyze query and determine if decomposition is needed.
     * Uses universal heuristics (length, markers, domain count).
     */
    analyzeComplexity(instruction: string): number {
        let complexity = 1;

        // Length
        if (instruction.length > 200) complexity += 1;
        if (instruction.length > 500) complexity += 1;

        // Task count markers (universal: numbered lists, conjunctions)
        const taskMarkers = instruction.match(/(\d+\)|\d+\.|\bи\b.*\bи\b|\bтакже\b|\bещё\b|\balso\b|\bthen\b)/gi);
        if (taskMarkers) complexity += Math.min(taskMarkers.length, 3);

        // Multi-domain detection: count how many specialty domains are mentioned
        const allSpecialties = this.getAllSpecialties();
        const domainCount = allSpecialties.filter(spec => {
            const regex = new RegExp(spec.patterns.join('|'), 'i');
            return regex.test(instruction);
        }).length;
        if (domainCount >= 2) complexity += 2;

        // Custom complexity keywords from host app
        if (this.customComplexityKeywords.length > 0) {
            const kwRegex = new RegExp(this.customComplexityKeywords.join('|'), 'i');
            if (kwRegex.test(instruction)) complexity += 1;
        }

        // Explicit complexity markers
        if (/сложн|complex|multi-step/i.test(instruction)) complexity += 1;

        return Math.min(10, complexity);
    }

    /**
     * Decompose task into sub-tasks.
     */
    decompose(instruction: string): DecompositionResult {
        // Auto-sync from shared config (set by PanelApp's trustchain:agent_config handler)
        this.syncFromSharedConfig();

        const complexity = this.analyzeComplexity(instruction);

        if (complexity < this.config.decompositionThreshold) {
            return {
                originalInstruction: instruction,
                subTasks: [{
                    id: 'main',
                    description: instruction,
                    specialist: this.detectSpecialty(instruction),
                    dependencies: [],
                    priority: 1,
                    status: 'pending'
                }],
                strategy: 'sequential',
                estimatedComplexity: complexity
            };
        }

        const subTasks = this.extractSubTasks(instruction);
        const strategy = this.determineStrategy(subTasks);

        return {
            originalInstruction: instruction,
            subTasks,
            strategy,
            estimatedComplexity: complexity
        };
    }

    /**
     * Detect the best specialist for a given text.
     * Checks custom specialties first (host app priority), then built-in.
     */
    detectSpecialty(text: string): AgentSpecialty {
        const lower = text.toLowerCase();

        // Check all specialties (custom first, then built-in)
        const allSpecialties = this.getAllSpecialties();

        // Custom specialties get priority — check them first
        for (const spec of this.customSpecialties) {
            const regex = new RegExp(spec.patterns.join('|'), 'i');
            if (regex.test(lower)) return spec.name;
        }

        // Then built-in specialties
        for (const spec of BUILTIN_SPECIALTIES) {
            const regex = new RegExp(spec.patterns.join('|'), 'i');
            if (regex.test(lower)) return spec.name;
        }

        return 'general';
    }

    /**
     * Extract sub-tasks from instruction.
     */
    private extractSubTasks(instruction: string): SubTask[] {
        const tasks: SubTask[] = [];

        // Split by numbered lists
        const numbered = instruction.match(/\d+[.)]\s*([^\n]+)/g);
        if (numbered && numbered.length >= 2) {
            for (let i = 0; i < numbered.length; i++) {
                const desc = numbered[i].replace(/^\d+[.)]\s*/, '').trim();
                tasks.push({
                    id: `sub_${i + 1}`,
                    description: desc,
                    specialist: this.detectSpecialty(desc),
                    dependencies: i > 0 ? [`sub_${i}`] : [],
                    priority: i + 1,
                    status: 'pending'
                });
            }
            return tasks;
        }

        // Split by conjunctions
        const parts = instruction.split(/\s*(?:,\s+и\s+|;\s+|\.\s+(?:Также|Потом|Затем|Also|Then)\s+)/i);
        if (parts.length >= 2) {
            for (let i = 0; i < parts.length; i++) {
                const desc = parts[i].trim();
                if (desc.length < 10) continue;
                tasks.push({
                    id: `sub_${i + 1}`,
                    description: desc,
                    specialist: this.detectSpecialty(desc),
                    dependencies: [],
                    priority: i + 1,
                    status: 'pending'
                });
            }
            return tasks;
        }

        // Can't decompose — return as single task
        tasks.push({
            id: 'main',
            description: instruction,
            specialist: this.detectSpecialty(instruction),
            dependencies: [],
            priority: 1,
            status: 'pending'
        });

        return tasks;
    }

    /**
     * Determine execution strategy.
     */
    private determineStrategy(subTasks: SubTask[]): 'sequential' | 'parallel' | 'mixed' {
        const hasDeps = subTasks.some(t => t.dependencies.length > 0);
        if (!hasDeps) return 'parallel';
        if (subTasks.every(t => t.dependencies.length > 0 || t.id === subTasks[0].id)) return 'sequential';
        return 'mixed';
    }

    /**
     * Execute sub-tasks in parallel with dependency tracking.
     */
    async executeParallel(
        decomposition: DecompositionResult,
        executor: (instruction: string) => Promise<string>,
        progressCallback?: (event: ProgressEvent) => void
    ): Promise<string> {
        const { subTasks, strategy } = decomposition;

        for (const st of subTasks) {
            this.activeSubTasks.set(st.id, st);
        }

        if (strategy === 'sequential') {
            for (const st of subTasks) {
                st.status = 'running';
                progressCallback?.({
                    type: 'reasoning_step',
                    message: `▶️ Sub-task: ${st.description}`,
                    reasoning_text: `Specialist: ${st.specialist}`
                });
                try {
                    st.result = await executor(st.description);
                    st.status = 'completed';
                } catch (err: any) {
                    st.status = 'failed';
                    st.result = `Error: ${err.message}`;
                }
            }
        } else {
            const completed = new Set<string>();
            const maxWaves = 10;
            let wave = 0;

            while (completed.size < subTasks.length && wave < maxWaves) {
                wave++;
                const ready = subTasks.filter(
                    st => st.status === 'pending' &&
                        st.dependencies.every(d => completed.has(d))
                );

                if (ready.length === 0) break;

                const batch = ready.slice(0, this.config.maxParallelAgents);
                for (const st of batch) st.status = 'running';

                progressCallback?.({
                    type: 'reasoning_step',
                    message: `🔄 Wave ${wave}: ${batch.length} sub-tasks in parallel`,
                    reasoning_text: batch.map(st => st.description).join('\n')
                });

                const results = await Promise.allSettled(
                    batch.map(st => executor(st.description))
                );

                for (let i = 0; i < batch.length; i++) {
                    const st = batch[i];
                    const res = results[i];
                    if (res.status === 'fulfilled') {
                        st.result = res.value;
                        st.status = 'completed';
                    } else {
                        st.result = `Error: ${res.reason?.message || 'unknown'}`;
                        st.status = 'failed';
                    }
                    completed.add(st.id);
                }
            }
        }

        return this.mergeResults(subTasks);
    }

    /**
     * Merge sub-task results.
     */
    mergeResults(subTasks: SubTask[]): string {
        const completed = subTasks.filter(t => t.status === 'completed' && t.result);

        if (completed.length === 0) return 'No results from sub-tasks';
        if (completed.length === 1) return String(completed[0].result);

        const sections = completed.map(t =>
            `### ${t.description}\n${String(t.result)}`
        );

        return sections.join('\n\n---\n\n');
    }

    /**
     * Get status of all sub-tasks.
     */
    getStatus(): SubTask[] {
        return [...this.activeSubTasks.values()];
    }
}
