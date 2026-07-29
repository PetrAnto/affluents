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


---

# SESSION RECORD — appended 2026-07-29 (gates run live against this file's process)

The operator ran this cycle before the file above reached the repo (uploaded
via the GitHub web editor mid-cycle, per its own house rules). The gates
below were executed in-session; where a decision was AMENDED at a gate, the
amendment supersedes the corresponding signed decision above (decision 2 →
both destinations USDC, no FX leg anywhere this cycle, EURC-on-withdraw
roadmap only; decision 4 → NEW additive withdrawals/withdrawal_steps tables,
since executions is invoice-locked). Everything else above stands, including
the copy table (adapted "To Spend (USDC)"), the pre-dispatch confirmation
step, exception_hold for out-of-band actuals, the done-means checklist, and
deletion of this file in the final commit.

## Gate 0 — SIGNED operator decisions (2026-07-29, after evidence review)

1. **Destination selector, both USDC (AMENDED).** Two options: "To Spend
   (USDC)" — ledger-labeled "Withdrawn from Earn" — and "To Reserve (USDC)".
   Same vault leg, different transfer destination + ledger bucket. NO FX leg
   anywhere in this cycle; withdrawn USDC is never converted (EURC-on-withdraw
   is roadmap only). Conservation exact (band = 0) on BOTH destinations.
2. **Journal (AMENDED).** NEW additive `withdrawals` journal (migration 0005)
   — `executions` is invoice-locked. Intent-first, house status shape,
   `destination` a CHECK-constrained enum ('spend','reserve'). Exact SQL
   shown at the Phase 1 review gate before applying.
3. **Partial withdrawals (CONFIRMED).** Server-side: integer Usdc6,
   `> 0`, `>= 10000` (0.01 USDC floor), `<= sharesOf(treasury)` — enforced
   in the Worker against the ledger-derived Earn balance (proven equal to
   on-chain sharesOf in the evidence below), and on-chain by the vault's own
   `require(assets <= shares)` as final authority.
4. **Two-hop traceability (NEW REQUIREMENT).** The money path is two hops
   (vault → treasury → destination wallet). Each hop is journaled and
   reconcilable independently; a crash between hops must leave a traceable
   intermediate state, shown as "Withdrawal in progress" — never invisible,
   never failed. Consequence: once the vault hop is confirmed, `failed` is
   FORBIDDEN — the only path is forward to completion.
5. **D1 Earn total operator-verified: 1,200,000** — matches on-chain exactly.

Standing from the draft (unamended, so unchanged per the operator): dashboard
URL-secret auth for the trigger; at most ONE withdrawal in a non-terminal
state (409 on a second); portal/receipt untouched — the DTO key-set snapshot
stays byte-identical; this file is deleted in the final commit.

**Route/SQL gate amendments (operator, 2026-07-29):**
- **A1 — parent fail also blocked on 'sent':** `POST /withdrawals/:id/fail`
  refuses (409) when ANY step is 'sent' OR 'confirmed'. A sent hop must
  first be reconciled to 'confirmed' or step-'failed' (with proven on-chain
  absence) before the withdrawal may be failed. Dedicated test for this
  exact window.
- **A2 — exactly-one-of invoice_id/withdrawal_id on ledger rows** is
  CODE-enforced (SQLite cannot ALTER in a CHECK): the enforcement point is
  the `/withdrawals/:id/complete` batch builder in the Worker, plus a test.
- **A3 — Phase 0 micro-withdrawal conditions:** minimum amount (10000
  Usdc6); the operator witnesses it live (announce BEFORE dispatch); the
  0.01 USDC is re-deposited via the existing deposit path immediately
  after, restoring vault + position to exactly 1,200,000; before/after
  reads shown.
- **Accepted knowingly:** a permanently-stuck withdrawal blocks new
  withdrawals (safety property; demo discipline noted).

## Gate 0 evidence — gathered 2026-07-29 (read-only, no secrets touched)

1. **FX↔invoice coupling is schema AND code.** `fx_intents.invoice_id` is
   `NOT NULL REFERENCES invoices(id)` (migrations/0003_fx_journal.sql:8);
   same on `fx_results` (0003:45); intent ids are literally
   `'<invoice_id>:fx'` (0003:7, orchestrator/src/fx.ts:172). Code:
   `runFxLeg(invoiceId, …)` (fx.ts:165), invoked with the invoice's split
   amount (executor.ts:205-211); the post-swap EURC transfer is journaled in
   invoice-keyed `executions` (0001:57-58 step CHECK); Worker writes bind
   invoice_id (db.ts:395, 527-529); dashboard halted-FX view INNER JOINs
   invoices (db.ts:186-189 — a non-invoice row would silently vanish);
   portal rate label reads the invoice's own intent (portal.ts:78-106).
