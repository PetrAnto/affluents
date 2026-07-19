export interface Env {
  DB: D1Database;
  /** Shared secret for the orchestrator-only internal API (wrangler secret). */
  INTERNAL_API_KEY: string;
  /** URL-path secret for the single-profile dashboard (wrangler secret). */
  DASHBOARD_SECRET: string;
  ARC_CHAIN_ID: string;
  USDC_ADDRESS: string;
  EURC_ADDRESS: string;
  ARC_EXPLORER: string;
  /** Active FX adapter — drives honest UI copy ("demo rate" on treasury). */
  FX_ADAPTER: string;
}

export type InvoiceStatus =
  | 'created'
  | 'awaiting_wallet'
  | 'awaiting_payment'
  | 'payment_reported'
  | 'payment_verified'
  | 'routing'
  | 'completed'
  | 'failed_retryable'
  | 'failed_terminal';

/** Payment-page display state, derived from an invoice row (design/payment.html). */
export type PayState = 'awaiting' | 'verifying' | 'partial' | 'paid';

export interface InvoiceRow {
  id: string;
  display_no: string;
  amount_usdc6: number;
  label: string;
  memo: string | null;
  status: InvoiceStatus;
  wallet_id: string | null;
  paid_txs: string;
  paid_at: string | null;
  received_usdc6: number;
  overpaid_usdc6: number;
  overpaid: number;
  unexpected_payment: number;
  created_at: string;
  // joined from deposit_wallets when selected with the wallet
  deposit_address?: string | null;
}

export interface WalletRow {
  id: string;
  address: string;
  circle_wallet_id: string | null;
  status: 'free' | 'assigned' | 'retired';
  invoice_id: string | null;
  baseline_usdc6: number;
  buffer_native18: string;
  created_at: string;
}

export interface SplitRuleRow {
  spend_pct: number;
  reserve_pct: number;
  earn_pct: number;
  updated_at: string;
}
