import React, { useState } from 'react';
import { CheckCircle2, Shield } from 'lucide-react';

/**
 * VerifiedFact — Displays a verified data point with TrustChain signature tooltip.
 * Ported from AI Studio's VerifiedFact component.
 */

export interface VerificationInfo {
    signature: string;
    signatureId: string;
    timestamp: number;
    certificate: {
        owner: string;
        organization: string;
        role: string;
        tier: 'community' | 'pro' | 'enterprise';
    };
}

interface VerifiedFactProps {
    text: string;
    verification: VerificationInfo;
}

const tierColors = {
    community: 'text-gray-400',
    pro: 'text-blue-400',
    enterprise: 'text-purple-400',
};

const tierLabels = {
    community: 'Community',
    pro: 'Pro',
    enterprise: 'Enterprise',
};

export const VerifiedFact: React.FC<VerifiedFactProps> = ({ text, verification }) => {
    const [showTooltip, setShowTooltip] = useState(false);

    return (
        <span
            className="relative verified-fact"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
        >
            {/* Highlighted text with checkmark */}
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 cursor-help text-sm">
                <span>{text}</span>
                <CheckCircle2 size={12} />
            </span>

            {/* Tooltip */}
            {showTooltip && (
                <span
                    className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-3 bg-gray-900 border border-emerald-700 rounded-lg shadow-xl"
                    style={{ pointerEvents: 'none' }}
                >
                    {/* Header */}
                    <span className="flex items-center gap-2 mb-2 pb-2 border-b border-gray-700">
                        <Shield className="w-4 h-4 text-emerald-400" />
                        <span className="text-sm font-medium text-emerald-400">TrustChain Verified</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded bg-gray-800 ${tierColors[verification.certificate.tier]}`}>
                            {tierLabels[verification.certificate.tier]}
                        </span>
                    </span>

                    {/* Details */}
                    <span className="block space-y-1.5 text-xs">
                        {[
                            { label: 'Owner', val: verification.certificate.owner },
                            { label: 'Organization', val: verification.certificate.organization },
                            { label: 'Role', val: verification.certificate.role },
                            { label: 'Signed at', val: new Date(verification.timestamp * 1000).toLocaleString() },
                        ].map(r => (
                            <span key={r.label} className="flex justify-between">
                                <span className="text-gray-500">{r.label}:</span>
                                <span className="text-gray-300">{r.val}</span>
                            </span>
                        ))}
                    </span>

                    {/* Signature ID */}
                    <span className="block mt-2 pt-2 border-t border-gray-700">
                        <span className="text-xs text-gray-500 font-mono truncate">
                            ID: {verification.signatureId.slice(0, 8)}...{verification.signatureId.slice(-8)}
                        </span>
                    </span>

                    {/* Tooltip arrow */}
                    <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
                        <span className="block border-8 border-transparent border-t-emerald-700" />
                    </span>
                </span>
            )}
        </span>
    );
};

export default VerifiedFact;
