-- Migration 0005: withdraw-from-Earn journal (WITHDRAW_HANDOFF.md, Gate 0
-- signed 2026-07-29). Additive only: two new tables + indexes, plus one
-- nullable provenance column on ledger. No existing data is touched.
--
-- The money path is two hops (vault -> treasury -> destination wallet).
-- Each hop is journaled in withdrawal_steps and reconcilable independently
-- (Gate 0 decision 4): a crash between hops leaves the vault step
-- 'confirmed' and the transfer step short of it — visible, never failed.
-- All amounts are integer 6-decimal ERC-20 USDC units.

CREATE TABLE withdrawals (
  id TEXT PRIMARY KEY,                       -- 'wd_' + 16 hex
  amount_usdc6 INTEGER NOT NULL CHECK (amount_usdc6 >= 10000),
  destination TEXT NOT NULL CHECK (destination IN ('spend', 'reserve')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'complete', 'failed')),
  fail_reason TEXT,                          -- set only on state='failed' (never after a confirmed hop)
  created_block INTEGER,                     -- chain head at creation: bounded reconciliation scan start
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_withdrawals_state ON withdrawals (state);

-- Per-hop journal, mirroring executions' status shape. amount_usdc6 is
-- denormalized on purpose: the divergence guard compares it against the
-- parent row on every write, so a mismatched send can never be journaled.
CREATE TABLE withdrawal_steps (
  id TEXT PRIMARY KEY,                       -- '<withdrawal_id>:vault' | '<withdrawal_id>:transfer'
  withdrawal_id TEXT NOT NULL REFERENCES withdrawals (id),
  step TEXT NOT NULL CHECK (step IN ('vault', 'transfer')),
  status TEXT NOT NULL DEFAULT 'intent' CHECK (status IN ('intent', 'sent', 'confirmed', 'failed')),
  provider_ref TEXT,                         -- Circle transaction UUID (restart lookup key)
  tx_hash TEXT,
  amount_usdc6 INTEGER NOT NULL CHECK (amount_usdc6 >= 10000),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (withdrawal_id, step)
);
CREATE INDEX idx_withdrawal_steps_withdrawal ON withdrawal_steps (withdrawal_id);

-- Ledger provenance: rows written by a withdrawal completion carry its id
-- (invoice-pipeline rows keep invoice_id; exactly one of the two is set).
ALTER TABLE ledger ADD COLUMN withdrawal_id TEXT REFERENCES withdrawals (id);
