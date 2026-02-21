/**
 * Scheduler Service — Cron Jobs for TrustChain Agent
 * 
 * Inspired by OpenClaw's "Chrome Jobs" (Cron Jobs).
 * Allows scheduling automated tasks at specific times using cron expressions.
 * 
 * Each scheduled job:
 *   - Has a cron expression (minute, hour, day, month, weekday)
 *   - Runs as a spawned sub-agent session via SessionSpawnService
 *   - Results are signed with TrustChain
 *   - Persisted in localStorage (and optionally .trustchain/jobs/)
 */

import { dockerAgentService } from '../dockerAgentService';

// ─── Types ───

export interface ScheduledJob {
    /** Unique job ID */
    id: string;
    /** Human-readable name */
    name: string;
    /** Cron expression: "min hour day month weekday" (e.g. "0 9 * * *" = daily 9am) */
    schedule: string;
    /** Instruction for the agent */
    instruction: string;
    /** Tool whitelist for the sub-agent */
    tools?: string[];
    /** Where to push results (chat channel / notification) */
    channel?: string;
    /** Is job enabled? */
    enabled: boolean;
    /** Timestamps */
    createdAt: number;
    lastRunAt?: number;
    nextRunAt?: number;
    /** Number of times this job has executed */
    runCount: number;
    /** Last run ID (from SessionSpawnService) */
    lastRunId?: string;
    /** Last run status */
    lastRunStatus?: 'completed' | 'failed';
}

export interface SchedulerConfig {
    /** Check interval in ms (default: 60000 = 1 minute) */
    checkIntervalMs: number;
    /** Max jobs (default: 20) */
    maxJobs: number;
    /** Enable scheduler (default: true) */
    enabled: boolean;
}

// ─── Constants ───

const DEFAULT_CONFIG: SchedulerConfig = {
    checkIntervalMs: 60000,
    maxJobs: 20,
    enabled: true,
};

const STORAGE_KEY = 'trustchain_scheduled_jobs';

// ─── Cron Parser (minimal) ───

interface CronFields {
    minute: number[];
    hour: number[];
    dayOfMonth: number[];
    month: number[];
    dayOfWeek: number[];
}

function parseCronField(field: string, min: number, max: number): number[] {
    if (field === '*') return Array.from({ length: max - min + 1 }, (_, i) => i + min);

    const values: number[] = [];
    for (const part of field.split(',')) {
        if (part.includes('/')) {
            const [range, stepStr] = part.split('/');
            const step = parseInt(stepStr, 10);
            const start = range === '*' ? min : parseInt(range, 10);
            for (let i = start; i <= max; i += step) values.push(i);
        } else if (part.includes('-')) {
            const [a, b] = part.split('-').map(Number);
            for (let i = a; i <= b; i++) values.push(i);
        } else {
            values.push(parseInt(part, 10));
        }
    }
    return values.filter(v => v >= min && v <= max);
}

function parseCron(expression: string): CronFields {
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) throw new Error(`Invalid cron expression: "${expression}" (need 5 fields)`);
    return {
        minute: parseCronField(parts[0], 0, 59),
        hour: parseCronField(parts[1], 0, 23),
        dayOfMonth: parseCronField(parts[2], 1, 31),
        month: parseCronField(parts[3], 1, 12),
        dayOfWeek: parseCronField(parts[4], 0, 6),
    };
}

function shouldRunNow(expression: string): boolean {
    try {
        const fields = parseCron(expression);
        const now = new Date();
        return (
            fields.minute.includes(now.getMinutes()) &&
            fields.hour.includes(now.getHours()) &&
            fields.dayOfMonth.includes(now.getDate()) &&
            fields.month.includes(now.getMonth() + 1) &&
            fields.dayOfWeek.includes(now.getDay())
        );
    } catch {
        return false;
    }
}

function getNextRun(expression: string): number | undefined {
    try {
        const fields = parseCron(expression);
        const now = new Date();
        // Simple: find next matching minute within the next 48 hours
        for (let offset = 1; offset <= 2880; offset++) {
            const candidate = new Date(now.getTime() + offset * 60000);
            if (
                fields.minute.includes(candidate.getMinutes()) &&
                fields.hour.includes(candidate.getHours()) &&
                fields.dayOfMonth.includes(candidate.getDate()) &&
                fields.month.includes(candidate.getMonth() + 1) &&
                fields.dayOfWeek.includes(candidate.getDay())
            ) {
                return candidate.getTime();
            }
        }
    } catch { /* invalid cron */ }
    return undefined;
}

