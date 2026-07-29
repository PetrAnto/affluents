import { describe, expect, it } from 'vitest';
import { deterministicIdempotencyKey } from './circleTx';
import type { WithdrawalFeedItem, WithdrawalStepRow } from './internalApi';
import { runWithdrawal, type WithdrawDeps } from './withdraw';

/**
 * Withdraw-leg tests (WITHDRAW_HANDOFF.md Phase 2). Deps are mocked at the
 * same seam fx.test.ts uses; every scenario asserts what was DISPATCHED and
 * what was JOURNALED, in order. Restart windows are the fixtures the live
 * kill-tests will produce for real:
 *   window 1 — step intent journaled, no provider_ref (crash before/inside
 *              dispatch): reconcile via event scan, else re-dispatch with the
 *              SAME deterministic idempotency key.
 *   window 2 — provider_ref journaled, no confirmation (crash between
 *              dispatch and result): adopt Circle's transaction, never re-send.
 */

const WD = 'wd_testabc123456789';

function step(partial: Partial<WithdrawalStepRow> & { step: 'vault' | 'transfer' }): WithdrawalStepRow {
  return {
    id: `${WD}:${partial.step}`,
    withdrawal_id: WD,
    status: 'intent',
    provider_ref: null,
    tx_hash: null,
    amount_usdc6: 150_000,
    attempt_count: 0,
    ...partial,
  };
}

interface Calls {
  dispatched: Array<{ kind: 'vault' | 'transfer'; amount: bigint; key: string; refId: string; to?: string }>;
  journal: string[];
  completed: string[];
}

function makeDeps(fix: {
  destination?: 'spend' | 'reserve';
  amount?: number;
  createdBlock?: number | null;
  steps?: WithdrawalStepRow[];
  scanResult?: { txHash: string } | null;
  circleState?: { state: string; txHash: string | null } | null;
  postStepAmountOverride?: number;
}): { deps: WithdrawDeps; calls: Calls; item: WithdrawalFeedItem } {
  const calls: Calls = { dispatched: [], journal: [], completed: [] };
  const steps = new Map<string, WithdrawalStepRow>((fix.steps ?? []).map((s) => [s.step, s]));
  const amount = fix.amount ?? 150_000;
  const withdrawal = {
    state: 'pending',
    amount_usdc6: amount,
    destination: fix.destination ?? 'spend',
    created_block: fix.createdBlock === undefined ? 54_200_000 : fix.createdBlock,
  };
  let refSeq = 0;

  const deps: WithdrawDeps = {
    getWithdrawal: async () => ({ withdrawal, steps: [...steps.values()] }),
    postStep: async (_id, p) => {
      if (!steps.has(p.step)) {
        steps.set(p.step, step({ step: p.step, amount_usdc6: fix.postStepAmountOverride ?? Number(p.amountUsdc6) }));
      }
      calls.journal.push(`intent:${p.step}`);
      return { ok: true, step: steps.get(p.step)! };
    },
    postStepUpdate: async (_id, p) => {
      const row = steps.get(p.step)!;
      if (p.status) row.status = p.status;
      if (p.providerRef) row.provider_ref = p.providerRef;
      if (p.txHash) row.tx_hash = p.txHash;
      if (p.bumpAttempt) row.attempt_count += 1;
      calls.journal.push(`update:${p.step}:${p.status}${p.providerRef ? ':ref' : ''}${p.txHash ? `:${p.txHash}` : ''}`);
      return { ok: true, step: row };
    },
    postComplete: async (id, amountUsdc6) => {
      calls.completed.push(`${id}:${amountUsdc6}`);
      return { ok: true, idempotent: false };
    },
    sendVaultWithdraw: async (amt, key, refId) => {
      calls.dispatched.push({ kind: 'vault', amount: amt, key, refId });
      return { providerRef: `circle-ref-${++refSeq}` };
    },
    sendTransfer: async (to, amt, key, refId) => {
      calls.dispatched.push({ kind: 'transfer', amount: amt, key, refId, to });
      return { providerRef: `circle-ref-${++refSeq}` };
    },
    getTransactionState: async () => fix.circleState ?? null,
    waitForConfirmation: async (ref) => ({ txHash: `0xtx-${ref}` }),
    isTerminalFailure: (s) => s === 'FAILED' || s === 'CANCELLED' || s === 'DENIED',
    deterministicKey: deterministicIdempotencyKey,
    scanVaultWithdraw: async () => fix.scanResult ?? null,
    getBlockNumber: async () => 54_300_000n,
    spendAddress: '0xspend',
    reserveAddress: '0xreserve',
    log: () => {},
  };
  const item: WithdrawalFeedItem = {
    id: WD,
    amount_usdc6: amount,
    destination: withdrawal.destination as 'spend' | 'reserve',
    state: 'pending',
    created_block: withdrawal.created_block,
    steps: [...steps.values()],
  };
  return { deps, calls, item };
}

