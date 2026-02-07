/**
 * Gap A: Персистентная память агента между сессиями
 * 
 * Автоматически извлекает и сохраняет ключевые решения, предпочтения
 * и знания о проекте. Загружает их при старте новой сессии.
 */

import type OpenAI from 'openai';

// ─── Типы ───

export type MemoryCategory =
    | 'preference'          // Предпочтения пользователя (язык, формат, модель)
    | 'decision'            // Принятые решения (архитектурные, технические)
    | 'project_structure'   // Структура проекта (ключевые файлы, конвенции)
    | 'tool_pattern'        // Паттерны использования инструментов
    | 'domain_knowledge';   // Доменные знания (бренды, стандарты, номенклатура)

export interface MemoryEntry {
    id: string;
    key: string;
    value: string;
    category: MemoryCategory;
    confidence: number;   // 0.0 - 1.0
    timestamp: number;
    sourceSession?: string;
    accessCount: number;
}

export interface PersistentMemoryStore {
    version: number;
    entries: MemoryEntry[];
    lastUpdated: number;
}

export interface PersistentMemoryDeps {
    openai?: OpenAI;
    getApiParams?: (params: any) => any;
}

// ─── Константы ───

const MEMORY_STORAGE_KEY = 'kb_agent_persistent_memory';
const MAX_ENTRIES = 200;
const MAX_RELEVANT_ENTRIES = 10;
const MEMORY_VERSION = 1;

// Backend URL для серверного хранения
const _proc = typeof process !== 'undefined' ? process.env : {} as Record<string, string | undefined>;
const BACKEND_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_URL)
    || _proc.VITE_BACKEND_URL
    || 'http://localhost:8000';

// ─── Сервис ───

export class PersistentMemoryService {
    private store: PersistentMemoryStore = {
        version: MEMORY_VERSION,
        entries: [],
        lastUpdated: 0
    };
    private loaded = false;
    private deps?: PersistentMemoryDeps;

    constructor(deps?: PersistentMemoryDeps) {
        this.deps = deps;
    }

    // ──────────────────────────────────────────────
    // Загрузка / Сохранение
    // ──────────────────────────────────────────────

