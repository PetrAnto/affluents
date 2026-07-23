import type { Env, InvoiceRow, PayState, SplitRuleRow, WalletRow } from './types';

function randomId(prefix: string): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`;
}

/**
 * Atomically create an invoice and claim one free wallet (SPEC §3.1).
 * The whole batch is one D1 transaction; the wallet-claim UPDATE is a single
 * statement whose WHERE re-checks status='free', so two concurrent creations
 * can never claim the same wallet (proven by test/claim-concurrency.mjs).
 */
export async function createInvoice(
  env: Env,
  amountUsdc6: bigint,
  label: string,
  memo: string | null,
): Promise<InvoiceRow> {
  const id = randomId('inv');
  await env.DB.batch([
    env.DB.prepare(`UPDATE counters SET value = value + 1 WHERE name = 'invoice_display'`),
    env.DB.prepare(
      `INSERT INTO invoices (id, display_no, amount_usdc6, label, memo, status)
       VALUES (?1, printf('2026-%03d', (SELECT value FROM counters WHERE name = 'invoice_display')), ?2, ?3, ?4, 'created')`,
    ).bind(id, amountUsdc6.toString(), label, memo),
    env.DB.prepare(
      `UPDATE deposit_wallets SET status = 'assigned', invoice_id = ?1
       WHERE id = (SELECT id FROM deposit_wallets WHERE status = 'free' ORDER BY created_at, id LIMIT 1)
         AND status = 'free'`,
    ).bind(id),
    env.DB.prepare(
      `UPDATE invoices SET
         wallet_id = (SELECT id FROM deposit_wallets WHERE invoice_id = ?1),
         status = CASE
           WHEN EXISTS (SELECT 1 FROM deposit_wallets WHERE invoice_id = ?1) THEN 'awaiting_payment'
           ELSE 'awaiting_wallet'
         END
       WHERE id = ?1`,
    ).bind(id),
  ]);
  const row = await getInvoice(env, id);
  if (!row) throw new Error('invoice insert did not persist');
  return row;
}

export async function getInvoice(env: Env, id: string): Promise<InvoiceRow | null> {
  return await env.DB.prepare(
    `SELECT i.*, w.address AS deposit_address
     FROM invoices i LEFT JOIN deposit_wallets w ON w.id = i.wallet_id
     WHERE i.id = ?1`,
  )
    .bind(id)
    .first<InvoiceRow>();
}

/** Client reported a wallet-button payment (txHash). Idempotent. */
export async function reportPayment(env: Env, invoiceId: string, txHash: string): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE invoices SET
       status = CASE WHEN status = 'awaiting_payment' THEN 'payment_reported' ELSE status END,
       paid_txs = CASE
         WHEN paid_txs LIKE '%' || ?2 || '%' THEN paid_txs
         ELSE json_insert(paid_txs, '$[#]', json_object('txHash', ?2, 'source', 'reported'))
       END
     WHERE id = ?1 AND status IN ('awaiting_payment', 'payment_reported')`,
  )
    .bind(invoiceId, txHash)
    .run();
  return res.meta.changes > 0;
}

export function payStateOf(inv: InvoiceRow): PayState {
  switch (inv.status) {
    // Payment is verified the moment the funds are confirmed — that is
    // "Paid ✓" for the payer. Routing is the recipient's pipeline; the
    // routed summary rows appear on the paid state once available.
    case 'payment_verified':
    case 'routing':
    case 'completed':
      return 'paid';
    case 'payment_reported':
      return 'verifying';
    default:
      return inv.received_usdc6 > 0 ? 'partial' : 'awaiting';
  }
}

export async function getSplitRule(env: Env): Promise<SplitRuleRow> {
  const row = await env.DB.prepare(`SELECT spend_pct, reserve_pct, earn_pct, updated_at FROM split_rules WHERE id = 1`).first<SplitRuleRow>();
  if (!row) throw new Error('split rule row missing');
  return row;
}

