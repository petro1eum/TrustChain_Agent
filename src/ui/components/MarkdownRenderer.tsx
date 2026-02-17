import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';

const DEFAULT_TRUSTCHAIN_TOOLTIP = 'TrustChain: цифровая верификация';

const escapeHtmlAttr = (value: string): string => value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const getTrustchainMarkerHtml = (tooltip: string): string =>
    `<span class="tc-verified-shield" title="${escapeHtmlAttr(tooltip || DEFAULT_TRUSTCHAIN_TOOLTIP)}">✓</span>`;

/**
 * Normalizes legacy TrustChain badge markup so UI never displays raw
 * <span ...> tags from older messages or model output.
 */
export function normalizeTrustChainMarkup(
    text: string,
    opts?: { tooltip?: string }
): string {
    if (!text) return '';
    const markerHtml = getTrustchainMarkerHtml(opts?.tooltip || DEFAULT_TRUSTCHAIN_TOOLTIP);

    return text
        .replace(/🛡✓/g, markerHtml)
        .replace(
            /&lt;span[\s\S]*?tc-verified(?!-shield)(?!-label)\b[\s\S]*?&gt;[\s\S]*?&lt;\/span&gt;/gi,
            markerHtml
        )
        .replace(
            /<span[\s\S]*?tc-verified(?!-shield)(?!-label)\b[\s\S]*?>[\s\S]*?<\/span>/gi,
            markerHtml
        )
        .replace(
            /<span[\s\S]*?class=\\?["']tc-verified(?!-shield)(?!-label)\b\\?["'][\s\S]*?>[\s\S]*?<\/span>/gi,
            markerHtml
        )
        .replace(/title="([^"]*)"/gi, (_m, title) => `title="${title.replace(/\|/g, ';')}"`)
        .replace(/title=\\"([^"]*)\\"/gi, (_m, title) => `title=\\"${title.replace(/\|/g, ';')}\\"`)
        .replace(/title=&quot;([^&]*)&quot;/gi, (_m, title) => `title=&quot;${title.replace(/\|/g, ';')}&quot;`);
}

/* ─────── react-markdown plugins ─────── */
const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex, rehypeHighlight];