2. **DemoVault:** only `withdraw(uint256 assetsUsdc6)` exists
   (contracts/src/DemoVault.sol:36-44) — no redeem(shares); shares are 1:1
   assets by construction, so exact-asset withdrawal is native. No allowance
   needed (vault pushes via `transfer`). Authorization is msg.sender-scoped.
   Live reads (paced RPC, 33 calls, 0 rate-limit errors):
   `sharesOf(treasury) = balanceOfAssets(treasury) = totalShares() =
   USDC.balanceOf(vault) = 1_200_000`. Owner = treasury SCA
   0x87AE649883Af5f8f6689D294BD7445B227b299CD (recovered from swap receipt
   0x136ecee4…e020a + latest Deposit event owner; matches PROGRESS
   0x87ae…99cd). shares == totalShares ⇒ sole owner.
3. **Two-destination selector (Spend USDC / Reserve USDC) is free:** ledger
   CHECK already allows bucket 'reserve' with token 'USDC' (0001:73); the
   reserve wallet address/id are already validated role config used by the
   reserve step (executor.ts:252-259). Same vault leg; only the transfer
   `destinationAddress` and the ledger bucket differ. Zero FX involvement;
   zero extra migration — `destination` is a column in the NEW 0005 table,
   which does not exist anywhere yet.
