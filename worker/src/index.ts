import { asUsdc6, format6, parseDecimalToUsdc6, validateSplitPercents, type Usdc6 } from '@affluents/shared';
import { Hono } from 'hono';
import { renderSVG } from 'uqr';
import {
  applyVerification,
  completeInvoice,
  createInvoice,
  getDashboardData,
  getExecutions,
  getInvoice,
  getSplitRule,
  payStateOf,
  pullWork,
  registerWallets,
  reportPayment,
  setSplitRule,
  updateExecution,
  upsertExecutionIntent,
  type ExecutionRow,
  type LedgerEntryInput,
  type TxResult,
} from './db';
import { FAVICON_SVG } from './html';
import { createPage } from './pages/create';
import { dashboardPage } from './pages/dashboard';
import { landingPage } from './pages/landing';
import { payPage } from './pages/pay';
import type { Env, InvoiceRow } from './types';

const app = new Hono<{ Bindings: Env }>();

const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8' };

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i]! ^ bb[i]!;
  return diff === 0;
}

function u6(n: number): Usdc6 {
  return asUsdc6(BigInt(n));
}

/** EIP-681 payment request URI for the manual-payment QR. */
function depositUri(env: Env, depositAddress: string, amountUsdc6: bigint): string {
  return `ethereum:${env.USDC_ADDRESS}@${env.ARC_CHAIN_ID}/transfer?address=${depositAddress}&uint256=${amountUsdc6}`;
}

/** Routed summary for the paid state, built from confirmed executions. */
function routingOf(env: Env, execs: ExecutionRow[]) {
  const by = (step: string) => execs.find((e) => e.step === step && e.status === 'confirmed');
  const fx = by('fx');
  const reserve = by('reserve');
  const earn = by('earn');
  if (!fx || !reserve || !earn) return null;
  const txUrl = (h: string | null) => (h ? `${env.ARC_EXPLORER}/tx/${h}` : null);
  return {
    spendInFormatted: format6(asUsdc6(BigInt(fx.amount_usdc6 ?? 0))),
    spendOutFormatted: format6(asUsdc6(BigInt(fx.amount_out6 ?? 0))),
    spendOutToken: fx.output_token ?? 'EURC',
    fxNote: env.FX_ADAPTER === 'treasury' ? 'demo rate' : null,
    reserveFormatted: format6(asUsdc6(BigInt(reserve.amount_usdc6 ?? 0))),
    earnFormatted: format6(asUsdc6(BigInt(earn.amount_usdc6 ?? 0))),
    spendTxUrl: txUrl(fx.tx_hash),
    reserveTxUrl: txUrl(reserve.tx_hash),
    earnTxUrl: txUrl(earn.tx_hash),
  };
}

function invoiceJson(env: Env, inv: InvoiceRow, origin: string) {
  const amount = u6(inv.amount_usdc6);
  const received = u6(inv.received_usdc6);
  const remaining = asUsdc6(amount > received ? amount - received : 0n);
  const extra = u6(inv.overpaid_usdc6);
  const state = payStateOf(inv);
  return {
    id: inv.id,
    displayNo: inv.display_no,
    label: inv.label,
    memo: inv.memo,
    status: inv.status,
    state,
    amountUsdc6: amount.toString(),
    amountFormatted: format6(amount),
    receivedUsdc6: received.toString(),
    receivedFormatted: format6(received),
    remainingUsdc6: remaining.toString(),
    remainingFormatted: format6(remaining),
    receivedPct: amount > 0n ? Number((received * 100n) / amount) : 0,
    extraHeld: inv.overpaid === 1 || inv.unexpected_payment === 1,
    extraFormatted: format6(extra),
    depositAddress: inv.deposit_address ?? null,
    explorerAddressUrl: inv.deposit_address ? `${env.ARC_EXPLORER}/address/${inv.deposit_address}` : null,
    paymentTxs: (JSON.parse(inv.paid_txs) as Array<{ txHash: string; status?: string }>)
      .filter((t) => t.status === 'verified')
      .map((t) => ({ txHash: t.txHash, url: `${env.ARC_EXPLORER}/tx/${t.txHash}` })),
    payUrl: `${origin}/pay/${inv.id}`,
    routing: null as null | ReturnType<typeof routingOf>,
  };
}

// ---- pages ----

app.get('/', (c) => c.body(landingPage(), 200, HTML_HEADERS));
app.get('/create', (c) => c.body(createPage(), 200, HTML_HEADERS));

