import React from 'react';
import {
    FileCode, FileText, Table, BarChart3, FileCheck,
    Network, Shield, Activity, Crown
} from 'lucide-react';
import type { Artifact, Tier, Conversation, Message } from './types';

/* ── Artifact Type Icons & Colors ── */
export const ARTIFACT_META: Record<Artifact['type'], { icon: React.ReactNode; color: string; bg: string; label: string }> = {
    code: { icon: <FileCode size={14} />, color: 'text-amber-400', bg: 'bg-amber-500/10', label: 'Code' },
    report: { icon: <FileText size={14} />, color: 'text-blue-400', bg: 'bg-blue-500/10', label: 'Report' },
    table: { icon: <Table size={14} />, color: 'text-emerald-400', bg: 'bg-emerald-500/10', label: 'Table' },
    document: { icon: <FileText size={14} />, color: 'text-violet-400', bg: 'bg-violet-500/10', label: 'Document' },
    chart: { icon: <BarChart3 size={14} />, color: 'text-rose-400', bg: 'bg-rose-500/10', label: 'Chart' },
    plan: { icon: <FileCheck size={14} />, color: 'text-cyan-400', bg: 'bg-cyan-500/10', label: 'Plan' },
    graph: { icon: <Network size={14} />, color: 'text-indigo-400', bg: 'bg-indigo-500/10', label: 'Execution Graph' },
    compliance: { icon: <Shield size={14} />, color: 'text-emerald-400', bg: 'bg-emerald-500/10', label: 'Compliance' },
    analytics: { icon: <Activity size={14} />, color: 'text-orange-400', bg: 'bg-orange-500/10', label: 'Analytics' },
};

/* ── Tier Config ── */
export const TIER_CONFIG: Record<Tier, { label: string; color: string; bg: string; border: string }> = {
    oss: { label: 'OSS', color: 'text-emerald-600', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
    pro: { label: 'PRO', color: 'text-blue-600', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
    enterprise: { label: 'ENT', color: 'text-violet-600', bg: 'bg-violet-500/10', border: 'border-violet-500/20' },
};

/* ── Tier Badge ── */
export const TierBadge: React.FC<{ tier: Tier; size?: 'sm' | 'md' }> = ({ tier, size = 'sm' }) => {
    const cfg = TIER_CONFIG[tier];
    return (
        <span className={`inline-flex items-center gap-1 font-semibold border rounded-full
            ${cfg.color} ${cfg.bg} ${cfg.border}
            ${size === 'sm' ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-0.5'}`}>
            {tier === 'enterprise' && <Crown size={8} />}
            {cfg.label}
        </span>
    );
};

/* ── Agent Tools (static fallback) ── */
export const AGENT_TOOLS: { name: string; desc: string; tier: Tier }[] = [
    { name: 'git_diff', desc: 'Compare commits', tier: 'oss' },
    { name: 'security_scan', desc: 'Static analysis', tier: 'oss' },
    { name: 'verify_chain', desc: 'Chain integrity check', tier: 'oss' },
    { name: 'code_generate', desc: 'Generate code artifacts', tier: 'oss' },
    { name: 'build_execution_graph', desc: 'DAG forensics', tier: 'pro' },
    { name: 'detect_anomalies', desc: 'Fork / replay check', tier: 'pro' },
    { name: 'streaming_verify', desc: 'Real-time signing', tier: 'pro' },
    { name: 'compliance_evaluate', desc: 'SOC2 / HIPAA / AI Act', tier: 'enterprise' },
    { name: 'export_report', desc: 'PDF / JSON export', tier: 'enterprise' },
];

export const AGENT_POLICIES: { name: string; desc: string; enforced: boolean }[] = [
    { name: 'sign_all_outputs', desc: 'Sign every tool result', enforced: true },
    { name: 'soc2_compliance', desc: 'SOC 2 Type II checks', enforced: true },
    { name: 'nonce_replay_guard', desc: 'Block replayed signatures', enforced: false },
];

/* ── Demo Conversations ── */
export const DEMO_CONVERSATIONS: Conversation[] = [
    { id: '1', title: 'Security Audit Pipeline', lastMessage: 'Full audit complete — 7 steps, all signed', timestamp: new Date(Date.now() - 300000), messageCount: 5, trustScore: 1.0 },
    { id: '2', title: 'Code review: auth module', lastMessage: 'Updated auth middleware', timestamp: new Date(Date.now() - 3600000), messageCount: 14, trustScore: 1.0 },
    { id: '3', title: 'Migration plan v3.0', lastMessage: 'Plan created with 3 phases', timestamp: new Date(Date.now() - 7200000), messageCount: 6, trustScore: 0.95 },
];
