# WITHDRAW_HANDOFF.md — Withdraw from Earn (money-path write cycle)

You are Claude Code, running on the Affluents VPS. This file is your assignment.
Read `PROGRESS.md` and `CLAUDE.md` first. This is the first cycle in which a
user-facing surface triggers a money movement, so supervision is stricter than
the portal cycle, not lighter. The operator is not a developer; when you ask a
question, explain the stakes in plain language.

**This file is scaffolding: it must be deleted in the final commit.**

---

## Signed-off decisions (operator, 2026-07-29 — do not re-litigate)

1. **Trigger:** a withdraw control on the dashboard (behind the existing URL
   secret). The action is a `POST` — the secret travels in a header or body,
   never a new GET route with the secret in the query beyond what the dashboard
   already does. A confirmation step precedes dispatch.
2. **Destinations: two.** `reserve` (USDC → Reserve, single leg, exact) and
   `spend` (USDC → EURC via the **existing** FX machinery, chained after the
   vault leg — Option A: one user gesture, `fx_pending`-style intermediate
   state if the swap is delayed or refused by the oracle guard). The
   destination is a **server-validated enum** (`reserve` | `spend`). It is
   never an address, never any other value. An invalid destination is a
   400-refusal that writes nothing.
3. **Amounts: partial.** Server-side validation at dispatch time: amount > 0,
   ≥ 10000 usdc6 (0.01 USDC minimum), ≤ current vault position. Zero position:
   control disabled in the UI AND the endpoint refuses. **Contingency:** if
   diagnosis (Phase 0) shows the DemoVault's share math cannot deliver
   exact-asset withdrawals, STOP and report — the approved fallback is
   full-position-only, but that switch is the operator's call, not yours.
4. **Journaling:** intent-first, per house pattern.
   - Vault leg: journaled in `executions` with step `withdraw`
     (status `intent → sent → confirmed | failed`), idempotent per execution
     id. If diagnosis shows `executions` lacks a needed column, propose an
     **additive** migration 0005 and stop for review — do not build around it.
   - FX leg (spend destination only): reuse `fx_intents` / `fx_attempts` /
     `fx_results` exactly as the inbound leg does. No new FX tables.
   - Restart reconciliation covers both crash windows: intent-no-tx (check
     on-chain before re-dispatch) and tx-no-result (find the receipt before
     acting). The divergence check refuses: dispatch refuses if the amount to
     send ≠ journaled intent; result writes refuse if on-chain amount ≠
     intent. Refusals write nothing.
5. **Ledger & conservation:**
   - Reserve destination: Earn −X, Reserve +X, **exact** (band = 0), integer
     6-dec math, `Usdc6` branded types.
   - Spend destination: Earn −X exact on the USDC side; the EURC credit obeys
     the existing Decision-5 FX band. While the swap is pending, the dashboard
     shows the withdrawn USDC as "conversion pending" — money is never
     invisible and never shown as failed.
   - Any out-of-band actual (either leg) is ledgered to `exception_hold`,
     flagged, and never massaged into Reserve/Spend.
6. **Copy (house neutral style, English UI):**
   - Control: "Withdraw from Earn" · destination choice: "To Reserve (USDC)" /
     "To Spend (EURC)"
   - Confirm: "Move X USDC from Earn to {destination}?"
   - Pending (vault leg): "Withdrawal in progress"
   - Pending (FX leg): "X USDC withdrawn — conversion to EURC pending"
   - Failure: "Withdrawal not completed — funds remain in Earn." (true by
     construction on the vault leg)
   - Zero position: "Nothing in Earn yet"
   - Never internal state names; never a failure state for money that exists.
7. **Portal untouched.** Withdrawals are the freelancer's internal management;
   the client receipt never shows them. The portal DTO allowlist and its
   key-set snapshot test must be byte-identical after this cycle.

---

## Phase 0 — Diagnosis before writing (genuine unknowns only)

Report findings and STOP for operator review before any code:

1. **Read the deployed DemoVault contract** (source in `contracts/`, address
   from config — variable name only). Answer precisely:
   - Withdraw interface: `withdraw(assets)` vs `redeem(shares)` vs custom?
   - Can it deliver an exact requested asset amount, or does share rounding
     introduce dust? Prove it with a read-only calculation against the current
     live position, not by assumption.
   - Who is the position owner (treasury wallet?) and what authorization does
     a withdrawal require?
