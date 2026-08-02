import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createWithdrawal } from '../src/db';

/**
 * Regression suite for the 2026-08-02 live incident: withdrawal #1 (a valid
 * 10000 against a 1,200,000 Earn balance) was refused with "amount 10000
 * exceeds the Earn balance 1200000". Root cause: the amount is bound as a
 * STRING, and SQLite's cross-type ordering puts every TEXT above every
 * INTEGER, so the guard predicate `?2 <= SUM(...)` was false for ANY amount.
 *
 * The unit fake in db.withdrawals.test.ts could never catch this — it
 * re-implements the predicate in JS with the intended semantics. This suite
 * runs createWithdrawal's REAL statements against REAL SQLite (node:sqlite)
 * on the REAL migration 0005 schema, behind a minimal D1-shaped shim.
 */
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const MIGRATION_0005 = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../migrations/0005_withdrawals.sql'), 'utf8');

// ledger DDL as in migration 0001 (the table 0005's ALTER extends).
const LEDGER_DDL = `CREATE TABLE ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket TEXT NOT NULL CHECK (bucket IN ('spend', 'reserve', 'earn', 'ops', 'exception_hold')),
  token TEXT NOT NULL CHECK (token IN ('USDC', 'EURC')),
  delta6 INTEGER NOT NULL,
  tx_hash TEXT,
  invoice_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);`;

/** Minimal D1 facade over node:sqlite — real statements, real semantics. */
function realSqliteEnv(seedEarnRows) {
  const db = new DatabaseSync(':memory:');
  db.exec(LEDGER_DDL);
  db.exec(MIGRATION_0005);
  for (const delta of seedEarnRows) {
    db.prepare(`INSERT INTO ledger (bucket, token, delta6) VALUES ('earn', 'USDC', ?)`).run(delta);
  }
  const env = {
    DB: {
      prepare(sql) {
        let bound = [];
        const stmt = {
          bind(...args) {
            bound = args.map((a) => (a === undefined ? null : a));
            return stmt;
          },
          async run() {
            const info = db.prepare(sql).run(...bound);
            return { meta: { changes: Number(info.changes) } };
          },
          async first() {
            return db.prepare(sql).get(...bound) ?? null;
          },
          async all() {
            return { results: db.prepare(sql).all(...bound) };
          },
        };
        return stmt;
      },
      async batch(stmts) {
        return Promise.all(stmts.map((s) => s.run()));
      },
    },
  };
  return { env, db };
}

const EARN_ROWS = [450_000, 750_000]; // sums to the live 1,200,000

describe('createWithdrawal against real SQLite (migration 0005 schema)', () => {
  it('ACCEPTS a valid string-bound amount below the balance (the live-incident regression)', async () => {
    const { env, db } = realSqliteEnv(EARN_ROWS);
    const out = await createWithdrawal(env, { amountUsdc6: '10000', destination: 'reserve' });
    expect(out).toMatchObject({ ok: true });
    const row = db.prepare(`SELECT amount_usdc6, destination, state FROM withdrawals`).get();
    expect(row).toMatchObject({ amount_usdc6: 10_000, destination: 'reserve', state: 'pending' });
  });

  it('accepts the exact full balance (boundary) and refuses one unit above it, writing nothing', async () => {
    const exact = realSqliteEnv(EARN_ROWS);
    const okOut = await createWithdrawal(exact.env, { amountUsdc6: '1200000', destination: 'spend' });
    expect(okOut.ok).toBe(true);

    const over = realSqliteEnv(EARN_ROWS);
    const refused = await createWithdrawal(over.env, { amountUsdc6: '1200001', destination: 'spend' });
    expect(refused).toMatchObject({ ok: false, status: 409 });
    expect(refused.reasons.join()).toContain('exceeds the Earn balance 1200000');
    expect(over.db.prepare(`SELECT COUNT(*) AS n FROM withdrawals`).get().n).toBe(0);
  });

  it('refuses a second withdrawal while one is pending, under real SQL', async () => {
    const { env, db } = realSqliteEnv(EARN_ROWS);
    expect((await createWithdrawal(env, { amountUsdc6: '10000', destination: 'reserve' })).ok).toBe(true);
    const second = await createWithdrawal(env, { amountUsdc6: '10000', destination: 'spend' });
    expect(second).toMatchObject({ ok: false, status: 409 });
    expect(second.reasons.join()).toContain('one at a time');
    expect(db.prepare(`SELECT COUNT(*) AS n FROM withdrawals`).get().n).toBe(1);
  });

  it('still refuses below the 10000 floor with 400 before any SQL runs', async () => {
    const { env, db } = realSqliteEnv(EARN_ROWS);
    const out = await createWithdrawal(env, { amountUsdc6: '9999', destination: 'reserve' });
    expect(out).toMatchObject({ ok: false, status: 400 });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM withdrawals`).get().n).toBe(0);
  });
});
