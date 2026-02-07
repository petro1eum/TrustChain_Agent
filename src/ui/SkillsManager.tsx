/**
 * SkillsManager — Shows agent skills (SKILL.md files) grouped by category.
 *
 * Skills are higher-level capabilities loaded from /mnt/skills/... SKILL.md files.
 * Each skill has a name, description, category, subcategory, and container path.
 *
 * Features:
 * - Skills grouped by category (public, kb-tools/*, examples)
 * - Search/filter
 * - Click skill → detail panel with path, category, description
 * - "Ask Agent" button → prefills chat with a request to use/explain the skill
 */

import React, { useState, useMemo } from 'react';
import {
    Search, X, ChevronRight, ChevronLeft,
    Sparkles, BookOpen, Code, Globe,
    Database, Monitor, FolderOpen, Settings,
    Terminal, FileText, Layers, Puzzle,
    Wand2, MessageSquare, ExternalLink, Brain,
} from 'lucide-react';

// ── Skill data (static from SkillsLoaderService paths) ──

interface SkillInfo {
    name: string;
    description: string;
    path: string;
    category: string;
    subcategory?: string;
}

// Build skills list from the known SKILL_PATHS in SkillsLoaderService
// We include readable names/descriptions derived from path structure
const ALL_SKILLS: SkillInfo[] = [
    // === Public (5) ===
    { name: 'DOCX Generator', description: 'Create and format Microsoft Word documents', path: '/mnt/skills/public/docx/SKILL.md', category: 'public' },
    { name: 'PDF Generator', description: 'Create and format PDF documents', path: '/mnt/skills/public/pdf/SKILL.md', category: 'public' },
    { name: 'PPTX Generator', description: 'Create PowerPoint presentations', path: '/mnt/skills/public/pptx/SKILL.md', category: 'public' },
    { name: 'XLSX Generator', description: 'Create Excel spreadsheets with data', path: '/mnt/skills/public/xlsx/SKILL.md', category: 'public' },
    { name: 'Product Self-Knowledge', description: 'Agent self-awareness and product knowledge base', path: '/mnt/skills/public/product-self-knowledge/SKILL.md', category: 'public' },

    // === Category Management (14) ===
    { name: 'Test Category Search', description: 'Test search functionality for a category', path: '/mnt/skills/kb-tools/category-management/test-category-search/SKILL.md', category: 'kb-tools', subcategory: 'category-management' },
    { name: 'Run Category Diagnostic', description: 'Run diagnostic checks on category configuration', path: '/mnt/skills/kb-tools/category-management/run-category-diagnostic/SKILL.md', category: 'kb-tools', subcategory: 'category-management' },
    { name: 'Get Category Config', description: 'Retrieve current category configuration', path: '/mnt/skills/kb-tools/category-management/get-category-config/SKILL.md', category: 'kb-tools', subcategory: 'category-management' },
    { name: 'Troubleshoot Search', description: 'Troubleshoot search problems in categories', path: '/mnt/skills/kb-tools/category-management/troubleshoot-search-problems/SKILL.md', category: 'kb-tools', subcategory: 'category-management' },
    { name: 'Follow Diagnostic Protocol', description: 'Follow structured diagnostic protocol', path: '/mnt/skills/kb-tools/category-management/follow-diagnostic-protocol/SKILL.md', category: 'kb-tools', subcategory: 'category-management' },
    { name: 'Manage Category Lifecycle', description: 'Manage full lifecycle of a category', path: '/mnt/skills/kb-tools/category-management/manage-category-lifecycle/SKILL.md', category: 'kb-tools', subcategory: 'category-management' },
    { name: 'Add New Category', description: 'Create and configure a new category', path: '/mnt/skills/kb-tools/category-management/add-new-category/SKILL.md', category: 'kb-tools', subcategory: 'category-management' },
    { name: 'Get Category Info', description: 'Get detailed information about a category', path: '/mnt/skills/kb-tools/category-management/get-category-info/SKILL.md', category: 'kb-tools', subcategory: 'category-management' },
    { name: 'Get Category Backups', description: 'List available backups for a category', path: '/mnt/skills/kb-tools/category-management/get-category-backups/SKILL.md', category: 'kb-tools', subcategory: 'category-management' },
    { name: 'Validate Category Config', description: 'Validate category configuration for errors', path: '/mnt/skills/kb-tools/category-management/validate-category-config/SKILL.md', category: 'kb-tools', subcategory: 'category-management' },
    { name: 'Get Param Coverage', description: 'Get parameter coverage statistics for a category', path: '/mnt/skills/kb-tools/category-management/get-category-param-coverage/SKILL.md', category: 'kb-tools', subcategory: 'category-management' },
    { name: 'Restore Backup', description: 'Restore a category from backup', path: '/mnt/skills/kb-tools/category-management/restore-category-backup/SKILL.md', category: 'kb-tools', subcategory: 'category-management' },
    { name: 'Save Category Config', description: 'Save changes to category configuration', path: '/mnt/skills/kb-tools/category-management/save-category-config/SKILL.md', category: 'kb-tools', subcategory: 'category-management' },
    { name: 'Get Diagnostic History', description: 'View history of diagnostic runs', path: '/mnt/skills/kb-tools/category-management/get-diagnostic-history/SKILL.md', category: 'kb-tools', subcategory: 'category-management' },

    // === Computer Use (4) ===
    { name: 'View File', description: 'View contents of files in the workspace', path: '/mnt/skills/kb-tools/computer-use/view/SKILL.md', category: 'kb-tools', subcategory: 'computer-use' },
    { name: 'Bash Tool', description: 'Execute bash commands in sandbox', path: '/mnt/skills/kb-tools/computer-use/bash-tool/SKILL.md', category: 'kb-tools', subcategory: 'computer-use' },
    { name: 'Create File', description: 'Create new files in the workspace', path: '/mnt/skills/kb-tools/computer-use/create-file/SKILL.md', category: 'kb-tools', subcategory: 'computer-use' },
    { name: 'String Replace', description: 'Search and replace text in files', path: '/mnt/skills/kb-tools/computer-use/str-replace/SKILL.md', category: 'kb-tools', subcategory: 'computer-use' },

    // === Code Execution (6) ===
    { name: 'Execute Code', description: 'Run code snippets in sandboxed environment', path: '/mnt/skills/kb-tools/code-execution/execute-code/SKILL.md', category: 'kb-tools', subcategory: 'code-execution' },
    { name: 'Execute Bash', description: 'Execute bash scripts with output capture', path: '/mnt/skills/kb-tools/code-execution/execute-bash/SKILL.md', category: 'kb-tools', subcategory: 'code-execution' },
    { name: 'Load Tool', description: 'Load a saved tool for use', path: '/mnt/skills/kb-tools/code-execution/load-tool/SKILL.md', category: 'kb-tools', subcategory: 'code-execution' },
    { name: 'List Tools', description: 'List all available saved tools', path: '/mnt/skills/kb-tools/code-execution/list-tools/SKILL.md', category: 'kb-tools', subcategory: 'code-execution' },
    { name: 'Import Tool', description: 'Import external tool into the workspace', path: '/mnt/skills/kb-tools/code-execution/import-tool/SKILL.md', category: 'kb-tools', subcategory: 'code-execution' },
    { name: 'Save Tool', description: 'Save a tool for future use', path: '/mnt/skills/kb-tools/code-execution/save-tool/SKILL.md', category: 'kb-tools', subcategory: 'code-execution' },

    // === Web Tools (5) ===
    { name: 'Web Search', description: 'Search the web via DuckDuckGo/Jina', path: '/mnt/skills/kb-tools/web-tools/web-search/SKILL.md', category: 'kb-tools', subcategory: 'web-tools' },
    { name: 'Web Fetch', description: 'Fetch and extract content from URLs', path: '/mnt/skills/kb-tools/web-tools/web-fetch/SKILL.md', category: 'kb-tools', subcategory: 'web-tools' },
    { name: 'Read Project File', description: 'Read files from the project directory', path: '/mnt/skills/kb-tools/web-tools/read-project-file/SKILL.md', category: 'kb-tools', subcategory: 'web-tools' },
    { name: 'Synonyms Preview', description: 'Preview synonyms for search terms', path: '/mnt/skills/kb-tools/web-tools/get-synonyms-preview/SKILL.md', category: 'kb-tools', subcategory: 'web-tools' },
    { name: 'Search Files by Name', description: 'Find files by name pattern in workspace', path: '/mnt/skills/kb-tools/web-tools/search-files-by-name/SKILL.md', category: 'kb-tools', subcategory: 'web-tools' },

    // === File Tools (1) ===
    { name: 'Extract Table to Excel', description: 'Extract tables from documents to Excel format', path: '/mnt/skills/kb-tools/file-tools/extract-table-to-excel/SKILL.md', category: 'kb-tools', subcategory: 'file-tools' },

    // === Data Processing (10) ===
    { name: 'Missing Data', description: 'Detect and handle missing data', path: '/mnt/skills/kb-tools/data-processing/missing-data/SKILL.md', category: 'kb-tools', subcategory: 'data-processing' },
    { name: 'Normalize Data', description: 'Normalize and standardize data values', path: '/mnt/skills/kb-tools/data-processing/normalize-data/SKILL.md', category: 'kb-tools', subcategory: 'data-processing' },
    { name: 'Data Quality', description: 'Assess and improve data quality', path: '/mnt/skills/kb-tools/data-processing/data-quality/SKILL.md', category: 'kb-tools', subcategory: 'data-processing' },
    { name: 'Access Source File', description: 'Access source data files', path: '/mnt/skills/kb-tools/data-processing/access-source-file/SKILL.md', category: 'kb-tools', subcategory: 'data-processing' },
    { name: 'Add to Workspace', description: 'Add new data to workspace', path: '/mnt/skills/kb-tools/data-processing/add-to-workspace/SKILL.md', category: 'kb-tools', subcategory: 'data-processing' },
    { name: 'Smart Lookup', description: 'Intelligent data lookup and matching', path: '/mnt/skills/kb-tools/data-processing/smart-lookup/SKILL.md', category: 'kb-tools', subcategory: 'data-processing' },
    { name: 'Pandas Operation', description: 'Execute pandas DataFrame operations', path: '/mnt/skills/kb-tools/data-processing/pandas-operation/SKILL.md', category: 'kb-tools', subcategory: 'data-processing' },
    { name: 'Outliers', description: 'Detect and handle outliers in data', path: '/mnt/skills/kb-tools/data-processing/outliers/SKILL.md', category: 'kb-tools', subcategory: 'data-processing' },
    { name: 'Semantic Analysis', description: 'Semantic analysis of text data', path: '/mnt/skills/kb-tools/data-processing/semantic-analysis/SKILL.md', category: 'kb-tools', subcategory: 'data-processing' },
    { name: 'Text Processing', description: 'Process and transform text data', path: '/mnt/skills/kb-tools/data-processing/text-processing/SKILL.md', category: 'kb-tools', subcategory: 'data-processing' },

    // === Frontend Navigation (11) ===
    { name: 'Navigate to Tab', description: 'Navigate to a specific tab in the UI', path: '/mnt/skills/kb-tools/frontend-navigation/navigate-to-tab/SKILL.md', category: 'kb-tools', subcategory: 'frontend-navigation' },
    { name: 'Navigate to Subtab', description: 'Navigate to a subtab within a tab', path: '/mnt/skills/kb-tools/frontend-navigation/navigate-to-subtab/SKILL.md', category: 'kb-tools', subcategory: 'frontend-navigation' },
    { name: 'Get Current Screen', description: 'Get information about the current screen', path: '/mnt/skills/kb-tools/frontend-navigation/get-current-screen/SKILL.md', category: 'kb-tools', subcategory: 'frontend-navigation' },
    { name: 'Get App Structure', description: 'Get the navigation structure of the app', path: '/mnt/skills/kb-tools/frontend-navigation/get-app-structure/SKILL.md', category: 'kb-tools', subcategory: 'frontend-navigation' },
    { name: 'Select Category', description: 'Select a category in the UI', path: '/mnt/skills/kb-tools/frontend-navigation/select-category/SKILL.md', category: 'kb-tools', subcategory: 'frontend-navigation' },
    { name: 'Select Product', description: 'Select a product in the product list', path: '/mnt/skills/kb-tools/frontend-navigation/select-product/SKILL.md', category: 'kb-tools', subcategory: 'frontend-navigation' },
    { name: 'Search UI', description: 'Perform search operations in the UI', path: '/mnt/skills/kb-tools/frontend-navigation/search-ui/SKILL.md', category: 'kb-tools', subcategory: 'frontend-navigation' },
    { name: 'Apply Filters', description: 'Apply filters to data views', path: '/mnt/skills/kb-tools/frontend-navigation/apply-filters/SKILL.md', category: 'kb-tools', subcategory: 'frontend-navigation' },
    { name: 'Get Screen Data', description: 'Extract data from the current screen', path: '/mnt/skills/kb-tools/frontend-navigation/get-screen-data/SKILL.md', category: 'kb-tools', subcategory: 'frontend-navigation' },
    { name: 'Get Selected Items', description: 'Get currently selected items in the UI', path: '/mnt/skills/kb-tools/frontend-navigation/get-selected-items/SKILL.md', category: 'kb-tools', subcategory: 'frontend-navigation' },
    { name: 'Click Element', description: 'Click on a UI element by selector', path: '/mnt/skills/kb-tools/frontend-navigation/click-element/SKILL.md', category: 'kb-tools', subcategory: 'frontend-navigation' },

    // === Backend API (5) ===
    { name: 'Backend API Call', description: 'Call backend REST API endpoints', path: '/mnt/skills/kb-tools/backend-api/backend-api-call/SKILL.md', category: 'kb-tools', subcategory: 'backend-api' },
    { name: 'Get YAML File', description: 'Read YAML configuration files', path: '/mnt/skills/kb-tools/backend-api/get-yaml-file/SKILL.md', category: 'kb-tools', subcategory: 'backend-api' },
    { name: 'Save YAML File', description: 'Write YAML configuration files', path: '/mnt/skills/kb-tools/backend-api/save-yaml-file/SKILL.md', category: 'kb-tools', subcategory: 'backend-api' },
    { name: 'List API Endpoints', description: 'List all available API endpoints', path: '/mnt/skills/kb-tools/backend-api/list-api-endpoints/SKILL.md', category: 'kb-tools', subcategory: 'backend-api' },
    { name: 'List Data Files', description: 'List available data files on server', path: '/mnt/skills/kb-tools/backend-api/list-data-files/SKILL.md', category: 'kb-tools', subcategory: 'backend-api' },

    // === Examples (9) ===
    { name: 'Skill Creator', description: 'Create new skills with SKILL.md templates', path: '/mnt/skills/examples/skill-creator/SKILL.md', category: 'examples' },
    { name: 'Web Artifacts Builder', description: 'Build interactive web artifacts (HTML/JS/CSS)', path: '/mnt/skills/examples/web-artifacts-builder/SKILL.md', category: 'examples' },
    { name: 'Algorithmic Art', description: 'Generate algorithmic art and visualizations', path: '/mnt/skills/examples/algorithmic-art/SKILL.md', category: 'examples' },
    { name: 'Brand Guidelines', description: 'Create brand guideline documents', path: '/mnt/skills/examples/brand-guidelines/SKILL.md', category: 'examples' },
    { name: 'Canvas Design', description: 'Design canvas-based visual content', path: '/mnt/skills/examples/canvas-design/SKILL.md', category: 'examples' },
    { name: 'Internal Comms', description: 'Generate internal communications content', path: '/mnt/skills/examples/internal-comms/SKILL.md', category: 'examples' },
    { name: 'MCP Builder', description: 'Build MCP (Model Context Protocol) servers', path: '/mnt/skills/examples/mcp-builder/SKILL.md', category: 'examples' },
    { name: 'Slack GIF Creator', description: 'Create animated GIFs for Slack', path: '/mnt/skills/examples/slack-gif-creator/SKILL.md', category: 'examples' },
    { name: 'Theme Factory', description: 'Create UI themes and color schemes', path: '/mnt/skills/examples/theme-factory/SKILL.md', category: 'examples' },
];

