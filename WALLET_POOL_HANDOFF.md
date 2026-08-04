# WALLET_POOL_HANDOFF.md — Deposit wallet pool refill (mini-session)

You are Claude Code on the Affluents VPS. Read `PROGRESS.md` and `CLAUDE.md` first.
This is a deliberately small operational session: **refill the deposit wallet pool**,
nothing else. The operator is not a developer; explain in plain language when asked.

**This file is scaffolding: delete it in the final commit.**

## Context

Every invoice claims a fresh single-use deposit wallet (Circle developer-controlled SCA,
Gas Station sponsored — no pre-funding). The pool is down to **1 free wallet**, which
blocks all further test payments, fresh demo data, and demo rehearsals. The original
pool was created during the initial build, so tooling likely exists — verify, don't
assume.

## Signed decisions (operator, 2026-08-02)

1. **Target: 12 new free wallets** (existing free wallet stays; end state ≥ 13 free).
   Rationale: fresh demo data needs ~8–10 invoices, plus rehearsal and Demo-Day buffer.
   If the operator wants a different N they will say so before you build.
2. **No money moves in this session.** Wallet creation is Circle API calls + D1 rows.
   If anything in this session would move funds, that is out of scope: stop and ask.
3. **Never touch existing wallet rows** (free, assigned, or retired) — additive inserts
   only. No migration is expected; if diagnosis shows one is needed, stop for review.
4. **Operator runs the creation command(s)** with credentials extracted from `.env` by
   variable name, same pattern as every prior cycle. Announce what a command does
   before handing it over; batch output must show per-wallet results (index, Circle
   wallet id, address) and never any secret.

## Phase 0 — diagnosis (report and STOP before any writes)

1. **How were pool wallets originally created and registered?** Find the existing
   script/tooling in the repo (or orchestrator code path). State exactly what it does,
   whether it is re-runnable as-is for N wallets, and what (if anything) needs
   adjusting.
2. **What does a valid pool row require?** Read the `deposit_wallets` (or equivalent)
   schema and the invoice-creation claim query: required columns, status value for
   "free", any uniqueness constraints.
3. **How do rows get inserted?** Existing internal API endpoint vs direct script → the
   exact write path you propose, for the review gate.
4. **Current pool state**: counts by status (free / assigned / retired) from D1 — the
   operator runs the read command you provide. This is the "before".

## Review gate (MANDATORY before creating anything)

Present: the creation command (what it calls, how many wallets, what it prints), the
exact insert path (endpoint or statements), and the expected "after" state. Wait for
operator approval.

## Execution order (after approval)

1. Operator runs the creation command; pastes the per-wallet output back.
2. Verify registration: operator runs the D1 count command — expected ≥ 13 free.
3. Verify the orchestrator sees it: next `work:` log line shows `freeWallets=13`
   (or the actual count). Operator pastes the line.
4. Optional sanity: create nothing else — do NOT create a test invoice in this session
   (test payments resume in the demo-data session).

## Out of scope — do not start

- No test invoices or payments; no withdraw activity; no demo data.
- No dashboard, deck, portal, or orchestrator feature work.
- No migrations (stop for review if diagnosis says otherwise).
- No cleanup/renames.

## House rules (restated)

- Bare commands without the `! ` prefix; the operator pastes them.
- Never ask for secrets or `.env` values; variable names only; extraction via
  `$(grep -m1 '^VAR=' .env | cut -d= -f2-)` when a command needs one.
- Arc RPC ~1 req/s: any chain reads go through the serialising queue / paced calls.
- `npx tsc --noEmit` before any deploy (only if a code change proves necessary —
  none is expected).

## Done means (all verifiable)

- [ ] ≥ 13 free wallets in D1 (operator-run count, before/after shown).
- [ ] Orchestrator `work:` line showing the new freeWallets count (operator-pasted).
- [ ] No existing rows modified; no money moved; no migration applied.
- [ ] `PROGRESS.md` entry (before/after counts, tooling used or added).
- [ ] This file deleted in the final commit; push.
