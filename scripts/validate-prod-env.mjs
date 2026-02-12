#!/usr/bin/env node

function asBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const errors = [];
const warnings = [];

const strictMode = asBool(process.env.VITE_TRUSTCHAIN_STRICT_MODE, false);
const allowUnsignedLocal = asBool(process.env.VITE_TRUSTCHAIN_ALLOW_LOCAL_UNSIGNED_MCP, false);

if (!strictMode) errors.push('VITE_TRUSTCHAIN_STRICT_MODE должен быть true');
if (allowUnsignedLocal) errors.push('VITE_TRUSTCHAIN_ALLOW_LOCAL_UNSIGNED_MCP должен быть false');

const canary = asBool(process.env.VITE_TRUSTCHAIN_EXTERNAL_SIGNER_CANARY, false);
const signerUrl = String(process.env.VITE_TRUSTCHAIN_EXTERNAL_SIGNER_URL || '').trim();
const signerTimeout = asNumber(process.env.VITE_TRUSTCHAIN_EXTERNAL_SIGNER_TIMEOUT_MS, 0);
const signerKeyId = String(process.env.VITE_TRUSTCHAIN_EXTERNAL_SIGNER_KEY_ID || '').trim();
const signerPubKey = String(process.env.VITE_TRUSTCHAIN_EXTERNAL_SIGNER_PUBLIC_KEY || '').trim();

if (canary) {
  if (!signerUrl) errors.push('VITE_TRUSTCHAIN_EXTERNAL_SIGNER_URL обязателен при CANARY=true');
  if (!/^https?:\/\//.test(signerUrl)) {
    errors.push('VITE_TRUSTCHAIN_EXTERNAL_SIGNER_URL должен начинаться с http:// или https://');
  }
  if (signerTimeout < 1000) {
    errors.push('VITE_TRUSTCHAIN_EXTERNAL_SIGNER_TIMEOUT_MS должен быть >= 1000');
  }
  if (!signerKeyId) errors.push('VITE_TRUSTCHAIN_EXTERNAL_SIGNER_KEY_ID обязателен при CANARY=true');
  if (!signerPubKey) errors.push('VITE_TRUSTCHAIN_EXTERNAL_SIGNER_PUBLIC_KEY обязателен при CANARY=true');
}

const llmApiKey = String(process.env.VITE_OPENAI_API_KEY || '').trim();
const llmBaseUrl = String(process.env.VITE_OPENAI_BASE_URL || '').trim();
if (!llmApiKey) warnings.push('VITE_OPENAI_API_KEY пустой (проверьте секреты в окружении)');
if (!llmBaseUrl) warnings.push('VITE_OPENAI_BASE_URL пустой (ожидается production endpoint)');

const report = {
  ok: errors.length === 0,
  checks: {
    strict_mode: strictMode,
    allow_local_unsigned_mcp: allowUnsignedLocal,
    external_signer_canary: canary,
    external_signer_url_configured: !!signerUrl,
    external_signer_timeout_ms: signerTimeout,
    external_signer_key_id_configured: !!signerKeyId,
    external_signer_pubkey_configured: !!signerPubKey,
  },
  warnings,
  errors,
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