// ── Category Icons & Labels ──

const CATEGORY_META: Record<string, { label: string; icon: React.FC<{ size?: number; className?: string }>; color: string }> = {
    'public': { label: 'Public Skills', icon: Globe, color: 'text-emerald-500' },
    'category-management': { label: 'Category Management', icon: FolderOpen, color: 'text-blue-500' },
    'computer-use': { label: 'Computer Use', icon: Terminal, color: 'text-amber-500' },
    'code-execution': { label: 'Code Execution', icon: Code, color: 'text-red-500' },
    'web-tools': { label: 'Web Tools', icon: Globe, color: 'text-cyan-500' },
    'file-tools': { label: 'File Tools', icon: FileText, color: 'text-orange-500' },
    'data-processing': { label: 'Data Processing', icon: Database, color: 'text-violet-500' },
    'frontend-navigation': { label: 'Frontend Navigation', icon: Monitor, color: 'text-pink-500' },
    'backend-api': { label: 'Backend API', icon: Settings, color: 'text-indigo-500' },
    'examples': { label: 'Example Skills', icon: Sparkles, color: 'text-yellow-500' },
};

function getCategoryKey(skill: SkillInfo): string {
    return skill.subcategory || skill.category;
}

// ── Props ──

export interface SkillsManagerProps {
    /** Called when "Ask Agent" button is clicked — prefills chat */
    onAskAgent?: (prompt: string) => void;
}

