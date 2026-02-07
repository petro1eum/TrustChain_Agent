/**
 * Gap H: Event Trigger Service — Webhook-driven Agent Tasks
 *
 * Позволяет настраивать автоматические реакции агента на внешние события:
 * новый PR, обновление данных, webhook от CI/CD и т.д.
 */

// ─── Типы ───

export type EventType =
    | 'webhook'            // Generic webhook
    | 'new_pr'             // Новый Pull Request
    | 'data_update'        // Обновление данных в каталоге
    | 'schedule'           // Расписание (cron-like)
    | 'file_change'        // Изменение файлов
    | 'error_alert'        // Ошибка в системе
    | 'custom';            // Пользовательский

export interface EventTrigger {
    id: string;
    name: string;
    eventType: EventType;
    pattern?: string;          // Regex или glob для фильтрации событий
    agentInstruction: string;  // Инструкция для агента
    enabled: boolean;
    createdAt: number;
    lastTriggered?: number;
    triggerCount: number;
    cooldownMs: number;        // Минимальный интервал между срабатываниями
}

export interface EventPayload {
    eventType: EventType;
    source: string;
    data: Record<string, any>;
    timestamp: number;
}

export interface TriggerResult {
    triggerId: string;
    eventPayload: EventPayload;
    matched: boolean;
    executed: boolean;
    taskId?: string;       // ID созданной задачи в TaskQueueService
    error?: string;
}

export interface EventTriggerConfig {
    maxTriggersPerHour: number;
    defaultCooldownMs: number;
    enabled: boolean;
}

// ─── Константы ───

const DEFAULT_CONFIG: EventTriggerConfig = {
    maxTriggersPerHour: 20,
    defaultCooldownMs: 60000, // 1 минута
    enabled: true
};

const STORAGE_KEY = 'kb_agent_event_triggers';

// ─── Сервис ───

export class EventTriggerService {
    private triggers: Map<string, EventTrigger> = new Map();
    private config: EventTriggerConfig;
    private triggerCountThisHour: number = 0;
    private hourStart: number = Date.now();

    constructor(config?: Partial<EventTriggerConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.loadTriggers();
    }

    // ──────────────────────────────────────────────
    // Trigger Management
    // ──────────────────────────────────────────────

    /**
     * Регистрирует новый триггер
     */
    registerTrigger(
        name: string,
        eventType: EventType,
        agentInstruction: string,
        options?: { pattern?: string; cooldownMs?: number }
    ): EventTrigger {
        const trigger: EventTrigger = {
            id: `trigger_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name,
            eventType,
            pattern: options?.pattern,
            agentInstruction,
            enabled: true,
            createdAt: Date.now(),
            triggerCount: 0,
            cooldownMs: options?.cooldownMs || this.config.defaultCooldownMs
        };

        this.triggers.set(trigger.id, trigger);
        this.saveTriggers();
        console.log(`[EventTrigger] Registered: "${name}" for ${eventType}`);

        return trigger;
    }

    /**
     * Удаляет триггер
     */
    removeTrigger(triggerId: string): boolean {
        const result = this.triggers.delete(triggerId);
        if (result) this.saveTriggers();
        return result;
    }

    /**
     * Включает/выключает триггер
     */
    setTriggerEnabled(triggerId: string, enabled: boolean): void {
        const trigger = this.triggers.get(triggerId);
        if (trigger) {
            trigger.enabled = enabled;
            this.saveTriggers();
        }
    }

    // ──────────────────────────────────────────────
    // Event Processing
    // ──────────────────────────────────────────────

    /**
     * Обрабатывает входящее событие — находит matching triggers и выполняет
     */
    processTrigger(event: EventPayload): TriggerResult[] {
        if (!this.config.enabled) return [];

        // Rate limiting
        this.resetHourlyCountIfNeeded();
        if (this.triggerCountThisHour >= this.config.maxTriggersPerHour) {
            console.warn('[EventTrigger] Hourly limit reached');
            return [];
        }

        const results: TriggerResult[] = [];

        for (const [, trigger] of this.triggers) {
            if (!trigger.enabled) continue;
            if (trigger.eventType !== event.eventType && trigger.eventType !== 'custom') continue;

            // Check cooldown
            if (trigger.lastTriggered &&
                Date.now() - trigger.lastTriggered < trigger.cooldownMs) {
                continue;
            }

            // Check pattern match
            if (trigger.pattern) {
                const eventStr = JSON.stringify(event.data);
                try {
                    const regex = new RegExp(trigger.pattern, 'i');
                    if (!regex.test(eventStr) && !regex.test(event.source)) {
                        results.push({
                            triggerId: trigger.id,
                            eventPayload: event,
                            matched: false,
                            executed: false
                        });
                        continue;
                    }
                } catch {
                    // Invalid regex — skip pattern check
                }
            }

            // Match found — prepare instruction with event data
            const enrichedInstruction = this.enrichInstruction(trigger.agentInstruction, event);

            trigger.lastTriggered = Date.now();
            trigger.triggerCount++;
            this.triggerCountThisHour++;

            results.push({
                triggerId: trigger.id,
                eventPayload: event,
                matched: true,
                executed: true,
                // taskId will be set by the caller (who creates the actual task)
            });

            console.log(`[EventTrigger] Matched: "${trigger.name}" → task created`);
        }

        this.saveTriggers();
        return results;
    }

    /**
     * Обогащает инструкцию агента данными события
     */
    private enrichInstruction(instruction: string, event: EventPayload): string {
        return `${instruction}

=== EVENT DATA ===
Type: ${event.eventType}
Source: ${event.source}
Timestamp: ${new Date(event.timestamp).toISOString()}
Data: ${JSON.stringify(event.data, null, 2).slice(0, 2000)}`;
    }

    // ──────────────────────────────────────────────
    // Query
    // ──────────────────────────────────────────────

    getAllTriggers(): EventTrigger[] {
        return [...this.triggers.values()];
    }

    getEnabledTriggers(): EventTrigger[] {
        return [...this.triggers.values()].filter(t => t.enabled);
    }

    getTrigger(triggerId: string): EventTrigger | undefined {
        return this.triggers.get(triggerId);
    }

    // ──────────────────────────────────────────────
    // Persistence
    // ──────────────────────────────────────────────

    private saveTriggers(): void {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                const data = [...this.triggers.values()];
                localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            }
        } catch {
            // ignore
        }
    }

    private loadTriggers(): void {
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (raw) {
                    const data = JSON.parse(raw) as EventTrigger[];
                    for (const trigger of data) {
                        this.triggers.set(trigger.id, trigger);
                    }
                }
            }
        } catch {
            // ignore
        }
    }

    private resetHourlyCountIfNeeded(): void {
        if (Date.now() - this.hourStart > 60 * 60 * 1000) {
            this.triggerCountThisHour = 0;
            this.hourStart = Date.now();
        }
    }
}
