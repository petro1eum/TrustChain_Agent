/**
 * ChainStatusBar — Bottom status bar displaying chain health statistics.
 * Shows chain length, verification status, and module availability.
 */

import React, { useEffect, useState } from 'react';

interface ChainStats {
    chainLength: number;
    verified: boolean;
    brokenLinks: number;
    proModules: number;
    totalModules: number;
}

function getBackendUrl(): string {
    return (import.meta as any).env?.VITE_BACKEND_URL || '';
}

export const ChainStatusBar: React.FC = () => {
    const [stats, setStats] = useState<ChainStats | null>(null);

    useEffect(() => {
        let mounted = true;
        let intervalId: ReturnType<typeof setInterval> | null = null;
        const base = getBackendUrl();
        let backendDown = false;

        async function fetchStats() {
            if (backendDown) return;
            try {
                const opts = { signal: AbortSignal.timeout(2000) };
                const [chainRes, proRes] = await Promise.all([
                    fetch(`${base}/api/trustchain/stats`, opts).then(r => r.ok ? r.json() : null).catch(() => null),
                    fetch(`${base}/api/trustchain-pro/status`, opts).then(r => r.ok ? r.json() : null).catch(() => null),
                ]);

                if (!mounted) return;

                // If both failed, backend is down — stop polling to avoid console spam
                if (!chainRes && !proRes) {
                    backendDown = true;
                    if (intervalId) clearInterval(intervalId);
                    return;
                }

                setStats({
                    chainLength: chainRes?.total_operations ?? 0,
                    verified: chainRes?.chain_valid ?? false,
                    brokenLinks: chainRes?.broken_links ?? 0,
                    proModules: proRes?.available_count ?? 0,
                    totalModules: proRes?.total_count ?? 0,
                });
            } catch {
                backendDown = true;
                if (intervalId) clearInterval(intervalId);
            }
        }

        fetchStats();
        intervalId = setInterval(fetchStats, 10000);
        return () => { mounted = false; if (intervalId) clearInterval(intervalId); };
    }, []);

    if (!stats) return null;

    const verifiedIcon = stats.verified ? '✅' : (stats.brokenLinks > 0 ? '⚠️' : '🔗');
    const verifiedLabel = stats.verified
        ? `Chain Verified: ${stats.chainLength} ops`
        : `Chain: ${stats.chainLength} ops (${stats.brokenLinks} broken)`;

    return (
        <div style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            height: 28,
            background: 'linear-gradient(90deg, #1e1e2e 0%, #181825 100%)',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 24,
            fontSize: 12,
            fontFamily: "'Inter', 'SF Mono', monospace",
            color: 'rgba(255,255,255,0.5)',
            zIndex: 9999,
            padding: '0 16px',
        }}>
            <span>{verifiedIcon} {verifiedLabel}</span>
            <span style={{ color: 'rgba(255,255,255,0.25)' }}>|</span>
            <span>🔑 Ed25519</span>
            <span style={{ color: 'rgba(255,255,255,0.25)' }}>|</span>
            <span>
                📦 Pro: {stats.proModules}/{stats.totalModules} modules
            </span>
            <a
                href={`${getBackendUrl()}/api/trustchain-pro/export/html`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                    color: '#89b4fa',
                    textDecoration: 'none',
                    marginLeft: 8,
                    cursor: 'pointer',
                    opacity: 0.7,
                    transition: 'opacity 0.2s',
                }}
                onMouseOver={e => (e.currentTarget.style.opacity = '1')}
                onMouseOut={e => (e.currentTarget.style.opacity = '0.7')}
            >
                📄 Export Audit HTML
            </a>
        </div>
    );
};
