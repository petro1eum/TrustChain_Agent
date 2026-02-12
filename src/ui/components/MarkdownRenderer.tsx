import React from 'react';

/**
 * Full markdown renderer for TrustChain Agent responses.
 * Supports: headings, bold, italic, code, code blocks, tables,
 * blockquotes, ordered/unordered/nested lists, checkboxes,
 * links, inline HTML (spans with style/title/class), HR.
 */
export function renderFullMarkdown(text: string): React.ReactNode {
    const blocks = text.split('\n');
    const elements: React.ReactNode[] = [];
    let i = 0;

    while (i < blocks.length) {
        const line = blocks[i];

        // ── Code blocks ──
        if (line.startsWith('```')) {
            const lang = line.replace('```', '').trim();
            const codeLines: string[] = [];
            i++;
            while (i < blocks.length && !blocks[i].startsWith('```')) {
                codeLines.push(blocks[i]);
                i++;
            }
            i++; // skip closing ```
            elements.push(
                <pre key={`code_${i}`} style={{
                    background: '#0f172a', borderRadius: 8, padding: '10px 12px',
                    fontSize: 11, overflowX: 'auto', border: '1px solid #1e293b',
                    margin: '4px 0',
                }}>
                    <code className={lang ? `language-${lang}` : ''}>{codeLines.join('\n')}</code>
                </pre>
            );
            continue;
        }

        // ── Tables ──
        if (line.includes('|') && i + 1 < blocks.length && blocks[i + 1]?.match(/^\|[-\s:|]+\|$/)) {
            const tableLines: string[] = [line];
            i++;
            while (i < blocks.length && blocks[i].includes('|')) {
                if (!blocks[i].match(/^\|[-\s:|]+\|$/)) {
                    tableLines.push(blocks[i]);
                }
                i++;
            }
            const headers = tableLines[0].split('|').filter(c => c.trim()).map(c => c.trim());
            const rows = tableLines.slice(1).map(r => r.split('|').filter(c => c.trim()).map(c => c.trim()));
            elements.push(
                <table key={`table_${i}`} style={{
                    width: '100%', borderCollapse: 'collapse', fontSize: 11, margin: '6px 0',
                }}>
                    <thead>
                        <tr>{headers.map((h, hi) => (
                            <th key={hi} style={{
                                textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #334155',
                                color: '#94a3b8', fontWeight: 600, fontSize: 10,
                            }}>{renderInline(h)}</th>
                        ))}</tr>
                    </thead>
                    <tbody>{rows.map((row, ri) => (
                        <tr key={ri}>{row.map((cell, ci) => (
                            <td key={ci} style={{
                                padding: '3px 8px', borderBottom: '1px solid #1e293b', color: '#cbd5e1',
                            }}>{renderInline(cell)}</td>
                        ))}</tr>
                    ))}</tbody>
                </table>
            );
            continue;
        }

        // ── Blockquotes ──
        if (line.startsWith('> ')) {
            const quoteLines: string[] = [];
            while (i < blocks.length && blocks[i].startsWith('> ')) {
                quoteLines.push(blocks[i].substring(2));
                i++;
            }
            elements.push(
                <blockquote key={`bq_${i}`} style={{
                    borderLeft: '3px solid #34d399', paddingLeft: 12, margin: '6px 0',
                    color: '#94a3b8', fontSize: 12,
                }}>
                    {quoteLines.map((ql, qi) => <div key={qi}>{renderInline(ql)}</div>)}
                </blockquote>
            );
            continue;
        }

        // ── Headings ──
        if (line.startsWith('#### ')) {
            elements.push(<h4 key={`h4_${i}`} style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', margin: '8px 0 4px' }}>{renderInline(line.substring(5))}</h4>);
        } else if (line.startsWith('### ')) {
            elements.push(<h3 key={`h3_${i}`} style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', margin: '10px 0 4px' }}>{renderInline(line.substring(4))}</h3>);
        } else if (line.startsWith('## ')) {
            elements.push(<h2 key={`h2_${i}`} style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9', margin: '12px 0 4px' }}>{renderInline(line.substring(3))}</h2>);
        } else if (line.startsWith('# ')) {
            elements.push(<h1 key={`h1_${i}`} style={{ fontSize: 16, fontWeight: 700, color: '#f8fafc', margin: '14px 0 6px' }}>{renderInline(line.substring(2))}</h1>);
        }
        // ── HR ──
        else if (line.match(/^---+$/)) {
            elements.push(<hr key={`hr_${i}`} style={{ border: 'none', borderTop: '1px solid #334155', margin: '8px 0' }} />);
        }
        // ── Checkbox list ──
        else if (line.match(/^(\s*)[-*] \[[ x]\] /)) {
            const indent = line.match(/^(\s*)/)?.[1].length || 0;
            const checked = line.includes('[x]');
            const content = line.replace(/^\s*[-*] \[[ x]\] /, '');
            elements.push(
                <div key={`cb_${i}`} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 6, paddingTop: 2, paddingBottom: 2,
                    paddingLeft: indent * 8,
                    color: checked ? '#64748b' : '#cbd5e1',
                    textDecoration: checked ? 'line-through' : 'none',
                }}>
                    <input type="checkbox" checked={checked} readOnly style={{ marginTop: 3, accentColor: '#34d399' }} />
                    <span style={{ fontSize: 12 }}>{renderInline(content)}</span>
                </div>
            );
        }
        // ── Ordered list (1. 2. etc.) ──
        else if (line.match(/^(\s*)\d+\.\s/)) {
            const indent = line.match(/^(\s*)/)?.[1].length || 0;
            const content = line.replace(/^\s*\d+\.\s/, '');
            elements.push(
                <div key={`ol_${i}`} style={{
                    paddingLeft: 8 + indent * 8, position: 'relative', fontSize: 12,
                    color: '#cbd5e1', paddingTop: 1, paddingBottom: 1,
                }}>
                    <span style={{ position: 'absolute', left: indent * 8, color: '#64748b', fontWeight: 500 }}>
                        {line.match(/(\d+)\./)?.[1]}.
                    </span>
                    {renderInline(content)}
                </div>
            );
        }
        // ── Unordered list (- or * with indent support) ──
        else if (line.match(/^(\s*)[-*]\s/)) {
            const indent = line.match(/^(\s*)/)?.[1].length || 0;
            const content = line.replace(/^\s*[-*]\s/, '');
            elements.push(
                <div key={`ul_${i}`} style={{
                    paddingLeft: 12 + indent * 8, position: 'relative', fontSize: 12,
                    color: '#cbd5e1', paddingTop: 1, paddingBottom: 1,
                }}>
                    <span style={{ position: 'absolute', left: indent * 8, color: '#475569' }}>•</span>
                    {renderInline(content)}
                </div>
            );
        }
        // ── Empty line ──
        else if (!line.trim()) {
            elements.push(<div key={`sp_${i}`} style={{ height: 6 }} />);
        }
        // ── Regular paragraph ──
        else {
            elements.push(<p key={`p_${i}`} style={{ margin: '2px 0', fontSize: 12, color: '#cbd5e1' }}>{renderInline(line)}</p>);
        }

        i++;
    }

    return <>{elements}</>;
}

/**
 * Renders inline markdown: **bold**, *italic*, `code`, [links](url),
 * and inline HTML <span> tags (for TrustChain verification badges).
 */
export function renderInline(text: string): React.ReactNode {
    // Split on: **bold**, *italic*, `code`, [text](url), <span ...>...</span>
    const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|<span[^>]*>[^<]*<\/span>)/);
    return parts.map((part, i) => {
        // Bold
        if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={i} style={{ color: '#e2e8f0', fontWeight: 600 }}>{part.slice(2, -2)}</strong>;
        }
        // Italic
        if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) {
            return <em key={i} style={{ color: '#94a3b8' }}>{part.slice(1, -1)}</em>;
        }
        // Inline code
        if (part.startsWith('`') && part.endsWith('`')) {
            return <code key={i} style={{
                background: '#1e293b', padding: '1px 5px', borderRadius: 4,
                fontSize: '0.9em', color: '#93c5fd',
            }}>{part.slice(1, -1)}</code>;
        }
        // Links [text](url)
        const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (linkMatch) {
            return <a key={i} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" style={{
                color: '#818cf8', textDecoration: 'underline',
            }}>{linkMatch[1]}</a>;
        }
        // Inline HTML <span> — parse style, title, class
        const spanMatch = part.match(/^<span([^>]*)>([^<]*)<\/span>$/);
        if (spanMatch) {
            const attrs = spanMatch[1];
            const content = spanMatch[2];
            const styleMatch = attrs.match(/style="([^"]*)"/);
            const titleMatch = attrs.match(/title="([^"]*)"/);
            const classMatch = attrs.match(/class="([^"]*)"/);
            const inlineStyle: Record<string, string> = {};
            if (styleMatch) {
                styleMatch[1].split(';').forEach(s => {
                    const [k, v] = s.split(':').map(x => x.trim());
                    if (k && v) {
                        // Convert CSS property to camelCase
                        const camelKey = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
                        inlineStyle[camelKey] = v;
                    }
                });
            }
            return <span key={i} style={inlineStyle} title={titleMatch?.[1] || undefined} className={classMatch?.[1] || undefined}>{content}</span>;
        }
        return <span key={i}>{part}</span>;
    });
}
