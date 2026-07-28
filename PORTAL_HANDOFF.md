# PORTAL_HANDOFF.md — Read-only client portal

Cycle: work-queue item 2. Operator-signed decisions below are settled; do not
re-litigate them. Read `PROGRESS.md` first — it is the authoritative technical
state. This file is scaffolding: **delete it in the final commit of this cycle.**

## Goal

After paying, a client can open a private receipt link and see what happened to
their payment — honestly labeled, with nothing about the freelancer's internal
allocation policy exposed. Read-only in the strictest sense: **this cycle
introduces no write path reachable from the portal.** Any write you find
yourself adding is a design error — stop and ask.

---

## Signed decisions (operator, 2026-07-28)

1. **Access model — tokenized per-invoice link.** New column
   `portal_token` on `invoices`: 128-bit random, hex, prefixed `rcp_`
   (generate with `crypto.getRandomValues`, 16 bytes). Generated at invoice
   creation for new invoices. Existing invoices: no automatic backfill; if the
   operator wants an old invoice viewable, that is a one-off
   `wrangler d1 execute --remote` operator action (propose the exact
   self-guarding SQL, do not run it unprompted, and never add an endpoint for
   it). URL: `GET /r/:token`. The invoice id is never accepted as a portal
   credential, even though ids are random — identifiers are not capabilities.

2. **Visibility — Tier 2: receipt + honest status timeline. No bucket
   amounts, no percentages.** The client sees:
   - invoice label, invoiced amount, amount received, per-funding-tx ArcScan
     links (partials aggregate, as on the pay page);
   - a timeline: Payment received → Verified on-chain → Allocated → Complete;
   - the rate label from the invoice's own journaled `rate_source`
     ("live rate" / "demo rate") on the allocation step — **label only, never
     the EURC amount**;
   - during an FX-pending/halted leg: the converting amount with
     "≈ €X at ECB reference rate — indicative, conversion pending", computed
     from the **journaled oracle rate on the fx intent row** (no external
     fetch from the Worker). If the journaled oracle rate is NULL (oracle was
     unreachable pre-swap), omit the € figure and show the neutral pending
     copy alone. Operator accepted that the pending figure implicitly reveals
     the converting portion; do not add percentages or make it worse.

   The client must NEVER see: split percentages, Reserve/Earn amounts or
   existence, bucket names, wallet ids/addresses beyond what ArcScan links
   already show, internal state names, the dashboard secret, or anything
   about any other invoice or client.

3. **Read path — dedicated least-privilege endpoint.**
   `GET /api/portal/:token` returns a purpose-built DTO (allowlist below).
   The internal→client state mapping happens **inside the Worker**, at the
   state of record. Do not reuse `GET /api/invoices/:id` and do not have the
   portal page call it. The portal page (`/r/:token`, server-rendered like
   the other pages) may poll `/api/portal/:token` (~5s) while the state is
   non-final and stop when final.

4. **Client-facing copy** (neutral house style — internal jargon never
   crosses the Worker boundary):

   | Internal | Client sees |
   |---|---|
   | `awaiting_payment` (incl. partial) | "Awaiting payment — received X of N USDC" |
   | `payment_reported` | "Payment received — verifying on-chain" |
   | `payment_verified` | "Payment verified on-chain ✓" |
   | `routing`, `failed_retryable`, halted FX leg | "Payment confirmed ✓ — allocation in progress" (+ FX-pending line per decision 2 when applicable) |
   | `completed` | "Complete ✓" (allocation step shows "Allocated · live rate" or "· demo rate") |
   | `overpaid` flag | "Extra X USDC received — held safely, not allocated. If this was unintended, contact {invoice label owner}." |
   | `unexpected_payment` flag | "A payment arrived after this invoice was completed — it is held safely and has not been allocated." |
   | `failed_terminal` | Same as "allocation in progress" — a client is never shown a failure state for money that has been received; failures are the operator's to resolve. |

   404 (unknown, malformed, or null token) is one generic page, identical in
   every case — no distinction between "no such token" and "invoice exists
   but has no token".