2. **Read the existing earn (deposit) leg** in the orchestrator: how it
   journals, dispatches, confirms. The withdraw leg must mirror its shape.
3. **Read the inbound FX leg** end-to-end (intent → attempt → result →
   reconciliation) — the spend destination reuses it; identify the exact
   entry point you will call and whether it assumes "inbound invoice" context
   that a withdrawal lacks.
4. **Check `executions` columns** against what the withdraw step needs.
5. **Current vault position and ledger Earn total** — record both; they are
   the "before" of the final evidence.

## Review gate — route list (MANDATORY, before building)

After Phase 0, present the **complete list of new/changed routes** (method,
path, auth, what it writes) and any migration SQL. Wait for explicit operator
approval. Any write path not on the approved list discovered later is a
stop-and-ask, not a judgment call. Expected shape (subject to your diagnosis):

- `POST /api/withdraw` (or similar) — dashboard-secret-authenticated,
  body `{ amount_usdc6, destination }`, destination enum-validated, creates
  the journaled intent only. The Worker/orchestrator division of labor follows
  the existing pattern: all D1 via the Worker internal API; on-chain dispatch
  from the orchestrator.
- Whatever internal-API additions the orchestrator needs to pull withdraw
  work and post results (mirror the existing step endpoints).
- **Zero new public read routes. Zero portal routes. Zero changes to
  `GET /api/portal/:token`.**

## Build order (after route-list approval)

1. Vault leg to **Reserve** first: journal, dispatch, confirm, ledger, exact
   conservation. Prove it with a real testnet withdrawal before touching FX.
2. Spend destination: chain the FX leg via the existing machinery; pending
   state on the dashboard; prove with a second real withdrawal (executed or
   honestly pending, whichever the day's oracle deviation gives — both are
   valid evidence).
3. Dashboard control (the ONLY dashboard change permitted): withdraw control
   with destination choice, confirm step, pending/zero states, ledger lines
   with explorer links.
4. Tests: conservation unit test (both destinations), divergence-refusal test,
   zero/min/over-position refusal tests, portal DTO key-set snapshot
   unchanged, full suite green.

## Out of scope — do not start

- No dashboard upgrades beyond the withdraw control (no time ranges, no
  by-client view).
- No deck, screenshot, or demo-data work.
- No SplitVault. No pay-page changes. No portal changes.
- No wallet-pool refill (separate session).
- No renaming of `FX_ADAPTER` or any deliberate-cleanup items.
- No new secrets, no `.env` edits beyond variable names the operator sets.

## House rules (restated)

- **Emit bare commands without the `! ` prefix** — the operator pastes them
  into bash themselves.
- Never ask for secrets or `.env` values; variable names only; never a secret
  inside a shell command. Authenticated-page evidence = operator opens it in
  their own browser and screenshots (crop the URL bar).
- Migrations additive-only; show the SQL, stop for review, and after approval
  `cat` the file on disk so the operator confirms it matches before
  `--remote` apply. `--local` replays full history — expected.
- `npx tsc --noEmit` before every deploy; `wrangler deploy` does not
  typecheck. Edge serves stale ~30s after deploy.
- Arc RPC ~1 req/s per IP: everything goes through the serialising queue.
- Long file contents go in via the GitHub web editor, not heredocs.
- Capture unrecoverable evidence before advancing state (e.g. the vault
  position and dashboard BEFORE the first withdrawal).

## Done means (all of it, verifiable)

- [ ] Two real withdrawals executed on testnet: one → Reserve (conservation
      exact, before/after vault position + ledger shown), one → Spend (swap
      executed within band, or pending state demonstrated honestly).
- [ ] Divergence/refusal paths demonstrated (at least: over-position refusal
      shown against the live endpoint).
- [ ] Full test suite green, portal snapshot test unchanged.
- [ ] `PROGRESS.md` entry: decisions applied, evidence links, caveats.
- [ ] This file deleted in the final commit.
- [ ] Pushed; Worker deployed; operator has verified the dashboard in their
      own browser.
