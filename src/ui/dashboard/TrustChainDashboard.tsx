import React, { useState, useEffect, useCallback } from 'react';
import {
    Shield, Activity, FileCheck, Key, Wifi, WifiOff,
    Download, RefreshCw, ChevronRight, AlertTriangle,
    CheckCircle, XCircle, Clock, BarChart3, Zap, Lock
} from 'lucide-react';

/* ─────────── Types ─────────── */

interface TrustChainStats {
    totalOperations: number;
    successRate: number;
    avgLatencyMs: number;
    chainLength: number;
    violations: number;
    lastUpdated: string;
}

interface AuditEntry {
    id: string;
    tool: string;
    timestamp: string;
    signature: string;
    verified: boolean;
    data: Record<string, unknown>;
    parentSignature?: string;
}

interface ComplianceResult {
    framework: string;
    score: number;
    status: 'compliant' | 'partial' | 'non_compliant';
    controls: { name: string; passed: boolean; details: string }[];
}

interface ToolMetric {
    name: string;
    calls: number;
    avgLatency: number;
    errorRate: number;
    lastCall: string;
}

interface KeyInfo {
    id: string;
    algorithm: string;
    created: string;
    provider: string;
    status: 'active' | 'rotated' | 'revoked';
}

interface DashboardProps {
    isOpen: boolean;
    onClose: () => void;
    /** Optional: endpoint base URL for the TrustChain API */
    apiBase?: string;
}

/* ─────────── Demo Data Generator ─────────── */

function generateDemoData(): {
    stats: TrustChainStats;
    auditTrail: AuditEntry[];
    compliance: ComplianceResult[];
    toolMetrics: ToolMetric[];
    keys: KeyInfo[];
} {
    const now = new Date();
    const auditTrail: AuditEntry[] = [
        'data_load', 'preprocess', 'validate', 'train_model',
        'evaluate', 'approve', 'deploy', 'monitor'
    ].map((tool, i) => ({
        id: `op_${1000 + i}`,
        tool,
        timestamp: new Date(now.getTime() - (7 - i) * 60000).toISOString(),
        signature: Array.from({ length: 8 }, () =>
            Math.random().toString(36).substring(2, 6)
        ).join(''),
        verified: true,
        data: { step: i + 1, status: 'completed' },
        parentSignature: i > 0 ? `parent_sig_${i}` : undefined,
    }));

    return {
        stats: {
            totalOperations: 1247,
            successRate: 0.986,
            avgLatencyMs: 42,
            chainLength: auditTrail.length,
            violations: 3,
            lastUpdated: now.toISOString(),
        },
        auditTrail,
        compliance: [
            {
                framework: 'SOC 2',
                score: 1.0,
                status: 'compliant',
                controls: [
                    { name: 'Key Management', passed: true, details: 'Ed25519 keys with AES-256-GCM encryption' },
                    { name: 'Cryptographic Signing', passed: true, details: 'All operations signed' },
                    { name: 'Chain Integrity', passed: true, details: 'Parent-child chain verified' },
                    { name: 'Audit Trail', passed: true, details: 'Complete audit trail maintained' },
                    { name: 'Nonce Protection', passed: true, details: 'Replay attacks blocked' },
                ],
            },
            {
                framework: 'HIPAA',
                score: 0.8,
                status: 'partial',
                controls: [
                    { name: 'Access Controls', passed: true, details: 'Role-based access configured' },
                    { name: 'Audit Logging', passed: true, details: 'All actions logged' },
                    { name: 'Encryption at Rest', passed: true, details: 'AES-256 encryption' },
                    { name: 'Data Integrity', passed: true, details: 'Cryptographic verification' },
                    { name: 'Breach Notification', passed: false, details: 'Not configured' },
                ],
            },
            {
                framework: 'EU AI Act',
                score: 0.6,
                status: 'partial',
                controls: [
                    { name: 'Transparency', passed: true, details: 'Decision provenance tracked' },
                    { name: 'Human Oversight', passed: true, details: 'Approval gates in pipeline' },
                    { name: 'Risk Assessment', passed: false, details: 'Pending configuration' },
                    { name: 'Technical Documentation', passed: true, details: 'Auto-generated' },
                    { name: 'Bias Monitoring', passed: false, details: 'Not implemented' },
                ],
            },
        ],
        toolMetrics: [
            { name: 'web_search', calls: 342, avgLatency: 850, errorRate: 0.02, lastCall: new Date(now.getTime() - 300000).toISOString() },
            { name: 'code_exec', calls: 589, avgLatency: 120, errorRate: 0.05, lastCall: new Date(now.getTime() - 60000).toISOString() },
            { name: 'file_ops', calls: 201, avgLatency: 15, errorRate: 0.001, lastCall: new Date(now.getTime() - 180000).toISOString() },
            { name: 'bash', calls: 115, avgLatency: 230, errorRate: 0.08, lastCall: new Date(now.getTime() - 420000).toISOString() },
        ],
        keys: [
            { id: 'key_prod_001', algorithm: 'Ed25519', created: new Date(now.getTime() - 86400000 * 30).toISOString(), provider: 'LocalFileKeyProvider', status: 'active' },
            { id: 'key_prev_001', algorithm: 'Ed25519', created: new Date(now.getTime() - 86400000 * 90).toISOString(), provider: 'LocalFileKeyProvider', status: 'rotated' },
        ],
    };
}

