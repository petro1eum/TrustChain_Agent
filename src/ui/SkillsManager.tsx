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

import React, { useState, useMemo, useEffect } from 'react';
import {
    Search, X, ChevronRight, ChevronLeft,
    Sparkles, BookOpen, Code, Globe,
    Database, Monitor, FolderOpen, Settings,
    Terminal, FileText, Layers, Puzzle,
    Wand2, MessageSquare, ExternalLink, Brain,
} from 'lucide-react';
import { SkillsLoaderService } from '../services/skills';

// ── Skill data (registry-driven from SkillsLoaderService) ──

interface SkillInfo {
    name: string;
    description: string;
    path: string;
    category: string;
    subcategory?: string;
}

const FALLBACK_SKILLS: SkillInfo[] = [
    { name: 'DOCX Generator', description: 'Create and format Microsoft Word documents', path: '/mnt/skills/public/docx/SKILL.md', category: 'public' },
    { name: 'PDF Generator', description: 'Create and format PDF documents', path: '/mnt/skills/public/pdf/SKILL.md', category: 'public' },
    { name: 'Web Search', description: 'Search the web and collect sources', path: '/mnt/skills/kb-tools/web-tools/web-search/SKILL.md', category: 'kb-tools', subcategory: 'web-tools' },
    { name: 'Bash Tool', description: 'Execute bash commands in sandbox', path: '/mnt/skills/kb-tools/computer-use/bash-tool/SKILL.md', category: 'kb-tools', subcategory: 'computer-use' },
];

function toSkillInfo(meta: any): SkillInfo {
    return {
        name: meta?.name || 'Unknown Skill',
        description: meta?.description || '',
        path: meta?.containerPath || meta?.path || '',
        category: meta?.category || 'public',
        subcategory: meta?.subcategory,
    };
}

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
    const [skills, setSkills] = useState<SkillInfo[]>(FALLBACK_SKILLS);

    useEffect(() => {
        let active = true;
        SkillsLoaderService.loadAllSkillsMetadata()
            .then((loaded) => {
                if (!active || !Array.isArray(loaded) || loaded.length === 0) return;
                setSkills(loaded.map(toSkillInfo));
            })
            .catch(() => {
                // silent fallback
            });
        return () => { active = false; };
    }, []);

    // Group by category key
    const grouped = useMemo(() => {
        const map = new Map<string, SkillInfo[]>();
        for (const skill of skills) {
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
    }, [skills]);

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
                    <span className="text-xs font-semibold tc-text">{skills.length} Skills Available</span>
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
                Skills are loaded from configurable registry (production/demo)
            </div>
        </div>
    );
};

export default SkillsManager;
