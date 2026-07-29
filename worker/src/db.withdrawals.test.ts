import { describe, expect, it } from 'vitest';
import {
  completeInvoice,
  completeWithdrawal,
  createWithdrawal,
  failWithdrawal,
  updateWithdrawalStep,
  upsertWithdrawalStepIntent,
  type WithdrawalRow,
  type WithdrawalStepRow,
} from './db';
import type { Env } from './types';

/**
 * Stateful D1 stand-in for the withdrawal guards (WITHDRAW_HANDOFF.md).
 * The business guards live inside conditional SQL (wallet-claim style), so
 * this fake EVALUATES those predicates against fixture state instead of just
 * recording strings: a conditional INSERT/UPDATE mutates the fixture only
 * when its WHERE would hold, and reports meta.changes accordingly. Ledger
 * writes are captured row-by-row so tests can assert exactly what would be
 * persisted (amendment A2: invoice_id NULL + withdrawal_id set).
 */
interface Fix {
  withdrawals: WithdrawalRow[];
  steps: WithdrawalStepRow[];
  earnSum: number;
}

interface LedgerWrite {
  bucket: string;
  delta6: string;
  tx_hash: string | null;
  invoice_id: null;
  withdrawal_id: string;
}

function wd(partial: Partial<WithdrawalRow>): WithdrawalRow {
  return {
    id: 'wd_seed000000000001',
    amount_usdc6: 150_000,
    destination: 'spend',
    state: 'pending',
    fail_reason: null,
    created_block: null,
    created_at: '2026-07-29T12:00:00.000Z',
    updated_at: '2026-07-29T12:00:00.000Z',
    ...partial,
  };
}

function stepRow(partial: Partial<WithdrawalStepRow>): WithdrawalStepRow {
  const withdrawalId = partial.withdrawal_id ?? 'wd_seed000000000001';
  const step = partial.step ?? 'vault';
  return {
    id: `${withdrawalId}:${step}`,
    withdrawal_id: withdrawalId,
    step,
    status: 'intent',
    provider_ref: null,
    tx_hash: null,
    amount_usdc6: 150_000,
    attempt_count: 0,
    created_at: '2026-07-29T12:00:00.000Z',
    updated_at: '2026-07-29T12:00:00.000Z',
    ...partial,
  };
}

