/**
 * Утилиты для извлечения и сопоставления верифицированных фактов
 * из TrustChain-подписанных tool responses
 */

import type { MessageEvent, ToolResultEvent } from '../agents/types';
import type { VerificationInfo } from '../components/agents/components/VerifiedFact';

export interface VerifiedFactEntry {
    text: string;
    verification: VerificationInfo;
}

/**
 * Извлекает верифицированные факты из событий сообщения
 * Извлекает идентификаторы, названия и другие ключевые данные
 */
export function extractVerifiedFacts(events: MessageEvent[]): Map<string, VerificationInfo> {
    const factsMap = new Map<string, VerificationInfo>();

    // DEBUG: Логируем что приходит
    console.log('[extractVerifiedFacts] events count:', events.length);
    console.log('[extractVerifiedFacts] events types:', events.map(e => e.type));

    // Находим все tool_result события
    const toolResults = events.filter(
        (e): e is ToolResultEvent => e.type === 'tool_result'
    );

    console.log('[extractVerifiedFacts] toolResults count:', toolResults.length);

    // Проверяем каждый tool_result на наличие подписи (может быть в разных местах)
    for (const event of toolResults) {
        const result = event.result;
        if (!result) continue;

        // Signature может быть:
        // 1. В event.signature (если скопирована наверх)
        // 2. В event.result.signature (если осталась в result)
        const signature = event.signature || result.signature;
        const certificate = event.certificate || result.certificate;
        const signatureId = (event as any).signature_id || result.signature_id || event.id;
        const timestamp = (event as any).timestamp || result.timestamp || Date.now() / 1000;

        console.log('[extractVerifiedFacts] checking result:', {
            hasEventSignature: !!event.signature,
            hasResultSignature: !!result.signature,
            hasCertificate: !!certificate
        });

        if (!signature || !certificate) continue;

        const verification: VerificationInfo = {
            signature,
            signatureId,
            timestamp,
            certificate
        };

        // Извлекаем факты из результата (result может содержать data или быть данными напрямую)
        const dataToExtract = result.data || result;
        const facts = extractFactsFromResult(dataToExtract);

        console.log('[extractVerifiedFacts] extracted facts:', facts.length);

        for (const fact of facts) {
            // Добавляем факт в map (если ещё нет)
            if (!factsMap.has(fact)) {
                factsMap.set(fact, verification);
            }
        }
    }

    console.log('[extractVerifiedFacts] total verified facts:', factsMap.size);
    return factsMap;
}

/**
 * Извлекает ключевые факты из результата tool call
 */
function extractFactsFromResult(result: any): string[] {
    const facts: string[] = [];

    if (!result) return facts;

    // Если это объект с data
    const data = result.data || result;

    // Собираем все item-ы из разных форматов ответов
    const allItems: any[] = [];

    // 1. Прямые массивы items/products и domain-specific collections
    const arrayFields = ['items', 'products', 'tasks', 'documents', 'contracts',
        'meetings', 'vacancies', 'employees', 'organizations',
        'hits', 'results'];
    for (const field of arrayFields) {
        if (Array.isArray(data[field])) {
            allItems.push(...data[field]);
        }
    }
    if (Array.isArray(data)) {
        allItems.push(...data);
    }

    // 2. match_results_preview — результат match/specification tools
    // Формат: [{spec_row, spec_query, found_items: [{name, article, vendor, ...}], ...}]
    if (Array.isArray(data.match_results_preview)) {
        for (const row of data.match_results_preview) {
            if (Array.isArray(row.found_items)) {
                allItems.push(...row.found_items);
            }
        }
    }

    // 3. hits — результат поиска OpenSearch
    if (Array.isArray(data.hits)) {
        allItems.push(...data.hits);
    }

    // Извлекаем факты из собранных items
    for (const item of allItems) {
        if (!item || typeof item !== 'object') continue;

        // === Identifiers & catalog fields ===
        if (item.article) facts.push(item.article);
        if (item.art) facts.push(item.art);
        if (item.vendor_code) facts.push(item.vendor_code);
        if (item.sku) facts.push(item.sku);
        if (item.brand && item.brand.length > 2) facts.push(item.brand);
        if (item.category && item.category.length > 3) facts.push(item.category);

        // === Common entity fields (OnaiDocs: tasks, documents, contracts, etc.) ===
        if (item.name && item.name.length > 3) facts.push(item.name);
        if (item.title && item.title.length > 3) facts.push(item.title);
        if (item.number) facts.push(item.number);
        if (item.reg_number) facts.push(item.reg_number);
        if (item.doc_id) facts.push(item.doc_id);

        // === People fields ===
        if (item.assignee_name) facts.push(item.assignee_name);
        if (item.author_name) facts.push(item.author_name);
        if (item.org_name && item.org_name.length > 3) facts.push(item.org_name);

        // === Status / priority ===
        if (item.status && item.status.length > 2) facts.push(item.status);
        if (item.priority && item.priority.length > 2) facts.push(item.priority);
    }

    // Если результат - строка, ищем паттерны идентификаторов и номеров
    if (typeof data === 'string') {
        // Паттерн идентификаторов: XXX-XXXX
        const articlePattern = /\b\d{3}-\d{4}\b/g;
        const matches = data.match(articlePattern);
        if (matches) {
            facts.push(...matches);
        }
        // Task/doc numbers: 01-125, 02-32
        const taskNumberPattern = /\b\d{2,3}-\d{2,4}\b/g;
        const taskMatches = data.match(taskNumberPattern);
        if (taskMatches) {
            facts.push(...taskMatches);
        }
    }

    return facts;
}

/**
 * Заменяет верифицированные факты в тексте на маркированные версии
 * Возвращает текст с маркерами ##VERIFIED:id## вокруг фактов
 */
export function markVerifiedFacts(text: string, factsMap: Map<string, VerificationInfo>): string {
    if (factsMap.size === 0) return text;

    let markedText = text;

    // Сортируем факты по длине (длинные сначала) чтобы избежать частичных замен
    const sortedFacts = Array.from(factsMap.keys()).sort((a, b) => b.length - a.length);

    for (const fact of sortedFacts) {
        // Экранируем специальные символы regex
        const escapedFact = fact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Заменяем все вхождения факта на маркированную версию
        // Используем word boundaries где возможно
        const regex = new RegExp(`(${escapedFact})`, 'g');
        markedText = markedText.replace(regex, `##VERIFIED_START##$1##VERIFIED_END##`);
    }

    return markedText;
}

/**
 * Проверяет, является ли текст верифицированным фактом
 */
export function isVerifiedFact(text: string, factsMap: Map<string, VerificationInfo>): VerificationInfo | null {
    // Точное совпадение
    if (factsMap.has(text)) {
        return factsMap.get(text)!;
    }

    // Проверяем содержится ли текст в каком-либо факте
    for (const [fact, verification] of factsMap.entries()) {
        if (fact.includes(text) || text.includes(fact)) {
            return verification;
        }
    }

    return null;
}
