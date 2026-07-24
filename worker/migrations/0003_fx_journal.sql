-- Migration 0003: FX intent/result journal for live App Kit FX (Decision 4).
-- Additive only: three new tables + indexes. No existing table is altered.
-- estimated_block / pre_swap_eurc6 are journaled at estimate time so restart
-- reconciliation has a bounded scan range and a balance baseline (Phase 3).

CREATE TABLE fx_intents (
  id TEXT PRIMARY KEY,                          -- '<invoice_id>:fx'
  invoice_id TEXT NOT NULL REFERENCES invoices (id),
  amount_in_usdc6 INTEGER NOT NULL CHECK (amount_in_usdc6 >= 0),
  estimated_out_eurc6 INTEGER NOT NULL CHECK (estimated_out_eurc6 >= 0),
  stop_limit_eurc6 INTEGER NOT NULL CHECK (stop_limit_eurc6 >= 0),
  tolerance_bps INTEGER NOT NULL CHECK (tolerance_bps >= 0),
  rate_source TEXT NOT NULL CHECK (rate_source IN ('appkit', 'demo')),
  oracle_rate_ppm INTEGER,                      -- ECB EUR-per-USD x 1e6; NULL = oracle unreachable
  oracle_deviation_bps INTEGER,                 -- signed estimate-vs-oracle deviation
  estimated_at TEXT NOT NULL,
  estimated_block INTEGER,                      -- chain head at estimate time (reconciliation scan start)
  pre_swap_eurc6 INTEGER,                       -- swapping wallet's EURC balance at estimate time
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'complete', 'halted')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_fx_intents_invoice ON fx_intents (invoice_id);
CREATE INDEX idx_fx_intents_state ON fx_intents (state);

-- Append-only ladder history: one row per estimate/attempt, so every retry's
-- tolerance and floor stays visible (Decisions 2 and 4).
CREATE TABLE fx_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  intent_id TEXT NOT NULL REFERENCES fx_intents (id),
  attempt_no INTEGER NOT NULL,
  tolerance_bps INTEGER NOT NULL,
  estimated_out_eurc6 INTEGER NOT NULL,
  stop_limit_eurc6 INTEGER NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'dispatched'
    CHECK (outcome IN ('dispatched', 'success', 'stop_limit_not_met', 'error')),
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (intent_id, attempt_no)
);
CREATE INDEX idx_fx_attempts_intent ON fx_attempts (intent_id);

CREATE TABLE fx_results (
  intent_id TEXT PRIMARY KEY REFERENCES fx_intents (id),
  invoice_id TEXT NOT NULL REFERENCES invoices (id),
  amount_out_eurc6 INTEGER NOT NULL CHECK (amount_out_eurc6 >= 0),
  tx_hash TEXT NOT NULL,
  fees_usdc6 INTEGER NOT NULL DEFAULT 0 CHECK (fees_usdc6 >= 0),
  discovered_by TEXT NOT NULL DEFAULT 'swap' CHECK (discovered_by IN ('swap', 'reconciliation')),
  completed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_fx_results_invoice ON fx_results (invoice_id);
