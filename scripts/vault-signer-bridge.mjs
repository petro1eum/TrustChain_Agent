#!/usr/bin/env node
import http from 'node:http';
import { createHash } from 'node:crypto';

const VAULT_ADDR = String(process.env.VAULT_ADDR || 'http://127.0.0.1:8200').replace(/\/+$/, '');
const VAULT_TOKEN = String(process.env.VAULT_TOKEN || '').trim();
const VAULT_TRANSIT_MOUNT = String(process.env.VAULT_TRANSIT_MOUNT || 'transit').trim();
const VAULT_TRANSIT_KEY = String(process.env.VAULT_TRANSIT_KEY || 'trustchain-ed25519').trim();
const HOST = String(process.env.VAULT_SIGNER_HOST || '127.0.0.1').trim();
const PORT = Number(process.env.VAULT_SIGNER_PORT || 9780);

function fail(msg) {
  console.error(`[vault-signer-bridge] ${msg}`);
  process.exit(1);
}

if (!VAULT_TOKEN) fail('VAULT_TOKEN обязателен');
if (!VAULT_TRANSIT_KEY) fail('VAULT_TRANSIT_KEY обязателен');
if (!Number.isFinite(PORT) || PORT <= 0) fail('VAULT_SIGNER_PORT должен быть > 0');

async function vaultRequest(path, method = 'GET', body = null) {
  const response = await fetch(`${VAULT_ADDR}/v1/${path.replace(/^\/+/, '')}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Vault-Token': VAULT_TOKEN,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    // noop
  }
  if (!response.ok) {
    throw new Error(`Vault HTTP ${response.status}: ${text || 'empty'}`);
  }
  return json || {};
}

function parseVaultSignature(signatureField) {
  const raw = String(signatureField || '').trim();
  if (!raw) throw new Error('Vault signature is empty');
  const parts = raw.split(':');
  return parts.length >= 3 ? parts[parts.length - 1] : raw;
}

function buildKeyId(publicKey) {
  return createHash('sha256').update(String(publicKey || ''), 'utf8').digest('hex').slice(0, 24);
}

async function loadKeyMaterial() {
  const configuredPublicKey = String(process.env.VAULT_SIGNER_PUBLIC_KEY || '').trim();
  const configuredKeyId = String(process.env.VAULT_SIGNER_KEY_ID || '').trim();
  if (configuredPublicKey && configuredKeyId) {
    return { key_id: configuredKeyId, public_key: configuredPublicKey };
  }

  const keyInfo = await vaultRequest(`${VAULT_TRANSIT_MOUNT}/keys/${encodeURIComponent(VAULT_TRANSIT_KEY)}`);
  const latestVersion = Number(keyInfo?.data?.latest_version || 0);
  const keys = keyInfo?.data?.keys || {};
  const versionNode = latestVersion > 0 ? keys[String(latestVersion)] : null;
  const publicKey = String(versionNode?.public_key || '').trim();
  if (!publicKey) {
    throw new Error('В ответе Vault не найден public_key (проверьте, что key type=ed25519)');
  }
  const keyId = configuredKeyId || buildKeyId(publicKey);
  return { key_id: keyId, public_key: publicKey };
}

const keyMaterial = await loadKeyMaterial();

function sendJson(res, code, payload) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, { ok: true });
  }

  if (req.url === '/health' && req.method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      provider: 'vault-oss-transit',
      vault_addr: VAULT_ADDR,
      transit_mount: VAULT_TRANSIT_MOUNT,
      transit_key: VAULT_TRANSIT_KEY,
      key_id: keyMaterial.key_id,
      public_key: keyMaterial.public_key,
      timestamp: new Date().toISOString(),
    });
  }

  if (req.url === '/sign' && req.method === 'POST') {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', async () => {
      try {
        const body = raw ? JSON.parse(raw) : {};
        const payloadBase64 = String(body?.payload_base64 || '').trim();
        if (!payloadBase64) {
          return sendJson(res, 400, { ok: false, error: 'payload_base64 обязателен' });
        }

        const signed = await vaultRequest(
          `${VAULT_TRANSIT_MOUNT}/sign/${encodeURIComponent(VAULT_TRANSIT_KEY)}`,
          'POST',
          { input: payloadBase64 }
        );
        const signatureBase64 = parseVaultSignature(signed?.data?.signature);

        return sendJson(res, 200, {
          ok: true,
          signature: signatureBase64,
          key_id: keyMaterial.key_id,
          public_key: keyMaterial.public_key,
          algorithm: 'ed25519',
        });
      } catch (e) {
        return sendJson(res, 500, {
          ok: false,
          error: e?.message || 'Ошибка подписи через Vault',
        });
      }
    });
    return;
  }

  return sendJson(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`[vault-signer-bridge] listening on http://${HOST}:${PORT}`);
  console.log(`[vault-signer-bridge] transit key: ${VAULT_TRANSIT_MOUNT}/${VAULT_TRANSIT_KEY}`);
  console.log(`[vault-signer-bridge] key_id: ${keyMaterial.key_id}`);
});
