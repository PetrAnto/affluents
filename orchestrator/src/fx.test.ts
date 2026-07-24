import { asUsdc6, type Usdc6 } from '@affluents/shared';
import { describe, expect, it } from 'vitest';
import {
  computeStopLimitEurc6,
  fetchOracleRatePpm,
  nextLadderTolerance,
  oracleDeviationBps,
  runFxLeg,
  type FxLegConfig,
  type FxLegDeps,
} from './fx';
import type { FxIntentRow, FxIntentState } from './internalApi';

// ---- pure math ----

describe('computeStopLimitEurc6 (Decision 2)', () => {
  it('floors estimate × (1 − bps/10000)', () => {
    // 422244 at 50 bps → tolerance floor(2111.22)=2111 → 420133
    expect(computeStopLimitEurc6(422_244n, 50, 10_000n)).toBe(412_244n); // min tolerance 10000 wins over 2111
    expect(computeStopLimitEurc6(10_000_000n, 50, 10_000n)).toBe(9_950_000n); // 50000 > 10000 → percentage applies
  });

  it('applies the 0.01 EURC absolute floor so micro-amounts cannot round to zero tolerance', () => {
    // 0.035 EURC estimate at 50 bps → pct tolerance 17; absolute floor 10000 applies.
    expect(computeStopLimitEurc6(35_187n, 50, 10_000n)).toBe(25_187n);
    // tolerance larger than the estimate → clamp at 0, never negative
    expect(computeStopLimitEurc6(5_000n, 50, 10_000n)).toBe(0n);
  });

  it('never rounds the floor up', () => {
    // 999999 at 100 bps → tol floor(9999.99)=9999 <10000 → min applies → 989999
    expect(computeStopLimitEurc6(999_999n, 100, 10_000n)).toBe(989_999n);
    // large amount: 123456789 at 75 bps → tol floor(925925.9175)=925925
    expect(computeStopLimitEurc6(123_456_789n, 75, 10_000n)).toBe(122_530_864n);
  });
});

describe('oracleDeviationBps (Decision 3)', () => {
  it('reproduces the measured testnet deviation (~1983 bps)', () => {
    // 0.05 USDC → 0.035187 EURC (net rate 0.70374); ECB 0.87781.
    const dev = oracleDeviationBps(50_000n, 35_187n, 877_810n);
    expect(dev).toBeGreaterThan(1900);
    expect(dev).toBeLessThan(2100);
  });

  it('is signed: estimate ABOVE oracle is negative', () => {
    expect(oracleDeviationBps(1_000_000n, 900_000n, 877_810n)).toBeLessThan(0);
    expect(oracleDeviationBps(1_000_000n, 877_810n, 877_810n)).toBe(0);
  });
});

describe('nextLadderTolerance', () => {
  const LADDER = [50, 75, 100];
  it('walks 50 → 75 → 100 → exhausted', () => {
    expect(nextLadderTolerance(LADDER, 50)).toBe(75);
    expect(nextLadderTolerance(LADDER, 75)).toBe(100);
    expect(nextLadderTolerance(LADDER, 100)).toBeNull();
  });
});