    /**
     * Загружает память при старте сессии.
     * Пробует backend API, fallback на localStorage.
     */
    async loadMemory(): Promise<void> {
        if (this.loaded) return;

        try {
            // Попытка загрузить с backend
            const response = await fetch(`${BACKEND_URL}/api/agent/memory`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.ok) {
                const data = await response.json();
                if (data && data.entries) {
                    this.store = data;
                    this.loaded = true;
                    console.log(`[PersistentMemory] Loaded ${this.store.entries.length} entries from backend`);
                    return;
                }
            }
        } catch {
            // Backend недоступен — пробуем localStorage
        }

        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                const raw = localStorage.getItem(MEMORY_STORAGE_KEY);
                if (raw) {
                    this.store = JSON.parse(raw);
                    console.log(`[PersistentMemory] Loaded ${this.store.entries.length} entries from localStorage`);
                }
            }
        } catch {
            console.warn('[PersistentMemory] Failed to load from localStorage');
        }

        this.loaded = true;
    }

    /**
     * Сохраняет память.
     * Пробует backend API, fallback на localStorage.
     */
    async saveMemory(): Promise<void> {
        this.store.lastUpdated = Date.now();

        // Ограничиваем размер хранилища
        if (this.store.entries.length > MAX_ENTRIES) {
            // Удаляем самые старые и наименее используемые
            this.store.entries.sort((a, b) => {
                const scoreA = a.accessCount * 0.3 + (a.confidence * 0.3) + (a.timestamp / Date.now() * 0.4);
                const scoreB = b.accessCount * 0.3 + (b.confidence * 0.3) + (b.timestamp / Date.now() * 0.4);
                return scoreB - scoreA;
            });
            this.store.entries = this.store.entries.slice(0, MAX_ENTRIES);
        }

        try {
            await fetch(`${BACKEND_URL}/api/agent/memory`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.store)
            });
            console.log(`[PersistentMemory] Saved ${this.store.entries.length} entries to backend`);
            return;
        } catch {
            // Backend недоступен
        }

        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(this.store));
                console.log(`[PersistentMemory] Saved ${this.store.entries.length} entries to localStorage`);
            }
        } catch {
            console.warn('[PersistentMemory] Failed to save to localStorage');
        }
    }

    // ──────────────────────────────────────────────
    // CRUD операции
    // ──────────────────────────────────────────────

    /**
     * Добавляет или обновляет запись в памяти
     */
    addEntry(entry: Omit<MemoryEntry, 'id' | 'timestamp' | 'accessCount'>): void {
        // Проверяем, нет ли уже такой записи
        const existing = this.store.entries.find(
            e => e.key === entry.key && e.category === entry.category
        );

        if (existing) {
            existing.value = entry.value;
            existing.confidence = Math.max(existing.confidence, entry.confidence);
            existing.timestamp = Date.now();
            existing.accessCount++;
        } else {
            this.store.entries.push({
                ...entry,
                id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                timestamp: Date.now(),
                accessCount: 0
            });
        }
    }

    /**
     * Получает записи по категории
     */
    getByCategory(category: MemoryCategory): MemoryEntry[] {
        return this.store.entries.filter(e => e.category === category);
    }

    /**
     * Получает все записи
     */
    getAllEntries(): MemoryEntry[] {
        return [...this.store.entries];
    }

    // ──────────────────────────────────────────────
    // Поиск релевантных записей
    // ──────────────────────────────────────────────

    /**
     * Находит релевантные записи для текущего запроса (keyword match)
     */
    getRelevantMemories(query: string): MemoryEntry[] {
        const queryLower = query.toLowerCase();
        const keywords = this.extractKeywords(queryLower);

        if (keywords.length === 0) {
            // Возвращаем самые важные (high confidence + frequent access)
            return this.store.entries
                .sort((a, b) => (b.confidence * b.accessCount) - (a.confidence * a.accessCount))
                .slice(0, 5);
        }

        const scored = this.store.entries.map(entry => {
            const entryText = `${entry.key} ${entry.value}`.toLowerCase();
            let score = 0;

            for (const kw of keywords) {
                if (entryText.includes(kw)) {
                    score += 2;
                }
            }

            // Бонус за высокую confidence и частое использование
            score += entry.confidence * 0.5;
            score += Math.min(entry.accessCount, 10) * 0.1;

            return { entry, score };
        });

        const relevant = scored
            .filter(s => s.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, MAX_RELEVANT_ENTRIES)
            .map(s => {
                // Увеличиваем счётчик доступа
                s.entry.accessCount++;
                return s.entry;
            });

        return relevant;
    }

    // ──────────────────────────────────────────────
    // Автоматическое извлечение знаний
    // ──────────────────────────────────────────────

    /**
     * Извлекает ключевые факты из завершённого диалога.
     * Использует LLM для семантического анализа.
     * Fallback на regex-based extraction.
     */
    async autoExtractMemories(
        messages: Array<{ role: string; content?: string }>,
        sessionId?: string
    ): Promise<Array<Omit<MemoryEntry, 'id' | 'timestamp' | 'accessCount'>>> {
        const extracted: Array<Omit<MemoryEntry, 'id' | 'timestamp' | 'accessCount'>> = [];

        // Regex-based extraction (всегда работает)
        extracted.push(...this.regexExtract(messages, sessionId));

        // LLM-based extraction (если доступен)
        if (this.deps?.openai) {
            try {
                const llmEntries = await this.llmExtract(messages, sessionId);
                extracted.push(...llmEntries);
            } catch (error) {
                console.warn('[PersistentMemory] LLM extraction failed:', error);
            }
        }

        // Добавляем извлечённые записи
        for (const entry of extracted) {
            this.addEntry(entry);
        }

        // Сохраняем
        if (extracted.length > 0) {
            await this.saveMemory();
        }

        return extracted;
    }

    /**
     * Regex-based extraction: извлекает предпочтения и решения из контекста
     */
    private regexExtract(
        messages: Array<{ role: string; content?: string }>,
        sessionId?: string
    ): Array<Omit<MemoryEntry, 'id' | 'timestamp' | 'accessCount'>> {
        const results: Array<Omit<MemoryEntry, 'id' | 'timestamp' | 'accessCount'>> = [];

        for (const msg of messages) {
            if (!msg.content) continue;
            const content = msg.content;

            // Предпочтения: "используй X", "предпочитаю X", "всегда делай X"
            const prefPatterns = [
                /(?:используй|предпочитаю|всегда|по умолчанию)\s+(.{5,80})/gi,
                /(?:use|prefer|always|default)\s+(.{5,80})/gi,
            ];

            for (const pattern of prefPatterns) {
                let match;
                while ((match = pattern.exec(content)) !== null) {
                    if (msg.role === 'user') {
                        results.push({
                            key: `pref_${match[1].slice(0, 30).trim()}`,
                            value: match[1].trim(),
                            category: 'preference',
                            confidence: 0.6,
                            sourceSession: sessionId
                        });
                    }
                }
            }

            // Решения: "решили что X", "выбрали X", "определили X" 
            const decisionPatterns = [
                /(?:решили|выбрали|определили|договорились)\s+(?:что\s+)?(.{5,120})/gi,
                /(?:decided|chose|agreed|selected)\s+(?:that\s+)?(.{5,120})/gi,
            ];

            for (const pattern of decisionPatterns) {
                let match;
                while ((match = pattern.exec(content)) !== null) {
                    results.push({
                        key: `decision_${match[1].slice(0, 30).trim()}`,
                        value: match[1].trim(),
                        category: 'decision',
                        confidence: 0.7,
                        sourceSession: sessionId
                    });
                }
            }
        }

        return results;
    }

    /**
     * LLM-based extraction: семантический анализ диалога
     */
    private async llmExtract(
        messages: Array<{ role: string; content?: string }>,
        sessionId?: string
    ): Promise<Array<Omit<MemoryEntry, 'id' | 'timestamp' | 'accessCount'>>> {
        if (!this.deps?.openai) return [];

        // Берём последние 10 сообщений для экономии токенов
        const recentMessages = messages
            .filter(m => m.content && (m.role === 'user' || m.role === 'assistant'))
            .slice(-10)
            .map(m => `[${m.role}]: ${m.content!.slice(0, 300)}`)
            .join('\n');

        if (recentMessages.length < 50) return [];

        const extractionPrompt = `Analyze this conversation and extract key facts that should be remembered for future sessions.
Return a JSON array of objects with fields: key (short identifier), value (fact description), category (one of: preference, decision, project_structure, tool_pattern, domain_knowledge), confidence (0.0-1.0).

Extract ONLY non-obvious, reusable facts. Skip greetings, generic questions, temporary states.

Conversation:
${recentMessages}

Reply ONLY with a valid JSON array. If nothing worth remembering, reply with [].`;

        try {
            const apiParams = this.deps.getApiParams?.({
                model: 'google/gemini-2.5-flash-lite',
                messages: [
                    { role: 'system', content: 'You are a memory extraction system. Output only valid JSON.' },
                    { role: 'user', content: extractionPrompt }
                ],
                temperature: 0.1,
                max_tokens: 1000,
                stream: false
            }) || {
                model: 'google/gemini-2.5-flash-lite',
                messages: [
                    { role: 'system', content: 'You are a memory extraction system. Output only valid JSON.' },
                    { role: 'user', content: extractionPrompt }
                ],
                temperature: 0.1,
                max_tokens: 1000
            };

            const response = await this.deps.openai.chat.completions.create(apiParams);
            const content = response.choices?.[0]?.message?.content?.trim() || '[]';

            // Парсим JSON (может быть обёрнут в ```json```)
            const jsonStr = content.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
            const parsed = JSON.parse(jsonStr);

            if (!Array.isArray(parsed)) return [];

            return parsed
                .filter((e: any) => e.key && e.value && e.category)
                .map((e: any) => ({
                    key: String(e.key).slice(0, 50),
                    value: String(e.value).slice(0, 200),
                    category: (['preference', 'decision', 'project_structure', 'tool_pattern', 'domain_knowledge'].includes(e.category)
                        ? e.category : 'decision') as MemoryCategory,
                    confidence: Math.min(1, Math.max(0, Number(e.confidence) || 0.5)),
                    sourceSession: sessionId
                }));
        } catch (error) {
            console.warn('[PersistentMemory] LLM extraction parse error:', error);
            return [];
        }
    }

    // ──────────────────────────────────────────────
    // Форматирование для system prompt
    // ──────────────────────────────────────────────

    /**
     * Форматирует релевантные записи для вставки в system prompt
     */
    formatMemoriesForPrompt(query: string): string {
        const relevant = this.getRelevantMemories(query);
        if (relevant.length === 0) return '';

        const grouped: Record<string, MemoryEntry[]> = {};
        for (const entry of relevant) {
            if (!grouped[entry.category]) grouped[entry.category] = [];
            grouped[entry.category].push(entry);
        }

        const sections: string[] = ['=== PERSISTENT MEMORY (cross-session) ==='];

        const categoryLabels: Record<string, string> = {
            preference: '🔧 Предпочтения пользователя',
            decision: '📌 Принятые решения',
            project_structure: '📁 Структура проекта',
            tool_pattern: '⚙️ Паттерны инструментов',
            domain_knowledge: '📚 Доменные знания'
        };

        for (const [cat, entries] of Object.entries(grouped)) {
            sections.push(`\n${categoryLabels[cat] || cat}:`);
            for (const entry of entries) {
                sections.push(`  - ${entry.value}`);
            }
        }

        return sections.join('\n');
    }

    // ──────────────────────────────────────────────
    // Утилиты
    // ──────────────────────────────────────────────

    private extractKeywords(text: string): string[] {
        const stopWords = new Set([
            'и', 'в', 'на', 'с', 'по', 'для', 'из', 'к', 'от', 'до', 'не', 'что', 'как', 'это',
            'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'to', 'of', 'and', 'in', 'for'
        ]);

        return text
            .split(/\s+/)
            .filter(w => w.length > 3 && !stopWords.has(w))
            .slice(0, 10);
    }

    /**
     * Количество записей
     */
    get size(): number {
        return this.store.entries.length;
    }

    /**
     * Очистка всей памяти
     */
    async clearAll(): Promise<void> {
        this.store.entries = [];
        this.store.lastUpdated = Date.now();
        await this.saveMemory();
    }
}