app.get('/favicon.svg', (c) => c.body(FAVICON_SVG, 200, { 'Content-Type': 'image/svg+xml' }));
app.get('/favicon.ico', (c) => c.body(FAVICON_SVG, 200, { 'Content-Type': 'image/svg+xml' }));

app.get('/pay/:id', async (c) => {
  const inv = await getInvoice(c.env, c.req.param('id'));
  if (!inv) return c.body('Invoice not found', 404);
  const state = payStateOf(inv);
  const extraHeld = inv.overpaid === 1 || inv.unexpected_payment === 1;
  return c.body(
    payPage({
      id: inv.id,
      displayNo: inv.display_no,
      label: inv.label,
      memo: inv.memo,
      amountFormatted: format6(u6(inv.amount_usdc6)),
      state: state === 'paid' && extraHeld ? 'overpaid' : state,
      depositAddress: inv.deposit_address ?? null,
      depositQrSvg: inv.deposit_address
        ? renderSVG(depositUri(c.env, inv.deposit_address, BigInt(inv.amount_usdc6) - BigInt(inv.received_usdc6)), { border: 1 })
        : null,
      usdcAddress: c.env.USDC_ADDRESS,
      chainIdHex: '0x' + Number(c.env.ARC_CHAIN_ID).toString(16),
      explorer: c.env.ARC_EXPLORER,
    }),
    200,
    HTML_HEADERS,
  );
});

app.get('/dashboard/:secret', async (c) => {
  if (!timingSafeEqual(c.req.param('secret'), c.env.DASHBOARD_SECRET)) return c.body('Not found', 404);
  const data = await getDashboardData(c.env);
  return c.body(dashboardPage(data, c.req.param('secret'), c.env.ARC_EXPLORER, new Date(), c.env.FX_ADAPTER), 200, HTML_HEADERS);
});

app.post('/dashboard/:secret/rule', async (c) => {
  if (!timingSafeEqual(c.req.param('secret'), c.env.DASHBOARD_SECRET)) return c.body('Not found', 404);
  const body = await c.req.json<{ spendPct: number; reservePct: number; earnPct: number }>();
  try {
    validateSplitPercents(body);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
  await setSplitRule(c.env, body.spendPct, body.reservePct, body.earnPct);
  return c.json({ ok: true });
});

// ---- public JSON API ----

app.get('/api/health', async (c) => {
  const rule = await getSplitRule(c.env);
  return c.json({ ok: true, service: 'affluents-worker', rule });
});

app.post('/api/invoices', async (c) => {
  let body: { amount?: string; label?: string; memo?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }
  let amountUsdc6: bigint;
  try {
    amountUsdc6 = parseDecimalToUsdc6(String(body.amount ?? ''));
  } catch {
    return c.json({ error: 'Enter a valid USDC amount (up to 6 decimals).' }, 400);
  }
  if (amountUsdc6 <= 0n) return c.json({ error: 'Amount must be greater than zero.' }, 400);
  const label = (body.label ?? '').trim().slice(0, 80) || 'Client';
  const memo = (body.memo ?? '').trim().slice(0, 200) || null;
  const inv = await createInvoice(c.env, amountUsdc6, label, memo);
  return c.json(invoiceJson(c.env, inv, new URL(c.req.url).origin), 201);
});

app.get('/api/invoices/:id', async (c) => {
  const inv = await getInvoice(c.env, c.req.param('id'));
  if (!inv) return c.json({ error: 'not found' }, 404);
  const json = invoiceJson(c.env, inv, new URL(c.req.url).origin);
  if (inv.status === 'routing' || inv.status === 'completed') {
    json.routing = routingOf(c.env, await getExecutions(c.env, inv.id));
  }
  return c.json(json);
});

/** QR SVG for the payment link (create-page success card). */
app.get('/api/invoices/:id/qr', async (c) => {
  const inv = await getInvoice(c.env, c.req.param('id'));
  if (!inv) return c.body('not found', 404);
  const url = `${new URL(c.req.url).origin}/pay/${inv.id}`;
  return c.body(renderSVG(url, { border: 1 }), 200, { 'Content-Type': 'image/svg+xml' });
});

app.post('/api/invoices/:id/payment-report', async (c) => {
  let body: { txHash?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }
  const txHash = String(body.txHash ?? '');
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return c.json({ error: 'invalid txHash' }, 400);
  const accepted = await reportPayment(c.env, c.req.param('id'), txHash);
  return c.json({ ok: true, accepted });
});

// ---- internal API (orchestrator only; X-Internal-Key shared secret) ----

const internal = new Hono<{ Bindings: Env }>();

internal.use('*', async (c, next) => {
  const key = c.req.header('X-Internal-Key') ?? '';
  if (!c.env.INTERNAL_API_KEY || !timingSafeEqual(key, c.env.INTERNAL_API_KEY)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
});

internal.get('/ping', (c) => c.json({ ok: true, time: new Date().toISOString() }));

internal.get('/work', async (c) => c.json(await pullWork(c.env)));

internal.post('/wallets', async (c) => {
  const body = await c.req.json<{ wallets: Array<{ address: string; circleWalletId?: string; baselineUsdc6?: string; bufferNative18?: string }> }>();
  if (!Array.isArray(body.wallets) || body.wallets.length === 0) {
    return c.json({ error: 'wallets array required' }, 400);
  }
  for (const w of body.wallets) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(w.address)) return c.json({ error: `invalid address: ${w.address}` }, 400);
  }
  const ids = await registerWallets(c.env, body.wallets);
  return c.json({ ok: true, ids }, 201);
});