// ── Skill Detail ──

const SkillDetail: React.FC<{
    skill: SkillInfo;
    onBack: () => void;
    onAskAgent?: (prompt: string) => void;
}> = ({ skill, onBack, onAskAgent }) => {
    const catKey = getCategoryKey(skill);
    const catMeta = CATEGORY_META[catKey] || { label: catKey, icon: Puzzle, color: 'text-gray-500' };
    const CatIcon = catMeta.icon;

    return (
        <div className="animate-fadeIn space-y-3">
            <button onClick={onBack}
                className="flex items-center gap-1 text-xs tc-text hover:text-blue-500 transition-colors">
                <ChevronLeft size={14} /> Back to skills
            </button>

            {/* Header */}
            <div className="p-4 bg-gradient-to-br from-violet-50 to-blue-50 dark:from-violet-900/20 dark:to-blue-900/20 border border-violet-200 dark:border-violet-800/30 rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                    <CatIcon size={16} className={catMeta.color} />
                    <span className="text-sm font-bold tc-text">{skill.name}</span>
                </div>
                <div className="text-xs tc-text mb-3">{skill.description}</div>
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[9px] font-semibold text-violet-600 bg-violet-500/10 px-2 py-0.5 rounded-full uppercase tracking-wider">
                        {catMeta.label}
                    </span>
                    {skill.subcategory && (
                        <span className="text-[9px] font-mono text-gray-500 bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded">
                            {skill.category}/{skill.subcategory}
                        </span>
                    )}
                </div>
            </div>

            {/* Container Path */}
            <div>
                <div className="text-[10px] font-semibold tc-text uppercase tracking-wider mb-1">SKILL.md Location</div>
                <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                    <div className="flex items-start gap-2">
                        <FileText size={11} className="text-violet-500 mt-0.5 shrink-0" />
                        <div className="min-w-0">
                            <div className="text-[11px] font-mono text-violet-500 break-all">{skill.path}</div>
                            <div className="text-[9px] text-gray-500 dark:text-gray-400 mt-1">
                                Skills are loaded from Docker container. Use <code className="text-blue-500">view</code> tool to inspect content.
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 flex-wrap">
                {onAskAgent && (
                    <>
                        <button
                            onClick={() => onAskAgent(`Use the "${skill.name}" skill to help me. Read the skill instructions from ${skill.path} and follow them.`)}
                            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white rounded-lg
                                bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600
                                shadow-sm transition-all"
                        >
                            <Wand2 size={12} /> Use This Skill
                        </button>
                        <button
                            onClick={() => onAskAgent(`Read the SKILL.md at ${skill.path} and explain what the "${skill.name}" skill does, its parameters, and show example usage.`)}
                            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold tc-text border border-gray-200 dark:border-gray-600 rounded-lg
                                hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-colors"
                        >
                            <BookOpen size={12} /> Explain Skill
                        </button>
                    </>
                )}
            </div>
        </div>
    );
};

