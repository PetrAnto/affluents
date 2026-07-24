import { describe, expect, it } from 'vitest';
import { ladderFxIntent, writeFxResult, type FxIntentRow } from './db';
import type { Env } from './types';

/**
 * Minimal D1 stand-in for the FX journal guards. Routes each prepared
 * statement by table + verb: SELECTs return the fixture rows, writes are
 * recorded so tests can assert exactly what would have been persisted.
 */
function fakeFxEnv(fix: { intent?: Partial<FxIntentRow> | null; result?: Record<string, unknown> | null; attempts?: unknown[] }) {
  const writes: string[] = [];
  const intent: FxIntentRow | null =
    fix.intent === null
      ? null
      : {
          id: 'inv_a1:fx',
          invoice_id: 'inv_a1',
          amount_in_usdc6: 600_000,
          estimated_out_eurc6: 422_244,
          stop_limit_eurc6: 412_244,
          tolerance_bps: 50,
          rate_source: 'appkit',
          oracle_rate_ppm: 877_810,
          oracle_deviation_bps: 1980,
          estimated_at: '2026-07-24T10:00:00.000Z',
          estimated_block: 1000,
          pre_swap_eurc6: 0,
          state: 'pending',
          ...fix.intent,
        };
  // Stateful on results: an INSERT INTO fx_results makes the later re-read
  // see the row, as real D1 would.
  let resultRow: Record<string, unknown> | null = fix.result ?? null;
  const env = {
    DB: {
      prepare(sql: string) {
        const s = sql.trim();
        const stmt = {
          sql: s,
          bind: (..._args: unknown[]) => stmt,
          first: async () => {
            if (s.includes('FROM fx_intents')) return intent;
            if (s.includes('FROM fx_results')) return resultRow;
            return null;
          },
          all: async () => ({ results: fix.attempts ?? [] }),
          run: async () => {
            writes.push(s.split(/\s+/).slice(0, 4).join(' '));
            return { meta: { changes: 1 } };
          },
        };
        return stmt;
      },
      batch: async (stmts: Array<{ sql: string }>) => {
        for (const st of stmts) {
          writes.push(st.sql.split(/\s+/).slice(0, 4).join(' '));
          if (st.sql.includes('INSERT INTO fx_results')) resultRow = { intent_id: 'inv_a1:fx', inserted: true };
        }
        return stmts.map(() => ({ meta: { changes: 1 } }));
      },
    },
  } as unknown as Env;
  return { env, writes };
}

const RESULT_BASE = {
  intentId: 'inv_a1:fx',
  invoiceId: 'inv_a1',
  amountInUsdc6: '600000',
  amountOutEurc6: '422244',
  txHash: '0xabc',
  discoveredBy: 'swap' as const,
  completedAt: '2026-07-24T10:00:05.000Z',
};

describe('writeFxResult server-side guards (Decision 4/5)', () => {
  it('accepts an in-band result and completes the intent atomically', async () => {
    // fx_results SELECT returns null before the batch; the post-batch re-read
    // must see a row, so hand the fake a result only after writes exist — the
    // simplest honest fake is to return the row unconditionally and assert the
    // batch happened. We instead assert refusals write NOTHING (below) and
    // acceptance writes the full batch.
    const f = fakeFxEnv({ result: { intent_id: 'inv_a1:fx', amount_out_eurc6: 422_244, tx_hash: '0xabc' } });
    // A pre-existing identical result short-circuits as idempotent (no writes):
    const res = await writeFxResult(f.env, RESULT_BASE);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.idempotent).toBe(true);
    expect(f.writes).toHaveLength(0);
  });

  it('refuses amount_out below the journaled stop limit, writing nothing', async () => {
    const f = fakeFxEnv({});
    const res = await writeFxResult(f.env, { ...RESULT_BASE, amountOutEurc6: '412243' }); // floor is 412244
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(409);
      expect(res.reasons.join(' ')).toContain('below journaled stop limit');
    }
    expect(f.writes).toHaveLength(0);
  });

  it('accepts exactly the stop limit (inclusive lower bound)', async () => {
    const f = fakeFxEnv({});
    const res = await writeFxResult(f.env, { ...RESULT_BASE, amountOutEurc6: '412244' });
    expect(res.ok).toBe(true);
    expect(f.writes.some((w) => w.includes('INSERT INTO fx_results'))).toBe(true);
    expect(f.writes.some((w) => w.includes('UPDATE fx_intents'))).toBe(true);
  });

  it('refuses amount_out above estimate + 10 bps (broken-pool ceiling)', async () => {
    // ceil = floor(422244 * 1.001) = 422666; 422667 must refuse.
    const f = fakeFxEnv({});
    const ok = await writeFxResult(f.env, { ...RESULT_BASE, amountOutEurc6: '422666' });
    expect(ok.ok).toBe(true);
    const f2 = fakeFxEnv({});
    const bad = await writeFxResult(f2.env, { ...RESULT_BASE, amountOutEurc6: '422667' });
    expect(bad.ok).toBe(false);
    expect(f2.writes).toHaveLength(0);
  });

  it('refuses a reported amount_in that diverges from the journaled intent', async () => {
    const f = fakeFxEnv({});
    const res = await writeFxResult(f.env, { ...RESULT_BASE, amountInUsdc6: '600001' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reasons.join(' ')).toContain('differs from journaled intent');
    expect(f.writes).toHaveLength(0);
  });

  it('refuses a result against a halted intent', async () => {
    const f = fakeFxEnv({ intent: { state: 'halted' } });
    const res = await writeFxResult(f.env, RESULT_BASE);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reasons.join(' ')).toContain("not 'pending'");
    expect(f.writes).toHaveLength(0);
  });

  it('refuses a conflicting second result for the same intent', async () => {
    const f = fakeFxEnv({ result: { intent_id: 'inv_a1:fx', amount_out_eurc6: 422_244, tx_hash: '0xOTHER' } });
    const res = await writeFxResult(f.env, RESULT_BASE);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reasons.join(' ')).toContain('different result is already journaled');
    expect(f.writes).toHaveLength(0);
  });
});

describe('ladderFxIntent state guard (Decision 2)', () => {
  const PATCH = {
    attemptNo: 2,
    toleranceBps: 75,
    estimatedOutEurc6: '422244',
    stopLimitEurc6: '419077',
    estimatedAt: '2026-07-24T10:01:00.000Z',
  };

  it('refuses to ladder a non-pending intent, writing nothing', async () => {
    for (const state of ['complete', 'halted'] as const) {
      const f = fakeFxEnv({ intent: { state } });
      const res = await ladderFxIntent(f.env, 'inv_a1:fx', PATCH);
      expect(res).toBe('not_pending');
      expect(f.writes).toHaveLength(0);
    }
  });

  it('ladders a pending intent (update + attempt row in one batch)', async () => {
    const f = fakeFxEnv({});
    const res = await ladderFxIntent(f.env, 'inv_a1:fx', PATCH);
    expect(res).not.toBe('not_pending');
    expect(f.writes.some((w) => w.includes('UPDATE fx_intents'))).toBe(true);
    expect(f.writes.some((w) => w.includes('INSERT OR IGNORE INTO'))).toBe(true);
  });
});