/** Journal an execution intent (idempotent); returns the current row. */
internal.post('/executions', async (c) => {
  const b = await c.req.json<{ id: string; invoiceId: string; step: string; amountUsdc6: string }>();
  if (!b.id || !b.invoiceId || !b.step || !/^\d+$/.test(String(b.amountUsdc6))) {
    return c.json({ error: 'id, invoiceId, step, integer amountUsdc6 required' }, 400);
  }
  return c.json(await upsertExecutionIntent(c.env, b.id, b.invoiceId, b.step, b.amountUsdc6));
});

internal.post('/executions/update', async (c) => {
  const b = await c.req.json<{ id: string } & Parameters<typeof updateExecution>[2]>();
  if (!b.id) return c.json({ error: 'id required' }, 400);
  await updateExecution(c.env, b.id, b);
  return c.json({ ok: true });
});

internal.get('/executions/:invoiceId', async (c) => c.json(await getExecutions(c.env, c.req.param('invoiceId'))));

/** Atomic completion: ledger deltas + invoice completed + wallet retired. */
internal.post('/invoices/:id/complete', async (c) => {
  const b = await c.req.json<{ entries: LedgerEntryInput[] }>();
  if (!Array.isArray(b.entries) || b.entries.length === 0) return c.json({ error: 'entries required' }, 400);
  for (const e of b.entries) {
    if (!/^-?\d+$/.test(String(e.delta6))) return c.json({ error: 'integer delta6 required' }, 400);
  }
  const applied = await completeInvoice(c.env, c.req.param('id'), b.entries);
  return c.json({ ok: true, applied });
});

/** Orchestrator posts a verification pass: authoritative balance + tx audit. */
internal.post('/verifications', async (c) => {
  const body = await c.req.json<{ invoiceId: string; balanceUsdc6: string; txResults?: TxResult[] }>();
  if (!body.invoiceId || !/^\d+$/.test(String(body.balanceUsdc6))) {
    return c.json({ error: 'invoiceId and integer balanceUsdc6 required' }, 400);
  }
  const res = await applyVerification(c.env, body.invoiceId, BigInt(body.balanceUsdc6), body.txResults ?? []);
  if (!res) return c.json({ error: 'invoice not found' }, 404);
  return c.json({ ok: true, ...res });
});

/**
 * Removes ONLY concurrency-test artifacts (test/claim-concurrency.mjs):
 * invoices labeled by the test and the exact wallet addresses it seeded.
 */
internal.post('/test-cleanup', async (c) => {
  const body = await c.req.json<{ addresses?: string[] }>().catch(() => ({ addresses: [] as string[] }));
  const addresses = (body.addresses ?? []).filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
  const stmts = [
    c.env.DB.prepare(`DELETE FROM invoices WHERE label LIKE 'concurrency-test-%'`),
  ];
  for (const addr of addresses) {
    stmts.push(c.env.DB.prepare(`DELETE FROM deposit_wallets WHERE address = ?1`).bind(addr));
  }
  const res = await c.env.DB.batch(stmts);
  return c.json({ ok: true, deleted: res.reduce((t, r) => t + r.meta.changes, 0) });
});

app.route('/api/internal', internal);

export default app;
