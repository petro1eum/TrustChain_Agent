import React, { useState } from 'react';
import { Shield, ChevronRight, X, Code, Fingerprint, Clock, Zap, Network, Copy, Check, Download } from 'lucide-react';
import type { ExecutionStep, ToolCall } from './types';
import { exportTrustChainPdf } from '../../utils/trustchainPdfExport';

interface TrustChainExplorerModalProps {
    isOpen: boolean;
    onClose: () => void;
    steps?: ExecutionStep[];
    toolCalls?: ToolCall[];
}

export const TrustChainExplorerModal: React.FC<TrustChainExplorerModalProps> = ({
    isOpen,
    onClose,
    steps,
    toolCalls,
}) => {
    const [expandedNode, setExpandedNode] = useState<string | null>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);

    if (!isOpen) return null;

    // Normalizing inputs
    // We can have either new Agent-style `steps` or legacy OpenAI `toolCalls`
    const chainItems = (steps || []).filter(s => s.type === 'tool' || s.signed || s.signature).map((s, idx) => ({
        id: s.id || `step-${idx}`,
        toolName: s.toolName || s.label,
        args: s.args,
        result: s.result,
        latencyMs: s.latencyMs,
        signature: s.signature,
        type: s.type,
    }));

    if (chainItems.length === 0 && toolCalls) {
        toolCalls.forEach((tc, idx) => {
            chainItems.push({
                id: tc.id || `tc-${idx}`,
                toolName: tc.name,
                args: tc.args,
                result: tc.result,
                latencyMs: tc.latencyMs,
                signature: tc.signature,
                type: 'tool',
            });
        });
    }

    const handleCopy = (text: string, id: string) => {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const handleExportPdf = async () => {
        try {
            await exportTrustChainPdf(steps || [], toolCalls);
        } catch (error) {
            console.error('Failed to export PDF:', error);
            alert('Failed to generate protected PDF report.');
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                            <Shield className="text-emerald-500 w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                                TrustChain Explorer
                                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 font-mono text-[10px] tracking-wider uppercase">Verified</span>
                            </h2>
                            <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                                <Network size={12} />
                                Cryptographic Signature Chain ({chainItems.length} nodes)
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleExportPdf}
                            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 bg-slate-100/50 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded-lg transition-colors border border-slate-200 dark:border-slate-700 hover:border-emerald-200 dark:hover:border-emerald-500/30"
                            title="Download Protected PDF Audit Report"
                        >
                            <Download size={14} />
                            Save PDF
                        </button>
                        <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-1"></div>
                        <button onClick={onClose} className="p-2 -mr-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Body / Timeline */}
                <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
                    <div className="relative">
                        {/* Vertical line connecting nodes */}
                        <div className="absolute top-8 bottom-8 left-[19px] w-0.5 bg-gradient-to-b from-emerald-500 via-emerald-500/50 to-emerald-500/10" />

                        <div className="space-y-6">
                            {chainItems.map((item, index) => {
                                const isExpanded = expandedNode === item.id;
                                const hasSig = !!item.signature;
                                const shortSig = hasSig ? `${item.signature!.slice(0, 16)}...${item.signature!.slice(-16)}` : 'Unsigned Operation';

                                return (
                                    <div key={item.id} className="relative pl-12">
                                        {/* Timeline Node Icon */}
                                        <div className={`absolute left-0 top-1 w-10 h-10 rounded-full border-4 border-white dark:border-slate-900 flex items-center justify-center bg-white dark:bg-slate-900 z-10
                                            ${hasSig ? 'text-emerald-500' : 'text-slate-400'}`}>
                                            <div className={`w-full h-full rounded-full flex items-center justify-center bg-slate-100 dark:bg-slate-800
                                                ${hasSig ? 'border-emerald-500/30 border text-emerald-500' : 'border-slate-300 dark:border-slate-700 border text-slate-400'}`}>
                                                <Fingerprint size={14} />
                                            </div>
                                        </div>

                                        {/* Node Content */}
                                        <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">

                                            {/* Node Header (Clickable) */}
                                            <div
                                                className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors"
                                                onClick={() => setExpandedNode(isExpanded ? null : item.id)}
                                            >
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <div className="flex items-center justify-center w-7 h-7 rounded bg-blue-500/10 text-blue-500 shrink-0">
                                                        <Code size={12} />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="text-sm font-mono text-slate-800 dark:text-slate-200 font-semibold truncate">
                                                            {item.toolName}
                                                        </div>
                                                        <div className="text-[10px] text-slate-500 flex items-center gap-2 mt-0.5">
                                                            <span>Node #{index + 1}</span>
                                                            {item.latencyMs && (
                                                                <>
                                                                    <span>·</span>
                                                                    <span className="flex items-center gap-1"><Clock size={10} /> {item.latencyMs}ms</span>
                                                                </>
                                                            )}
                                                            {hasSig && (
                                                                <>
                                                                    <span>·</span>
                                                                    <span className="text-emerald-600 dark:text-emerald-400 font-mono tracking-tight flex items-center gap-1">
                                                                        <Zap size={10} /> Ed25519 Verified
                                                                    </span>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-4 shrink-0">
                                                    {hasSig && (
                                                        <div className="px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded text-[10px] font-mono hidden sm:block">
                                                            {shortSig}
                                                        </div>
                                                    )}
                                                    <ChevronRight size={16} className={`text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                                                </div>
                                            </div>

                                            {/* Node Details (Expanded) */}
                                            {isExpanded && (
                                                <div className="px-4 pb-4 border-t border-slate-200 dark:border-slate-700/50 pt-3 bg-white dark:bg-slate-900/50">
                                                    <div className="space-y-4">

                                                        {/* Full Signature */}
                                                        {item.signature && (
                                                            <div>
                                                                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                                                                    <span>Cryptographic Signature (Ed25519)</span>
                                                                    <button
                                                                        onClick={() => handleCopy(item.signature!, item.id)}
                                                                        className="flex items-center gap-1 text-blue-500 hover:text-blue-600"
                                                                    >
                                                                        {copiedId === item.id ? <Check size={10} /> : <Copy size={10} />}
                                                                    </button>
                                                                </div>
                                                                <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-[11px] font-mono text-emerald-600 dark:text-emerald-400 break-all select-all">
                                                                    {item.signature}
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Input Args */}
                                                        {item.args && Object.keys(item.args).length > 0 && (
                                                            <div>
                                                                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Payload (Arguments)</div>
                                                                <div className="p-2.5 rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
                                                                    <pre className="text-[11px] font-mono text-slate-700 dark:text-slate-300 overflow-x-auto whitespace-pre-wrap word-break-all">
                                                                        {JSON.stringify(item.args, null, 2)}
                                                                    </pre>
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Result */}
                                                        {item.result && (
                                                            <div>
                                                                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Execution Result</div>
                                                                <div className="p-2.5 rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
                                                                    <pre className="text-[11px] font-mono text-slate-700 dark:text-slate-300 overflow-y-auto max-h-48 whitespace-pre-wrap word-break-all">
                                                                        {typeof item.result === 'string' ? item.result : JSON.stringify(item.result, null, 2)}
                                                                    </pre>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
