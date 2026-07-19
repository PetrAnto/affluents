-- Migration 0001: Affluents state of record (SPEC §3.1).
-- All *_usdc6 / *_6 columns are integer 6-decimal ERC-20 units.
-- buffer_native18 is TEXT: 18-decimal values overflow float64 range.

CREATE TABLE counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT INTO counters (name, value) VALUES ('invoice_display', 0);

CREATE TABLE split_rules (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  spend_pct INTEGER NOT NULL CHECK (spend_pct BETWEEN 0 AND 100),
  reserve_pct INTEGER NOT NULL CHECK (reserve_pct BETWEEN 0 AND 100),
  earn_pct INTEGER NOT NULL CHECK (earn_pct BETWEEN 0 AND 100),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (spend_pct + reserve_pct + earn_pct = 100)
);
INSERT INTO split_rules (id, spend_pct, reserve_pct, earn_pct) VALUES (1, 60, 25, 15);

CREATE TABLE deposit_wallets (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL UNIQUE,
  circle_wallet_id TEXT,
  status TEXT NOT NULL DEFAULT 'free' CHECK (status IN ('free', 'assigned', 'retired')),
  invoice_id TEXT UNIQUE,
  baseline_usdc6 INTEGER NOT NULL DEFAULT 0,
  buffer_native18 TEXT NOT NULL DEFAULT '0',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_wallets_status ON deposit_wallets (status);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  display_no TEXT NOT NULL UNIQUE,
  amount_usdc6 INTEGER NOT NULL CHECK (amount_usdc6 > 0),
  label TEXT NOT NULL,
  memo TEXT,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN (
    'created', 'awaiting_wallet', 'awaiting_payment', 'payment_reported',
    'payment_verified', 'routing', 'completed', 'failed_retryable', 'failed_terminal'
  )),
  wallet_id TEXT REFERENCES deposit_wallets (id),
  paid_txs TEXT NOT NULL DEFAULT '[]',
  paid_at TEXT,
  received_usdc6 INTEGER NOT NULL DEFAULT 0,
  overpaid_usdc6 INTEGER NOT NULL DEFAULT 0,
  overpaid INTEGER NOT NULL DEFAULT 0,
  unexpected_payment INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_invoices_status ON invoices (status);

CREATE TABLE executions (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices (id),
  step TEXT NOT NULL CHECK (step IN ('verify', 'sweep', 'fx', 'reserve', 'earn', 'reclaim')),
  status TEXT NOT NULL DEFAULT 'intent' CHECK (status IN ('intent', 'sent', 'confirmed', 'failed')),
  tx_hash TEXT,
  amount_usdc6 INTEGER,
  amount_out6 INTEGER,
  output_token TEXT CHECK (output_token IN ('USDC', 'EURC') OR output_token IS NULL),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_executions_invoice ON executions (invoice_id);
CREATE INDEX idx_executions_status ON executions (status);

CREATE TABLE ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket TEXT NOT NULL CHECK (bucket IN ('spend', 'reserve', 'earn', 'ops', 'exception_hold')),
  token TEXT NOT NULL CHECK (token IN ('USDC', 'EURC')),
  delta6 INTEGER NOT NULL,
  tx_hash TEXT,
  invoice_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_ledger_bucket ON ledger (bucket, token);
CREATE INDEX idx_ledger_invoice ON ledger (invoice_id);
