import { describe, it, expect } from 'vitest';
import { trustchainService } from './trustchainService';

describe('trustchainService hardening', () => {
  it('включает schema version и key_id в envelope', async () => {
    trustchainService.startSession();
    trustchainService.setCurrentQuery('test query');
    const env = await trustchainService.sign('describe_platform', {});
    expect(env.signature_schema_version).toBe(1);
    expect(typeof env.key_id).toBe('string');
    expect(env.key_id.length).toBeGreaterThan(6);
  });

  it('обеспечивает монотонность sequence для серии подписи', async () => {
    trustchainService.startSession();
    const total = 25;
    let prev = 0;
    for (let i = 0; i < total; i++) {
      const env = await trustchainService.sign('describe_current_page', { n: i, r: Math.random() });
      expect(env.sequence).toBeGreaterThan(prev);
      prev = env.sequence;
    }
  });

  it('подписывает финальный ответ с привязкой к tool signatures', async () => {
    trustchainService.startSession();
    const s1 = await trustchainService.sign('describe_platform', {});
    const s2 = await trustchainService.sign('describe_current_page', { context: 'dashboard' });
    const proof = await trustchainService.signFinalResponse('Итоговый ответ', [s1.signature, s2.signature], {
      context: 'dashboard',
    });
    expect(proof.envelope.key_id).toBeTruthy();
    expect(proof.response_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(proof.tool_signatures_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('ловит tamper args при verify', async () => {
    trustchainService.startSession();
    const env = await trustchainService.sign('list_tasks', { limit: 10 });
    const ok = await trustchainService.verify(env, 'list_tasks', { limit: 10 });
    const tampered = await trustchainService.verify(env, 'list_tasks', { limit: 999 });
    expect(ok).toBe(true);
    expect(tampered).toBe(false);
  });

  it('устойчив к порядку ключей (property-like)', async () => {
    trustchainService.startSession();
    for (let i = 0; i < 20; i++) {
      const argsA = { a: i, b: `v${i}`, c: { x: i + 1, y: i + 2 } };
      const argsB = { c: { y: i + 2, x: i + 1 }, b: `v${i}`, a: i };
      const env = await trustchainService.sign('search_all', argsA);
      const ok = await trustchainService.verify(env, 'search_all', argsB as any);
      expect(ok).toBe(true);
    }
  });
});