function fakeEnv(fix: Fix) {
  const ledgerWrites: LedgerWrite[] = [];
  const sqlLog: string[] = [];

  function exec(sql: string, args: unknown[]): { changes: number; first?: unknown; all?: unknown[] } {
    const s = sql.replace(/\s+/g, ' ').trim();
    sqlLog.push(s);

    if (s.startsWith('INSERT INTO withdrawals')) {
      const [id, amount, destination] = args as [string, string, WithdrawalRow['destination']];
      const noPending = !fix.withdrawals.some((w) => w.state === 'pending');
      const within = BigInt(amount) <= BigInt(fix.earnSum);
      if (!noPending || !within) return { changes: 0 };
      fix.withdrawals.push(wd({ id, amount_usdc6: Number(amount), destination }));
      return { changes: 1 };
    }
    if (s.startsWith('SELECT * FROM withdrawals WHERE id')) {
      return { changes: 0, first: fix.withdrawals.find((w) => w.id === args[0]) ?? null };
    }
    if (s.includes("FROM withdrawals WHERE state = 'pending' LIMIT 1")) {
      return { changes: 0, first: fix.withdrawals.find((w) => w.state === 'pending') ?? null };
    }
    if (s.includes('COALESCE(SUM(delta6), 0) AS s')) {
      return { changes: 0, first: { s: fix.earnSum } };
    }
    if (s.startsWith('SELECT * FROM withdrawal_steps WHERE withdrawal_id')) {
      return { changes: 0, all: fix.steps.filter((st) => st.withdrawal_id === args[0]) };
    }
    if (s.startsWith('SELECT * FROM withdrawal_steps WHERE id')) {
      return { changes: 0, first: fix.steps.find((st) => st.id === args[0]) ?? null };
    }
    if (s.startsWith('INSERT OR IGNORE INTO withdrawal_steps')) {
      const [id, withdrawalId, step, amount] = args as [string, string, WithdrawalStepRow['step'], string];
      if (!fix.steps.some((st) => st.id === id)) {
        fix.steps.push(stepRow({ id, withdrawal_id: withdrawalId, step, amount_usdc6: Number(amount) }));
        return { changes: 1 };
      }
      return { changes: 0 };
    }
    if (s.startsWith('UPDATE withdrawals SET created_block')) {
      const [id, block] = args as [string, string | null];
      const row = fix.withdrawals.find((w) => w.id === id);
      if (row && row.created_block === null && block !== null) row.created_block = Number(block);
      return { changes: row ? 1 : 0 };
    }
    if (s.startsWith('UPDATE withdrawal_steps SET')) {
      const [id, status, providerRef, txHash, bump] = args as [string, string | null, string | null, string | null, number];
      const row = fix.steps.find((st) => st.id === id);
      if (!row) return { changes: 0 };
      if (status !== null) row.status = status as WithdrawalStepRow['status'];
      if (providerRef !== null) row.provider_ref = providerRef;
      if (txHash !== null) row.tx_hash = txHash;
      row.attempt_count += bump;
      return { changes: 1 };
    }
    if (s.startsWith("UPDATE withdrawals SET state = 'failed'")) {
      const [id, reason] = args as [string, string];
      const row = fix.withdrawals.find((w) => w.id === id);
      const dispatched = fix.steps.some(
        (st) => st.withdrawal_id === id && (st.status === 'sent' || st.status === 'confirmed'),
      );
      if (!row || row.state !== 'pending' || dispatched) return { changes: 0 };
      row.state = 'failed';
      row.fail_reason = reason;
      return { changes: 1 };
    }
    if (s.startsWith('INSERT INTO ledger')) {
      // Both completion inserts carry the in-statement EXISTS(state='pending')
      // re-check; honor it against CURRENT fixture state (batch is sequential).
      if (s.includes("SELECT 'earn', 'USDC'")) {
        const [delta, tx, id] = args as [string, string, string];
        const parent = fix.withdrawals.find((w) => w.id === id);
        if (parent?.state !== 'pending') return { changes: 0 };
        ledgerWrites.push({ bucket: 'earn', delta6: delta, tx_hash: tx, invoice_id: null, withdrawal_id: id });
        return { changes: 1 };
      }
      const [bucket, amount, tx, id] = args as [string, string, string, string];
      const parent = fix.withdrawals.find((w) => w.id === id);
      if (parent?.state !== 'pending') return { changes: 0 };
      ledgerWrites.push({ bucket, delta6: amount, tx_hash: tx, invoice_id: null, withdrawal_id: id });
      return { changes: 1 };
    }
    if (s.startsWith("UPDATE withdrawals SET state = 'complete'")) {
      const [id] = args as [string];
      const row = fix.withdrawals.find((w) => w.id === id);
      if (!row || row.state !== 'pending') return { changes: 0 };
      row.state = 'complete';
      return { changes: 1 };
    }
    throw new Error(`fake D1: unhandled SQL: ${s.slice(0, 80)}`);
  }

  const env = {
    DB: {
      prepare(sql: string) {
        let bound: unknown[] = [];
        const stmt = {
          sql,
          bind(...args: unknown[]) {
            bound = args;
            return stmt;
          },
          async first() {
            return exec(sql, bound).first ?? null;
          },
          async all() {
            return { results: exec(sql, bound).all ?? [] };
          },
          async run() {
            return { meta: { changes: exec(sql, bound).changes } };
          },
          _exec() {
            return exec(sql, bound);
          },
        };
        return stmt;
      },
      async batch(stmts: Array<{ _exec: () => { changes: number } }>) {
        return stmts.map((st) => ({ meta: { changes: st._exec().changes } }));
      },
    },
  } as unknown as Env;

  return { env, fix, ledgerWrites, sqlLog };
}

