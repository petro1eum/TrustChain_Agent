#!/usr/bin/env node
import { readFileSync } from 'fs';

function fail(message) {
  console.error(`[verify-trustchain-proof] ${message}`);
  process.exit(1);
}

function parseInput(filePath) {
  if (!filePath) fail('Укажите путь к JSON файлу audit trail.');
  const raw = readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.entries)) return parsed.entries;
  fail('Файл должен содержать массив записей или поле entries.');
}

function verifySequenceAndReplay(entries) {
  const bySession = new Map();
  for (const entry of entries) {
    const sessionId = String(entry.session_id || 'unknown');
    const seq = Number(entry.sequence || 0);
    const prev = bySession.get(sessionId) || 0;
    if (seq <= prev) {
      return { ok: false, reason: `Replay/non-monotonic sequence in session=${sessionId}: ${seq} <= ${prev}` };
    }
    bySession.set(sessionId, seq);
  }
  return { ok: true };
}

function verifyHashChain(entries) {
  let prevHash = '';
  const ordered = [...entries].sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
  for (const entry of ordered) {
    const expectedPrev = String(entry.prev_hash || '');
    if (expectedPrev !== prevHash) {
      return { ok: false, reason: `Hash chain break at id=${entry.id}` };
    }
    prevHash = String(entry.entry_hash || '');
  }
  return { ok: true };
}

function verifyMinimalCryptoFields(entries) {
  for (const entry of entries) {
    if (!entry.signature || !entry.algorithm) {
      return { ok: false, reason: `Missing signature/algorithm at id=${entry.id}` };
    }
    if (!entry.signature_schema_version) {
      return { ok: false, reason: `Missing signature_schema_version at id=${entry.id}` };
    }
  }
  return { ok: true };
}

const filePath = process.argv[2];
const entries = parseInput(filePath);
if (entries.length === 0) fail('Пустой audit trail.');

const checks = [
  verifyMinimalCryptoFields(entries),
  verifySequenceAndReplay(entries),
  verifyHashChain(entries),
];

const failed = checks.find((c) => !c.ok);
if (failed) fail(failed.reason);

console.log(JSON.stringify({
  success: true,
  total: entries.length,
  checks: ['crypto-fields', 'replay', 'hash-chain'],
}, null, 2));
