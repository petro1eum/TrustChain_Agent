#!/usr/bin/env node
import { createHash } from 'node:crypto';

const VAULT_ADDR = String(process.env.VAULT_ADDR || 'http://127.0.0.1:8200').replace(/\/+$/, '');
const VAULT_TOKEN = String(process.env.VAULT_TOKEN || '').trim();
const VAULT_TRANSIT_MOUNT = String(process.env.VAULT_TRANSIT_MOUNT || 'transit').trim();
const VAULT_TRANSIT_KEY = String(process.env.VAULT_TRANSIT_KEY || 'trustchain-ed25519').trim();

function fail(msg) {
  console.error(`[vault-key-info] ${msg}`);
  process.exit(1);
}

if (!VAULT_TOKEN) fail('VAULT_TOKEN обязателен');
if (!VAULT_TRANSIT_KEY) fail('VAULT_TRANSIT_KEY обязателен');

function buildKeyId(publicKey) {
  return createHash('sha256').update(String(publicKey || ''), 'utf8').digest('hex').slice(0, 24);
}

async function main() {
  const response = await fetch(`${VAULT_ADDR}/v1/${VAULT_TRANSIT_MOUNT}/keys/${encodeURIComponent(VAULT_TRANSIT_KEY)}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Vault-Token': VAULT_TOKEN,
    },
  });
  const text = await response.text();
  if (!response.ok) {
    fail(`Vault HTTP ${response.status}: ${text || 'empty'}`);
  }
  const payload = text ? JSON.parse(text) : {};
  const latestVersion = Number(payload?.data?.latest_version || 0);
  const keys = payload?.data?.keys || {};
  const node = latestVersion > 0 ? keys[String(latestVersion)] : null;
  const publicKey = String(node?.public_key || '').trim();
  if (!publicKey) {
    fail('В ответе Vault не найден public_key');
  }
  const keyId = buildKeyId(publicKey);

  console.log(JSON.stringify({
    ok: true,
    vault_addr: VAULT_ADDR,
    transit_mount: VAULT_TRANSIT_MOUNT,
    transit_key: VAULT_TRANSIT_KEY,
    key_id: keyId,
    public_key: publicKey,
    env: {
      VITE_TRUSTCHAIN_EXTERNAL_SIGNER_KEY_ID: keyId,
      VITE_TRUSTCHAIN_EXTERNAL_SIGNER_PUBLIC_KEY: publicKey,
      TRUSTCHAIN_ALLOWED_KEY_IDS: keyId,
      TRUSTCHAIN_ALLOWED_PUBKEYS: publicKey,
    },
  }, null, 2));
}

main().catch((e) => fail(e?.message || 'unknown error'));
