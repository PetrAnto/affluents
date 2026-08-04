# DEMO_DATA_HANDOFF — Fresh demo data + screenshot retake

**Cycle**: Work-queue item 1 (critical path). Operational cycle: live money movements over
**shipped, proven paths only**. Zero new routes, zero migrations, zero orchestrator/Worker
code changes. The only new code permitted is a local screenshot capture script (Playwright).

**Session mode**: Fable 5, high effort (multiple live money movements: real payments,
live FX swaps, one withdrawal). `--permission-mode auto`. Operator pastes outputs back;
emit **bare commands** (no `! ` prefix). Never paste secrets — extract values by name:
`$(grep -m1 '^VAR=' .env | cut -d= -f2-)`.

**Calendar**: today Aug 5 · internal freeze Aug 8 · submission Sun Aug 9 midnight London.
This cycle feeds the deck regen and the 3-min video — do not start either (out of scope).

---

## SIGNED DECISIONS (operator, 2026-08-05 — FROZEN)

1. **Scope**: demo data generation + screenshot retake in this cycle. Deck regeneration
   is a separate cycle.
2. **Amount scale**: **1–2 USDC per invoice** (a few dollars total). Realistic-looking,
   non-round numbers at this scale (e.g. 1.85, 2.40). No hundreds, no thousands.
3. **Old data**: **kept intact**. The books are never rewritten; ledger↔chain
   conservation stands on existing rows (vault position is real and backed). Screenshots
   frame recent rows; new invoices dominate visually.
4. **Dataset**: 4–5 invoices, fictional clients only (never real companies), covering
   `completed` (with live FX journaled), one left `awaiting` for pay-page/link
   screenshots, one portal token visited for the client-view screenshot; plus **one
   realistic partial withdrawal from Earn → Reserve** so withdrawals history, bucket
   provenance split and the defluence animation are real on screen.
5. **Screenshot list**: subject to an explicit review gate (Gate 2) before any capture.

**Demo discipline (binding)**: after the planned withdrawal completes, **no further
withdrawals** "just to see" — single-pending-withdrawal is a designed safety property
and a stuck row would block the demo path.

---

## House rules (unchanged, binding)

- Every money movement is **announced before dispatch**; operator witnesses
  **before/after reads** (dashboard totals, vault position, journal rows) to the unit.
- No secrets in commands or output. Browser evidence with cropped URL bar is valid.
- `FX_MODE` is never flipped while any invoice is `routing`.
- **Never run `circle-setup.ts`** (re-registers role wallets as deposit wallets).
- Any write not on the approved plan (Gate 1) is a **stop-and-ask**.
- One-off data repairs are operator actions via `wrangler d1 execute --remote`, never
  session improvisation — and none are expected this cycle.
- Capture unrecoverable evidence before advancing state. After any pm2 restart, wait
  (`sleep 25`) before tailing logs.

---

## Phase 0 — Diagnosis (mandatory, before anything else)

Measure, print, and stop for operator acknowledgment. No writes in Phase 0 except the
faucet top-up if needed (announced first).

1. **Health**: orchestrator online under pm2; Worker version serves current deploy
   (compare `45f04870` or later); cloudflared up.
2. **Pool**: confirm `freeWallets` ≥ 6 via the orchestrator's own report (expected 13).
3. **Baseline reads (frozen as "before")**: dashboard totals per bucket, provenance
   split, vault position on-chain (expected 1,090,000 Usdc6 at block ≥ 54,993,653
   unless withdrawals ran since), count of invoices and withdrawals rows.
4. **Payer funding inventory**: identify the funding source used for test payments in
   prior cycles (existing script/wallet); read its USDC balance. Total needed ≈ sum of
   planned invoices + margin (≈ 10 USDC at the signed scale). If short: announce, then
   faucet top-up, then re-read.
5. **FX dry-run**: one App Kit `estimate` (no swap) at the largest planned Spend-leg
   amount. Print estimate, implied rate, deviation vs oracle. Confirm it clears the
   50→75→100 bps journaled ladder logic under `FX_ORACLE_MAX_DEVIATION_BPS=3000`.
   Expected fine at this scale — but proven, not assumed.
6. **Existing tooling inventory**: list the scripts/surfaces that will be used to (a)
   create invoices, (b) send payments, (c) trigger the withdrawal. All three must be
   existing shipped surfaces. If any step would require new orchestrator/Worker code:
   **stop-and-ask** — that is a different cycle.

---

## Gate 1 — Dataset plan approval (operator sign-off required)

Present the exact plan as a table before any write:

| # | Client (fictional) | Amount USDC | Target end state | Notes |
|---|---|---|---|---|

