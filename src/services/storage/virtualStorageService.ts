/**
 * Virtual Storage Service
 * 
 * Provides a unified FileEntry-based interface over multiple virtual "mounts":
 *   skills://  — system skills (Docker /mnt/skills, read-only) + user skills (VFS, read-write)
 *   tools://   — built-in tools (registry, read-only) + custom tools (localStorage, read-write)
 * 
 * The FileManagerView uses this to browse skills/tools alongside the regular user storage.
 */

import type { FileEntry } from './types';
import { SkillsLoaderService } from '../skills/skillsLoaderService';
import type { SkillMetadata } from '../skills/types';
import { getToolRegistry, type ToolMeta, type ToolCategory } from '../../tools/toolRegistry';

// ── Custom Tools (same localStorage key as ToolManager) ──

const CUSTOM_TOOLS_KEY = 'tc_custom_tools';

interface CustomToolDef {
    id: string;
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, { type: string; description: string }>;
        required: string[];
    };
    createdAt: number;
    updatedAt: number;
}

function loadCustomTools(): CustomToolDef[] {
    try {
        const raw = localStorage.getItem(CUSTOM_TOOLS_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}

function saveCustomTools(tools: CustomToolDef[]): void {
    localStorage.setItem(CUSTOM_TOOLS_KEY, JSON.stringify(tools));
}

// ── Virtual Mount Prefixes ──

export const MOUNT_SKILLS = 'skills://';
export const MOUNT_TOOLS = 'tools://';

// ── Helpers ──

const now = () => Date.now();

function makeFileEntry(name: string, path: string, content: string, type: 'file' | 'directory' = 'file', modified = now()): FileEntry {
    return { name, path, type, size: new Blob([content]).size, modified };
}

function makeDirEntry(name: string, path: string, modified = now()): FileEntry {
    return { name, path, type: 'directory', size: 0, modified };
}

// ── Static Skills Registry ──
// Always available regardless of Docker/backend — all 15 known skills

interface StaticSkillDef {
    name: string;
    id: string;
    description: string;
    category: string;
    subcategory?: string;
    containerPath: string;
    localPath: string; // relative to project root
    license?: string;
}

const STATIC_SKILLS_REGISTRY: StaticSkillDef[] = [
    // ── Public: Office formats ──
    {
        name: 'DOCX', id: 'docx',
        description: 'Create, edit, and analyze Word documents (.docx) — tracked changes, comments, formatting, text extraction',
        category: 'public', containerPath: '/mnt/skills/public/docx/SKILL.md',
        localPath: 'skills/public/docx/SKILL.md', license: 'Proprietary',
    },
    {
        name: 'PDF', id: 'pdf',
        description: 'PDF manipulation — extract text and tables, create, merge/split, forms, OCR',
        category: 'public', containerPath: '/mnt/skills/public/pdf/SKILL.md',
        localPath: 'skills/public/pdf/SKILL.md', license: 'Proprietary',
    },
    {
        name: 'PPTX', id: 'pptx',
        description: 'Create, edit, and analyze PowerPoint presentations (.pptx) — layouts, speaker notes, html2pptx',
        category: 'public', containerPath: '/mnt/skills/public/pptx/SKILL.md',
        localPath: 'skills/public/pptx/SKILL.md', license: 'Proprietary',
    },
    {
        name: 'XLSX', id: 'xlsx',
        description: 'Spreadsheet creation, editing, analysis — formulas, formatting, data visualization (.xlsx/.csv)',
        category: 'public', containerPath: '/mnt/skills/public/xlsx/SKILL.md',
        localPath: 'skills/public/xlsx/SKILL.md', license: 'Proprietary',
    },
    {
        name: 'Product Self-Knowledge', id: 'product-self-knowledge',
        description: 'Authoritative product reference — capabilities, pricing, limits, features',
        category: 'public', containerPath: '/mnt/skills/public/product-self-knowledge/SKILL.md',
        localPath: 'skills/public/product-self-knowledge/SKILL.md',
    },
    // ── KB-Tools: Computer Use ──
    {
        name: 'View', id: 'view',
        description: 'View file contents in sandbox environment',
        category: 'kb-tools', subcategory: 'computer-use',
        containerPath: '/mnt/skills/kb-tools/computer-use/view/SKILL.md',
        localPath: 'skills/kb-tools/computer-use/view/SKILL.md',
    },
    {
        name: 'Bash Tool', id: 'bash-tool',
        description: 'Execute bash commands in sandbox',
        category: 'kb-tools', subcategory: 'computer-use',
        containerPath: '/mnt/skills/kb-tools/computer-use/bash-tool/SKILL.md',
        localPath: 'skills/kb-tools/computer-use/bash-tool/SKILL.md',
    },
    {
        name: 'Create File', id: 'create-file',
        description: 'Create new files in sandbox',
        category: 'kb-tools', subcategory: 'computer-use',
        containerPath: '/mnt/skills/kb-tools/computer-use/create-file/SKILL.md',
        localPath: 'skills/kb-tools/computer-use/create-file/SKILL.md',
    },
    {
        name: 'Str Replace', id: 'str-replace',
        description: 'String replacement tool for editing files',
        category: 'kb-tools', subcategory: 'computer-use',
        containerPath: '/mnt/skills/kb-tools/computer-use/str-replace/SKILL.md',
        localPath: 'skills/kb-tools/computer-use/str-replace/SKILL.md',
    },
    // ── KB-Tools: Web Tools ──
    {
        name: 'Web Search', id: 'web-search',
        description: 'Search the web and collect sources',
        category: 'kb-tools', subcategory: 'web-tools',
        containerPath: '/mnt/skills/kb-tools/web-tools/web-search/SKILL.md',
        localPath: 'skills/kb-tools/web-tools/web-search/SKILL.md',
    },
    {
        name: 'Web Fetch', id: 'web-fetch',
        description: 'Fetch and parse content from URLs',
        category: 'kb-tools', subcategory: 'web-tools',
        containerPath: '/mnt/skills/kb-tools/web-tools/web-fetch/SKILL.md',
        localPath: 'skills/kb-tools/web-tools/web-fetch/SKILL.md',
    },
    // ── Examples ──
    {
        name: 'Skill Creator', id: 'skill-creator',
        description: 'Guide for creating effective skills that extend agent capabilities',
        category: 'examples', containerPath: '/mnt/skills/examples/skill-creator/SKILL.md',
        localPath: 'skills/examples/skill-creator/SKILL.md',
    },
    {
        name: 'Web Artifacts Builder', id: 'web-artifacts-builder',
        description: 'Create multi-component HTML artifacts with React, Tailwind, shadcn/ui',
        category: 'examples', containerPath: '/mnt/skills/examples/web-artifacts-builder/SKILL.md',
        localPath: 'skills/examples/web-artifacts-builder/SKILL.md',
    },
    {
        name: 'Algorithmic Art', id: 'algorithmic-art',
        description: 'Create algorithmic art with p5.js — flow fields, particle systems, generative art',
        category: 'examples', containerPath: '/mnt/skills/examples/algorithmic-art/SKILL.md',
        localPath: 'skills/examples/algorithmic-art/SKILL.md',
    },
    {
        name: 'Brand Guidelines', id: 'brand-guidelines',
        description: 'Apply brand colors and typography to artifacts',
        category: 'examples', containerPath: '/mnt/skills/examples/brand-guidelines/SKILL.md',
        localPath: 'skills/examples/brand-guidelines/SKILL.md',
    },
    {
        name: 'Canvas Design', id: 'canvas-design',
        description: 'Create visual art in PNG/PDF using design philosophy — posters, art, static designs',
        category: 'examples', containerPath: '/mnt/skills/examples/canvas-design/SKILL.md',
        localPath: 'skills/examples/canvas-design/SKILL.md',
    },
    {
        name: 'Internal Comms', id: 'internal-comms',
        description: 'Write internal communications — status reports, newsletters, FAQs, incident reports',
        category: 'examples', containerPath: '/mnt/skills/examples/internal-comms/SKILL.md',
        localPath: 'skills/examples/internal-comms/SKILL.md',
    },
    {
        name: 'MCP Builder', id: 'mcp-builder',
        description: 'Create MCP servers for LLM tool integration — Python or TypeScript',
        category: 'examples', containerPath: '/mnt/skills/examples/mcp-builder/SKILL.md',
        localPath: 'skills/examples/mcp-builder/SKILL.md',
    },
    {
        name: 'Slack GIF Creator', id: 'slack-gif-creator',
        description: 'Create animated GIFs optimized for Slack — constraints, validation, animation concepts',
        category: 'examples', containerPath: '/mnt/skills/examples/slack-gif-creator/SKILL.md',
        localPath: 'skills/examples/slack-gif-creator/SKILL.md',
    },
    {
        name: 'Theme Factory', id: 'theme-factory',
        description: 'Toolkit for styling artifacts with themes — 10 presets, colors, fonts, custom themes',
        category: 'examples', containerPath: '/mnt/skills/examples/theme-factory/SKILL.md',
        localPath: 'skills/examples/theme-factory/SKILL.md',
    },
    // ── Standalone ──
    {
        name: 'Playwright Browser', id: 'playwright-browser',
        description: 'Control web browsers with Playwright — navigate, click, type, screenshot',
        category: 'browser', containerPath: '/mnt/skills/playwright-browser/SKILL.md',
        localPath: 'skills/playwright-browser/SKILL.md',
    },
];

// ── Skills mount ──

async function listSkillsDir(subPath: string): Promise<FileEntry[]> {
    if (subPath === '') {
        // Root: show categories (system / user)
        return [
            makeDirEntry('system', `${MOUNT_SKILLS}system`),
            makeDirEntry('user', `${MOUNT_SKILLS}user`),
        ];
    }

    const parts = subPath.split('/');

    if (parts[0] === 'system') {
        const skills = getEffectiveSkills();
        if (parts.length === 1) {
            // Group by category
            const categories = new Set(skills.map(s => s.category));
            return [...categories].sort().map(cat =>
                makeDirEntry(cat, `${MOUNT_SKILLS}system/${cat}`)
            );
        }
        if (parts.length === 2) {
            // List skills in category
            const cat = parts[1];
            return skills
                .filter(s => s.category === cat)
                .map(s => makeFileEntry(
                    `${s.id}.md`,
                    `${MOUNT_SKILLS}system/${cat}/${s.id}.md`,
                    s.description,
                ));
        }
    }

    if (parts[0] === 'user') {
        return [];
    }

    return [];
}

/** Merge static registry with any Docker-loaded skills */
function getEffectiveSkills(): StaticSkillDef[] {
    // Static registry always available — Docker-loaded data enriches it
    const cached = SkillsLoaderService.getCachedSkills();
    if (!cached || cached.length === 0) return STATIC_SKILLS_REGISTRY;

    // Merge: Docker skills override static by containerPath
    const map = new Map(STATIC_SKILLS_REGISTRY.map(s => [s.containerPath, s]));
    for (const docker of cached) {
        if (!map.has(docker.containerPath)) {
            map.set(docker.containerPath, {
                name: docker.name,
                id: docker.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                description: docker.description || '',
                category: docker.category || 'uncategorized',
                subcategory: docker.subcategory,
                containerPath: docker.containerPath,
                localPath: '',
                license: docker.license,
            });
        }
    }
    return [...map.values()];
}

async function readSkillFile(subPath: string): Promise<string> {
    const parts = subPath.split('/');

    if (parts[0] === 'system' && parts.length === 3) {
        const cat = parts[1];
        const skillId = parts[2].replace(/\.md$/, '');
        const skills = getEffectiveSkills();
        const skill = skills.find(s => s.category === cat && s.id === skillId);
        if (skill) {
            // 1. Try local file via fetch (works in dev server)
            if (skill.localPath) {
                try {
                    const resp = await fetch(`/${skill.localPath}`);
                    if (resp.ok) return await resp.text();
                } catch { /* fallthrough */ }
            }

            // 2. Try Docker
            try {
                const fullContent = await SkillsLoaderService.loadFullSkillContent(skill.containerPath);
                if (fullContent) return fullContent;
            } catch { /* fallthrough */ }

            // 3. Generate summary card
            return [
                '---',
                `name: ${skill.name}`,
                `description: ${skill.description}`,
                skill.license ? `license: ${skill.license}` : null,
                '---',
                '',
                `# ${skill.name}`,
                '',
                skill.description,
                '',
                `**Category:** ${skill.category}${skill.subcategory ? ' / ' + skill.subcategory : ''}`,
                `**Container Path:** \`${skill.containerPath}\``,
            ].filter(Boolean).join('\n');
        }
    }

    throw new Error(`Skill not found: ${subPath}`);
}

// ── Tools mount ──

function listToolsDir(subPath: string): FileEntry[] {
    if (subPath === '') {
        // Root: show categories
        return [
            makeDirEntry('built-in', `${MOUNT_TOOLS}built-in`),
            makeDirEntry('custom', `${MOUNT_TOOLS}custom`),
        ];
    }

    const parts = subPath.split('/');

    if (parts[0] === 'built-in') {
        const tools = getToolRegistry();
        if (parts.length === 1) {
            // Group by category
            const categories = new Set(tools.map(t => t.category));
            return [...categories].sort().map(cat => {
                const safeName = cat.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                return makeDirEntry(safeName, `${MOUNT_TOOLS}built-in/${safeName}`);
            });
        }
        if (parts.length === 2) {
            const catKey = parts[1];
            return tools
                .filter(t => t.category.toLowerCase().replace(/[^a-z0-9]+/g, '-') === catKey)
                .map(t => makeFileEntry(
                    `${t.id}.json`,
                    `${MOUNT_TOOLS}built-in/${catKey}/${t.id}.json`,
                    JSON.stringify(toolMetaToSpec(t), null, 2),
                ));
        }
    }

    if (parts[0] === 'custom') {
        const custom = loadCustomTools();
        if (parts.length === 1) {
            return custom.map(t => makeFileEntry(
                `${t.id}.json`,
                `${MOUNT_TOOLS}custom/${t.id}.json`,
                JSON.stringify(t, null, 2),
                'file',
                t.updatedAt || t.createdAt,
            ));
        }
    }

    return [];
}

function toolMetaToSpec(t: ToolMeta): object {
    return {
        id: t.id,
        name: t.name,
        description: t.description,
        category: t.category,
        riskLevel: t.riskLevel,
        locked: t.locked,
        defaultEnabled: t.defaultEnabled,
        parameters: t.parameters ? {
            type: 'object',
            properties: Object.fromEntries(
                t.parameters.map(p => [p.name, { type: p.type, description: p.description }])
            ),
            required: t.parameters.filter(p => p.required).map(p => p.name),
        } : undefined,
    };
}

function readToolFile(subPath: string): string {
    const parts = subPath.split('/');

    if (parts[0] === 'built-in' && parts.length === 3) {
        const toolId = parts[2].replace(/\.json$/, '');
        const tool = getToolRegistry().find(t => t.id === toolId);
        if (tool) return JSON.stringify(toolMetaToSpec(tool), null, 2);
    }

    if (parts[0] === 'custom' && parts.length === 2) {
        const toolId = parts[1].replace(/\.json$/, '');
        const custom = loadCustomTools();
        const tool = custom.find(t => t.id === toolId);
        if (tool) return JSON.stringify(tool, null, 2);
    }

    throw new Error(`Tool not found: ${subPath}`);
}

function writeToolFile(subPath: string, content: string): void {
    const parts = subPath.split('/');
    if (parts[0] === 'custom' && parts.length === 2) {
        const toolId = parts[1].replace(/\.json$/, '');
        const custom = loadCustomTools();
        const idx = custom.findIndex(t => t.id === toolId);
        if (idx >= 0) {
            const parsed = JSON.parse(content);
            custom[idx] = { ...custom[idx], ...parsed, updatedAt: Date.now() };
            saveCustomTools(custom);
            return;
        }
    }
    throw new Error(`Cannot write to: ${subPath}`);
}

function deleteToolFile(subPath: string): void {
    const parts = subPath.split('/');
    if (parts[0] === 'custom' && parts.length === 2) {
        const toolId = parts[1].replace(/\.json$/, '');
        const custom = loadCustomTools();
        saveCustomTools(custom.filter(t => t.id !== toolId));
        return;
    }
    throw new Error(`Cannot delete: ${subPath}`);
}

// ── Public API ──

export const virtualStorageService = {
    /** Check if a path belongs to a virtual mount */
    isVirtualPath(path: string): boolean {
        return path.startsWith(MOUNT_SKILLS) || path.startsWith(MOUNT_TOOLS);
    },

    /** Check if a virtual path is read-only */
    isReadOnly(path: string): boolean {
        if (path.startsWith(MOUNT_SKILLS + 'system')) return true;
        if (path.startsWith(MOUNT_TOOLS + 'built-in')) return true;
        return false;
    },

    /** List directory entries for a virtual path */
    async listDir(fullPath: string): Promise<FileEntry[]> {
        if (fullPath.startsWith(MOUNT_SKILLS)) {
            const sub = fullPath.slice(MOUNT_SKILLS.length);
            return listSkillsDir(sub);
        }
        if (fullPath.startsWith(MOUNT_TOOLS)) {
            const sub = fullPath.slice(MOUNT_TOOLS.length);
            return listToolsDir(sub);
        }
        return [];
    },

    /** Read a virtual file's content */
    async readFile(fullPath: string): Promise<string> {
        if (fullPath.startsWith(MOUNT_SKILLS)) {
            return readSkillFile(fullPath.slice(MOUNT_SKILLS.length));
        }
        if (fullPath.startsWith(MOUNT_TOOLS)) {
            return readToolFile(fullPath.slice(MOUNT_TOOLS.length));
        }
        throw new Error(`Unknown virtual path: ${fullPath}`);
    },

    /** Write to a virtual file (only writable mounts) */
    async writeFile(fullPath: string, content: string): Promise<void> {
        if (fullPath.startsWith(MOUNT_TOOLS)) {
            return writeToolFile(fullPath.slice(MOUNT_TOOLS.length), content);
        }
        throw new Error(`Cannot write to: ${fullPath}`);
    },

    /** Delete a virtual file (only writable mounts) */
    async deleteFile(fullPath: string): Promise<void> {
        if (fullPath.startsWith(MOUNT_TOOLS)) {
            return deleteToolFile(fullPath.slice(MOUNT_TOOLS.length));
        }
        throw new Error(`Cannot delete: ${fullPath}`);
    },

    /** Get top-level virtual mounts for the sidebar */
    getMounts(): { name: string; path: string; icon: string }[] {
        return [
            { name: 'Skills', path: MOUNT_SKILLS, icon: 'puzzle' },
            { name: 'Tools', path: MOUNT_TOOLS, icon: 'wrench' },
        ];
    },
};