export async function setSplitRule(env: Env, spend: number, reserve: number, earn: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE split_rules SET spend_pct = ?1, reserve_pct = ?2, earn_pct = ?3,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1`,
  )
    .bind(spend, reserve, earn)
    .run();
}

export interface BucketTotals {
  spendEurc6: bigint;
  spendInUsdc6: bigint;
  reserveUsdc6: bigint;
  earnUsdc6: bigint;
  exceptionUsdc6: bigint;
  totalReceivedUsdc6: bigint;
}

export async function getDashboardData(env: Env) {
  const [sums, invoices, rule, exceptions] = await Promise.all([
    env.DB.prepare(
      `SELECT bucket, token, SUM(delta6) AS total FROM ledger GROUP BY bucket, token`,
    ).all<{ bucket: string; token: string; total: number }>(),
    env.DB.prepare(
      `SELECT i.*, w.address AS deposit_address
       FROM invoices i LEFT JOIN deposit_wallets w ON w.id = i.wallet_id
       ORDER BY i.created_at DESC LIMIT 50`,
    ).all<InvoiceRow>(),
    getSplitRule(env),
    // Exceptions come from the invoice flags — the source of truth from the
    // moment of verification. (The exception_hold ledger row lands at sweep
    // time in Phase 3; flags must surface immediately, never silently.)
    env.DB.prepare(
      `SELECT i.overpaid_usdc6 AS delta6, i.display_no, i.label, i.id AS invoice_id,
              i.unexpected_payment, w.address AS deposit_address
       FROM invoices i LEFT JOIN deposit_wallets w ON w.id = i.wallet_id
       WHERE (i.overpaid = 1 OR i.unexpected_payment = 1) AND i.overpaid_usdc6 > 0
       ORDER BY i.created_at DESC LIMIT 20`,
    ).all<{ delta6: number; display_no: string | null; label: string | null; invoice_id: string | null; unexpected_payment: number | null; deposit_address: string | null }>(),
  ]);

  const totals: BucketTotals = {
    spendEurc6: 0n,
    spendInUsdc6: 0n,
    reserveUsdc6: 0n,
    earnUsdc6: 0n,
    exceptionUsdc6: 0n,
    totalReceivedUsdc6: 0n,
  };
  for (const r of sums.results) {
    const v = BigInt(r.total);
    if (r.bucket === 'spend' && r.token === 'EURC') totals.spendEurc6 += v;
    if (r.bucket === 'spend' && r.token === 'USDC') totals.spendInUsdc6 += v;
    if (r.bucket === 'reserve' && r.token === 'USDC') totals.reserveUsdc6 += v;
    if (r.bucket === 'earn' && r.token === 'USDC') totals.earnUsdc6 += v;
    if (r.bucket === 'exception_hold' && r.token === 'USDC') totals.exceptionUsdc6 += v;
  }
  const recv = await env.DB.prepare(`SELECT COALESCE(SUM(received_usdc6), 0) AS t FROM invoices`).first<{ t: number }>();
  totals.totalReceivedUsdc6 = BigInt(recv?.t ?? 0);

  return { totals, invoices: invoices.results, rule, exceptions: exceptions.results };
}

// ---- execution journal + completion (orchestrator only) ----

export interface ExecutionRow {
  id: string;
  invoice_id: string;
  step: string;
  status: 'intent' | 'sent' | 'confirmed' | 'failed';
  tx_hash: string | null;
  amount_usdc6: number | null;
  amount_out6: number | null;
  output_token: string | null;
  provider_ref: string | null;
  attempt_count: number;
}

/**
 * Journal an intent BEFORE any send (SPEC §3.2). Idempotent per execution id:
 * an existing row is returned untouched so a restarted orchestrator sees what
 * was already in flight and reconciles instead of re-sending.
 */
export async function upsertExecutionIntent(
  env: Env,
  id: string,
  invoiceId: string,
  step: string,
  amountUsdc6: string,
): Promise<ExecutionRow> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO executions (id, invoice_id, step, status, amount_usdc6) VALUES (?1, ?2, ?3, 'intent', ?4)`,
    ).bind(id, invoiceId, step, amountUsdc6),
    // First pipeline step moves the invoice into 'routing'.
    env.DB.prepare(`UPDATE invoices SET status = 'routing' WHERE id = ?1 AND status = 'payment_verified'`).bind(invoiceId),
  ]);
  const row = await env.DB.prepare(`SELECT * FROM executions WHERE id = ?1`).bind(id).first<ExecutionRow>();
  if (!row) throw new Error('execution row missing after insert');
  return row;
}

export async function updateExecution(
  env: Env,
  id: string,
  patch: { status?: string; txHash?: string; providerRef?: string; amountOut6?: string; outputToken?: string; bumpAttempt?: boolean },
): Promise<void> {
  await env.DB.prepare(
    `UPDATE executions SET
       status = COALESCE(?2, status),
       tx_hash = COALESCE(?3, tx_hash),
       provider_ref = COALESCE(?4, provider_ref),
       amount_out6 = COALESCE(?5, amount_out6),
       output_token = COALESCE(?6, output_token),
       attempt_count = attempt_count + ?7,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?1`,
  )
    .bind(id, patch.status ?? null, patch.txHash ?? null, patch.providerRef ?? null, patch.amountOut6 ?? null, patch.outputToken ?? null, patch.bumpAttempt ? 1 : 0)
    .run();
}

