import { describe, expect, it } from 'vitest';
import { applyVerification } from './db';
import type { Env } from './types';

/**
 * Minimal D1 stand-in: `applyVerification` issues exactly one SELECT (the
 * invoice joined to its wallet) and one UPDATE, so the fake records the bound
 * UPDATE parameters and hands back a fixed row for the SELECT.
 */
function fakeEnv(row: Record<string, unknown>) {
  const updates: unknown[][] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        const isUpdate = sql.trim().startsWith('UPDATE');
        const stmt = {
          bind(...args: unknown[]) {
            if (isUpdate) updates.push(args);
            return stmt;
          },
          first: async () => (isUpdate ? null : row),
          run: async () => ({}),
        };
        return stmt;
      },
    },
  } as unknown as Env;
  // UPDATE binds: (?1 id, ?2 received, ?3 overpaid, ?4 overpaidFlag, ?5 unexpected, ?6 status, ?7 paid_txs)
  return { env, updates, received: () => updates.at(-1)?.[1], overpaid: () => updates.at(-1)?.[2], overpaidFlag: () => updates.at(-1)?.[3] };
}

const BASE = {
  id: 'inv_test',
  amount_usdc6: 1_000_000,
  status: 'awaiting_payment',
  received_usdc6: 0,
  overpaid_usdc6: 0,
  overpaid: 0,
  unexpected_payment: 0,
  paid_txs: '[]',
  baseline_usdc6: 0,
};

describe('applyVerification: credit is monotonic', () => {
  it('credits the balance delta above baseline on first verification', async () => {
    const f = fakeEnv({ ...BASE });
    const res = await applyVerification(f.env, 'inv_test', 1_000_000n, []);
    expect(res).toEqual({ status: 'payment_verified', receivedUsdc6: '1000000' });
    expect(f.received()).toBe('1000000');
  });

  it('does NOT lower credit after the sweep empties the deposit wallet', async () => {
    // The exact live regression (invoice 2026-010): payment verified and swept
    // to treasury, invoice still 'routing' so still watched, watcher observes a
    // now-empty wallet and posts balance 0. Credit must survive untouched --
    // the pipeline derives `routed` from it, and routed=0 broke the earn step.
    const f = fakeEnv({ ...BASE, status: 'routing', received_usdc6: 1_000_000 });
    const res = await applyVerification(f.env, 'inv_test', 0n, []);
    expect(res?.receivedUsdc6).toBe('1000000');
    expect(f.received()).toBe('1000000');
    expect(res?.status).toBe('routing');
  });

  it('still raises credit when genuinely more funds arrive', async () => {
    const f = fakeEnv({ ...BASE, received_usdc6: 400_000 });
    const res = await applyVerification(f.env, 'inv_test', 1_000_000n, []);
    expect(res?.receivedUsdc6).toBe('1000000');
  });

  it('keeps a flagged overpayment sticky across a post-sweep zero balance', async () => {
    const f = fakeEnv({
      ...BASE,
      status: 'routing',
      received_usdc6: 1_500_000,
      overpaid_usdc6: 500_000,
      overpaid: 1,
    });
    await applyVerification(f.env, 'inv_test', 0n, []);
    expect(f.received()).toBe('1500000');
    expect(f.overpaid()).toBe('500000');
    expect(f.overpaidFlag()).toBe(1);
  });

  it('does not downgrade a verified invoice to awaiting_payment on a zero balance', async () => {
    const f = fakeEnv({ ...BASE, status: 'payment_verified', received_usdc6: 1_000_000 });
    const res = await applyVerification(f.env, 'inv_test', 0n, []);
    expect(res?.status).toBe('payment_verified');
    expect(res?.receivedUsdc6).toBe('1000000');
  });
});
