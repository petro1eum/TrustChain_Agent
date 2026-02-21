import React, { useState } from 'react';
import { Eye, ShieldCheck } from 'lucide-react';
import type { Artifact, ExecutionStep } from './types';
import { ARTIFACT_META, TierBadge } from './constants';
import { TrustChainExplorerModal } from './TrustChainExplorerModal';

/**
 * ArtifactCard — Inline card shown inside chat messages for generated artifacts.
 */
export const ArtifactCard: React.FC<{
    artifact: Artifact;
    onClick: () => void;
    isActive: boolean;
}> = ({ artifact, onClick, isActive }) => {
    const meta = ARTIFACT_META[artifact.type];
    const [isExplorerOpen, setIsExplorerOpen] = useState(false);

    // Create a synthetic step to show in the explorer for this artifact
    const syntheticStep: ExecutionStep = {
        id: `artifact-${artifact.id}`,
        type: 'artifacts',
        label: `Artifact Generation: ${artifact.title}`,
        toolName: 'create_artifact',
        result: `Created artifact of type ${artifact.type} with ${artifact.content?.length || 0} bytes.`,
        signature: artifact.signature,
        signed: !!artifact.signature,
        tier: artifact.tier
    };

    return (
        <>
            <button
                onClick={onClick}
                className={`w-full text-left mt-2 p-3 rounded-xl border transition-all group tc-artifact-card
                ${isActive ? 'active' : ''}`}
            >
                <div className="flex items-center gap-2.5">
                    <div className={`w-8 h-8 rounded-lg ${meta.bg} flex items-center justify-center ${meta.color}`}>
                        {meta.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-sm tc-text-heading font-medium truncate">{artifact.title}</div>
                        <div className="text-[11px] tc-text-muted flex items-center gap-2">
                            <span>{meta.label}</span>
                            {artifact.version > 1 && <span>· v{artifact.version}</span>}
                            {artifact.signature && (
                                <div
                                    className="flex items-center gap-1 hover:text-emerald-500 transition-colors cursor-pointer"
                                    onClick={(e) => { e.stopPropagation(); setIsExplorerOpen(true); }}
                                    title="Inspect TrustChain Signature"
                                >
                                    <span>·</span>
                                    <ShieldCheck size={10} className="text-emerald-500/80" />
                                    <span className="text-emerald-500/80 font-mono tracking-tight">{artifact.signature.substring(0, 12)}</span>
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                        {artifact.tier && <TierBadge tier={artifact.tier} />}
                        <div className={`tc-text-muted group-hover:tc-text-secondary transition-colors ${isActive ? 'text-violet-400' : ''}`}>
                            <Eye size={14} />
                        </div>
                    </div>
                </div>
            </button>
            <TrustChainExplorerModal
                isOpen={isExplorerOpen}
                onClose={() => setIsExplorerOpen(false)}
                steps={[syntheticStep]}
            />
        </>
    );
};