// ─── Service ───

export class SchedulerService {
    private jobs: Map<string, ScheduledJob> = new Map();
    private config: SchedulerConfig;
    private checkInterval: ReturnType<typeof setInterval> | null = null;

    constructor(config?: Partial<SchedulerConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.loadJobs();
    }

    // Not needed since we run natively via dockerAgentService

    /** Start the scheduler loop. */
    start(): void {
        if (this.checkInterval) return;
        if (!this.config.enabled) return;

        this.checkInterval = setInterval(() => this.tick(), this.config.checkIntervalMs);
        console.log(`[Scheduler] Started (interval: ${this.config.checkIntervalMs}ms, jobs: ${this.jobs.size})`);
    }

    /** Stop the scheduler loop. */
    stop(): void {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        console.log('[Scheduler] Stopped');
    }

    /** Manual tick — check all jobs and run due ones. */
    tick(): void {
        for (const job of this.jobs.values()) {
            if (!job.enabled) continue;
            if (shouldRunNow(job.schedule)) {
                // Debounce: don't re-run if last run was within 2 minutes
                if (job.lastRunAt && (Date.now() - job.lastRunAt) < 120000) continue;
                this.runJob(job.id);
            }
        }
    }

    // ─── CRUD ───

    /** Create a new scheduled job. */
    createJob(params: {
        name: string;
        schedule: string;
        instruction: string;
        tools?: string[];
        channel?: string;
    }): ScheduledJob {
        if (this.jobs.size >= this.config.maxJobs) {
            throw new Error(`Max jobs reached (${this.config.maxJobs})`);
        }

        // Validate cron
        parseCron(params.schedule);

        const job: ScheduledJob = {
            id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: params.name,
            schedule: params.schedule,
            instruction: params.instruction,
            tools: params.tools,
            channel: params.channel,
            enabled: true,
            createdAt: Date.now(),
            runCount: 0,
            nextRunAt: getNextRun(params.schedule),
        };

        this.jobs.set(job.id, job);
        this.saveJobs();
        console.log(`[Scheduler] Created job "${job.name}" (${job.schedule}) → ${job.id}`);
        return job;
    }

    /** Delete a job. */
    deleteJob(jobId: string): boolean {
        const deleted = this.jobs.delete(jobId);
        if (deleted) this.saveJobs();
        return deleted;
    }

    /** Toggle a job enabled/disabled. */
    toggleJob(jobId: string): boolean {
        const job = this.jobs.get(jobId);
        if (!job) return false;
        job.enabled = !job.enabled;
        if (job.enabled) job.nextRunAt = getNextRun(job.schedule);
        this.saveJobs();
        return true;
    }

    /** Get all jobs. */
    getAllJobs(): ScheduledJob[] {
        return Array.from(this.jobs.values()).sort((a, b) => a.createdAt - b.createdAt);
    }

    /** Get a job by ID. */
    getJob(jobId: string): ScheduledJob | undefined {
        return this.jobs.get(jobId);
    }

    async runJob(jobId: string): Promise<string | null> {
        const job = this.jobs.get(jobId);
        if (!job) return null;

        try {
            const result = await dockerAgentService.sessionSpawn({
                name: `cron:${job.name}`,
                instruction: job.instruction,
                tools: job.tools,
                priority: 'normal',
                sync: false
            });

            job.lastRunAt = Date.now();
            job.runCount++;
            job.lastRunId = result.run_id;
            job.nextRunAt = getNextRun(job.schedule);

            this.saveJobs();
            return result.run_id;
        } catch (err: any) {
            console.error(`[Scheduler] Failed to run job "${job.name}": ${err.message}`);
            return null;
        }
    }

    // ─── Persistence ───

    private saveJobs(): void {
        try {
            const data = Array.from(this.jobs.values());
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch { /* quota */ }
    }

    private loadJobs(): void {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const data: ScheduledJob[] = JSON.parse(raw);
            for (const job of data) {
                this.jobs.set(job.id, job);
            }
        } catch { /* corrupt */ }
    }
}

// ─── Singleton ───

export const schedulerService = new SchedulerService();