Constraints: 4–5 invoices; amounts in [1.00, 2.99], non-round; fictional client names
(suggested register: "Studio Lumen", "Atlas Conseil", "Marge & Pixel", "Nordwind
Media", "Cabinet Ferro" — session may propose its own, no real companies); at least
three reaching `completed` with live FX; exactly one left `awaiting`; one completed
invoice's portal link visited for the client screenshot. Include the planned
withdrawal: partial, Earn → Reserve, amount ≈ 30–40% of the post-routing Earn balance
(computed, shown, ≥ 10000 usdc6), stated in the same table.

Operator approves or amends. Frozen after approval.

## Phase 1 — Invoices + payments (sequential, witnessed)

For each invoice, one at a time:
1. Create via the existing surface; print the pay link and invoice id.
2. **Announce the payment** (amount, from, to), wait for operator go, dispatch.
3. Wait for routing + FX completion (or FX-pending → completed); print the invoice's
   journal state and per-bucket deltas; operator acknowledges before the next invoice.

The `awaiting` invoice is created **last** and never paid.

## Phase 2 — Portal + withdrawal

1. Visit one completed invoice's portal link; confirm it renders (this is also the
   screenshot subject later).
2. **Withdrawal (A3 discipline)**: announce amount and destination (Reserve), operator
   go, trigger via the dashboard button path (the real user surface, not curl — this is
   also demo rehearsal). Witness: journal `intent→sent→confirmed` per hop, two explorer
   links in history, exact conservation (band = 0): Earn −X / Reserve +X, vault
   position −X on-chain, treasury net-unchanged.

## Gate 2 — Screenshot list approval (operator sign-off required)

Propose the exact capture list before any capture. Baseline expected set (session may
propose amendments):

| Page | State | Viewport | Notes |
|---|---|---|---|
| Landing | — | 1440×900 | |
| Create | filled | 1440×900 | fictional client visible |
| Pay | awaiting | 1440×900 + 390×844 | the unpaid invoice |
| Pay | paid | 1440×900 | full routing rows visible |
| Receipt | completed | 1440×900 | |
| Portal | completed | 1440×900 + 390×844 | client view, token URL cropped |
| Dashboard | fresh totals | 1440×900 | buckets + provenance split |
| Dashboard | withdrawals history | 1440×900 | row with two explorer links |
| Withdraw | confirm step | 1440×900 | |
| Withdraw | defluence pending | 1440×900 | timing-sensitive; capture during Phase 2 if needed — flag at Gate 1 if so |

All captures: Playwright, `deviceScaleFactor: 2`, real pages on `affluents.money`
(honest artifacts — no local mocks, no doctored data). Output to `design/screenshots/`
with descriptive kebab-case names. The capture script lives in the repo
(`design/screenshots/capture.mjs` or similar), committed. **Secrets**: the dashboard
URL secret must come from env at runtime, never hardcoded in the script; captured
dashboard/withdraw frames must not show the secret-bearing URL bar (page-only
screenshots are fine).

## Explicitly OUT OF SCOPE — do not start

- Deck regeneration (`design/deck-print.html`, `worker/src/pages/deck.ts`) — next cycle.
- Demo video, script, or storyboard.
- Dashboard upgrades (time ranges, by-client view).
- Any migration, any new route, any Worker/orchestrator code change.
- Any additional withdrawal beyond the one planned at Gate 1.
- `circle-setup.ts`, `refill-pool.ts` (pool is healthy).
- EURC-on-withdraw, `swept_usdc6`, retry layer, `FX_ADAPTER` rename.

## Done means

- [ ] Phase 0 printed and operator-acknowledged (health, pool, baselines, funding,
      FX dry-run, tooling inventory).
- [ ] Gate 1 dataset table approved and executed exactly (no unplanned writes).
- [ ] 3+ invoices `completed` with live FX journaled; 1 invoice `awaiting`; all with
      **real Arc testnet transactions** (explorer links printed).
- [ ] One withdrawal Earn→Reserve completed via the dashboard button; exact
      conservation witnessed (journal + ledger + chain agree to the unit); treasury
      net-unchanged.
- [ ] No unexplained journal rows; books reconciled against the Phase 0 baseline
      ("after" reads printed side by side with "before").
- [ ] Gate 2 list approved; all screenshots captured at deviceScaleFactor 2 and
      committed under `design/screenshots/`; capture script committed, secret-free.
- [ ] `PROGRESS.md` entry appended; push done; final commit hash printed.
- [ ] Fresh dashboard totals printed verbatim at close — these are the **only**
      figures the deck-regen cycle may use (trust neither old slides nor chat
      arithmetic).