const EARN_SUM = 1_200_000;

describe('createWithdrawal', () => {
  it('refuses bad destination, non-integer amount, and the exact 10000 floor boundary with 400, writing nothing', async () => {
    const { env, fix } = fakeEnv({ withdrawals: [], steps: [], earnSum: EARN_SUM });
    for (const input of [
      { amountUsdc6: '150000', destination: 'earn' },
      { amountUsdc6: '0.15', destination: 'spend' },
      { amountUsdc6: '-1', destination: 'spend' },
      { amountUsdc6: '9999', destination: 'spend' }, // one below the floor
    ]) {
      const out = await createWithdrawal(env, input);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.status).toBe(400);
    }
    expect(fix.withdrawals).toHaveLength(0);
    // exact floor is accepted
    const ok = await createWithdrawal(env, { amountUsdc6: '10000', destination: 'spend' });
    expect(ok.ok).toBe(true);
  });

  it('refuses over-balance at the exact boundary (sum+1) and accepts the full balance — Earn can never go negative', async () => {
    const over = fakeEnv({ withdrawals: [], steps: [], earnSum: EARN_SUM });
    const refused = await createWithdrawal(over.env, { amountUsdc6: String(EARN_SUM + 1), destination: 'reserve' });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.status).toBe(409);
      expect(refused.reasons.join()).toContain('exceeds the Earn balance');
    }
    expect(over.fix.withdrawals).toHaveLength(0);

    const exact = fakeEnv({ withdrawals: [], steps: [], earnSum: EARN_SUM });
    const accepted = await createWithdrawal(exact.env, { amountUsdc6: String(EARN_SUM), destination: 'reserve' });
    expect(accepted.ok).toBe(true);
  });

  it('refuses a second withdrawal while one is pending (one at a time), writing nothing', async () => {
    const { env, fix } = fakeEnv({ withdrawals: [wd({})], steps: [], earnSum: EARN_SUM });
    const out = await createWithdrawal(env, { amountUsdc6: '10000', destination: 'spend' });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(409);
      expect(out.reasons.join()).toContain('one at a time');
    }
    expect(fix.withdrawals).toHaveLength(1);
  });
});

describe('upsertWithdrawalStepIntent', () => {
  it('refuses a diverging amount with 409 and journals nothing (divergence guard)', async () => {
    const { env, fix } = fakeEnv({ withdrawals: [wd({})], steps: [], earnSum: EARN_SUM });
    const out = await upsertWithdrawalStepIntent(env, 'wd_seed000000000001', 'vault', '140000');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reasons.join()).toContain('differs from journaled withdrawal');
    expect(fix.steps).toHaveLength(0);
  });

  it('journals the exact amount, is idempotent, and records created_block once', async () => {
    const { env, fix } = fakeEnv({ withdrawals: [wd({})], steps: [], earnSum: EARN_SUM });
    const first = await upsertWithdrawalStepIntent(env, 'wd_seed000000000001', 'vault', '150000', '54200000');
    expect(first.ok).toBe(true);
    const again = await upsertWithdrawalStepIntent(env, 'wd_seed000000000001', 'vault', '150000', '54299999');
    expect(again.ok).toBe(true);
    expect(fix.steps).toHaveLength(1);
    expect(fix.withdrawals[0]!.created_block).toBe(54_200_000); // never overwritten
  });
});