// ── Category Group ──

const CategoryGroup: React.FC<{
    categoryKey: string;
    skills: SkillInfo[];
    searchQuery: string;
    onSelect: (skill: SkillInfo) => void;
}> = ({ categoryKey, skills, searchQuery, onSelect }) => {
    const [isOpen, setIsOpen] = useState(true);
    const meta = CATEGORY_META[categoryKey] || { label: categoryKey, icon: Puzzle, color: 'text-gray-500' };
    const CatIcon = meta.icon;

    const filtered = useMemo(() => {
        if (!searchQuery) return skills;
        const q = searchQuery.toLowerCase();
        return skills.filter(s =>
            s.name.toLowerCase().includes(q)
            || s.description.toLowerCase().includes(q)
            || s.path.toLowerCase().includes(q),
        );
    }, [skills, searchQuery]);

    if (filtered.length === 0) return null;

    return (
        <div className="mb-2">
            <button onClick={() => setIsOpen(v => !v)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors">
                <ChevronRight size={12}
                    className={`tc-text transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`} />
                <CatIcon size={14} className={meta.color} />
                <span className="text-xs font-semibold tc-text flex-1 text-left">{meta.label}</span>
                <span className="text-[10px] tc-text">{filtered.length}</span>
            </button>

            {isOpen && (
                <div className="ml-3 mt-0.5 space-y-0.5 animate-fadeIn">
                    {filtered.map(skill => (
                        <div key={skill.path} onClick={() => onSelect(skill)}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer
                                hover:bg-violet-50 dark:hover:bg-violet-900/10 transition-colors">
                            <Sparkles size={10} className="text-violet-400 shrink-0" />
                            <div className="flex-1 min-w-0">
                                <div className="text-[11px] font-medium tc-text truncate">{skill.name}</div>
                                <div className="text-[10px] tc-text truncate" style={{ opacity: 0.6 }}>{skill.description}</div>
                            </div>
                            <ChevronRight size={10} className="text-gray-300 dark:text-gray-600 shrink-0" />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// ── Main Component ──

export const SkillsManager: React.FC<SkillsManagerProps> = ({ onAskAgent }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedSkill, setSelectedSkill] = useState<SkillInfo | null>(null);

    // Group by category key
    const grouped = useMemo(() => {
        const map = new Map<string, SkillInfo[]>();
        for (const skill of ALL_SKILLS) {
            const key = getCategoryKey(skill);
            const arr = map.get(key) || [];
            arr.push(skill);
            map.set(key, arr);
        }
        // Sort: public first, then kb-tools subcategories, then examples
        const order = ['public', 'category-management', 'computer-use', 'code-execution', 'web-tools', 'file-tools', 'data-processing', 'frontend-navigation', 'backend-api', 'examples'];
        return [...map.entries()].sort(([a], [b]) => {
            const ia = order.indexOf(a);
            const ib = order.indexOf(b);
            return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
        });
    }, []);

    // Detail view
    if (selectedSkill) {
        return (
            <SkillDetail
                skill={selectedSkill}
                onBack={() => setSelectedSkill(null)}
                onAskAgent={onAskAgent}
            />
        );
    }

    return (
        <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-1.5">
                    <Sparkles size={14} className="text-violet-500" />
                    <span className="text-xs font-semibold tc-text">{ALL_SKILLS.length} Skills Available</span>
                </div>
                {onAskAgent && (
                    <button
                        onClick={() => onAskAgent('List all your available skills and what each one can do. Group them by category.')}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-semibold text-white rounded-lg
                            bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600
                            shadow-sm transition-all"
                    >
                        <MessageSquare size={10} /> Ask Agent
                    </button>
                )}
            </div>

            {/* Search */}
            <div className="relative">
                <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search skills..."
                    className="w-full px-3 py-2 pl-8 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl tc-text focus:outline-none focus:ring-2 focus:ring-violet-500/30 placeholder:text-gray-400" />
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 tc-text" />
                {searchQuery && (
                    <button onClick={() => setSearchQuery('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 tc-text hover:text-violet-500">
                        <X size={12} />
                    </button>
                )}
            </div>

            {/* Categories */}
            <div className="space-y-0.5 max-h-[50vh] overflow-y-auto pr-1 custom-scrollbar">
                {grouped.map(([categoryKey, skills]) => (
                    <CategoryGroup
                        key={categoryKey}
                        categoryKey={categoryKey}
                        skills={skills}
                        searchQuery={searchQuery}
                        onSelect={setSelectedSkill}
                    />
                ))}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-center gap-1.5 text-[9px] tc-text pt-1 border-t border-gray-200 dark:border-gray-700">
                <Brain size={8} />
                Skills are loaded from /mnt/skills/*.SKILL.md in Docker container
            </div>
        </div>
    );
};

export default SkillsManager;
