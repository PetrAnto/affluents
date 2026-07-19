import { config } from './config';

/**
 * All application state flows through the Worker's authenticated internal
 * API — the orchestrator never touches D1 directly (intentional design,
 * SPEC §3.1). Outbound HTTPS only; this process listens on no port.
 */
async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${config.workerBaseUrl}/api/internal${path}`, {
    method,
    headers: {
      'X-Internal-Key': config.internalApiKey,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
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
