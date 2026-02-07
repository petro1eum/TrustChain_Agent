/**
 * VerifiedFact component — displays TrustChain verification badge on facts.
 * Also exports VerificationInfo type used across the codebase.
 */

import React from 'react';

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

export const VerifiedFact: React.FC<VerifiedFactProps> = ({ text, verification }) => {
    const tierColors: Record<string, string> = {
        community: '#10b981',
        pro: '#3b82f6',
        enterprise: '#8b5cf6',
    };

    const color = tierColors[verification.certificate.tier] || '#6b7280';

    return (
        <span
            className="verified-fact"
            title={`Подписано: ${verification.certificate.owner} (${verification.certificate.organization})\nID: ${verification.signatureId}`}
            style={{
                borderBottom: `2px solid ${color}`,
                cursor: 'help',
                position: 'relative',
            }}
        >
            {text}
            <span
                style={{
                    display: 'inline-block',
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: color,
                    marginLeft: '2px',
                    verticalAlign: 'super',
                    fontSize: '0.6em',
                }}
                title="✓ Verified"
            />
        </span>
    );
};

export default VerifiedFact;