describe('fetchOracleRatePpm', () => {
  const ok = (body: unknown) =>
    (async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch;

  it('parses the frankfurter.dev shape by string, never floats', async () => {
    expect(await fetchOracleRatePpm('https://x', 100, ok({ rates: { EUR: 0.87781 } }))).toBe(877_810n);
    expect(await fetchOracleRatePpm('https://x', 100, ok({ rates: { EUR: '0.9' } }))).toBe(900_000n);
  });

  it('returns null on any failure — never throws (Decision 3: no second halt path)', async () => {
    expect(await fetchOracleRatePpm('https://x', 100, (async () => { throw new Error('down'); }) as unknown as typeof fetch)).toBeNull();
    expect(await fetchOracleRatePpm('https://x', 100, ok({}))).toBeNull();
    expect(await fetchOracleRatePpm('https://x', 100, ok({ rates: { EUR: 'not-a-number' } }))).toBeNull();
    expect(await fetchOracleRatePpm('https://x', 100, (async () => ({ ok: false })) as unknown as typeof fetch)).toBeNull();
  });
});

// ---- the leg, against an in-memory journal that mirrors the Worker guards ----

const CFG: FxLegConfig = {
  ladderBps: [50, 75, 100],
  minToleranceEurc6: 10_000n,
  maxOracleDeviationBps: 3000,
  oracleUrl: 'https://oracle.test',
  treasuryAddress: '0x87ae649883af5f8f6689d294bd7445b227b299cd',
  eurcAddress: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
  retryBackoffMs: 0,
};

function fakeJournal(seed?: { intent: Partial<FxIntentRow>; attempts?: Array<{ attempt_no: number; outcome: string }> }) {
  let intent: FxIntentRow | null = null;
  let attempts: Array<{ attempt_no: number; tolerance_bps: number; estimated_out_eurc6: number; stop_limit_eurc6: number; outcome: string; error_code: string | null }> = [];
  let result: { intent_id: string; amount_out_eurc6: number; tx_hash: string; fees_usdc6: number; discovered_by: 'swap' | 'reconciliation'; completed_at: string } | null = null;

  if (seed) {
    intent = {
      id: 'inv_t:fx',
      invoice_id: 'inv_t',
      amount_in_usdc6: 600_000,
      estimated_out_eurc6: 422_244,
      stop_limit_eurc6: 412_244,
      tolerance_bps: 50,
      rate_source: 'appkit',
      oracle_rate_ppm: 877_810,
      oracle_deviation_bps: 1983,
      estimated_at: '2026-07-24T09:00:00.000Z',
      estimated_block: 500,
      pre_swap_eurc6: 0,
      state: 'pending',
      ...seed.intent,
    };
    attempts = (seed.attempts ?? [{ attempt_no: 1, outcome: 'dispatched' }]).map((a) => ({
      attempt_no: a.attempt_no,
      tolerance_bps: 50,
      estimated_out_eurc6: 422_244,
      stop_limit_eurc6: 412_244,
      outcome: a.outcome,
      error_code: null,
    }));
  }

  const state = (): FxIntentState => ({ intent: intent!, attempts: attempts as never, result: result as never });

  const api: FxLegDeps['api'] = {
    getFxIntent: async () => (intent ? state() : null),
    journalFxIntent: async (p) => {
      if (!intent) {
        intent = {
          id: p.id,
          invoice_id: p.invoiceId,
          amount_in_usdc6: Number(p.amountInUsdc6),
          estimated_out_eurc6: Number(p.estimatedOutEurc6),
          stop_limit_eurc6: Number(p.stopLimitEurc6),
          tolerance_bps: p.toleranceBps,
          rate_source: p.rateSource,
          oracle_rate_ppm: p.oracleRatePpm ? Number(p.oracleRatePpm) : null,
          oracle_deviation_bps: p.oracleDeviationBps ?? null,
          estimated_at: p.estimatedAt,
          estimated_block: p.estimatedBlock ? Number(p.estimatedBlock) : null,
          pre_swap_eurc6: p.preSwapEurc6 ? Number(p.preSwapEurc6) : null,
          state: 'pending',
        };
        attempts = [{ attempt_no: 1, tolerance_bps: p.toleranceBps, estimated_out_eurc6: Number(p.estimatedOutEurc6), stop_limit_eurc6: Number(p.stopLimitEurc6), outcome: 'dispatched', error_code: null }];
      }
      return state();
    },
    ladderFxIntent: async (_id, patch) => {
      if (intent!.state !== 'pending') throw new Error('409 not pending');
      intent = { ...intent!, tolerance_bps: patch.toleranceBps, estimated_out_eurc6: Number(patch.estimatedOutEurc6), stop_limit_eurc6: Number(patch.stopLimitEurc6), estimated_at: patch.estimatedAt };
      attempts.push({ attempt_no: patch.attemptNo, tolerance_bps: patch.toleranceBps, estimated_out_eurc6: Number(patch.estimatedOutEurc6), stop_limit_eurc6: Number(patch.stopLimitEurc6), outcome: 'dispatched', error_code: null });
      return state();
    },
    patchFxAttempt: async (_id, attemptNo, outcome, errorCode) => {
      const a = attempts.find((x) => x.attempt_no === attemptNo);
      if (a) Object.assign(a, { outcome, error_code: errorCode ?? null });
      return { ok: true };
    },
    haltFxIntent: async () => {
      intent = { ...intent!, state: 'halted' };
      return { ok: true };
    },
    postFxResult: async (p) => {
      // mirror the Worker's band + divergence guards
      const out = BigInt(p.amountOutEurc6);
      const floor = BigInt(intent!.stop_limit_eurc6);
      const ceil = (BigInt(intent!.estimated_out_eurc6) * 10010n) / 10000n;
      const reasons: string[] = [];
      if (String(intent!.amount_in_usdc6) !== p.amountInUsdc6) reasons.push('divergence');
      if (out < floor) reasons.push('below stop limit');
      if (out > ceil) reasons.push('above ceiling');
      if (intent!.state !== 'pending') reasons.push('not pending');
      if (reasons.length > 0) return { ok: false as const, status: 409, reasons };
      result = { intent_id: p.intentId, amount_out_eurc6: Number(p.amountOutEurc6), tx_hash: p.txHash, fees_usdc6: Number(p.feesUsdc6 ?? 0), discovered_by: p.discoveredBy, completed_at: p.completedAt };
      intent = { ...intent!, state: 'complete' };
      const last = attempts.at(-1);
      if (last) last.outcome = 'success';
      return { ok: true as const, idempotent: false, result: result as never };
    },
  };

  return { api, view: () => ({ intent, attempts, result }) };
}

function fakeRpc(logs: Array<{ transactionHash: string; data: string }> = []) {
  const calls: string[] = [];
  return {
    calls,
    rpc: {
      getBlockNumber: async () => {
        calls.push('getBlockNumber');
        return 1000n;
      },
      readContract: async () => {
        calls.push('readContract');
        return 0n;
      },
      request: async () => {
        calls.push('eth_getLogs');
        return logs;
      },
    } as unknown as FxLegDeps['rpc'],
  };
}

function deps(over: Partial<FxLegDeps> & { journal?: ReturnType<typeof fakeJournal> }): { d: FxLegDeps; journal: ReturnType<typeof fakeJournal>; kitCalls: string[] } {
  const journal = over.journal ?? fakeJournal();
  const kitCalls: string[] = [];
  const d: FxLegDeps = {
    kit: {
      estimate: async () => {
        kitCalls.push('estimate');
        return 422_244n as never;
      },
      swap: async (_a, stop) => {
        kitCalls.push(`swap@${stop}`);
        return { amountOutEurc6: 422_244n as never, txHash: '0xswap', feesUsdc6: 120n };
      },
    },
    isStopLimitError: (e) => (e as Error).message === 'STOP',
    errorCodeOf: (e) => (e as Error).message,
    oracle: async () => 877_810n,
    api: journal.api,
    rpc: fakeRpc().rpc,
    sleep: async () => {},
    now: () => new Date('2026-07-24T10:00:00.000Z'),
    ...over,
  };
  return { d, journal, kitCalls };
}

const SPEND = asUsdc6(600_000n) as Usdc6;

describe('runFxLeg — live mode', () => {
  it('happy path: estimate → journal → swap → result journaled with actuals', async () => {
    const { d, journal, kitCalls } = deps({});
    const out = await runFxLeg('inv_t', SPEND, 'live', 0n, CFG, d);
    expect(out).toEqual({ kind: 'swapped', amountOutEurc6: 422_244n, swapTxHash: '0xswap' });
    const v = journal.view();
    expect(v.intent?.state).toBe('complete');
    expect(v.intent?.stop_limit_eurc6).toBe(412_244); // 50 bps under min-tolerance floor 10000
    expect(v.result?.discovered_by).toBe('swap');
    expect(v.attempts.at(-1)?.outcome).toBe('success');
    expect(kitCalls).toEqual(['estimate', `swap@412244`]);
  });

  it('halts without dispatching when the estimate deviates beyond the oracle bound', async () => {
    const { d, journal, kitCalls } = deps({ oracle: async () => 877_810n });
    const tight = { ...CFG, maxOracleDeviationBps: 200 }; // production default vs ~1983 bps testnet pool
    const out = await runFxLeg('inv_t', SPEND, 'live', 0n, tight, d);
    expect(out).toEqual({ kind: 'halted' });
    const v = journal.view();
    expect(v.intent?.state).toBe('halted');
    expect(v.attempts[0]?.error_code).toContain('ORACLE_DEVIATION');
    expect(kitCalls).toEqual(['estimate']); // no swap ever dispatched
  });

  it('skips the oracle check (journaling NULL) when the oracle is unreachable — never a halt reason', async () => {
    const { d, journal } = deps({ oracle: async () => null });
    const out = await runFxLeg('inv_t', SPEND, 'live', 0n, { ...CFG, maxOracleDeviationBps: 1 }, d);
    expect(out.kind).toBe('swapped');
    expect(journal.view().intent?.oracle_rate_ppm).toBeNull();
  });

  it('ladders 50 → 75 → 100 with every attempt journaled, then halts', async () => {
    let swapAttempts = 0;
    const { d, journal } = deps({
      kit: {
        estimate: async () => 422_244n as never,
        swap: async () => {
          swapAttempts += 1;
          throw new Error('STOP');
        },
      },
    });
    const out = await runFxLeg('inv_t', SPEND, 'live', 0n, CFG, d);
    expect(out).toEqual({ kind: 'halted' });
    const v = journal.view();
    expect(v.intent?.state).toBe('halted');
    expect(v.attempts.map((a) => a.tolerance_bps)).toEqual([50, 75, 100]);
    expect(v.attempts.map((a) => a.outcome)).toEqual(['stop_limit_not_met', 'stop_limit_not_met', 'stop_limit_not_met']);
    expect(swapAttempts).toBe(3);
  });

  it('succeeds mid-ladder and the journal shows exactly which tolerance won', async () => {
    let swaps = 0;
    const { d, journal } = deps({
      kit: {
        estimate: async () => 422_244n as never,
        swap: async () => {
          swaps += 1;
          if (swaps < 2) throw new Error('STOP');
          return { amountOutEurc6: 421_000n as never, txHash: '0xsecond', feesUsdc6: 120n };
        },
      },
    });
    const out = await runFxLeg('inv_t', SPEND, 'live', 0n, CFG, d);
    expect(out.kind).toBe('swapped');
    const v = journal.view();
    expect(v.intent?.tolerance_bps).toBe(75);
    expect(v.attempts.map((a) => a.outcome)).toEqual(['stop_limit_not_met', 'success']);
  });

  it('non-stopLimit swap errors journal the attempt and rethrow (pipeline retries next tick)', async () => {
    const { d, journal } = deps({
      kit: {
        estimate: async () => 422_244n as never,
        swap: async () => {
          throw new Error('CIRCLE_DOWN');
        },
      },
    });
    await expect(runFxLeg('inv_t', SPEND, 'live', 0n, CFG, d)).rejects.toThrow('CIRCLE_DOWN');
    const v = journal.view();
    expect(v.intent?.state).toBe('pending'); // NOT halted — transient
    expect(v.attempts[0]?.outcome).toBe('error');
    expect(v.attempts[0]?.error_code).toBe('CIRCLE_DOWN');
  });

  it('halts when the actual lands outside the acceptance band (Decision 5)', async () => {
    const { d, journal } = deps({
      kit: {
        estimate: async () => 422_244n as never,
        // above ceil(422244*1.001)=422666 → out of band
        swap: async () => ({ amountOutEurc6: 500_000n as never, txHash: '0xhigh', feesUsdc6: 0n }),
      },
    });
    const out = await runFxLeg('inv_t', SPEND, 'live', 0n, CFG, d);
    expect(out).toEqual({ kind: 'halted' });
    const v = journal.view();
    expect(v.intent?.state).toBe('halted');
    expect(v.result).toBeNull(); // the refused result was NOT journaled
    expect(v.attempts.at(-1)?.error_code).toContain('OUT_OF_BAND');
  });

  it('refuses on divergence between recomputed spend and the journaled intent', async () => {
    const journal = fakeJournal({ intent: { amount_in_usdc6: 999_999 } });
    const { d } = deps({ journal });
    await expect(runFxLeg('inv_t', SPEND, 'live', 0n, CFG, d)).rejects.toThrow('divergence');
  });
});

describe('runFxLeg — restart reconciliation (Decision 4)', () => {
  it('window 2: finds the dispatched swap on-chain and journals the discovered result', async () => {
    const journal = fakeJournal({ intent: {} }); // pending intent from a previous run
    const { rpc, calls } = fakeRpc([{ transactionHash: '0xfound', data: '0x' + (420_500n).toString(16) }]);
    const { d, kitCalls } = deps({ journal, rpc });
    const out = await runFxLeg('inv_t', SPEND, 'live', 0n, CFG, d);
    expect(out).toEqual({ kind: 'swapped', amountOutEurc6: 420_500n, swapTxHash: '0xfound' });
    const v = journal.view();
    expect(v.result?.discovered_by).toBe('reconciliation');
    expect(v.intent?.state).toBe('complete');
    expect(kitCalls).toEqual([]); // NO re-estimate, NO re-swap — the chain was the truth
    expect(calls).toContain('eth_getLogs');
  });

  it('window 2: ignores on-chain EURC transfers outside the acceptance band', async () => {
    const journal = fakeJournal({ intent: {} });
    // 100 EURC transfer into treasury — some other flow, not our swap
    const { rpc } = fakeRpc([{ transactionHash: '0xother', data: '0x' + (100_000_000n).toString(16) }]);
    const { d, kitCalls } = deps({ journal, rpc });
    const out = await runFxLeg('inv_t', SPEND, 'live', 0n, CFG, d);
    expect(out.kind).toBe('swapped'); // fell through to window 1 re-dispatch
    expect(kitCalls).toEqual(['swap@412244']);
  });

  it('window 1: re-executes with the JOURNALED stopLimit — never re-estimates', async () => {
    const journal = fakeJournal({ intent: { stop_limit_eurc6: 400_000 } });
    const { d, kitCalls } = deps({ journal, rpc: fakeRpc([]).rpc });
    const out = await runFxLeg('inv_t', SPEND, 'live', 0n, CFG, d);
    expect(out.kind).toBe('swapped');
    expect(kitCalls).toEqual(['swap@400000']); // journaled floor, no estimate call
    const v = journal.view();
    // the re-dispatch was journaled as a new attempt at the SAME tolerance/floor
    expect(v.attempts.map((a) => a.attempt_no)).toEqual([1, 2]);
    expect(v.attempts[1]?.stop_limit_eurc6).toBe(400_000);
  });

  it('returns the journaled result without touching anything when already complete', async () => {
    const journal = fakeJournal({ intent: { state: 'complete' } });
    (journal.view() as { result: unknown }).result = null; // seed result via api
    // seed a result directly through the fake's postFxResult path is complex;
    // emulate by seeding state complete + result:
    const j2 = fakeJournal({ intent: {} });
    await j2.api.postFxResult({ intentId: 'inv_t:fx', invoiceId: 'inv_t', amountInUsdc6: '600000', amountOutEurc6: '420000', txHash: '0xdone', discoveredBy: 'swap', completedAt: 'x' });
    const { d, kitCalls } = deps({ journal: j2 });
    const out = await runFxLeg('inv_t', SPEND, 'live', 0n, CFG, d);
    expect(out).toEqual({ kind: 'swapped', amountOutEurc6: 420_000n, swapTxHash: '0xdone' });
    expect(kitCalls).toEqual([]);
  });
});

describe('runFxLeg — demo mode', () => {
  it('journals a demo intent (rate_source=demo, stop=estimate=quote) and returns the journaled quote', async () => {
    const { d, journal, kitCalls } = deps({});
    const out = await runFxLeg('inv_t', SPEND, 'demo', 552_000n, CFG, d);
    expect(out).toEqual({ kind: 'demo', amountOutEurc6: 552_000n });
    const v = journal.view();
    expect(v.intent?.rate_source).toBe('demo');
    expect(v.intent?.stop_limit_eurc6).toBe(552_000);
    expect(v.intent?.state).toBe('pending'); // completes when the transfer confirms
    expect(kitCalls).toEqual([]); // no App Kit calls in demo mode
  });
});