describe('runWithdrawal — fresh run', () => {
  it('runs both hops in order with deterministic keys and completes with the exact amount', async () => {
    const { deps, calls, item } = makeDeps({});
    await runWithdrawal(item, deps);
    expect(calls.dispatched.map((d) => d.kind)).toEqual(['vault', 'transfer']);
    expect(calls.dispatched[0]).toMatchObject({
      amount: 150_000n,
      refId: `${WD}:vault`,
      key: deterministicIdempotencyKey(`${WD}:vault:0`),
    });
    expect(calls.dispatched[1]).toMatchObject({ to: '0xspend', refId: `${WD}:transfer` });
    // journal order per hop: intent → sent(ref) → confirmed(tx)
    expect(calls.journal).toEqual([
      'intent:vault',
      'update:vault:sent:ref',
      'update:vault:confirmed:0xtx-circle-ref-1',
      'intent:transfer',
      'update:transfer:sent:ref',
      'update:transfer:confirmed:0xtx-circle-ref-2',
    ]);
    expect(calls.completed).toEqual([`${WD}:150000`]);
  });

  it('routes the transfer to the reserve wallet for destination reserve', async () => {
    const { deps, calls, item } = makeDeps({ destination: 'reserve' });
    await runWithdrawal(item, deps);
    expect(calls.dispatched[1]).toMatchObject({ kind: 'transfer', to: '0xreserve' });
  });

  it('does nothing when the journal says the withdrawal is not pending', async () => {
    const { deps, calls, item } = makeDeps({});
    (await deps.getWithdrawal(WD))!.withdrawal.state = 'complete';
    await runWithdrawal(item, deps);
    expect(calls.dispatched).toEqual([]);
    expect(calls.completed).toEqual([]);
  });
});

describe('runWithdrawal — window 1 (intent journaled, no provider_ref)', () => {
  it('re-dispatches with the SAME deterministic key as the original attempt (attempt_count 0)', async () => {
    const { deps, calls, item } = makeDeps({ steps: [step({ step: 'vault' })] });
    await runWithdrawal(item, deps);
    // The crash left attempt_count at 0, so the retry derives the identical
    // key — Circle would return the original transaction if it was dispatched.
    expect(calls.dispatched[0]!.key).toBe(deterministicIdempotencyKey(`${WD}:vault:0`));
  });

  it('adopts an on-chain Withdraw event found by the scan instead of re-dispatching the vault hop', async () => {
    const { deps, calls, item } = makeDeps({
      steps: [step({ step: 'vault' })],
      scanResult: { txHash: '0xfound' },
    });
    await runWithdrawal(item, deps);
    expect(calls.dispatched.map((d) => d.kind)).toEqual(['transfer']); // vault NOT re-sent
    expect(calls.journal).toContain('update:vault:confirmed:0xfound');
    expect(calls.completed).toEqual([`${WD}:150000`]);
  });
});

describe('runWithdrawal — window 2 (provider_ref journaled, no result)', () => {
  it('adopts the Circle transaction and never re-sends', async () => {
    const { deps, calls, item } = makeDeps({
      steps: [step({ step: 'vault', status: 'sent', provider_ref: 'circle-old', attempt_count: 1 })],
      circleState: { state: 'CONFIRMED', txHash: '0xlanded' },
    });
    await runWithdrawal(item, deps);
    expect(calls.dispatched.filter((d) => d.kind === 'vault')).toEqual([]); // never re-sent
    expect(calls.journal).toContain('update:vault:confirmed:0xlanded');
    expect(calls.completed).toEqual([`${WD}:150000`]);
  });

  it('journals a step failure and retries with a NEW key when Circle reports terminal failure', async () => {
    const { deps, calls, item } = makeDeps({
      steps: [step({ step: 'vault', status: 'sent', provider_ref: 'circle-old', attempt_count: 1 })],
      circleState: { state: 'FAILED', txHash: null },
    });
    await runWithdrawal(item, deps);
    expect(calls.journal).toContain('update:vault:failed');
    // attempt bumped to 2 by the failure journal → new key, not attempt 1's
    expect(calls.dispatched[0]!.key).toBe(deterministicIdempotencyKey(`${WD}:vault:2`));
    expect(calls.dispatched[0]!.key).not.toBe(deterministicIdempotencyKey(`${WD}:vault:1`));
  });
});

describe('runWithdrawal — both hops already confirmed (crash before complete)', () => {
  it('dispatches nothing and only posts completion', async () => {
    const { deps, calls, item } = makeDeps({
      steps: [
        step({ step: 'vault', status: 'confirmed', tx_hash: '0xv' }),
        step({ step: 'transfer', status: 'confirmed', tx_hash: '0xt' }),
      ],
    });
    await runWithdrawal(item, deps);
    expect(calls.dispatched).toEqual([]);
    expect(calls.completed).toEqual([`${WD}:150000`]);
  });
});

describe('runWithdrawal — guards', () => {
  it('refuses to dispatch on journal divergence (runStep precedent)', async () => {
    const { deps, calls, item } = makeDeps({ postStepAmountOverride: 140_000 });
    await expect(runWithdrawal(item, deps)).rejects.toThrow(/journal divergence/);
    expect(calls.dispatched).toEqual([]);
  });

  it('never auto-fails after dispatched hops: a completion refusal leaves state pending', async () => {
    const { deps, calls, item } = makeDeps({
      steps: [
        step({ step: 'vault', status: 'confirmed', tx_hash: '0xv' }),
        step({ step: 'transfer', status: 'confirmed', tx_hash: '0xt' }),
      ],
    });
    deps.postComplete = async () => ({ ok: false, status: 409, reasons: ['test refusal'] });
    await runWithdrawal(item, deps); // must NOT throw, must NOT fail anything
    expect(calls.journal.filter((j) => j.includes('failed'))).toEqual([]);
  });

  it('deterministicIdempotencyKey is stable and UUID-shaped', () => {
    const a = deterministicIdempotencyKey('wd_x:vault:0');
    expect(a).toBe(deterministicIdempotencyKey('wd_x:vault:0'));
    expect(a).not.toBe(deterministicIdempotencyKey('wd_x:vault:1'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