export async function getExecutions(env: Env, invoiceId: string): Promise<ExecutionRow[]> {
  const res = await env.DB.prepare(`SELECT * FROM executions WHERE invoice_id = ?1 ORDER BY created_at`).bind(invoiceId).all<ExecutionRow>();
  return res.results;
}

export interface LedgerEntryInput {
  bucket: 'spend' | 'reserve' | 'earn' | 'ops' | 'exception_hold';
  token: 'USDC' | 'EURC';
  delta6: string;
  txHash?: string;
}

/**
 * Atomic completion: post all ledger deltas, mark the invoice completed and
 * retire its wallet in ONE D1 transaction — and only if the invoice is not
 * already completed, so a re-run cannot double-post the ledger.
 */
export async function completeInvoice(env: Env, invoiceId: string, entries: LedgerEntryInput[]): Promise<boolean> {
  const inv = await env.DB.prepare(`SELECT status FROM invoices WHERE id = ?1`).bind(invoiceId).first<{ status: string }>();
  if (!inv) throw new Error('invoice not found');
  if (inv.status === 'completed') return false; // idempotent no-op
  const stmts = entries.map((e) =>
    env.DB.prepare(`INSERT INTO ledger (bucket, token, delta6, tx_hash, invoice_id) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(
      e.bucket,
      e.token,
      e.delta6,
      e.txHash ?? null,
      invoiceId,
    ),
  );
  stmts.push(
    env.DB.prepare(`UPDATE invoices SET status = 'completed' WHERE id = ?1 AND status != 'completed'`).bind(invoiceId),
    env.DB.prepare(`UPDATE deposit_wallets SET status = 'retired' WHERE invoice_id = ?1`).bind(invoiceId),
  );
  await env.DB.batch(stmts);
  return true;
}

// ---- internal API (orchestrator only) ----

export interface RegisterWalletInput {
  address: string;
  circleWalletId?: string;
  baselineUsdc6?: string;
  bufferNative18?: string;
}

export async function registerWallets(env: Env, wallets: RegisterWalletInput[]): Promise<string[]> {
  const ids: string[] = [];
  const stmts = wallets.map((w) => {
    const id = randomId('dw');
    ids.push(id);
    // OR IGNORE: registration is idempotent by address, so a crashed setup
    // run can safely re-register the same Circle wallets.
    return env.DB.prepare(
      `INSERT OR IGNORE INTO deposit_wallets (id, address, circle_wallet_id, baseline_usdc6, buffer_native18)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    ).bind(id, w.address, w.circleWalletId ?? null, w.baselineUsdc6 ?? '0', w.bufferNative18 ?? '0');
  });
  if (stmts.length > 0) await env.DB.batch(stmts);
  return ids;
}