## DTO allowlist — exhaustive

`label`, `amount_usdc6`, `received_usdc6`, `overpaid_usdc6` (only if flagged),
`unexpected_payment` (boolean), `client_state` (mapped string per the table),
`funding_txs` (hash + explorer URL each), `rate_label` (`live rate` /
`demo rate` / null), `fx_pending` (boolean), `fx_pending_usdc6` +
`fx_indicative_eur` (only while pending and oracle rate non-NULL),
`paid_at`, `completed` (boolean).

Nothing else, ever. Add a worker unit test that snapshots the DTO's key set so
an accidental field addition fails loudly rather than shipping.

---

## Phase A — Diagnosis before writing (report back, then stop)

Read the code and report findings **before any code or SQL**:

1. Confirm the invoice id format and how `/pay/:invoiceId` and the existing
   `payState` mapping work — the portal mapping should be a sibling of that
   pattern, not a fork of it.
2. **Report exactly what the paid/completed pay page currently displays** —
   PROGRESS.md mentions routed-summary rows with journaled actuals. If the
   pay page reveals bucket amounts or the split to the payer, flag it with a
   description and **ask the operator**; do not change the pay page's
   information display unilaterally. (Adding the "View receipt" link is in
   scope; removing information is an operator decision.)
3. Confirm where `rate_source` and the journaled oracle rate live
   (`fx_intents` per migration 0003) and how to join invoice → fx intent for
   the pending display.
4. Confirm the current pages architecture (`worker/src/pages/*`) and how
   `/r/:token` should be served consistently with it.
5. Propose migration 0004 (additive only: `ALTER TABLE invoices ADD COLUMN
   portal_token TEXT` + unique index) — show the exact SQL and the exact
   `wrangler d1 migrations apply` command with `--remote` explicit, and wait
   for the review gate before applying.

## Phase B — Build (after diagnosis sign-off)

1. Migration 0004 (review-gated, additive, `--remote` deliberate).
2. Token generation in `POST /api/invoices` (inside the existing atomic
   creation batch).
3. `GET /api/portal/:token` + server-side mapping + DTO allowlist test.
4. `GET /r/:token` page: house visual style, neutral copy per the table,
   polling while non-final, generic 404.
5. Link surfacing (both, per operator): pay page shows "View receipt →
   /r/:token" once paid; dashboard per-invoice row gets a copy-link
   affordance (this is the only dashboard change permitted this cycle).
6. `npx tsc --noEmit` clean in `worker/`; unit tests green; deploy; verify
   on the live domain (edge serves stale ~30s post-deploy — not a failed
   deploy).

## Out of scope — do not start

- Withdraw-from-Earn; dashboard upgrades beyond the copy-link affordance;
  deck/slides work; any auth beyond the token; the `swept_usdc6` migration;
  the `awaiting_wallet` auto-assign backlog; changing pay-page information
  display (flag → ask); refactors of working code; any new write endpoint or
  operator-action-as-API.

## House rules (unchanged)

- Never print or ask for secrets or `.env` values — variable names only;
  never `cat ~/.pm2/dump.pm2`.
- Migrations additive-only, shown before applying, `--remote` explicit.
- `npx tsc --noEmit` before every `wrangler deploy`.
- Repo is public: no scaffolding or measurement scripts at push — including
  this file, deleted in the final commit.
- The operator is not a developer: ask questions in plain language, one at a
  time, with a recommendation.

## Done means (all of it, verifiable)

- A **real invoice** created fresh, paid on testnet, and viewed through
  `/r/:token` — screenshots of: the receipt in a pending/awaiting state (if
  catchable), the completed receipt, the "View receipt" link on the paid pay
  page, and the dashboard copy-link.
- The raw `/api/portal/:token` JSON shown, demonstrating only allowlisted
  fields; an invalid token demonstrated returning the generic 404.
- Confirmation the portal introduced **zero write paths** (list every route
  added).
- `PROGRESS.md` entry (session, evidence, caveats), `PORTAL_HANDOFF.md`
  deleted, committed, pushed, deployed.