4. **Before state:** on-chain position 1,200,000 Usdc6 (1.20 USDC), fully
   backed 1:1. Latest deposit: 150,000 at block 54,069,038, tx
   0x5f98aa779b89c843283b6962791907966011285c7ea1637ee5eb42a780731a73
   (invoice 2026-016's earn step). D1 `SUM(ledger earn USDC)` expected
   1,200,000 (Phase-3 450,000 + 5 × 150,000 per PROGRESS); operator
   confirmation command in session notes (wrangler token is operator-only).

## Diagnosis before writing (mandatory)

Confirm or correct, in code, before Phase 1:

- `DemoVault.withdraw(assetsUsdc6)` pays `msg.sender`; the depositor is the
  **treasury SCA** (deposits were Circle contract executions from the treasury
  wallet), so `sharesOf[treasury]` == the journaled Earn total. Verify the
  live number: on-chain `sharesOf(treasury)` vs `SELECT SUM(delta6) FROM
  ledger WHERE bucket='earn' AND token='USDC'`.
- Withdraw needs **no allowance** (vault pushes via `transfer`), unlike
  deposit's `transferFrom`.
- The `executions` step CHECK does NOT include a withdraw step — and SQLite
  cannot ALTER a CHECK. The journal therefore goes in a NEW additive table,
  never a table rebuild.
- All reads of Arc RPC go through the pacing queue (~1.1s gap); Circle API
  calls do not.

State findings, then proceed.

## Phase 0 — Live micro-measurement (report before Phase 1)

One tiny real withdrawal (0.01 USDC) executed manually via a throwaway
script OUTSIDE the repo (Circle contract execution
`withdraw(uint256)` from the treasury wallet, Gas Station sponsored):

1. Does Gas Station sponsor the vault `withdraw` call as it did `deposit`?
2. Confirm the `Withdraw(owner, assetsUsdc6)` event lands with
   emitter == VAULT_ADDRESS and owner == treasury (this is the
   reconciliation signal).
3. Confirm treasury USDC `balanceOf` rises by exactly the amount (6-dec).
4. Journal nothing; then IMMEDIATELY record the 0.01 as an operator ops
   movement in the session notes so conservation reporting stays honest.

**Review gate:** report the four findings. If sponsorship fails or the event
shape surprises, STOP.

**EXECUTED 2026-07-29, operator-witnessed (A3), nothing surprising:**
- Withdraw 10000 Usdc6: Circle ref a83ef285-aa35-5148-b721-6310ca3ac4f7, tx
  0x58b343012ca5c4877642b331a3a5b483c974962315a168ac0d8ad86cf7a91791
  (block 54267566). Gas payer 0xCec1…9389 (bundler) — Gas Station sponsors
  `withdraw` ✓. `Withdraw(owner=treasury, 10000)` emitted by the vault ✓.
  USDC Transfer vault→treasury exactly 10000 (USDC emitter; EIP-7708 system
  logs present at 18-dec and correctly ignorable by emitter filter) ✓.
  Treasury USDC rose to exactly 3,460,000 — zero gas out of treasury ✓.
- Redeposit 10000: Circle ref 5427ae2c-0bdc-57ac-98af-ca3feb8d3bf0, tx
  0xeaa7caeb2afd16440fcd2f75ff12c58f287ac33c92b483dcddcd43db33a88b5a
  (block 54268341), Deposit(owner=treasury, 10000), sponsored likewise.
- Before/after reads byte-identical: sharesOf(treasury) = totalShares =
  vault USDC = 1,200,000; treasury USDC 3,450,000. Net ops movement: ZERO —
  ledger untouched (off-journal measurement, as specified).

## Phase 1 — Journal schema + Worker guards

Additive-only migration `0005_withdrawals.sql` (exact SQL reviewed at this
gate; summary):

- `withdrawals`: `id` (`wd_` + 16 hex), `amount_usdc6` (CHECK ≥ 10000),
  `destination` CHECK ('spend','reserve'), `state`
  (`pending|complete|failed`), `fail_reason`, `created_block`, timestamps.
- `withdrawal_steps` (mirrors `executions`' status shape, per-hop): id
  `'<wd>:vault' | '<wd>:transfer'`, `step` CHECK ('vault','transfer'),
  `status` (`intent|sent|confirmed|failed`), `provider_ref`, `tx_hash`,
  `amount_usdc6`, `attempt_count`, UNIQUE(withdrawal_id, step).
- `ALTER TABLE ledger ADD COLUMN withdrawal_id` (nullable) — explicit
  provenance for withdrawal-written ledger rows.
- Worker (state of record) server-side guards:
  - Create (`POST /dashboard/:secret/withdraw`): refuse unless integer
    amount, `≥ 10000`, `≤ SUM(ledger earn USDC)` minus non-terminal
    withdrawals; 409 if a non-terminal withdrawal exists — enforced by ONE
    conditional INSERT…SELECT…WHERE NOT EXISTS (atomic, wallet-claim
    style), proven by a concurrency test.
  - Internal API (`/api/internal/withdrawals/*`, X-Internal-Key): step
    upsert + forward-only status updates (divergence guard: step amount
    must equal the journaled withdrawal amount); `failed` REFUSED once any
    step is confirmed (Gate 0 decision 4); completion requires both steps
    confirmed with tx hashes and is ONE atomic batch: ledger `earn −X` +
    `<destination> +X` (both USDC, withdrawal_id set, per-hop tx hashes) +
    state `complete`. Refusals write nothing.
- Unit tests: over-balance refusal at the exact boundary, 10000 floor
  boundary, second-pending 409, completion atomicity, forbidden-fail after
  vault confirm, no negative Earn possible.

**Review gate:** show the exact migration SQL before applying. Check:
additive only, no destructive statements, `--remote` explicit and deliberate.

## Phase 2 — Orchestrator step + restart reconciliation

- New pipeline handler (`orchestrator/src/withdraw.ts`), idempotent per
  withdrawal id, intent-row-first like every other step:
  1. Hop A (`vault` step): Circle contract execution `withdraw(uint256)`
     from treasury on VAULT_ADDRESS, `refId <id>:vault`; step intent →
     sent (provider_ref) → confirmed (tx hash), `runStep` semantics.
  2. Hop B (`transfer` step): `sendTokenTransfer` treasury → the wallet
     for the journaled `destination` (spend or reserve), exact
     `amount_usdc6`, `refId <id>:transfer`; same step lifecycle; then POST
     complete (the Worker writes the atomic ledger batch).
- Divergence guard exactly like `runStep`: recomputed amount ≠ journaled
  amount → THROW, never send.
- Restart reconciliation, in order: a stored provider_ref is queried on
  Circle FIRST (state of the exact transaction we sent); only if the ref is
  missing/unknown, scan `Withdraw` events (emitter == vault, owner ==
  treasury) since `created_block` before re-dispatching. Never trust
  balances alone — the treasury also receives sweeps.
- Kill-test both windows: between intent and vault dispatch, and between
  vault confirm and transfer dispatch.

## Phase 3 — UI + live proof

- Dashboard Earn card: current position, "Withdraw" button (BRAND voice:
  plain verbs), amount form with Max + destination selector ("To Spend
  (USDC)" / "To Reserve (USDC)"), in-progress state ("Withdrawal in
  progress" — visible for ANY non-terminal withdrawal, incl. between hops),
  refusal messages surfaced verbatim. Spend card shows USDC ("Withdrawn
  from Earn") alongside EURC when nonzero. No portal/receipt changes —
  clients never see buckets; the portal DTO key-set snapshot stays
  byte-identical.
- Live proof on testnet: one real partial withdrawal end-to-end with
  explorer links for both txs, the withdrawal row, ledger rows summing
  exactly, and `sharesOf(treasury)` reduced by exactly the amount. Plus one
  restart-reconciliation demonstration.

## Out of scope — do not start

FX on withdrawals (roadmap only, per Gate 0 decision 1), withdrawing to
external addresses, scheduled/auto withdrawals, `swept_usdc6` migration,
wallet-pool refill (separate operator task), any deck regeneration.

## House rules (unchanged)

- Never print `.env` values; variable names only.
- `npx tsc --noEmit` + `npx vitest run` before every Worker deploy;
  `wrangler deploy` does not typecheck.
- Migrations additive only; one-off repairs via targeted
  `wrangler d1 execute --remote` with self-guarding predicates.
- Cloudflare edge serves stale ~30s post-deploy; not a failed deploy.

## Done means

A real partial withdrawal executed from the dashboard on testnet, shown via:
both explorer links, the `withdrawals` row, ledger conservation exact to the
unit (Earn down + Spend up by the same integer), a restart-reconciliation
demonstration, tests green, a PROGRESS.md entry, and a push. Delete this file
in the final commit, per the portal-cycle precedent.