/** Work the orchestrator polls for: reported payments to verify, wallets to watch. */
export async function pullWork(env: Env) {
  const [reported, watching, freeCount, rule] = await Promise.all([
    env.DB.prepare(
      `SELECT i.id, i.amount_usdc6, i.received_usdc6, i.paid_txs, i.status, w.address AS deposit_address,
              w.baseline_usdc6, w.id AS wallet_id, w.circle_wallet_id
       FROM invoices i JOIN deposit_wallets w ON w.id = i.wallet_id
       WHERE i.status = 'payment_reported'`,
    ).all(),
    // payment_verified/routing stay watched until the pipeline completes them;
    // the audit-trail scan can still attach funding txs found after credit.
    env.DB.prepare(
      `SELECT i.id, i.amount_usdc6, i.received_usdc6, i.overpaid_usdc6, i.paid_txs, i.status,
              w.address AS deposit_address, w.baseline_usdc6, w.id AS wallet_id, w.circle_wallet_id
       FROM invoices i JOIN deposit_wallets w ON w.id = i.wallet_id
       WHERE i.status IN ('awaiting_payment', 'payment_verified', 'routing')`,
    ).all(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM deposit_wallets WHERE status = 'free'`).first<{ n: number }>(),
    getSplitRule(env),
  ]);
  return {
    reported: reported.results,
    watching: watching.results,
    freeWallets: freeCount?.n ?? 0,
    rule: { spendPct: rule.spend_pct, reservePct: rule.reserve_pct, earnPct: rule.earn_pct },
  };
}

export interface TxResult {
  txHash: string;
  source: 'reported' | 'observed';
  result: 'verified' | 'invalid' | 'pending';
  branch?: string;
  amountUsdc6?: string;
  dustNative18?: string;
  attempts?: number;
}

interface PaidTxEntry {
  txHash: string;
  source: string;
  status?: string;
  branch?: string;
  amountUsdc6?: string;
  dustNative18?: string;
  attempts?: number;
}

/**
 * Apply an orchestrator verification pass (SPEC §5b–§5c).
 * The 6-dec balance DELTA ABOVE BASELINE is the authoritative credit — it
 * aggregates partials and catches both ERC-20 and native payments; verified
 * tx records are the audit trail. Overpayment is flagged, never auto-routed.
 */
export async function applyVerification(
  env: Env,
  invoiceId: string,
  balanceUsdc6: bigint,
  txResults: TxResult[],
): Promise<{ status: string; receivedUsdc6: string } | null> {
  const inv = await env.DB.prepare(
    `SELECT i.*, w.baseline_usdc6 FROM invoices i JOIN deposit_wallets w ON w.id = i.wallet_id WHERE i.id = ?1`,
  )
    .bind(invoiceId)
    .first<InvoiceRow & { baseline_usdc6: number }>();
  if (!inv) return null;

  // Merge tx results into the stored audit trail (dedupe by txHash).
  const entries: PaidTxEntry[] = JSON.parse(inv.paid_txs);
  for (const r of txResults) {
    const existing = entries.find((e) => e.txHash === r.txHash);
    const patch: PaidTxEntry = {
      txHash: r.txHash,
      source: (existing?.source as 'reported' | 'observed' | undefined) ?? r.source,
      status: r.result,
      branch: r.branch,
      amountUsdc6: r.amountUsdc6,
      dustNative18: r.dustNative18,
      attempts: r.attempts,
    };
    if (existing) Object.assign(existing, patch);
    else entries.push(patch);
  }

  const amount = BigInt(inv.amount_usdc6);
  const baseline = BigInt(inv.baseline_usdc6);
  const delta = balanceUsdc6 > baseline ? balanceUsdc6 - baseline : 0n;

  /**
   * CREDIT IS MONOTONIC — it must never decrease (SPEC §5b).
   *
   * `delta` is derived from the wallet's CURRENT balance, but that balance is
   * legitimately drained to 0 once the sweep moves the payment to treasury.
   * Writing `delta` unconditionally therefore erased the credited amount of any
   * invoice still being watched (`routing`/`payment_verified`), and the pipeline
   * — which derives `routed` from `received_usdc6` — then re-ran the remaining
   * steps with routed=0. Credit is a recorded fact about a payment that
   * happened, not a function of the wallet's present balance, so a verification
   * pass may only ever RAISE it.
   *
   * Same reasoning for the overpayment: a flagged exception must not be wiped by
   * a later sweep, so both the amount and the flag are sticky.
   */
  const storedReceived = BigInt(inv.received_usdc6);
  const credited = delta > storedReceived ? delta : storedReceived;
  const storedOverpaid = BigInt(inv.overpaid_usdc6);
  const computedOverpaid = credited > amount ? credited - amount : 0n;
  const overpaid = computedOverpaid > storedOverpaid ? computedOverpaid : storedOverpaid;

  const anyPending = entries.some((e) => e.status === 'pending' || e.status === undefined);

  let status = inv.status;
  let unexpected = inv.unexpected_payment;
  if (inv.status === 'awaiting_payment' || inv.status === 'payment_reported') {
    if (credited >= amount) status = 'payment_verified';
    else if (credited > 0n) status = 'awaiting_payment';
    else status = anyPending ? 'payment_reported' : 'awaiting_payment';
  } else if (
    (inv.status === 'completed' || inv.status === 'routing' || inv.status === 'payment_verified') &&
    delta > storedReceived
  ) {
    // Post-verification funds: never silently absorbed (SPEC §5c).
    // KNOWN GAP: once the sweep has emptied the wallet this only catches a
    // top-up LARGER than the original credit, because `delta` restarts from 0
    // while the credit stays at its high-water mark. Closing it properly needs a
    // `swept_usdc6` column so the expected balance is `credited - swept`;
    // deliberately not built here (see PROGRESS.md 2026-07-23).
    unexpected = 1;
  }

  await env.DB.prepare(
    `UPDATE invoices SET
       received_usdc6 = ?2, overpaid_usdc6 = ?3, overpaid = ?4, unexpected_payment = ?5,
       status = ?6, paid_txs = ?7,
       paid_at = CASE WHEN ?6 IN ('payment_verified', 'routing', 'completed')
                      THEN COALESCE(paid_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                      ELSE paid_at END
     WHERE id = ?1`,
  )
    .bind(
      invoiceId,
      credited.toString(),
      overpaid.toString(),
      overpaid > 0n || inv.overpaid ? 1 : 0,
      unexpected,
      status,
      JSON.stringify(entries),
    )
    .run();
  return { status, receivedUsdc6: credited.toString() };
}
