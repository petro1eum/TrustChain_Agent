/**
 * trustchainPostProcess.ts — Shared TrustChain verification post-processing.
 *
 * Extracted from PanelApp.tsx to enable reuse across both
 * the standalone TrustChainAgentApp and the embeddable Panel.
 *
 * Pipeline: extractSignedResults → countDataPoints → markVerifiedLines → buildHeader
 *          → normalization → final content with TrustChain badges
 */

// ── Types ──

export type VerificationMarker = { toolName: string; signature: string };

export interface SignedResult {
    result: string;
    signature: string;
    toolName: string;
}

export interface PostProcessResult {
    content: string;
    signedResults: SignedResult[];
    totalDataPoints: number;
    hasVerification: boolean;
}

// ── Low-level helpers ──

export const normalizeSignature = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    return value.trim();
};

export const shortSignature = (signature: string): string => {
    if (!signature) return 'без подписи';
    if (signature.length <= 24) return signature;
    return `${signature.slice(0, 12)}…${signature.slice(-8)}`;
};

export const escapeHtmlAttr = (value: string): string => value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

export const buildVerificationTooltip = (markers: VerificationMarker[]): string => {
    if (!markers.length) return 'TrustChain: цифровая верификация';
    const unique = Array.from(new Map(
        markers.map(m => [`${m.toolName}::${m.signature}`, m])
    ).values());
    const shown = unique.slice(0, 5);
    const lines = shown.map((m, idx) =>
        `${idx + 1}. ${m.toolName || 'tool'} · ${shortSignature(m.signature)}`
    );
    if (unique.length > shown.length) lines.push(`+${unique.length - shown.length} ещё`);
    // Avoid "|" — it breaks markdown table rows.
    return `TrustChain: цифровая верификация; ${lines.join('; ')}`;
};

// ── Step 1: Extract signed results from agent events ──

export function extractSignedResults(events: any[]): SignedResult[] {
    const signedResults: SignedResult[] = [];
    for (const ev of events) {
        if (ev.type === 'tool_result' && (ev.signature || ev.certificate)) {
            const resultStr = typeof ev.result === 'string' ? ev.result : JSON.stringify(ev.result);
            const signature = normalizeSignature(ev.signature) || normalizeSignature(ev.certificate);
            if (!signature) continue;
            signedResults.push({
                result: resultStr || '',
                signature,
                toolName: ev.toolName || '',
            });
        }
    }
    return signedResults;
}

// ── Step 2: Count data points + build verification map ──

export function countDataPoints(signedResults: SignedResult[]): {
    totalDataPoints: number;
    verifiedIds: Set<string>;
    verificationById: Map<string, VerificationMarker[]>;
} {
    let totalDataPoints = 0;
    const verifiedIds = new Set<string>();
    const verificationById = new Map<string, VerificationMarker[]>();

    const bindVerifiedId = (rawId: unknown, marker: VerificationMarker) => {
        const id = typeof rawId === 'string' ? rawId.trim() : String(rawId || '').trim();
        if (!id) return;
        verifiedIds.add(id);
        const existing = verificationById.get(id) || [];
        if (!existing.some(e => e.toolName === marker.toolName && e.signature === marker.signature)) {
            existing.push(marker);
            verificationById.set(id, existing);
        }
    };

    for (const sr of signedResults) {
        const marker: VerificationMarker = { toolName: sr.toolName || 'tool', signature: sr.signature };

        // Try to parse the result as JSON — handle nested formats
        let parsed: any = null;
        try {
            parsed = JSON.parse(sr.result);
            if (typeof parsed === 'string') parsed = JSON.parse(parsed);
            // MCP content wrapper: {content: [{type: "text", text: "..."}]}
            if (parsed?.content?.[0]?.text) parsed = JSON.parse(parsed.content[0].text);
            // TrustChain data wrapper: {data: {...}, signature: "..."}
            if (parsed?.data && (parsed?.signature || parsed?.certificate)) parsed = parsed.data;
        } catch {
            parsed = null;
        }

        if (parsed && typeof parsed === 'object') {
            const seenItemIds = new Set<string>();
            const arrayFields = [
                'items', 'tasks', 'documents', 'contracts',
                'meetings', 'vacancies', 'hits', 'results',
                'employees', 'organizations',
            ];
            for (const field of arrayFields) {
                if (Array.isArray(parsed[field])) {
                    for (const item of parsed[field]) {
                        if (!item || typeof item !== 'object') continue;
                        const itemKey = item.id ? `${item.id}` : JSON.stringify(item).substring(0, 100);
                        if (seenItemIds.has(itemKey)) continue;
                        seenItemIds.add(itemKey);
                        totalDataPoints++;
                        // Extract identifying values for line marking
                        if (item.number) bindVerifiedId(item.number, marker);
                        if (item.reg_number) bindVerifiedId(item.reg_number, marker);
                        if (item.name && item.name.length > 3) bindVerifiedId(item.name, marker);
                        if (item.assignee_name) bindVerifiedId(item.assignee_name, marker);
                        if (item.author_name) bindVerifiedId(item.author_name, marker);
                        if (item.doc_id) bindVerifiedId(item.doc_id, marker);
                        if (item.article) bindVerifiedId(item.article, marker);
                        if (item.id) bindVerifiedId(String(item.id), marker);
                    }
                }
            }
            // Stats-only results (e.g. get_task_stats)
            if (parsed.total !== undefined && totalDataPoints === 0) totalDataPoints += 1;
            // by_status / by_priority breakdowns
            for (const field of ['by_status', 'by_priority']) {
                if (Array.isArray(parsed[field])) {
                    totalDataPoints += parsed[field].length;
                    for (const entry of parsed[field]) {
                        if (entry.status) bindVerifiedId(entry.status, marker);
                        if (entry.priority) bindVerifiedId(entry.priority, marker);
                    }
                }
            }
        } else {
            // String result — regex fallback for doc IDs / task numbers
            const text = sr.result || '';
            const idPatterns = [
                /[A-Z]{2,5}-\d{4}-\d{3,6}/g,
                /№\s*\d+/g,
                /\d{2,3}-\d{2,4}/g,
            ];
            for (const pat of idPatterns) {
                const matches = text.match(pat);
                if (matches) {
                    matches.forEach(m => bindVerifiedId(m, marker));
                    totalDataPoints += matches.length;
                }
            }
        }
    }

    return { totalDataPoints, verifiedIds, verificationById };
}

