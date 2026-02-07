import React from 'react';
import { Eye } from 'lucide-react';
import type { Artifact } from './types';
import { ARTIFACT_META, TierBadge } from './constants';

/**
 * ArtifactCard — Inline card shown inside chat messages for generated artifacts.
 */
export const ArtifactCard: React.FC<{
    artifact: Artifact;
    onClick: () => void;
    isActive: boolean;
}> = ({ artifact, onClick, isActive }) => {
    const meta = ARTIFACT_META[artifact.type];
    return (
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
                            <>
                                <span>·</span>
                                <span className="text-emerald-500/60 font-mono">{artifact.signature.substring(0, 8)}</span>
                            </>
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
    );
};