describe('updateWithdrawalStep', () => {
  it("walks intent→sent→confirmed, refuses leaving 'confirmed', and requires a tx_hash to confirm", async () => {
    const { env } = fakeEnv({ withdrawals: [wd({})], steps: [stepRow({})], earnSum: EARN_SUM });
    const sent = await updateWithdrawalStep(env, 'wd_seed000000000001', 'vault', { status: 'sent', providerRef: 'uuid-1' });
    expect(sent.ok).toBe(true);
    const noTx = await updateWithdrawalStep(env, 'wd_seed000000000001', 'vault', { status: 'confirmed' });
    expect(noTx.ok).toBe(false);
    if (!noTx.ok) expect(noTx.reasons.join()).toContain('requires a tx_hash');
    const confirmed = await updateWithdrawalStep(env, 'wd_seed000000000001', 'vault', { status: 'confirmed', txHash: '0xaa' });
    expect(confirmed.ok).toBe(true);
    for (const status of ['sent', 'failed'] as const) {
      const out = await updateWithdrawalStep(env, 'wd_seed000000000001', 'vault', { status });
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.reasons.join()).toContain("'confirmed'");
    }
  });
});

describe('failWithdrawal — amendment A1', () => {
  it("refuses while a step is 'sent' (the exact reconcile-first window)", async () => {
    const { env, fix } = fakeEnv({
      withdrawals: [wd({})],
      steps: [stepRow({ status: 'sent', provider_ref: 'uuid-1' })],
      earnSum: EARN_SUM,
    });
    const out = await failWithdrawal(env, 'wd_seed000000000001', 'operator gave up');
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(409);
      expect(out.reasons.join()).toContain("step 'vault' is 'sent' — reconcile it before failing");
    }
    expect(fix.withdrawals[0]!.state).toBe('pending'); // untouched
  });

  it("refuses while a step is 'confirmed'", async () => {
    const { env, fix } = fakeEnv({
      withdrawals: [wd({})],
      steps: [stepRow({ status: 'confirmed', tx_hash: '0xaa' })],
      earnSum: EARN_SUM,
    });
    const out = await failWithdrawal(env, 'wd_seed000000000001', 'operator gave up');
    expect(out.ok).toBe(false);
    expect(fix.withdrawals[0]!.state).toBe('pending');
  });

  it("fails cleanly when no hop was dispatched (steps absent or 'intent'/step-'failed')", async () => {
    const { env, fix } = fakeEnv({
      withdrawals: [wd({})],
      steps: [stepRow({ status: 'failed' })],
      earnSum: EARN_SUM,
    });
    const out = await failWithdrawal(env, 'wd_seed000000000001', 'circle refused terminally');
    expect(out.ok).toBe(true);
    expect(fix.withdrawals[0]!.state).toBe('failed');
    expect(fix.withdrawals[0]!.fail_reason).toBe('circle refused terminally');
  });
});

function confirmedSteps(withdrawalId = 'wd_seed000000000001', amount = 150_000): WithdrawalStepRow[] {
  return [
    stepRow({ withdrawal_id: withdrawalId, step: 'vault', status: 'confirmed', tx_hash: '0xvault', amount_usdc6: amount }),
    stepRow({ withdrawal_id: withdrawalId, step: 'transfer', status: 'confirmed', tx_hash: '0xtransfer', amount_usdc6: amount }),
  ];
}

