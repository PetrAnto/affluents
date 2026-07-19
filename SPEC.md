# SPEC.md — v3 — Affluents: programmable income router on Arc

Hackathon: Encode x Arc "Programmable Money" (Jul 13 – Aug 22, 2026)
Track: DeFi / Payments. Judging: working prototype on Arc; clear use of Circle
developer tools; real use case with a path to production; quality of execution
over complexity.

## 0. Changelog v2 → v3
1. **Brand settled: Affluents / affluents.money** (see BRAND.md — foundation
   validated by the operator; only material legal/trademark findings reopen it).
2. **Payment verifier corrected (P0):** explicit ERC-20 vs native branches —
   `tx.to == depositAddress` is only true for native payments; ERC-20 payments
   target the USDC contract and are verified via the USDC-contract-emitted
   Transfer log (emitter-filtered against EIP-7708 system logs).
3. **Gas/ops accounting model defined (§5b):** ops buffer + baseline-delta
   detection + sweep-exact; user buckets never absorb network costs; the
   100 → 60/25/15 demo stays mathematically exact.
4. **Payment edge-case policy defined (§5c).**
5. **Split rounding/conservation invariant defined (§5d).**
6. **D1 wallet claim stated as an invariant + concurrency test**, not a SQL
   syntax requirement.
7. Payer test wallet separated from fallback infra wallet; WALLET_MNEMONIC no
   longer required before first-session verification (START_HERE).
