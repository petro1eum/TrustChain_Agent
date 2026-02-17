/**
 * ProSettingsPanel — shared Pro/Enterprise settings component.
 * Used in both the main app (Settings modal tab) and Panel (compact overlay).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Shield, Crown, Building2, FileText, ToggleLeft, ToggleRight, AlertTriangle, Key, Users, Calendar, RotateCw, Clock, Wifi, WifiOff, CheckCircle, XCircle, Loader2, Server, Lock, Play, BookOpen } from 'lucide-react';
import trustchainService from '../../services/trustchainService';
import type { TrustChainTier } from '../../services/trustchainService';
import { licensingService, type LicenseInfo } from '../../services/licensingService';

/** Helper — call Pro API endpoints */
function getBaseUrl(): string {
    return (
        (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_URL) || ''
    );
}
async function proApiFetch(path: string, opts?: RequestInit) {
    const resp = await fetch(`${getBaseUrl()}/api/trustchain-pro${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts?.headers },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
}

interface ProSettingsPanelProps {
    /** Compact mode for Panel UI (narrower layout) */
    compact?: boolean;
    /** Callback when tier changes */
    onTierChange?: (tier: TrustChainTier) => void;
}

const TIERS: { id: TrustChainTier; label: string; icon: React.ReactNode; desc: string; color: string; gradient: string }[] = [
    {
        id: 'community', label: 'Community (OSS)', icon: <Shield size={14} />,
        desc: 'Ed25519 подписи, базовый аудит (10 записей)', color: '#94a3b8',
        gradient: 'linear-gradient(135deg, #334155, #475569)',
    },
    {
        id: 'pro', label: 'Pro', icon: <Crown size={14} />,
        desc: 'PolicyEngine, полный аудит, SOC2, цепочка доверия', color: '#a78bfa',
        gradient: 'linear-gradient(135deg, #7c3aed, #8b5cf6)',
    },
    {
        id: 'enterprise', label: 'Enterprise', icon: <Building2 size={14} />,
        desc: 'HIPAA, AI-Act, compliance-отчёты, внешний KMS', color: '#fbbf24',
        gradient: 'linear-gradient(135deg, #d97706, #f59e0b)',
    },
];

const COMPLIANCE_FRAMEWORKS = [
    { id: 'SOC2', label: 'SOC 2 Type II', tiers: ['pro', 'enterprise'] },
    { id: 'HIPAA', label: 'HIPAA', tiers: ['enterprise'] },
    { id: 'AI-Act', label: 'EU AI Act', tiers: ['enterprise'] },
    { id: 'ISO27001', label: 'ISO 27001', tiers: ['enterprise'] },
];

const DEFAULT_POLICY_YAML = `policies:
  - name: no_pii_without_consent
    description: Block PII access without user consent
    if:
      tool: database_query
      output.contains: ["ssn", "passport", "credit_card"]
    then:
      action: require
      parent_tool: user_consent

  - name: payment_limits
    description: Large payments need manager approval
    if:
      tool: payment
      args.amount: { ">": 10000 }
    then:
      action: require
      parent_tool: manager_approval
`;

const LS_TIER_KEY = 'tc_pro_tier';
const LS_POLICY_YAML_KEY = 'tc_policy_yaml';
const LS_COMPLIANCE_KEY = 'tc_compliance';
const LS_RUNBOOK_KEY = 'tc_runbook_yaml';

const DEFAULT_RUNBOOK_YAML = `name: "SOC2 Nightly Audit"
description: "Standard compliance check for production"

workflow:
  - step: 1
    action: "Check chain integrity"
    tool: "chain_status"

  - step: 2
    action: "Run SOC2 compliance"
    tool: "compliance"
    params:
      framework: "soc2"

  - step: 3
    action: "Generate audit report"
    tool: "audit_report"
    condition: "always"
`;

const ProSettingsPanel: React.FC<ProSettingsPanelProps> = ({ compact = false, onTierChange }) => {
    const [tier, setTier] = useState<TrustChainTier>(() => {
        const saved = localStorage.getItem(LS_TIER_KEY) as TrustChainTier | null;
        return saved || trustchainService.getTier();
    });
    const [policyEnabled, setPolicyEnabled] = useState(() => {
        return tier === 'pro' || tier === 'enterprise';
    });
    const [compliance, setCompliance] = useState<string[]>(() => {
        try {
            return JSON.parse(localStorage.getItem(LS_COMPLIANCE_KEY) || '[]');
        } catch { return []; }
    });
    const [policyYaml, setPolicyYaml] = useState(() => {
        return localStorage.getItem(LS_POLICY_YAML_KEY) || DEFAULT_POLICY_YAML;
    });
    const [showYamlEditor, setShowYamlEditor] = useState(false);
    const [licenseKeyInput, setLicenseKeyInput] = useState('');
    const [licenseInfo, setLicenseInfo] = useState<LicenseInfo>(() => licensingService.getLicenseInfo());
    const [licenseError, setLicenseError] = useState('');
    const [activating, setActivating] = useState(false);

    // ── Runbook state ──
    const [showRunbookEditor, setShowRunbookEditor] = useState(false);
    const [runbookYaml, setRunbookYaml] = useState(() => {
        return localStorage.getItem(LS_RUNBOOK_KEY) || DEFAULT_RUNBOOK_YAML;
    });
    const [runbookRunning, setRunbookRunning] = useState(false);
    const [runbookResult, setRunbookResult] = useState<string | null>(null);

    // ── REST-wired state ──
    const [policyLoadResult, setPolicyLoadResult] = useState<{ count: number; names: string[] } | null>(null);
    const [policyLoading, setPolicyLoading] = useState(false);
    const [complianceReports, setComplianceReports] = useState<Record<string, { status: string; score?: number }>>({});
    const [kmsInfo, setKmsInfo] = useState<{ provider: string; algorithm: string; keyId: string; rotatedAt?: string } | null>(null);
    const [kmsLoading, setKmsLoading] = useState(false);
    const [tsaInfo, setTsaInfo] = useState<{ available: boolean; lastTest?: string } | null>(null);
    const [tsaLoading, setTsaLoading] = useState(false);
    const [airgapInfo, setAirgapInfo] = useState<{ enabled: boolean; capabilities: string[] } | null>(null);
    const [proModules, setProModules] = useState<Record<string, boolean> | null>(null);

    // Subscribe to license changes
    useEffect(() => {
        return licensingService.onChange(setLicenseInfo);
    }, []);

    // Fetch Pro module status on mount
    useEffect(() => {
        proApiFetch('/status').then(data => {
            if (data.modules) setProModules(data.modules);
        }).catch(() => { });
    }, []);

    // Fetch KMS + AirGap info when enterprise
    useEffect(() => {
        if (tier !== 'enterprise') return;
        proApiFetch('/kms/keys').then(data => setKmsInfo(data)).catch(() => { });
        proApiFetch('/airgap/status').then(data => setAirgapInfo(data)).catch(() => { });
    }, [tier]);

    // Fetch TSA status when pro+
    useEffect(() => {
        if (tier === 'community') return;
        proApiFetch('/tsa/timestamp').then(() => setTsaInfo({ available: true })).catch(() => setTsaInfo({ available: false }));
    }, [tier]);

    // REST handlers
    const handleApplyPolicies = async () => {
        setPolicyLoading(true);
        try {
            const result = await proApiFetch('/policy/load', {
                method: 'POST',
                body: JSON.stringify({ yaml_content: policyYaml }),
            });
            setPolicyLoadResult({ count: result.loaded_count ?? 0, names: result.policy_names ?? [] });
        } catch {
            setPolicyLoadResult({ count: 0, names: [] });
        } finally {
            setPolicyLoading(false);
        }
    };

    const handleComplianceCheck = async (fw: string) => {
        setComplianceReports(prev => ({ ...prev, [fw]: { status: 'loading' } }));
        try {
            const result = await proApiFetch(`/compliance/${fw}`);
            setComplianceReports(prev => ({
                ...prev,
                [fw]: { status: 'done', score: result.compliance_score ?? result.score },
            }));
        } catch {
            setComplianceReports(prev => ({ ...prev, [fw]: { status: 'error' } }));
        }
    };

    const handleKmsRotate = async () => {
        setKmsLoading(true);
        try {
            const result = await proApiFetch('/kms/rotate', { method: 'POST' });
            setKmsInfo(prev => prev ? { ...prev, keyId: result.new_key_id ?? prev.keyId, rotatedAt: new Date().toISOString() } : prev);
        } catch { } finally {
            setKmsLoading(false);
        }
    };

    const handleTsaTest = async () => {
        setTsaLoading(true);
        try {
            await proApiFetch('/tsa/timestamp', {
                method: 'POST',
                body: JSON.stringify({ data: 'test-timestamp-' + Date.now() }),
            });
            setTsaInfo({ available: true, lastTest: new Date().toLocaleTimeString() });
        } catch {
            setTsaInfo({ available: false });
        } finally {
            setTsaLoading(false);
        }
    };

    const handleActivateLicense = async () => {
        if (!licenseKeyInput.trim()) return;
        setLicenseError('');
        setActivating(true);
        try {
            const info = await licensingService.activateLicense(licenseKeyInput.trim());
            setLicenseInfo(info);
            // Sync tier
            if (info.tier === 'pro' || info.tier === 'enterprise') {
                handleTierChange(info.tier as TrustChainTier);
            }
            setLicenseKeyInput('');
        } catch (e: any) {
            setLicenseError(e.message || 'Invalid license key');
        } finally {
            setActivating(false);
        }
    };

    // Apply tier changes to service + persist
    const handleTierChange = useCallback((newTier: TrustChainTier) => {
        setTier(newTier);
        trustchainService.setTier(newTier);
        localStorage.setItem(LS_TIER_KEY, newTier);

        // Auto-toggle policy engine
        const shouldEnable = newTier === 'pro' || newTier === 'enterprise';
        setPolicyEnabled(shouldEnable);

        // Auto-set compliance
        if (newTier === 'enterprise') {
            setCompliance(['SOC2', 'HIPAA', 'AI-Act']);
        } else if (newTier === 'pro') {
            setCompliance(['SOC2']);
        } else {
            setCompliance([]);
        }

        onTierChange?.(newTier);
    }, [onTierChange]);

    // Persist compliance
    useEffect(() => {
        localStorage.setItem(LS_COMPLIANCE_KEY, JSON.stringify(compliance));
    }, [compliance]);

    // Persist YAML
    useEffect(() => {
        localStorage.setItem(LS_POLICY_YAML_KEY, policyYaml);
    }, [policyYaml]);

    const toggleCompliance = (id: string) => {
        setCompliance(prev =>
            prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
        );
    };

    const isPro = tier === 'pro' || tier === 'enterprise';
    const isEnterprise = tier === 'enterprise';

    const sectionStyle: React.CSSProperties = {
        padding: compact ? '10px 12px' : '14px 16px',
        background: '#0f172a',
        border: '1px solid #1e293b',
        borderRadius: 12,
    };

    const labelStyle: React.CSSProperties = {
        fontSize: compact ? 10 : 11,
        fontWeight: 600,
        color: '#64748b',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: compact ? 6 : 8,
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 10 : 14 }}>

            {/* ── License Key ── */}
            <div style={sectionStyle}>
                <div style={labelStyle}>
                    <Key size={10} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                    Лицензия
                </div>

                {licenseInfo.isValid ? (
                    <div>
                        {/* Seat usage bar */}
                        <div style={{ marginBottom: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 4 }}>
                                <span style={{ color: '#94a3b8' }}>
                                    <Users size={10} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 3 }} />
                                    Активные места
                                </span>
                                <span style={{ color: '#e2e8f0', fontWeight: 600 }}>
                                    {licenseInfo.activeSeats} / {licenseInfo.maxSeats}
                                </span>
                            </div>
                            <div style={{
                                height: 6, background: '#1e293b', borderRadius: 3, overflow: 'hidden',
                            }}>
                                <div style={{
                                    height: '100%', borderRadius: 3,
                                    width: `${Math.min(100, (licenseInfo.activeSeats / Math.max(1, licenseInfo.maxSeats)) * 100)}%`,
                                    background: licenseInfo.activeSeats >= licenseInfo.maxSeats
                                        ? 'linear-gradient(90deg, #ef4444, #f87171)'
                                        : licenseInfo.activeSeats / licenseInfo.maxSeats > 0.7
                                            ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
                                            : 'linear-gradient(90deg, #6366f1, #8b5cf6)',
                                    transition: 'width 0.3s',
                                }} />
                            </div>
                        </div>

                        {/* Info chips */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                            {licenseInfo.orgName && (
                                <span style={{
                                    padding: '2px 6px', background: 'rgba(99,102,241,0.1)',
                                    borderRadius: 4, fontSize: 9, color: '#a5b4fc',
                                }}>
                                    {licenseInfo.orgName}
                                </span>
                            )}
                            <span style={{
                                padding: '2px 6px', borderRadius: 4, fontSize: 9,
                                background: licenseInfo.daysRemaining > 30
                                    ? 'rgba(52,211,153,0.1)'
                                    : licenseInfo.daysRemaining > 7
                                        ? 'rgba(251,191,36,0.1)'
                                        : 'rgba(239,68,68,0.1)',
                                color: licenseInfo.daysRemaining > 30
                                    ? '#6ee7b7'
                                    : licenseInfo.daysRemaining > 7
                                        ? '#fbbf24'
                                        : '#fca5a5',
                            }}>
                                <Calendar size={8} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 2 }} />
                                {licenseInfo.daysRemaining > 0 ? `${licenseInfo.daysRemaining} дн.` : 'Истекла'}
                            </span>
                            {licenseInfo.features.slice(0, compact ? 2 : 5).map(f => (
                                <span key={f} style={{
                                    padding: '2px 6px', background: 'rgba(99,102,241,0.06)',
                                    borderRadius: 4, fontSize: 9, color: '#64748b',
                                }}>
                                    {f}
                                </span>
                            ))}
                        </div>

                        {/* Deactivate */}
                        <button
                            onClick={() => { licensingService.deactivate(); setLicenseInfo(licensingService.getLicenseInfo()); }}
                            style={{
                                background: 'none', border: '1px solid #1e293b', borderRadius: 6,
                                padding: '4px 8px', fontSize: 9, color: '#475569',
                                cursor: 'pointer', transition: 'all 0.15s',
                            }}
                        >
                            Деактивировать лицензию
                        </button>
                    </div>
                ) : (
                    <div>
                        <div style={{ display: 'flex', gap: 6 }}>
                            <input
                                type="text"
                                value={licenseKeyInput}
                                onChange={e => { setLicenseKeyInput(e.target.value); setLicenseError(''); }}
                                placeholder={compact ? 'Ключ лицензии...' : 'TC-PRO-XXXX-XXXX-XXXX или token...'}
                                style={{
                                    flex: 1, padding: '6px 10px',
                                    background: '#020617', border: '1px solid #1e293b',
                                    borderRadius: 6, color: '#e2e8f0',
                                    fontSize: 11, outline: 'none',
                                    fontFamily: 'monospace',
                                }}
                                onFocus={e => e.target.style.borderColor = '#6366f1'}
                                onBlur={e => e.target.style.borderColor = '#1e293b'}
                                onKeyDown={e => e.key === 'Enter' && handleActivateLicense()}
                            />
                            <button
                                onClick={handleActivateLicense}
                                disabled={!licenseKeyInput.trim() || activating}
                                style={{
                                    padding: '6px 12px', borderRadius: 6, border: 'none',
                                    background: licenseKeyInput.trim() && !activating
                                        ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
                                        : '#1e293b',
                                    color: licenseKeyInput.trim() && !activating ? '#fff' : '#475569',
                                    fontSize: 10, fontWeight: 600,
                                    cursor: licenseKeyInput.trim() && !activating ? 'pointer' : 'default',
                                    transition: 'all 0.2s', flexShrink: 0,
                                }}
                            >
                                {activating ? '...' : 'Активировать'}
                            </button>
                        </div>
                        {licenseError && (
                            <div style={{
                                marginTop: 6, padding: '4px 8px', fontSize: 9,
                                color: '#fca5a5', background: 'rgba(239,68,68,0.08)',
                                borderRadius: 4, border: '1px solid rgba(239,68,68,0.15)',
                            }}>
                                {licenseError}
                            </div>
                        )}
                        <div style={{ marginTop: 6, fontSize: 9, color: '#334155' }}>
                            Получить лицензию: trustchain.dev/pro
                        </div>
                    </div>
                )}
            </div>
            <div style={sectionStyle}>
                <div style={labelStyle}>Уровень подписки</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {TIERS.map(t => {
                        const isActive = tier === t.id;
                        return (
                            <button
                                key={t.id}
                                onClick={() => handleTierChange(t.id)}
                                style={{
                                    width: '100%', textAlign: 'left',
                                    padding: compact ? '8px 10px' : '10px 14px',
                                    background: isActive ? 'rgba(99,102,241,0.12)' : 'transparent',
                                    border: `1px solid ${isActive ? t.color + '60' : '#1e293b'}`,
                                    borderRadius: 10,
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                    color: '#e2e8f0',
                                    display: 'flex', alignItems: 'center', gap: 10,
                                }}
                            >
                                <div style={{
                                    width: compact ? 28 : 32, height: compact ? 28 : 32,
                                    borderRadius: 8, background: isActive ? t.gradient : '#1e293b',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: isActive ? '#fff' : '#475569',
                                    transition: 'all 0.2s',
                                    flexShrink: 0,
                                }}>
                                    {t.icon}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{
                                        fontSize: compact ? 11 : 12, fontWeight: 600,
                                        color: isActive ? t.color : '#94a3b8',
                                    }}>
                                        {t.label}
                                    </div>
                                    {!compact && (
                                        <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>
                                            {t.desc}
                                        </div>
                                    )}
                                </div>
                                <div style={{
                                    width: 14, height: 14, borderRadius: '50%',
                                    border: `2px solid ${isActive ? t.color : '#334155'}`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    flexShrink: 0,
                                }}>
                                    {isActive && (
                                        <div style={{
                                            width: 6, height: 6, borderRadius: '50%',
                                            background: t.color,
                                        }} />
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* ── Policy Engine ── */}
            <div style={sectionStyle}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <div style={{
                            fontSize: compact ? 11 : 12, fontWeight: 600, color: '#e2e8f0',
                            display: 'flex', alignItems: 'center', gap: 6,
                        }}>
                            <Shield size={13} style={{ color: '#a78bfa' }} />
                            Policy Engine
                        </div>
                        <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>
                            YAML-политики для AI-governance
                        </div>
                    </div>
                    <button
                        onClick={() => {
                            if (isPro) setPolicyEnabled(!policyEnabled);
                        }}
                        style={{
                            background: 'none', border: 'none', cursor: isPro ? 'pointer' : 'not-allowed',
                            color: policyEnabled ? '#34d399' : '#475569',
                            opacity: isPro ? 1 : 0.4,
                            transition: 'color 0.2s',
                        }}
                        title={isPro ? (policyEnabled ? 'Отключить' : 'Включить') : 'Доступно в Pro/Enterprise'}
                    >
                        {policyEnabled ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
                    </button>
                </div>

                {!isPro && (
                    <div style={{
                        marginTop: 8, padding: '6px 10px', background: 'rgba(251,191,36,0.08)',
                        border: '1px solid rgba(251,191,36,0.2)', borderRadius: 8,
                        fontSize: 10, color: '#fbbf24',
                        display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                        <AlertTriangle size={12} />
                        Для Policy Engine необходим Pro или Enterprise уровень
                    </div>
                )}

                {/* YAML Editor toggle */}
                {isPro && policyEnabled && (
                    <div style={{ marginTop: 10 }}>
                        <button
                            onClick={() => setShowYamlEditor(!showYamlEditor)}
                            style={{
                                background: 'rgba(99,102,241,0.08)',
                                border: '1px solid rgba(99,102,241,0.2)',
                                borderRadius: 8, padding: '6px 10px',
                                fontSize: 10, color: '#a5b4fc',
                                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                                width: '100%', textAlign: 'left',
                            }}
                        >
                            <FileText size={12} />
                            {showYamlEditor ? 'Скрыть редактор политик' : 'Редактировать YAML-политики'}
                        </button>
                        {showYamlEditor && (
                            <div style={{ marginTop: 8 }}>
                                <textarea
                                    value={policyYaml}
                                    onChange={e => setPolicyYaml(e.target.value)}
                                    spellCheck={false}
                                    style={{
                                        width: '100%', minHeight: compact ? 120 : 180,
                                        padding: '10px 12px',
                                        background: '#020617', border: '1px solid #1e293b',
                                        borderRadius: 8, color: '#67e8f9',
                                        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                                        fontSize: 11, lineHeight: 1.5,
                                        resize: 'vertical', outline: 'none',
                                        boxSizing: 'border-box',
                                    }}
                                    onFocus={e => e.target.style.borderColor = '#6366f1'}
                                    onBlur={e => e.target.style.borderColor = '#1e293b'}
                                />
                                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                                    <button
                                        onClick={handleApplyPolicies}
                                        disabled={policyLoading}
                                        style={{
                                            padding: '5px 12px', borderRadius: 6, border: 'none',
                                            background: policyLoading ? '#1e293b' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                                            color: policyLoading ? '#475569' : '#fff',
                                            fontSize: 10, fontWeight: 600, cursor: policyLoading ? 'default' : 'pointer',
                                            display: 'flex', alignItems: 'center', gap: 4,
                                        }}
                                    >
                                        {policyLoading ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                                        Применить
                                    </button>
                                    {policyLoadResult && (
                                        <span style={{
                                            fontSize: 10, color: policyLoadResult.count > 0 ? '#34d399' : '#f87171',
                                            display: 'flex', alignItems: 'center', gap: 3,
                                        }}>
                                            {policyLoadResult.count > 0 ? <CheckCircle size={10} /> : <XCircle size={10} />}
                                            {policyLoadResult.count} политик загружено
                                        </span>
                                    )}
                                </div>
                                <div style={{ fontSize: 9, color: '#334155', marginTop: 4 }}>
                                    Формат: policies → name, if (tool, output.contains, args.*), then (action: deny|require|warn)
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ── Runbook Executor (SOAR) ── */}
            {isPro && (
                <div style={sectionStyle}>
                    <div style={labelStyle}>
                        <BookOpen size={12} style={{ marginRight: 4 }} />
                        Security Runbooks (SOAR)
                    </div>
                    <div style={{ fontSize: 10, color: '#64748b', marginBottom: 8 }}>
                        YAML-плейбуки для автоматического аудита. Агент выполняет шаги строго по порядку.
                    </div>
                    <button
                        onClick={() => setShowRunbookEditor(!showRunbookEditor)}
                        style={{
                            background: 'rgba(16,185,129,0.08)',
                            border: '1px solid rgba(16,185,129,0.2)',
                            borderRadius: 8, padding: '6px 10px',
                            fontSize: 10, color: '#6ee7b7',
                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                            width: '100%', textAlign: 'left',
                        }}
                    >
                        <FileText size={12} />
                        {showRunbookEditor ? 'Скрыть редактор' : 'Редактировать Runbook'}
                    </button>
                    {showRunbookEditor && (
                        <div style={{ marginTop: 8 }}>
                            <textarea
                                value={runbookYaml}
                                onChange={e => {
                                    setRunbookYaml(e.target.value);
                                    localStorage.setItem(LS_RUNBOOK_KEY, e.target.value);
                                }}
                                spellCheck={false}
                                style={{
                                    width: '100%', minHeight: compact ? 140 : 200,
                                    padding: '10px 12px',
                                    background: '#020617', border: '1px solid #1e293b',
                                    borderRadius: 8, color: '#a7f3d0',
                                    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                                    fontSize: 11, lineHeight: 1.5,
                                    resize: 'vertical', outline: 'none',
                                    boxSizing: 'border-box',
                                }}
                                onFocus={e => e.target.style.borderColor = '#10b981'}
                                onBlur={e => e.target.style.borderColor = '#1e293b'}
                            />
                            <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                                <button
                                    onClick={async () => {
                                        setRunbookRunning(true);
                                        setRunbookResult(null);
                                        try {
                                            const resp = await fetch(`${getBaseUrl()}/api/trustchain/runbook/execute`, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ yaml_content: runbookYaml }),
                                            });
                                            const data = await resp.json();
                                            setRunbookResult(data.result || data.error || 'Done');
                                        } catch (err: any) {
                                            setRunbookResult(`Error: ${err.message}`);
                                        } finally {
                                            setRunbookRunning(false);
                                        }
                                    }}
                                    disabled={runbookRunning}
                                    style={{
                                        padding: '5px 12px', borderRadius: 6, border: 'none',
                                        background: runbookRunning ? '#1e293b' : 'linear-gradient(135deg, #10b981, #059669)',
                                        color: runbookRunning ? '#475569' : '#fff',
                                        fontSize: 10, fontWeight: 600, cursor: runbookRunning ? 'default' : 'pointer',
                                        display: 'flex', alignItems: 'center', gap: 4,
                                    }}
                                >
                                    {runbookRunning ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                                    Запустить Runbook
                                </button>
                                <span style={{ fontSize: 9, color: '#475569' }}>
                                    Tools: chain_status, compliance, audit_report, verify, analytics, execution_graph
                                </span>
                            </div>
                            {runbookResult && (
                                <div style={{
                                    marginTop: 8, padding: 10, borderRadius: 8,
                                    background: '#020617', border: '1px solid #1e293b',
                                    fontSize: 10, color: '#94a3b8',
                                    fontFamily: '"JetBrains Mono", monospace',
                                    whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto',
                                }}>
                                    {runbookResult}
                                </div>
                            )}
                            <div style={{ fontSize: 9, color: '#334155', marginTop: 4 }}>
                                Формат: name, workflow → step, action, tool, params, condition (always|on_success)
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── Compliance Frameworks ── */}
            <div style={sectionStyle}>
                <div style={labelStyle}>Compliance Frameworks</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {COMPLIANCE_FRAMEWORKS.map(fw => {
                        const available = fw.tiers.includes(tier);
                        const active = compliance.includes(fw.id);
                        const report = complianceReports[fw.id];
                        return (
                            <div key={fw.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <button
                                    onClick={() => {
                                        if (!available) return;
                                        toggleCompliance(fw.id);
                                        if (!active) handleComplianceCheck(fw.id);
                                    }}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 8, flex: 1,
                                        padding: '7px 10px', background: 'transparent',
                                        border: `1px solid ${active ? '#34d39940' : '#1e293b'}`,
                                        borderRadius: 8, cursor: available ? 'pointer' : 'not-allowed',
                                        opacity: available ? 1 : 0.35, width: '100%', textAlign: 'left',
                                        transition: 'all 0.15s',
                                    }}
                                >
                                    <div style={{
                                        width: 16, height: 16, borderRadius: 4,
                                        border: `1.5px solid ${active ? '#34d399' : '#334155'}`,
                                        background: active ? 'rgba(52,211,153,0.15)' : 'transparent',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: 10, color: '#34d399', flexShrink: 0,
                                    }}>
                                        {active && '✓'}
                                    </div>
                                    <span style={{ fontSize: 11, color: available ? '#cbd5e1' : '#475569', flex: 1 }}>
                                        {fw.label}
                                    </span>
                                    {!available && (
                                        <span style={{ fontSize: 9, color: '#475569' }}>
                                            {fw.tiers[fw.tiers.length - 1] === 'enterprise' ? 'Enterprise' : 'Pro+'}
                                        </span>
                                    )}
                                </button>
                                {report && (
                                    <span style={{
                                        fontSize: 9, padding: '2px 6px', borderRadius: 4,
                                        background: report.status === 'done' ? 'rgba(52,211,153,0.1)' : report.status === 'loading' ? 'rgba(99,102,241,0.1)' : 'rgba(239,68,68,0.1)',
                                        color: report.status === 'done' ? '#34d399' : report.status === 'loading' ? '#a5b4fc' : '#f87171',
                                        whiteSpace: 'nowrap',
                                    }}>
                                        {report.status === 'loading' ? '...' : report.status === 'done' ? `Score: ${report.score ?? '—'}` : 'Error'}
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ── KMS / Key Management ── */}
            {isEnterprise && (
                <div style={sectionStyle}>
                    <div style={labelStyle}>
                        <Lock size={10} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                        KMS / Управление ключами
                    </div>
                    {kmsInfo ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {[
                                    { label: 'Провайдер', value: kmsInfo.provider },
                                    { label: 'Алгоритм', value: kmsInfo.algorithm },
                                    { label: 'Key ID', value: kmsInfo.keyId?.substring(0, 12) + '…' },
                                ].map(item => (
                                    <span key={item.label} style={{
                                        padding: '2px 6px', background: 'rgba(99,102,241,0.06)',
                                        borderRadius: 4, fontSize: 9, color: '#94a3b8',
                                    }}>
                                        {item.label}: <strong style={{ color: '#e2e8f0' }}>{item.value}</strong>
                                    </span>
                                ))}
                            </div>
                            <button
                                onClick={handleKmsRotate}
                                disabled={kmsLoading}
                                style={{
                                    padding: '5px 10px', borderRadius: 6, border: '1px solid #1e293b',
                                    background: 'transparent', color: kmsLoading ? '#475569' : '#fbbf24',
                                    fontSize: 10, cursor: kmsLoading ? 'default' : 'pointer',
                                    display: 'flex', alignItems: 'center', gap: 4, width: 'fit-content',
                                }}
                            >
                                {kmsLoading ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />}
                                Ротация ключа
                            </button>
                            {kmsInfo.rotatedAt && (
                                <span style={{ fontSize: 9, color: '#475569' }}>
                                    Последняя ротация: {new Date(kmsInfo.rotatedAt).toLocaleString()}
                                </span>
                            )}
                        </div>
                    ) : (
                        <div style={{ fontSize: 10, color: '#475569' }}>Загрузка KMS...</div>
                    )}
                </div>
            )}

            {/* ── TSA / Timestamps ── */}
            {isPro && (
                <div style={sectionStyle}>
                    <div style={labelStyle}>
                        <Clock size={10} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                        TSA / RFC 3161 Timestamps
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                            fontSize: 10, display: 'flex', alignItems: 'center', gap: 4,
                            color: tsaInfo?.available ? '#34d399' : '#f87171',
                        }}>
                            {tsaInfo?.available ? <Wifi size={12} /> : <WifiOff size={12} />}
                            {tsaInfo?.available ? 'TSA Online' : 'TSA Offline'}
                        </span>
                        <button
                            onClick={handleTsaTest}
                            disabled={tsaLoading}
                            style={{
                                padding: '4px 10px', borderRadius: 6, border: '1px solid #1e293b',
                                background: 'transparent', color: tsaLoading ? '#475569' : '#a5b4fc',
                                fontSize: 10, cursor: tsaLoading ? 'default' : 'pointer',
                                display: 'flex', alignItems: 'center', gap: 4,
                            }}
                        >
                            {tsaLoading ? <Loader2 size={12} className="animate-spin" /> : <Clock size={12} />}
                            Тест
                        </button>
                        {tsaInfo?.lastTest && (
                            <span style={{ fontSize: 9, color: '#475569' }}>Последн.: {tsaInfo.lastTest}</span>
                        )}
                    </div>
                </div>
            )}

            {/* ── AirGap Status ── */}
            {isEnterprise && airgapInfo && (
                <div style={sectionStyle}>
                    <div style={labelStyle}>
                        <Server size={10} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                        Air-Gap / On-Premise
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <span style={{
                            fontSize: 10, display: 'flex', alignItems: 'center', gap: 4,
                            color: airgapInfo.enabled ? '#34d399' : '#f87171',
                        }}>
                            {airgapInfo.enabled ? <CheckCircle size={12} /> : <XCircle size={12} />}
                            {airgapInfo.enabled ? 'Air-Gap активен' : 'Подключён к облаку'}
                        </span>
                    </div>
                    {airgapInfo.capabilities && airgapInfo.capabilities.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {airgapInfo.capabilities.map(cap => (
                                <span key={cap} style={{
                                    padding: '2px 6px', background: 'rgba(52,211,153,0.06)',
                                    borderRadius: 4, fontSize: 9, color: '#6ee7b7',
                                }}>
                                    {cap}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ── Pro Modules Status ── */}
            {isPro && proModules && (
                <div style={sectionStyle}>
                    <div style={labelStyle}>Pro Модули</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {Object.entries(proModules).map(([name, loaded]) => (
                            <span key={name} style={{
                                padding: '2px 8px', borderRadius: 4, fontSize: 9,
                                background: loaded ? 'rgba(52,211,153,0.08)' : 'rgba(239,68,68,0.08)',
                                color: loaded ? '#6ee7b7' : '#fca5a5',
                                border: `1px solid ${loaded ? 'rgba(52,211,153,0.15)' : 'rgba(239,68,68,0.15)'}`,
                                display: 'flex', alignItems: 'center', gap: 3,
                            }}>
                                {loaded ? <CheckCircle size={8} /> : <XCircle size={8} />}
                                {name}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Current Status ── */}
            <div style={{
                ...sectionStyle,
                background: 'rgba(99,102,241,0.05)',
                border: '1px solid rgba(99,102,241,0.15)',
            }}>
                <div style={labelStyle}>Статус сертификата</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {[
                        { label: 'Tier', value: tier.toUpperCase(), color: tier === 'enterprise' ? '#fbbf24' : tier === 'pro' ? '#a78bfa' : '#94a3b8' },
                        { label: 'PolicyEngine', value: policyEnabled ? 'ON' : 'OFF', color: policyEnabled ? '#34d399' : '#ef4444' },
                        ...(compliance.length > 0 ? [{ label: 'Compliance', value: compliance.join(', '), color: '#67e8f9' }] : []),
                    ].map(item => (
                        <div key={item.label} style={{
                            padding: '4px 8px', background: 'rgba(15,23,42,0.6)',
                            borderRadius: 6, fontSize: 10,
                        }}>
                            <span style={{ color: '#475569' }}>{item.label}: </span>
                            <span style={{ color: item.color, fontWeight: 600 }}>{item.value}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default ProSettingsPanel;