/* ─────── Custom components for theme-aware rendering ─────── */
const mdComponents: Record<string, React.FC<any>> = {
    /* Headings */
    h1: ({ children, ...props }: any) => (
        <h1 {...props} style={{ fontSize: 17, fontWeight: 700, color: 'var(--tc-prose-heading)', margin: '14px 0 6px', lineHeight: 1.4 }}>{children}</h1>
    ),
    h2: ({ children, ...props }: any) => (
        <h2 {...props} style={{ fontSize: 15, fontWeight: 700, color: 'var(--tc-prose-heading)', margin: '12px 0 5px', lineHeight: 1.4 }}>{children}</h2>
    ),
    h3: ({ children, ...props }: any) => (
        <h3 {...props} style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--tc-prose-heading)', margin: '10px 0 4px', lineHeight: 1.4 }}>{children}</h3>
    ),
    h4: ({ children, ...props }: any) => (
        <h4 {...props} style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--tc-prose-heading)', margin: '8px 0 3px', lineHeight: 1.4 }}>{children}</h4>
    ),

    /* Paragraph */
    p: ({ children, ...props }: any) => (
        <p {...props} style={{ margin: '4px 0', fontSize: 13, lineHeight: 1.65, color: 'var(--tc-prose-text)' }}>{children}</p>
    ),

    /* Bold / Italic */
    strong: ({ children, ...props }: any) => (
        <strong {...props} style={{ color: 'var(--tc-prose-strong)', fontWeight: 600 }}>{children}</strong>
    ),
    em: ({ children, ...props }: any) => (
        <em {...props} style={{ color: 'var(--tc-text-secondary)' }}>{children}</em>
    ),

    /* Lists */
    ul: ({ children, ...props }: any) => (
        <ul {...props} style={{ margin: '4px 0', paddingLeft: 20, listStyleType: 'disc', color: 'var(--tc-prose-text)' }}>{children}</ul>
    ),
    ol: ({ children, ...props }: any) => (
        <ol {...props} style={{ margin: '4px 0', paddingLeft: 20, listStyleType: 'decimal', color: 'var(--tc-prose-text)' }}>{children}</ol>
    ),
    li: ({ children, ...props }: any) => (
        <li {...props} style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 2, color: 'var(--tc-prose-text)' }}>{children}</li>
    ),

    /* Inline code */
    code: ({ children, className, ...props }: any) => {
        // If it's inside a <pre> (code block), className will contain "language-xxx"
        const isBlock = className && /language-/.test(className);
        if (isBlock) {
            return <code className={className} {...props} style={{ fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', monospace", fontSize: 12 }}>{children}</code>;
        }
        return (
            <code {...props} style={{
                background: 'var(--tc-prose-code-bg)',
                color: 'var(--tc-prose-code)',
                padding: '1px 5px',
                borderRadius: 4,
                fontSize: '0.88em',
                fontFamily: "'SF Mono', 'Fira Code', monospace",
            }}>{children}</code>
        );
    },

    /* Code block wrapper */
    pre: ({ children, ...props }: any) => (
        <pre {...props} style={{
            background: 'var(--tc-code-bg)',
            border: '1px solid var(--tc-code-border)',
            borderRadius: 8,
            padding: '10px 14px',
            fontSize: 12,
            lineHeight: 1.55,
            overflowX: 'auto',
            margin: '8px 0',
            color: 'var(--tc-code-text)',
        }}>{children}</pre>
    ),

    /* Tables */
    table: ({ children, ...props }: any) => (
        <table {...props} style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, margin: '8px 0' }}>{children}</table>
    ),
    thead: ({ children, ...props }: any) => <thead {...props}>{children}</thead>,
    tbody: ({ children, ...props }: any) => <tbody {...props}>{children}</tbody>,
    th: ({ children, ...props }: any) => (
        <th {...props} style={{
            textAlign: 'left', padding: '5px 10px',
            borderBottom: '2px solid var(--tc-prose-table-border)',
            color: 'var(--tc-prose-th-text)', fontWeight: 600, fontSize: 11,
            textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>{children}</th>
    ),
    td: ({ children, ...props }: any) => (
        <td {...props} style={{
            padding: '4px 10px',
            borderBottom: '1px solid var(--tc-prose-td-border)',
            color: 'var(--tc-prose-text)', fontSize: 12,
        }}>{children}</td>
    ),

    /* Blockquote */
    blockquote: ({ children, ...props }: any) => (
        <blockquote {...props} style={{
            borderLeft: '3px solid var(--tc-verified-text, #34d399)',
            paddingLeft: 12, margin: '6px 0',
            color: 'var(--tc-text-secondary)', fontSize: 12.5, fontStyle: 'italic',
        }}>{children}</blockquote>
    ),

    /* HR */
    hr: (props: any) => (
        <hr {...props} style={{ border: 'none', borderTop: '1px solid var(--tc-prose-hr)', margin: '10px 0' }} />
    ),

    /* Links */
    a: ({ children, href, ...props }: any) => (
        <a {...props} href={href} target="_blank" rel="noopener noreferrer" style={{
            color: 'var(--tc-accent-text)', textDecoration: 'underline',
        }}>{children}</a>
    ),

    /* Images */
    img: ({ src, alt, ...props }: any) => (
        <img {...props} src={src} alt={alt || ''} style={{ maxWidth: '100%', borderRadius: 8, margin: '8px 0' }} />
    ),

    /* Checkbox (GFM task list) */
    input: ({ type, checked, ...props }: any) => {
        if (type === 'checkbox') {
            return <input {...props} type="checkbox" checked={checked} readOnly
                style={{ marginRight: 6, accentColor: 'var(--tc-verified-text, #34d399)' }} />;
        }
        return <input {...props} />;
    },
};

/**
 * Full markdown renderer for TrustChain Agent responses.
 * Uses react-markdown with GFM, math (LaTeX), syntax highlighting.
 * All colors use CSS custom properties for dark/light theme compatibility.
 */
export function renderFullMarkdown(text: string): React.ReactNode {
    return (
        <ReactMarkdown
            remarkPlugins={remarkPlugins}
            rehypePlugins={rehypePlugins}
            components={mdComponents}
        >
            {text}
        </ReactMarkdown>
    );
}

/**
 * Renders inline markdown: **bold**, *italic*, `code`, [links](url),
 * and inline HTML <span> tags (for TrustChain verification badges).
 * Used in execution step labels where full markdown is too heavy.
 */
export function renderInline(text: string): React.ReactNode {
    const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|<span[^>]*>[^<]*<\/span>)/);
    return parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={i} style={{ color: 'var(--tc-prose-strong)', fontWeight: 600 }}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) {
            return <em key={i} style={{ color: 'var(--tc-text-secondary)' }}>{part.slice(1, -1)}</em>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
            return <code key={i} style={{
                background: 'var(--tc-prose-code-bg)', padding: '1px 5px', borderRadius: 4,
                fontSize: '0.9em', color: 'var(--tc-prose-code)',
            }}>{part.slice(1, -1)}</code>;
        }
        const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (linkMatch) {
            return <a key={i} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" style={{
                color: 'var(--tc-accent-text)', textDecoration: 'underline',
            }}>{linkMatch[1]}</a>;
        }
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