// ── Step 3: Mark response lines containing verified data with green shield ──

export function markVerifiedLines(
    content: string,
    verifiedIds: Set<string>,
    verificationById: Map<string, VerificationMarker[]>,
): string {
    if (verifiedIds.size === 0) return content;

    const lines = content.split('\n');
    const markedLines = lines.map(line => {
        const matchedMarkers = new Map<string, VerificationMarker>();
        for (const id of verifiedIds) {
            if (!line.includes(id)) continue;
            const markers = verificationById.get(id) || [];
            for (const m of markers) {
                matchedMarkers.set(`${m.toolName}::${m.signature}`, m);
            }
        }
        if (matchedMarkers.size > 0 && !line.includes('tc-verified-shield')) {
            const tooltip = buildVerificationTooltip(Array.from(matchedMarkers.values()));
            return `${line} <span class="tc-verified-shield" title="${escapeHtmlAttr(tooltip)}">✓</span>`;
        }
        return line;
    });
    return markedLines.join('\n');
}

// ── Step 4: Build TrustChain verified header ──

export function buildTrustChainHeader(
    signedResults: SignedResult[],
    totalDataPoints: number,
    headerTooltip: string,
): string {
    const fullSig = signedResults[0]?.signature || '';
    const sigShort = shortSignature(fullSig);
    return `> <span class="tc-verified-label" title="${escapeHtmlAttr(headerTooltip)}">TrustChain Verified</span> — ${totalDataPoints} data points · ${signedResults.length} tool calls · Ed25519: \`${sigShort}\``;
}

// ── Full pipeline: postProcessAgentResponse ──
// Takes raw agent response content and events, produces enriched content with
// TrustChain verification badges, data point counts, and line-level shields.
//
// `normalizeFn` is optional — pass `normalizeTrustChainMarkup` from MarkdownRenderer
// when available for additional cleanup.

export function postProcessAgentResponse(
    responseContent: string,
    events: any[],
    normalizeFn?: (content: string, opts?: { tooltip?: string }) => string,
): PostProcessResult {
    const signedResults = extractSignedResults(events);

    if (signedResults.length === 0 || responseContent.length <= 20) {
        return {
            content: responseContent,
            signedResults,
            totalDataPoints: 0,
            hasVerification: false,
        };
    }

    const headerTooltip = buildVerificationTooltip(
        signedResults.map(sr => ({ toolName: sr.toolName || 'tool', signature: sr.signature }))
    );

    const { totalDataPoints, verifiedIds, verificationById } = countDataPoints(signedResults);

    // Mark lines
    let content = markVerifiedLines(responseContent, verifiedIds, verificationById);

    // Strip any LLM-generated TrustChain shields to avoid duplication
    content = content.replace(/^>?\s*[🛡🔐].*TrustChain.*(?:Ed25519|data point|Verified).*\n*/gm, '');

    // Apply normalization if available
    if (normalizeFn) {
        content = normalizeFn(content, { tooltip: headerTooltip });
    }

    content = content.replace(/^\n+/, ''); // Remove leading empty lines

    // Prepend consolidated TrustChain header
    const header = buildTrustChainHeader(signedResults, totalDataPoints, headerTooltip);
    content = `${header}\n\n${content}`;

    return {
        content,
        signedResults,
        totalDataPoints,
        hasVerification: true,
    };
}
