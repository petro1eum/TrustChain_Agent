/**
 * VaultPanel.tsx — Encrypted Credential Vault UI
 *
 * Manage AES-256-GCM encrypted secrets.
 * Plaintext values are never stored client-side; reveal is explicit.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
    Lock, Plus, Trash2, Eye, EyeOff, Key,
    Shield, RefreshCw, Copy, CheckCircle2, AlertTriangle, X
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Credential {
    id: string;
    name: string;
    service: string;
    created_at: string;
    updated_at: string;
}

const BACKEND_URL = (() => {
    const fromEnv = (import.meta as { env: Record<string, string> }).env.VITE_BACKEND_URL;
    if (fromEnv) return fromEnv.replace(/\/$/, '');
    return `${window.location.protocol}//${window.location.hostname}:9742`;
})();

// ─── Service colour tags ──────────────────────────────────────────────────────

const SERVICE_COLORS: Record<string, string> = {
    stripe: 'text-purple-400 bg-purple-500/10 border-purple-500/25',
    salesforce: 'text-blue-400 bg-blue-500/10 border-blue-500/25',
    sendgrid: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/25',
    twilio: 'text-red-400 bg-red-500/10 border-red-500/25',
    jira: 'text-blue-300 bg-blue-400/10 border-blue-400/25',
    openai: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
    slack: 'text-amber-400 bg-amber-500/10 border-amber-500/25',
    github: 'text-gray-300 bg-gray-500/10 border-gray-500/25',
};

function ServiceBadge({ service }: { service: string }) {
    const color = SERVICE_COLORS[service.toLowerCase()] ?? 'text-indigo-400 bg-indigo-500/10 border-indigo-500/25';
    return (
        <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded border uppercase tracking-wide ${color}`}>
            {service}
        </span>
    );
}

// ─── Add Secret Form ──────────────────────────────────────────────────────────

interface AddFormProps {
    onAdded: () => void;
    onClose: () => void;
}

function AddSecretForm({ onAdded, onClose }: AddFormProps) {
    const [name, setName] = useState('');
    const [service, setService] = useState('');
    const [value, setValue] = useState('');
    const [showVal, setShowVal] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const handleSave = async () => {
        if (!name.trim() || !service.trim() || !value.trim()) {
            setError('All fields are required.');
            return;
        }
        setSaving(true);
        setError('');
        try {
            const res = await fetch(`${BACKEND_URL}/api/v1/vault/secrets`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name.trim(), service: service.trim(), value }),
            });
            if (!res.ok) { setError((await res.json()).detail ?? 'Save failed.'); return; }
            onAdded();
            onClose();
        } catch (_) {
            setError('Network error. Is the backend running?');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="border tc-border rounded-xl p-4 bg-indigo-500/5 mb-4">
            <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold tc-text flex items-center gap-1.5">
                    <Lock size={12} className="text-indigo-400" /> New Encrypted Secret
                </span>
                <button onClick={onClose} className="p-0.5 tc-text-muted hover:tc-text">
                    <X size={14} />
                </button>
            </div>

            <div className="grid gap-2">
                <div className="grid grid-cols-2 gap-2">
                    <input
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="Secret name (e.g. stripe_secret_key)"
                        className="text-xs tc-surface border tc-border rounded-lg px-2.5 py-1.5 tc-text placeholder:tc-text-muted focus:outline-none focus:border-indigo-500/50"
                    />
                    <input
                        value={service}
                        onChange={e => setService(e.target.value)}
                        placeholder="Service (e.g. stripe)"
                        className="text-xs tc-surface border tc-border rounded-lg px-2.5 py-1.5 tc-text placeholder:tc-text-muted focus:outline-none focus:border-indigo-500/50"
                    />
                </div>
                <div className="relative">
                    <input
                        type={showVal ? 'text' : 'password'}
                        value={value}
                        onChange={e => setValue(e.target.value)}
                        placeholder="Secret value (API key, token, password…)"
                        className="w-full text-xs tc-surface border tc-border rounded-lg px-2.5 py-1.5 pr-8 tc-text placeholder:tc-text-muted focus:outline-none focus:border-indigo-500/50 font-mono"
                    />
                    <button
                        onClick={() => setShowVal(v => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 tc-text-muted hover:tc-text"
                        title={showVal ? 'Hide' : 'Show'}
                    >
                        {showVal ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                </div>
                {error && (
                    <div className="text-[10px] text-amber-400 flex items-center gap-1">
                        <AlertTriangle size={10} /> {error}
                    </div>
                )}
                <div className="flex items-center gap-2 justify-between pt-1">
                    <span className="text-[9px] tc-text-muted flex items-center gap-1">
                        <Shield size={9} className="text-emerald-400" />
                        AES-256-GCM encrypted at rest. Plaintext never touches disk.
                    </span>
                    <button
                        onClick={() => void handleSave()}
                        disabled={saving}
                        className="text-[11px] font-medium px-3 py-1 rounded-lg bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/30 transition disabled:opacity-50"
                    >
                        {saving ? 'Encrypting…' : 'Save to Vault'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Credential Row ───────────────────────────────────────────────────────────

function CredentialRow({ cred, onDelete }: { cred: Credential; onDelete: () => void }) {
    const [revealed, setRevealed] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [copied, setCopied] = useState(false);

    const handleReveal = async () => {
        if (revealed) { setRevealed(null); return; }
        setLoading(true);
        try {
            const res = await fetch(`${BACKEND_URL}/api/v1/vault/secrets/${encodeURIComponent(cred.name)}/reveal`);
            if (res.ok) {
                const data = await res.json() as { value: string };
                setRevealed(data.value);
            }
        } catch (_) { /* silent */ } finally { setLoading(false); }
    };

    const handleCopy = async () => {
        if (!revealed) return;
        await navigator.clipboard.writeText(revealed);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="border-b tc-border last:border-0 py-2 px-3 hover:bg-white/[0.02] transition-colors">
            <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                    <Key size={11} className="text-indigo-400 shrink-0" />
                    <span className="text-xs font-mono tc-text">{cred.name}</span>
                </div>
                <ServiceBadge service={cred.service} />
            </div>

            {revealed && (
                <div className="flex items-center gap-2 mt-1.5 mb-1">
                    <code className="text-[10px] font-mono text-emerald-300/80 bg-black/30 rounded px-2 py-0.5 flex-1 truncate">
                        {revealed}
                    </code>
                    <button onClick={() => void handleCopy()} className="p-0.5 tc-text-muted hover:text-emerald-400 transition" title="Copy">
                        {copied ? <CheckCircle2 size={11} className="text-emerald-400" /> : <Copy size={11} />}
                    </button>
                </div>
            )}

            <div className="flex items-center gap-1 mt-1">
                <span className="text-[9px] tc-text-muted flex-1">
                    Added {new Date(cred.created_at + 'Z').toLocaleDateString()}
                </span>
                <button
                    onClick={() => void handleReveal()}
                    disabled={loading}
                    className="p-1 rounded hover:bg-white/10 tc-text-muted hover:text-indigo-300 transition text-[10px] flex items-center gap-0.5"
                    title={revealed ? 'Hide' : 'Reveal'}
                >
                    {loading ? <RefreshCw size={10} className="animate-spin" /> :
                        revealed ? <EyeOff size={10} /> : <Eye size={10} />}
                </button>
                <button
                    onClick={onDelete}
                    className="p-1 rounded hover:bg-white/10 tc-text-muted hover:text-amber-400 transition"
                    title="Delete secret"
                >
                    <Trash2 size={10} />
                </button>
            </div>
        </div>
    );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export const VaultPanel: React.FC = () => {
    const [creds, setCreds] = useState<Credential[]>([]);
    const [showAdd, setShowAdd] = useState(false);
    const [loading, setLoading] = useState(false);

    const fetchCreds = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`${BACKEND_URL}/api/v1/vault/secrets`);
            if (res.ok) {
                const data = await res.json() as { secrets: Credential[] };
                setCreds(data.secrets ?? []);
            }
        } catch (_) { /* silent */ } finally { setLoading(false); }
    }, []);

    useEffect(() => { void fetchCreds(); }, [fetchCreds]);

    const handleDelete = async (name: string) => {
        await fetch(`${BACKEND_URL}/api/v1/vault/secrets/${encodeURIComponent(name)}`, { method: 'DELETE' });
        setCreds(prev => prev.filter(c => c.name !== name));
    };

    return (
        <div className="flex flex-col h-full bg-transparent">
            {/* Header */}
            <div className="px-4 pt-4 pb-3 border-b tc-border shrink-0">
                <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                        <Lock size={15} className="text-indigo-400" />
                        <span className="text-sm font-semibold tc-text">Credential Vault</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            AES-256-GCM
                        </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <button onClick={() => void fetchCreds()}
                            className={`p-1.5 rounded-lg tc-btn-hover tc-text-muted hover:tc-text transition ${loading ? 'animate-spin' : ''}`}
                            title="Refresh">
                            <RefreshCw size={13} />
                        </button>
                        <button
                            onClick={() => setShowAdd(v => !v)}
                            className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg bg-indigo-500/15 border border-indigo-500/25 text-indigo-300 hover:bg-indigo-500/25 transition"
                        >
                            <Plus size={11} /> Add Secret
                        </button>
                    </div>
                </div>
                <p className="text-[10px] tc-text-muted">
                    Plaintext is never stored or logged — only AES-256-GCM ciphertext persists.
                </p>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-3 pt-3">
                {showAdd && (
                    <AddSecretForm
                        onAdded={() => void fetchCreds()}
                        onClose={() => setShowAdd(false)}
                    />
                )}

                {creds.length === 0 && !showAdd ? (
                    <div className="flex flex-col items-center justify-center h-48 gap-3 tc-text-muted">
                        <Lock size={28} className="opacity-25" />
                        <div className="text-xs text-center">
                            No credentials stored yet.<br />
                            <span className="text-[10px]">Add API keys to inject them securely into agent tasks.</span>
                        </div>
                    </div>
                ) : (
                    <div className="rounded-xl border tc-border overflow-hidden">
                        {creds.map(cred => (
                            <CredentialRow
                                key={cred.id}
                                cred={cred}
                                onDelete={() => void handleDelete(cred.name)}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="px-4 py-2 border-t tc-border shrink-0">
                <p className="text-[9px] tc-text-muted flex items-center gap-1.5">
                    <Shield size={9} className="text-indigo-400" />
                    Agent tool: <code className="font-mono">vault_read</code> — secrets are injected into agent RAM and discarded after use.
                </p>
            </div>
        </div>
    );
};
