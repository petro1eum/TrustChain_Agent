#!/usr/bin/env node
import { readFileSync } from 'fs';

function fail(msg) {
  console.error(`[provenance-gate] ${msg}`);
  process.exit(1);
}

const filePath = process.argv[2];
if (!filePath) fail('Usage: node scripts/provenance-gate.mjs <audit.json>');

const payload = JSON.parse(readFileSync(filePath, 'utf-8'));
const entries = Array.isArray(payload) ? payload : (payload.entries || []);
if (!Array.isArray(entries) || entries.length === 0) fail('No entries provided.');

let unsigned = 0;
let unverified = 0;
let missingDecisionContext = 0;
for (const e of entries) {
  if (!e.signature) unsigned++;
  if (!e.verified) unverified++;
  if (!e.decision_context_json) missingDecisionContext++;
}

const deny = unsigned > 0 || unverified > 0;
const report = {
  total: entries.length,
  unsigned,
  unverified,
  missingDecisionContext,
  decision: deny ? 'deny' : 'allow',
};

console.log(JSON.stringify(report, null, 2));
if (deny) {
  fail('Provenance gate failed.');
}