/* ─────────── Sub-Components ─────────── */

const StatCard: React.FC<{
    label: string;
    value: string | number;
    icon: React.ReactNode;
    trend?: 'up' | 'down' | 'stable';
    color?: string;
}> = ({ label, value, icon, color = 'blue' }) => (
    <div className={`bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 
    hover:border-${color}-500/30 transition-all duration-200 group`}>
        <div className="flex items-center justify-between mb-2">
            <span className="text-gray-400 text-xs uppercase tracking-wider">{label}</span>
            <span className={`text-${color}-400 opacity-60 group-hover:opacity-100 transition-opacity`}>
                {icon}
            </span>
        </div>
        <div className="text-2xl font-bold text-white">{value}</div>
    </div>
);

const ProgressBar: React.FC<{ value: number; color: string }> = ({ value, color }) => (
    <div className="w-full bg-gray-700/50 rounded-full h-2 overflow-hidden">
        <div
            className={`h-full rounded-full transition-all duration-500 bg-gradient-to-r ${color}`}
            style={{ width: `${Math.min(100, value * 100)}%` }}
        />
    </div>
);

/* ─────────── Tab: Overview ─────────── */

const OverviewTab: React.FC<{
    stats: TrustChainStats;
    toolMetrics: ToolMetric[];
}> = ({ stats, toolMetrics }) => (
    <div className="space-y-6">
        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
                label="Operations"
                value={stats.totalOperations.toLocaleString()}
                icon={<Activity size={18} />}
                color="blue"
            />
            <StatCard
                label="Success Rate"
                value={`${(stats.successRate * 100).toFixed(1)}%`}
                icon={<CheckCircle size={18} />}
                color="emerald"
            />
            <StatCard
                label="Avg Latency"
                value={`${stats.avgLatencyMs}ms`}
                icon={<Zap size={18} />}
                color="amber"
            />
            <StatCard
                label="Violations"
                value={stats.violations}
                icon={<AlertTriangle size={18} />}
                color="red"
            />
        </div>

        {/* Tool metrics table */}
        <div className="bg-gray-800/30 border border-gray-700/50 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-700/50">
                <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                    <BarChart3 size={16} className="text-blue-400" />
                    Tool Metrics
                </h3>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-gray-400 border-b border-gray-700/30">
                            <th className="text-left px-5 py-2.5 font-medium">Tool</th>
                            <th className="text-right px-5 py-2.5 font-medium">Calls</th>
                            <th className="text-right px-5 py-2.5 font-medium">Avg Latency</th>
                            <th className="text-right px-5 py-2.5 font-medium">Error Rate</th>
                            <th className="text-left px-5 py-2.5 font-medium">Last Call</th>
                        </tr>
                    </thead>
                    <tbody>
                        {toolMetrics.map((metric) => (
                            <tr key={metric.name} className="border-b border-gray-700/20 hover:bg-gray-700/20 transition-colors">
                                <td className="px-5 py-3">
                                    <span className="text-blue-400 font-mono text-xs bg-blue-500/10 px-2 py-1 rounded">
                                        {metric.name}
                                    </span>
                                </td>
                                <td className="text-right px-5 py-3 text-gray-300">{metric.calls.toLocaleString()}</td>
                                <td className="text-right px-5 py-3 text-gray-300">{metric.avgLatency}ms</td>
                                <td className="text-right px-5 py-3">
                                    <span className={`${metric.errorRate > 0.05 ? 'text-red-400' : 'text-emerald-400'}`}>
                                        {(metric.errorRate * 100).toFixed(1)}%
                                    </span>
                                </td>
                                <td className="px-5 py-3 text-gray-500 text-xs">
                                    {new Date(metric.lastCall).toLocaleTimeString()}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    </div>
);

/* ─────────── Tab: Audit Trail ─────────── */

const AuditTrailTab: React.FC<{
    entries: AuditEntry[];
}> = ({ entries }) => {
    const [expandedId, setExpandedId] = useState<string | null>(null);

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-300">
                    Chain of Trust — {entries.length} entries
                </h3>
                <button className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors 
          bg-blue-500/10 px-3 py-1.5 rounded-lg">
                    <Download size={14} />
                    Export PDF
                </button>
            </div>

            {entries.map((entry, idx) => (
                <div key={entry.id}>
                    {/* Chain connector */}
                    {idx > 0 && (
                        <div className="flex items-center pl-6 py-1">
                            <div className="w-0.5 h-4 bg-gradient-to-b from-emerald-500/40 to-emerald-500/20" />
                            <ChevronRight size={12} className="text-emerald-500/40 ml-1" />
                        </div>
                    )}

                    <div
                        className={`bg-gray-800/40 border rounded-xl transition-all duration-200 cursor-pointer
              ${expandedId === entry.id
                                ? 'border-blue-500/40 shadow-lg shadow-blue-500/5'
                                : 'border-gray-700/40 hover:border-gray-600/60'
                            }`}
                        onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                    >
                        <div className="flex items-center gap-3 px-4 py-3">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center
                ${entry.verified ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                                {entry.verified ? <CheckCircle size={16} /> : <XCircle size={16} />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-blue-400 font-mono text-xs">{entry.tool}</span>
                                    <span className="text-gray-500 text-xs">#{entry.id}</span>
                                </div>
                                <div className="text-gray-500 text-xs mt-0.5">
                                    {new Date(entry.timestamp).toLocaleString()}
                                </div>
                            </div>
                            <div className="text-gray-600 font-mono text-xs truncate max-w-[120px]">
                                {entry.signature.substring(0, 16)}…
                            </div>
                        </div>

                        {/* Expanded details */}
                        {expandedId === entry.id && (
                            <div className="px-4 pb-3 pt-1 border-t border-gray-700/30 space-y-2">
                                <div className="grid grid-cols-2 gap-4 text-xs">
                                    <div>
                                        <span className="text-gray-500">Signature:</span>
                                        <p className="text-gray-300 font-mono break-all">{entry.signature}</p>
                                    </div>
                                    {entry.parentSignature && (
                                        <div>
                                            <span className="text-gray-500">Parent:</span>
                                            <p className="text-gray-300 font-mono break-all">{entry.parentSignature}</p>
                                        </div>
                                    )}
                                </div>
                                <div>
                                    <span className="text-gray-500 text-xs">Data:</span>
                                    <pre className="text-gray-300 text-xs font-mono bg-gray-900/50 rounded-lg p-2 mt-1 overflow-auto">
                                        {JSON.stringify(entry.data, null, 2)}
                                    </pre>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
};

/* ─────────── Tab: Compliance ─────────── */

const ComplianceTab: React.FC<{
    results: ComplianceResult[];
}> = ({ results }) => {
    const statusColors = {
        compliant: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30' },
        partial: { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30' },
        non_compliant: { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/30' },
    };

    const statusLabels = {
        compliant: 'Compliant',
        partial: 'Partial',
        non_compliant: 'Non-Compliant',
    };

    return (
        <div className="space-y-5">
            {results.map((result) => {
                const colors = statusColors[result.status];
                return (
                    <div key={result.framework}
                        className={`bg-gray-800/30 border ${colors.border} rounded-xl overflow-hidden`}>
                        {/* Framework header */}
                        <div className="px-5 py-4 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <FileCheck size={20} className={colors.text} />
                                <div>
                                    <h3 className="text-white font-semibold">{result.framework}</h3>
                                    <span className={`text-xs ${colors.text} ${colors.bg} px-2 py-0.5 rounded-full`}>
                                        {statusLabels[result.status]}
                                    </span>
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-2xl font-bold text-white">{Math.round(result.score * 100)}%</div>
                                <div className="w-24 mt-1">
                                    <ProgressBar
                                        value={result.score}
                                        color={result.score >= 0.8 ? 'from-emerald-500 to-emerald-400' :
                                            result.score >= 0.6 ? 'from-amber-500 to-amber-400' : 'from-red-500 to-red-400'}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Controls */}
                        <div className="border-t border-gray-700/30 divide-y divide-gray-700/20">
                            {result.controls.map((control) => (
                                <div key={control.name} className="px-5 py-2.5 flex items-center gap-3 hover:bg-gray-700/10">
                                    {control.passed
                                        ? <CheckCircle size={14} className="text-emerald-400 shrink-0" />
                                        : <XCircle size={14} className="text-red-400 shrink-0" />
                                    }
                                    <span className="text-gray-300 text-sm flex-1">{control.name}</span>
                                    <span className="text-gray-500 text-xs max-w-[200px] truncate">{control.details}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

/* ─────────── Tab: Key Management ─────────── */

const KeyManagementTab: React.FC<{
    keys: KeyInfo[];
}> = ({ keys }) => {
    const statusBadge = (status: KeyInfo['status']) => {
        const styles = {
            active: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
            rotated: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
            revoked: 'bg-red-500/15 text-red-400 border-red-500/30',
        };
        return (
            <span className={`text-xs px-2 py-0.5 rounded-full border ${styles[status]}`}>
                {status}
            </span>
        );
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                    <Key size={16} className="text-purple-400" />
                    Cryptographic Keys
                </h3>
                <button className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 
          bg-purple-500/10 px-3 py-1.5 rounded-lg transition-colors">
                    <RefreshCw size={14} />
                    Rotate Key
                </button>
            </div>

            {keys.map((key) => (
                <div key={key.id}
                    className="bg-gray-800/40 border border-gray-700/40 rounded-xl p-4 hover:border-purple-500/20 transition-all">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <Lock size={16} className="text-purple-400" />
                            <span className="text-white font-mono text-sm">{key.id}</span>
                        </div>
                        {statusBadge(key.status)}
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-xs">
                        <div>
                            <span className="text-gray-500 block">Algorithm</span>
                            <span className="text-gray-300">{key.algorithm}</span>
                        </div>
                        <div>
                            <span className="text-gray-500 block">Provider</span>
                            <span className="text-gray-300">{key.provider}</span>
                        </div>
                        <div>
                            <span className="text-gray-500 block">Created</span>
                            <span className="text-gray-300">{new Date(key.created).toLocaleDateString()}</span>
                        </div>
                    </div>
                </div>
            ))}

            {/* Security info card */}
            <div className="bg-gradient-to-br from-purple-500/5 to-blue-500/5 border border-purple-500/20 rounded-xl p-4">
                <h4 className="text-purple-300 text-sm font-medium mb-2">🔐 Security Details</h4>
                <div className="text-gray-400 text-xs space-y-1">
                    <p>• Keys encrypted with AES-256-GCM + PBKDF2 (600K iterations)</p>
                    <p>• Ed25519 signatures for all operations</p>
                    <p>• File permissions: 0600 (owner read/write only)</p>
                    <p>• Supports AWS KMS and Azure Key Vault providers</p>
                </div>
            </div>
        </div>
    );
};

/* ─────────── Tab: Air-Gapped ─────────── */

const AirGappedTab: React.FC = () => {
    const [isOffline, setIsOffline] = useState(false);

    return (
        <div className="space-y-5">
            {/* Offline toggle */}
            <div className="bg-gray-800/40 border border-gray-700/40 rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        {isOffline ? (
                            <WifiOff size={20} className="text-amber-400" />
                        ) : (
                            <Wifi size={20} className="text-emerald-400" />
                        )}
                        <div>
                            <h3 className="text-white font-semibold">Air-Gapped Mode</h3>
                            <p className="text-gray-400 text-xs">
                                {isOffline ? 'All network dependencies disabled' : 'Connected — cloud services available'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => setIsOffline(!isOffline)}
                        className={`relative w-12 h-6 rounded-full transition-colors duration-200 
              ${isOffline ? 'bg-amber-500' : 'bg-gray-600'}`}
                    >
                        <div className={`absolute w-5 h-5 bg-white rounded-full top-0.5 transition-transform duration-200
              ${isOffline ? 'translate-x-6' : 'translate-x-0.5'}`} />
                    </button>
                </div>

                {isOffline && (
                    <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-300 space-y-1">
                        <p>⚠️ Air-gapped mode enabled:</p>
                        <p>• TSA: Local Ed25519 signer (RFC 3161-compatible)</p>
                        <p>• Storage: In-memory nonce store</p>
                        <p>• No external API calls</p>
                    </div>
                )}
            </div>

            {/* Local TSA status */}
            <div className="bg-gray-800/30 border border-gray-700/40 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                    <Clock size={16} className="text-blue-400" />
                    <h3 className="text-sm font-semibold text-gray-300">Local Timestamp Authority</h3>
                </div>
                <div className="grid grid-cols-2 gap-4 text-xs">
                    <div className="bg-gray-900/40 rounded-lg p-3">
                        <span className="text-gray-500 block mb-1">Algorithm</span>
                        <span className="text-gray-300 font-mono">Ed25519</span>
                    </div>
                    <div className="bg-gray-900/40 rounded-lg p-3">
                        <span className="text-gray-500 block mb-1">Protocol</span>
                        <span className="text-gray-300 font-mono">RFC 3161</span>
                    </div>
                    <div className="bg-gray-900/40 rounded-lg p-3">
                        <span className="text-gray-500 block mb-1">Status</span>
                        <span className="text-emerald-400">✓ Available</span>
                    </div>
                    <div className="bg-gray-900/40 rounded-lg p-3">
                        <span className="text-gray-500 block mb-1">Timestamps</span>
                        <span className="text-gray-300">0 issued</span>
                    </div>
                </div>
            </div>

            {/* Deployment info */}
            <div className="bg-gradient-to-br from-blue-500/5 to-emerald-500/5 border border-blue-500/20 rounded-xl p-4">
                <h4 className="text-blue-300 text-sm font-medium mb-2">📦 Deployment Options</h4>
                <div className="text-gray-400 text-xs space-y-1.5">
                    <p>• <span className="text-gray-300">Docker:</span> docker-compose up (includes Redis + Nginx)</p>
                    <p>• <span className="text-gray-300">Kubernetes:</span> helm install trustchain-pro ./deploy/helm</p>
                    <p>• <span className="text-gray-300">Air-gapped:</span> ./deploy/air-gapped/bundle.sh → transfer → install.sh</p>
                </div>
            </div>
        </div>
    );
};

/* ─────────── Main Dashboard ─────────── */

type TabId = 'overview' | 'audit' | 'compliance' | 'keys' | 'airgap';

const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <Activity size={16} /> },
    { id: 'audit', label: 'Audit Trail', icon: <Shield size={16} /> },
    { id: 'compliance', label: 'Compliance', icon: <FileCheck size={16} /> },
    { id: 'keys', label: 'Keys', icon: <Key size={16} /> },
    { id: 'airgap', label: 'Air-Gap', icon: <WifiOff size={16} /> },
];

const TrustChainDashboard: React.FC<DashboardProps> = ({ isOpen, onClose }) => {
    const [activeTab, setActiveTab] = useState<TabId>('overview');
    const [data, setData] = useState<ReturnType<typeof generateDemoData> | null>(null);
    const [loading, setLoading] = useState(true);

    const loadData = useCallback(() => {
        setLoading(true);
        // In production, this would fetch from /api/trustchain/*
        // For now, use demo data
        setTimeout(() => {
            setData(generateDemoData());
            setLoading(false);
        }, 300);
    }, []);

    useEffect(() => {
        if (isOpen) loadData();
    }, [isOpen, loadData]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-gray-900 border border-gray-700/60 rounded-2xl shadow-2xl
        w-[95vw] max-w-[1100px] h-[85vh] max-h-[800px] flex flex-col overflow-hidden">

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/50 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl 
              flex items-center justify-center shadow-lg shadow-blue-500/20">
                            <Shield size={18} className="text-white" />
                        </div>
                        <div>
                            <h2 className="text-white font-semibold text-base">TrustChain Dashboard</h2>
                            <p className="text-gray-500 text-xs">Enterprise AI Verification</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={loadData}
                            className="text-gray-400 hover:text-gray-200 p-2 hover:bg-gray-800 rounded-lg transition-colors"
                            title="Refresh"
                        >
                            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                        </button>
                        <button
                            onClick={onClose}
                            className="text-gray-400 hover:text-gray-200 text-xl font-bold w-8 h-8 
                flex items-center justify-center rounded-lg hover:bg-gray-800 transition-colors"
                        >
                            ×
                        </button>
                    </div>
                </div>

                {/* Tab bar */}
                <div className="flex items-center gap-1 px-6 py-2 border-b border-gray-700/30 shrink-0 overflow-x-auto">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150
                ${activeTab === tab.id
                                    ? 'bg-blue-500/15 text-blue-400 shadow-sm'
                                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/60'
                                }`}
                        >
                            {tab.icon}
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto px-6 py-5 chat-scrollbar">
                    {loading || !data ? (
                        <div className="flex items-center justify-center h-full">
                            <div className="text-center">
                                <RefreshCw size={24} className="text-blue-400 animate-spin mx-auto mb-3" />
                                <p className="text-gray-400 text-sm">Loading dashboard…</p>
                            </div>
                        </div>
                    ) : (
                        <>
                            {activeTab === 'overview' && (
                                <OverviewTab stats={data.stats} toolMetrics={data.toolMetrics} />
                            )}
                            {activeTab === 'audit' && (
                                <AuditTrailTab entries={data.auditTrail} />
                            )}
                            {activeTab === 'compliance' && (
                                <ComplianceTab results={data.compliance} />
                            )}
                            {activeTab === 'keys' && (
                                <KeyManagementTab keys={data.keys} />
                            )}
                            {activeTab === 'airgap' && (
                                <AirGappedTab />
                            )}
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-2.5 border-t border-gray-700/30 flex items-center justify-between text-xs text-gray-500 shrink-0">
                    <span>TrustChain Pro v0.3.0</span>
                    <span>
                        Last updated: {data ? new Date(data.stats.lastUpdated).toLocaleTimeString() : '—'}
                    </span>
                </div>
            </div>
        </div>
    );
};

export default TrustChainDashboard;
export type { DashboardProps, TrustChainStats, AuditEntry, ComplianceResult, ToolMetric, KeyInfo };
