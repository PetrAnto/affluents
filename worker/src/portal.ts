import type { FxIntentState } from './db';
import type { InvoiceRow } from './types';

/**
 * Read-only client portal (PORTAL_HANDOFF decisions 2–4).
 *
 * Everything here is PURE mapping — the internal→client translation happens
 * inside the Worker, at the state of record. Internal state names, split
 * percentages, bucket amounts, wallet ids and the dashboard secret must never
 * cross this boundary; the DTO below is an exhaustive allowlist, snapshot-
 * tested so an accidental field addition fails loudly.
 */

/** Client-facing state vocabulary — the ONLY states a client ever sees. */
export type ClientState = 'awaiting' | 'verifying' | 'verified' | 'allocating' | 'complete';

/**
 * Sibling of `payStateOf` (db.ts), not a fork: same shape, different audience.
 * A client is never shown a failure state for money that has been received —
 * failed_retryable/failed_terminal and a halted FX leg all read "allocation
 * in progress"; failures are the operator's to resolve.
 */
export function clientStateOf(inv: InvoiceRow): ClientState {
  switch (inv.status) {
    case 'completed':
      return 'complete';
    case 'payment_reported':
      return 'verifying';
    case 'payment_verified':
      return 'verified';
    case 'routing':
    case 'failed_retryable':
    case 'failed_terminal':
      return 'allocating';
    default:
      // created / awaiting_wallet / awaiting_payment (incl. partial —
      // received_usdc6 rides along in the DTO for the progress line).
      return 'awaiting';
  }
}

/**
 * The exhaustive portal DTO (PORTAL_HANDOFF "DTO allowlist"). Optional keys
 * are PRESENT only under their documented condition — never null-padded — so
 * the key-set snapshot test can pin the exact surface per scenario.
 */
export interface PortalDto {
  label: string;
  amount_usdc6: string;
  received_usdc6: string;
  /** Only when the overpaid flag is set. */
  overpaid_usdc6?: string;
  unexpected_payment: boolean;
  client_state: ClientState;
  funding_txs: Array<{ hash: string; explorer_url: string }>;
  rate_label: 'live rate' | 'demo rate' | null;
  fx_pending: boolean;
  /** Only while an FX leg is pending/halted. */
  fx_pending_usdc6?: string;
  /** Only while pending AND the journaled oracle rate is non-NULL. */
  fx_indicative_eur?: string;
  paid_at: string | null;
  completed: boolean;
}

/**
 * ≈ EUR figure from the JOURNALED oracle rate on the fx intent row — no
 * external fetch from the Worker, integer math only, floored (same formula as
 * the dashboard's halted-leg copy). Returns a 2-decimal display string.
 */
function indicativeEur(amountInUsdc6: number, oracleRatePpm: number): string {
  const eur6 = (BigInt(amountInUsdc6) * BigInt(oracleRatePpm)) / 1_000_000n;
  const whole = (eur6 / 1_000_000n).toLocaleString('en-US');
  const frac = (eur6 % 1_000_000n).toString().padStart(6, '0').slice(0, 2);
  return `${whole}.${frac}`;
}

export function buildPortalDto(inv: InvoiceRow, fx: FxIntentState | null, explorer: string): PortalDto {
  const completed = inv.status === 'completed';
  // Pending/halted FX leg on a non-completed invoice: the conversion has not
  // happened (at any rate) yet. 'complete' intents carry actuals instead.
  const fxPending = fx !== null && fx.intent.state !== 'complete' && !completed;

  const fundingTxs = (JSON.parse(inv.paid_txs) as Array<{ txHash: string; status?: string }>)
    .filter((t) => t.status === 'verified')
    .map((t) => ({ hash: t.txHash, explorer_url: `${explorer}/tx/${t.txHash}` }));

  const dto: PortalDto = {
    label: inv.label,
    amount_usdc6: String(inv.amount_usdc6),
    received_usdc6: String(inv.received_usdc6),
    unexpected_payment: inv.unexpected_payment === 1,
    client_state: clientStateOf(inv),
    funding_txs: fundingTxs,
    // Label only, never the EURC amount — from the invoice's own journaled
    // rate_source, so a demo-era invoice keeps saying so after go-live.
    rate_label: fx === null ? null : fx.intent.rate_source === 'appkit' ? 'live rate' : 'demo rate',
    fx_pending: fxPending,
    paid_at: inv.paid_at,
    completed,
  };
  if (inv.overpaid === 1) dto.overpaid_usdc6 = String(inv.overpaid_usdc6);
  if (fxPending && fx) {
    dto.fx_pending_usdc6 = String(fx.intent.amount_in_usdc6);
    if (fx.intent.oracle_rate_ppm !== null && fx.intent.oracle_rate_ppm > 0) {
      dto.fx_indicative_eur = indicativeEur(fx.intent.amount_in_usdc6, fx.intent.oracle_rate_ppm);
    }
  }
  return dto;
}