describe('completeWithdrawal', () => {
  it('refuses unless BOTH hops are confirmed with tx hashes, writing nothing', async () => {
    const { env, ledgerWrites } = fakeEnv({
      withdrawals: [wd({})],
      steps: [
        stepRow({ step: 'vault', status: 'confirmed', tx_hash: '0xvault' }),
        stepRow({ step: 'transfer', status: 'sent', provider_ref: 'uuid-2' }),
      ],
      earnSum: EARN_SUM,
    });
    const out = await completeWithdrawal(env, 'wd_seed000000000001', '150000');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reasons.join()).toContain("step 'transfer' is 'sent'");
    expect(ledgerWrites).toHaveLength(0);
  });

  it('refuses a diverging amount, writing nothing', async () => {
    const { env, ledgerWrites } = fakeEnv({ withdrawals: [wd({})], steps: confirmedSteps(), earnSum: EARN_SUM });
    const out = await completeWithdrawal(env, 'wd_seed000000000001', '140000');
    expect(out.ok).toBe(false);
    expect(ledgerWrites).toHaveLength(0);
  });

  it('writes exactly earn −X and spend +X (USDC), invoice_id NULL + withdrawal_id set (A2), per-hop tx hashes, state complete', async () => {
    const { env, fix, ledgerWrites } = fakeEnv({ withdrawals: [wd({})], steps: confirmedSteps(), earnSum: EARN_SUM });
    const out = await completeWithdrawal(env, 'wd_seed000000000001', '150000');
    expect(out.ok).toBe(true);
    expect(ledgerWrites).toEqual([
      { bucket: 'earn', delta6: '-150000', tx_hash: '0xvault', invoice_id: null, withdrawal_id: 'wd_seed000000000001' },
      { bucket: 'spend', delta6: '150000', tx_hash: '0xtransfer', invoice_id: null, withdrawal_id: 'wd_seed000000000001' },
    ]);
    expect(fix.withdrawals[0]!.state).toBe('complete');
    // conservation: the two deltas cancel exactly (band = 0)
    expect(BigInt(ledgerWrites[0]!.delta6) + BigInt(ledgerWrites[1]!.delta6)).toBe(0n);
  });

  it('routes the credit to reserve when that is the journaled destination', async () => {
    const { env, ledgerWrites } = fakeEnv({
      withdrawals: [wd({ destination: 'reserve' })],
      steps: confirmedSteps(),
      earnSum: EARN_SUM,
    });
    const out = await completeWithdrawal(env, 'wd_seed000000000001', '150000');
    expect(out.ok).toBe(true);
    expect(ledgerWrites[1]!.bucket).toBe('reserve');
  });

  it('is idempotent: a re-post after completion returns ok without new ledger rows', async () => {
    const { env, ledgerWrites } = fakeEnv({ withdrawals: [wd({})], steps: confirmedSteps(), earnSum: EARN_SUM });
    await completeWithdrawal(env, 'wd_seed000000000001', '150000');
    const again = await completeWithdrawal(env, 'wd_seed000000000001', '150000');
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.idempotent).toBe(true);
    expect(ledgerWrites).toHaveLength(2);
  });

  it('guards every ledger INSERT with an in-statement state=pending re-check (race protection)', async () => {
    const { env, sqlLog } = fakeEnv({ withdrawals: [wd({})], steps: confirmedSteps(), earnSum: EARN_SUM });
    await completeWithdrawal(env, 'wd_seed000000000001', '150000');
    const inserts = sqlLog.filter((s) => s.startsWith('INSERT INTO ledger'));
    expect(inserts).toHaveLength(2);
    for (const s of inserts) expect(s).toContain("state = 'pending'");
  });
});

describe('ledger provenance — amendment A2, invoice side', () => {
  it('completeInvoice never names withdrawal_id: invoice rows keep it NULL by omission', async () => {
    const batched: string[] = [];
    const env = {
      DB: {
        prepare(sql: string) {
          const stmt = {
            sql,
            bind: (..._args: unknown[]) => stmt,
            first: async () => ({ status: 'routing' }),
            all: async () => ({ results: [] }),
            run: async () => ({ meta: { changes: 1 } }),
          };
          return stmt;
        },
        batch: async (stmts: Array<{ sql: string }>) => {
          for (const st of stmts) batched.push(st.sql.replace(/\s+/g, ' '));
          return stmts.map(() => ({ meta: { changes: 1 } }));
        },
      },
    } as unknown as Env;
    const ok = await completeInvoice(env, 'inv_a1', [{ bucket: 'earn', token: 'USDC', delta6: '150000', txHash: '0xdep' }]);
    expect(ok).toBe(true);
    const ledgerInserts = batched.filter((s) => s.includes('INSERT INTO ledger'));
    expect(ledgerInserts.length).toBeGreaterThan(0);
    for (const s of ledgerInserts) {
      expect(s).toContain('invoice_id');
      expect(s).not.toContain('withdrawal_id');
    }
  });
});
