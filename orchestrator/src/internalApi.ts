import { config } from './config';

/**
 * All application state flows through the Worker's authenticated internal
 * API — the orchestrator never touches D1 directly (intentional design,
 * SPEC §3.1). Outbound HTTPS only; this process listens on no port.
 */
async function callRaw(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
  return await fetch(`${config.workerBaseUrl}/api/internal${path}`, {
    method,
    headers: {
      'X-Internal-Key': config.internalApiKey,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await callRaw(method, path, body);
  if (!res.ok) {
    throw new Error(`internal API ${method} ${path} → ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export function ping(): Promise<{ ok: boolean; time: string }> {
  return call('GET', '/ping');
}

export interface WorkItem {
  id: string;
  amount_usdc6: number;
  received_usdc6: number;
  overpaid_usdc6?: number;
  status: string;
  deposit_address: string;
  baseline_usdc6: number;
  wallet_id: string;
  circle_wallet_id: string | null;
  paid_txs: string;
}

export interface Work {
  reported: WorkItem[];
  watching: WorkItem[];
  freeWallets: number;
  rule: { spendPct: number; reservePct: number; earnPct: number };
}

export function pullWork(): Promise<Work> {
  return call('GET', '/work');
}

export interface TxResultPayload {
  txHash: string;
  source: 'reported' | 'observed';
  result: 'verified' | 'invalid' | 'pending';
  branch?: string;
  amountUsdc6?: string;
  dustNative18?: string;
  attempts?: number;
}

export function postVerification(
  invoiceId: string,
  balanceUsdc6: string,
  txResults: TxResultPayload[],
): Promise<{ ok: boolean; status: string; receivedUsdc6: string }> {
  return call('POST', '/verifications', { invoiceId, balanceUsdc6, txResults });
}

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

export function journalIntent(id: string, invoiceId: string, step: string, amountUsdc6: string): Promise<ExecutionRow> {
  return call('POST', '/executions', { id, invoiceId, step, amountUsdc6 });
}

export function journalUpdate(
  id: string,
  patch: { status?: string; txHash?: string; providerRef?: string; amountOut6?: string; outputToken?: string; bumpAttempt?: boolean },
): Promise<{ ok: boolean }> {
  return call('POST', '/executions/update', { id, ...patch });
}

export interface LedgerEntryPayload {
  bucket: 'spend' | 'reserve' | 'earn' | 'ops' | 'exception_hold';
  token: 'USDC' | 'EURC';
  delta6: string;
  txHash?: string;
}

export function completeInvoice(invoiceId: string, entries: LedgerEntryPayload[]): Promise<{ ok: boolean; applied: boolean }> {
  return call('POST', `/invoices/${invoiceId}/complete`, { entries });
}

// ---- FX journal (live App Kit FX; guards are server-side in the Worker) ----

export interface FxIntentRow {
  id: string;
  invoice_id: string;
  amount_in_usdc6: number;
  estimated_out_eurc6: number;
  stop_limit_eurc6: number;
  tolerance_bps: number;
  rate_source: 'appkit' | 'demo';
  oracle_rate_ppm: number | null;
  oracle_deviation_bps: number | null;
  estimated_at: string;
  estimated_block: number | null;
  pre_swap_eurc6: number | null;
  state: 'pending' | 'complete' | 'halted';
}

export interface FxAttemptRow {
  attempt_no: number;
  tolerance_bps: number;
  estimated_out_eurc6: number;
  stop_limit_eurc6: number;
  outcome: 'dispatched' | 'success' | 'stop_limit_not_met' | 'error';
  error_code: string | null;
}

export interface FxResultRow {
  intent_id: string;
  amount_out_eurc6: number;
  tx_hash: string;
  fees_usdc6: number;
  discovered_by: 'swap' | 'reconciliation';
  completed_at: string;
}

export interface FxIntentState {
  intent: FxIntentRow;
  attempts: FxAttemptRow[];
  result: FxResultRow | null;
}

export interface FxIntentPayload {
  id: string;
  invoiceId: string;
  amountInUsdc6: string;
  estimatedOutEurc6: string;
  stopLimitEurc6: string;
  toleranceBps: number;
  rateSource: 'appkit' | 'demo';
  oracleRatePpm?: string | null;
  oracleDeviationBps?: number | null;
  estimatedAt: string;
  estimatedBlock?: string | null;
  preSwapEurc6?: string | null;
}

export function journalFxIntent(payload: FxIntentPayload): Promise<FxIntentState> {
  return call('POST', '/fx/intents', payload);
}

/**
 * null STRICTLY means the intent does not exist (404). Any other failure
 * throws — treating a transient error as "absent" could re-create state and
 * skip the reconciliation path that prevents a double swap.
 */
export async function getFxIntent(id: string): Promise<FxIntentState | null> {
  const res = await callRaw('GET', `/fx/intents/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`internal API GET /fx/intents/${id} → ${res.status} ${await res.text()}`);
  return (await res.json()) as FxIntentState;
}

export function ladderFxIntent(
  id: string,
  patch: { attemptNo: number; toleranceBps: number; estimatedOutEurc6: string; stopLimitEurc6: string; estimatedAt: string; estimatedBlock?: string | null; preSwapEurc6?: string | null },
): Promise<FxIntentState> {
  return call('POST', `/fx/intents/${id}/ladder`, patch);
}

export function patchFxAttempt(id: string, attemptNo: number, outcome: 'stop_limit_not_met' | 'error', errorCode?: string): Promise<{ ok: boolean }> {
  return call('POST', `/fx/intents/${id}/attempt`, { attemptNo, outcome, errorCode });
}

export function haltFxIntent(id: string): Promise<{ ok: boolean }> {
  return call('POST', `/fx/intents/${id}/halt`);
}

export interface FxResultPayload {
  intentId: string;
  invoiceId: string;
  amountInUsdc6: string;
  amountOutEurc6: string;
  txHash: string;
  feesUsdc6?: string;
  discoveredBy: 'swap' | 'reconciliation';
  completedAt: string;
}

export type FxResultResponse =
  | { ok: true; idempotent: boolean; result: FxResultRow }
  | { ok: false; status: number; reasons: string[] };

/**
 * Returns refusals (409 band/divergence) as a value instead of throwing —
 * an out-of-band actual is a halt-path decision for the caller, not a crash.
 */
export async function postFxResult(payload: FxResultPayload): Promise<FxResultResponse> {
  const res = await callRaw('POST', '/fx/results', payload);
  if (res.ok) {
    const body = (await res.json()) as { idempotent: boolean; result: FxResultRow };
    return { ok: true, idempotent: body.idempotent, result: body.result };
  }
  if (res.status === 409 || res.status === 404) {
    const body = (await res.json().catch(() => ({ reasons: ['unparseable refusal'] }))) as { reasons?: string[] };
    return { ok: false, status: res.status, reasons: body.reasons ?? [] };
  }
  throw new Error(`internal API POST /fx/results → ${res.status} ${await res.text()}`);
}