8. All PayFlow/INCOMEROUTER-era names and paths removed; slug `affluents`.
(The "6-decimal native USDC" wording that survived in v2's KICKOFF safety
rails is corrected everywhere; see CLAUDE.md invariant #2.)

## 0b. Changelog v3 → v3.1 (patch — no architecture reopened)
1. Wallet layer made explicit: **primary = Circle Dev-Controlled SCA wallet
   pool + Gas Station** (both documented as supporting Arc testnet, Circle
   docs Jul 2026 — re-verify at session start); **fallback = HD EOA + ops gas
   buffer**. §5b buffer scoped to the EOA fallback.
2. ERC-20 verifier split into **direct UI payment** (strict `tx.to` check) vs
   **generic observed payment** (authoritative USDC-contract Transfer log;
   outer `tx.to` unconstrained) — smart accounts/routers pay legitimately.
3. Explicit native **18→6 floor conversion + dust rule** with boundary test.
4. **Overpayment / unexpected-payment policy reversed** (operator + reviewer
   decision): excess is never auto-routed; it goes to an internal
   `exception_hold` ledger state, flagged for review. Reversibility > elegance.
5. `.env` entity-secret placeholder emptied (truthy-string bug). D1 wording
   corrected (architectural choice, not platform limit). Rounding comment
   corrected (remainder → Spend). Runtime amount types distinguish
   `Usdc6`/`Eurc6`. Confluence glyph = primary symbol; ffl ligature =
   secondary signature (BRAND.md).

## 1. Product in one paragraph
**One payment in. Your money routes itself.** A freelancer (EU-based, paid by
international clients) shares an Affluents payment link. The client pays USDC
on Arc — sub-second settlement, ~cent fee, no separate gas token: the USDC
being paid also covers the fee. The moment the payment is verified, Affluents
executes the freelancer's allocation policy: e.g. 60% swapped to EURC as
spendable money, 25% reserved for taxes in USDC, 15% deposited into an
on-chain vault. The dashboard shows the buckets filling in real time, every
movement linked to the explorer. The invoice is the entry point; the product
is that **the payment itself triggers the recipient's financial policy**.

## 2. User stories (MVP)
1. Freelancer creates an invoice (amount USDC, client label, memo) → unique
   URL + QR instantly (wallet pre-assigned from the pool).
2. Client opens the URL, sees the amount + "Pay N USDC" (MetaMask/EIP-1193),
   which calls `USDC.transfer(depositAddr, amountUsdc6)`; on wallet success the
   page POSTs the txHash; page flips to "Paid ✓" with explorer link within
   seconds. Manual-payment instructions (address + QR) as alternative.
3. Freelancer sets the split rule once (three integer percentages, sum 100).
4. Dashboard: total received; Spend (EURC) / Reserve (USDC) / Earn (vault)
   buckets; per-invoice history; explorer link on every transaction; overpaid /
   unexpected-payment flags surfaced, never silent.
5. (Stretch) Withdraw from Earn back to Spend.
OUT of scope: multi-user/auth (single profile behind a URL secret), fiat
ramps, notifications, >2 currencies, mobile app, AI features.

## 3. System components

### 3.1 `worker/` — Cloudflare Worker (web app + API + D1)
Routes:
- `GET /` landing (BRAND.md) + create-invoice form
- `POST /api/invoices` → atomically: insert invoice + claim one free wallet
  from `deposit_wallets`. **Invariant: two concurrent creations can never
  claim the same wallet** — use whatever atomic mechanism current D1 supports
  (verify at implementation time), and prove it with a concurrency test firing
  parallel creations. Payment URL returned immediately. Empty pool →
  `awaiting_wallet` (orchestrator replenishes; should not occur with a
  pre-filled pool).
- `GET /pay/:invoiceId` payment page (the demo star — BRAND.md Direction A).
- `POST /api/invoices/:id/payment-report` {txHash} → stored `reported`.
- `GET /api/invoices/:id` status JSON (page polls ~3s).
- `GET /dashboard/:secret` buckets, history, rule editor.
- `POST /api/internal/*` orchestrator-only (`X-Internal-Key`): pull work,
  write verifications, journal steps, post ledger deltas. **All D1 access goes
  through the Worker — Affluents intentionally performs no direct D1 access
  from the VPS; all orchestrator state access goes through the Worker's
  authenticated internal API.**

D1 schema (wrangler migrations):
- `invoices(id, amount_usdc6, label, memo, status, wallet_id, created_at,
  paid_txs, paid_at, received_usdc6, overpaid_usdc6)`
- `deposit_wallets(id, address, circle_wallet_id, status[free|assigned|retired],
  invoice_id, baseline_usdc6, buffer_native18)`
- `split_rules(id, spend_pct, reserve_pct, earn_pct, updated_at)`
- `executions(id, invoice_id, step[verify|sweep|fx|reserve|earn|reclaim],
  status[intent|sent|confirmed|failed], tx_hash, amount_usdc6, amount_out6,
  attempt_count, created_at, updated_at)`
- `ledger(id, bucket[spend|reserve|earn|ops], token, delta6, tx_hash,
  invoice_id, created_at)`
Invoice states: `created → awaiting_payment → payment_reported →
payment_verified → routing → completed` + `overpaid` flag,
`failed_retryable | failed_terminal`, `unexpected_payment` post-completion flag.

### 3.2 `orchestrator/` — Node 22 daemon on the VPS (pm2)
Loop (~5s), all steps journaled intent-first and idempotent per execution_id;
restart reconciles `intent|sent` rows against on-chain state before acting.
1. Pull work from the internal API.
2. **Verify reported payments — branch by type (CLAUDE.md invariant #3):**
   - ERC-20, direct UI payment (payment-page `USDC.transfer`): receipt
     success; `tx.to ==` verified USDC contract; matching USDC-contract
     `Transfer` log to the deposit address (emitter-filtered vs EIP-7708
     system logs); amount in 6-dec.
   - ERC-20, generic observed/manual payment (incl. smart accounts, routers,
     batchers): receipt success; matching `Transfer` emitted by the verified
     USDC contract to the deposit address; the outer `tx.to` is NOT
     constrained. The emitter filter stays mandatory.
   - Native: receipt success; `tx.to == depositAddr`; `tx.value` converted at
     the boundary per the 18→6 rule: `usdc6 = floor(native18 / 10^12)`,
     `dust = native18 % 10^12`; business credit uses `usdc6` only; sub-micro
     dust is never promoted to business units and remains operational
     residual (boundary test required).
   Finality: 1 confirmation. Credit `received_usdc6` per §5c.
3. **Fallback watcher:** poll `USDC.balanceOf(depositAddr)`; payment progress =
   delta above the wallet's recorded `baseline_usdc6`; locate funding tx(s)
   for the audit trail, verify as above.
4. **Split pipeline** per §5b–§5d: sweep exact verified amount → treasury;
   FX leg (FxAdapter) → Spend; Reserve transfer; Earn deposit (YieldAdapter);
   post ledger deltas; retire wallet.
Wallet ops via WalletAdapter:
- **Primary: Circle Developer-Controlled SCA wallets + Circle Gas Station +
  pre-created pool.** Circle docs (Jul 2026) list Arc testnet support for
  dev-controlled wallets (EOA and SCA), Gas Station sponsorship on Arc
  testnet with a preconfigured testnet policy, and Gas Station requiring an
  ERC-4337 SCA on EVM chains. Re-verify at session start; on this path
  deposit wallets need **no gas buffer**.
- **Fallback: HD-derived EOAs + pre-funded ops gas buffer** (§5b buffer model
  applies to this path only).
Pool maintenance: keep ≥ N free wallets; batch-create (and pre-fund, EOA path
only) when low.

### 3.3 `contracts/` — Foundry
`DemoVault.sol`: minimal ERC-4626-style vault on the USDC ERC-20 interface;
honest UI copy per BRAND.md. Deployed via forge script. anvil cannot reproduce
Arc semantics — integration tests run against testnet RPC. (Stretch, only after
full MVP: `SplitVault.sol` on-chain splitter.)

## 4. Circle / Arc tools showcased
1. **Arc** — settlement; USDC-as-gas; sub-second deterministic finality (show
   the timestamp delta in the demo).
2. **Circle Developer-Controlled Wallets** — deposit pool + treasury (core
   infrastructure, not a README mention). **Gas Station** — gasless SCA
   sweeps on the primary path (documented for Arc testnet).
3. **Arc App Kit** — real USDC→EURC swap (multi-currency story).
4. **USDC + EURC** — payment in, multi-currency out.
5. Roadmap slide: CCTP/Bridge Kit (pay from another chain), smart accounts +
   Paymaster (true gasless), genuinely rule-based treasury policies.

## 5. Money-handling design (the invariants that make the demo honest)

### 5a. Adapter strategy (demo must survive any outage)
`WalletAdapter`: `circle` | `hd` · `FxAdapter`: `appkit` | `treasury` ·
`YieldAdapter`: `vault` | `protocol`. Selection via env; every choice + reason
logged in PROGRESS.md. Real swap outputs are whatever the quote returns.

### 5b. Gas & ops accounting (user buckets never pay network costs)
- Scope: this buffer model applies to the **HD/EOA fallback path**. On the
  primary SCA + Gas Station path, sweeps are sponsored and deposit wallets
  need no buffer.
- (EOA path) Every free deposit wallet is pre-funded with a small **ops
  buffer** (native, for sweep gas).
- On assignment, record `baseline_usdc6 = USDC.balanceOf(wallet)`.
- Payment detection/credit = **delta above baseline**, never raw balance.
- Sweep moves **exactly `received_usdc6`** (up to routing policy §5c), not the
  wallet balance; gas comes from the buffer.
- Ops costs and wallet residuals are ledgered under `ops`, invisible to
  Spend/Reserve/Earn. Retired wallets' residuals are reclaimed by a
  non-blocking maintenance `reclaim` step.
- Treasury keeps its own ops gas reserve, also ledgered `ops`.
Result: `100 USDC received → 60/25/15 routed`, exactly, honestly.

### 5c. Payment edge-case policy (deterministic)
- Wallet-button flow sends the exact amount.
- **Underpayment:** invoice stays `awaiting_payment`; page shows
  "received X of N". Partial payments **aggregate naturally** via
  baseline-delta: invoice is paid when cumulative delta ≥ `amount_usdc6`;
  all funding txs recorded in `paid_txs`.
- **Overpayment:** never silent, never auto-routed. The invoice amount is
  routed by the Spend/Reserve/Earn policy; the excess goes to an internal
  **`exception_hold`** ledger state (swept to treasury, not FX-swapped, not
  vault-deposited), invoice flagged `overpaid`, dashboard shows
  "Overpayment received: +X USDC — held for review, not routed
  automatically." Rationale: an overpayment may be a mistake or a duplicate
  and may need returning; reversibility beats conservation elegance.
- **Payment to an already-completed invoice:** wallets are never reused; a
  post-completion delta is swept to **`exception_hold`**, flagged
  `unexpected_payment`, and prominently surfaced. It is never auto-counted as
  Reserve — Reserve means intentional allocation.

### 5d. Split rounding & conservation
```
reserveUsdc6 = floor(receivedUsdc6 * reservePct / 100)
earnUsdc6    = floor(receivedUsdc6 * earnPct   / 100)
spendInUsdc6 = receivedUsdc6 - reserveUsdc6 - earnUsdc6   // deterministic rounding remainder → Spend
invariant:  spendInUsdc6 + reserveUsdc6 + earnUsdc6 == receivedUsdc6  (exact, integers)
```
Enforced by a unit test; integer 6-dec math only (bigint), no floats anywhere
near money. Runtime types distinguish `Usdc6` and `Eurc6` (branded types);
`amount_out6` rows carry an `output_token` column.

## 6. Milestones
### Phase 1 — Skeleton (within 3 days of starting)
Inspect-first environment check (START_HERE Phase 1); facts verified from
docs.arc.io + Circle docs (contract addresses, App Kit swap on testnet,
dev-wallet + Gas Station support, D1 atomic mechanism) and recorded; repo
`affluents` created (verify name free) and pushed public; Worker + D1 deployed
with migrations; orchestrator connects to RPC + internal API under pm2.
Operator confirms the official Encode deadline in the dashboard.
### Phase 2 — Payment loop (by Jul 22)
Wallet pool created + buffered; invoice → instant URL → operator pays with the
**payer** MetaMask → txHash reported → verified via the correct branch →
`payment_verified`. Fallback watcher proven by a manual payment without the
report. Underpay/overpay behaviors demonstrated on testnet.
### Phase 3 — Checkpoint (hard: Jul 26)
Split pipeline end-to-end on at least fallback adapters, conservation test
green; dashboard with buckets + explorer links; operator submits repo +
summary on Encode (Claude Code drafts it).
### Phase 4 — Upgrades & polish (Jul 27 – Aug 5)
App Kit FX live; Circle wallets live; BRAND.md Direction A applied (payment
page first), confluence glyph + signature animation; QR, error/empty states;
withdraw-from-Earn; rule-editor UX. SplitVault only if everything is stable.
### Phase 5 — Submission package (Aug 6 – Aug 9 internal freeze)
Judge-facing README + diagram; 3-min video (script + shot list by Claude Code;
operator records); ~8-slide deck → PDF; submit on Encode before the confirmed
deadline.

## 7. Acceptance test (the demo script)
1. Dashboard open: buckets at a known state.
2. Create invoice "Logo design — 100 USDC". Payment URL appears instantly.
3. Second browser profile (client) pays with MetaMask.
4. Within ~15 seconds the page flips to "Paid ✓"; the signature animation
   routes the payment; the dashboard shows: Spend + (actual EURC output of the
   60-USDC swap as quoted — fixed labeled rate if on the treasury fallback),
   Reserve +25 USDC, Earn +15 USDC — each with a working ArcScan link, and
   `60 + 25 + 15 == 100` exactly in the ledger.
5. Under 60 seconds total. That is the money shot of the video.
