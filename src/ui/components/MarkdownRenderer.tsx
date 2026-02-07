import React from 'react';

/**
 * Renders a full markdown document (tables, code blocks, headings, lists, etc.)
 */
export function renderFullMarkdown(text: string): React.ReactNode {
    const blocks = text.split('\n');
    const elements: React.ReactNode[] = [];
    let i = 0;

    while (i < blocks.length) {
        const line = blocks[i];

        // Tables
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
                <table key={i}>
                    <thead><tr>{headers.map((h, hi) => <th key={hi}>{renderInline(h)}</th>)}</tr></thead>
                    <tbody>{rows.map((row, ri) => <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{renderInline(cell)}</td>)}</tr>)}</tbody>
                </table>
            );
            continue;
        }

        // Code blocks
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
                <pre key={i}><code className={lang ? `language-${lang}` : ''}>{codeLines.join('\n')}</code></pre>
            );
            continue;
        }

        // Headings
        if (line.startsWith('# ')) {
            elements.push(<h1 key={i}>{renderInline(line.substring(2))}</h1>);
        } else if (line.startsWith('## ')) {
            elements.push(<h2 key={i}>{renderInline(line.substring(3))}</h2>);
        } else if (line.startsWith('### ')) {
            elements.push(<h3 key={i}>{renderInline(line.substring(4))}</h3>);
        }
        // HR
        else if (line.match(/^---+$/)) {
            elements.push(<hr key={i} />);
        }
        // Checkbox list
        else if (line.match(/^- \[[ x]\] /)) {
            const checked = line.includes('[x]');
            const content = line.replace(/^- \[[ x]\] /, '');
            elements.push(
                <div key={i} className={`flex items-start gap-2 py-0.5 ${checked ? 'text-gray-500 line-through' : ''}`}>
                    <input type="checkbox" checked={checked} readOnly className="mt-1" />
                    <span>{renderInline(content)}</span>
                </div>
            );
        }
        // List items
        else if (line.startsWith('- ')) {
            elements.push(<li key={i}>{renderInline(line.substring(2))}</li>);
        }
        // Empty line
        else if (!line.trim()) {
            elements.push(<div key={i} className="h-2" />);
        }
        // Italic comment line
        else if (line.startsWith('*') && line.endsWith('*') && !line.startsWith('**')) {
            elements.push(<p key={i} className="italic text-gray-500">{line.replace(/^\*|\*$/g, '')}</p>);
        }
        // Regular paragraph
        else {
            elements.push(<p key={i}>{renderInline(line)}</p>);
        }

        i++;
    }

    return <>{elements}</>;
}

/**
 * Renders inline markdown (bold, code).
 */
export function renderInline(text: string): React.ReactNode {
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/);
    return parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
            return <code key={i}>{part.slice(1, -1)}</code>;
        }
        return <span key={i}>{part}</span>;
    });
}
