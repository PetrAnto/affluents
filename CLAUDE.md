# CLAUDE.md — Affluents project rules (v3)

## What this project is
**Affluents** (https://affluents.money) — a programmable income router on Arc,
Circle's stablecoin-native L1. **One payment in. Your money routes itself.**
A freelancer shares a payment link; the client pays USDC on Arc; the verified
payment automatically executes the freelancer's allocation policy: **Spend**
(swapped USDC→EURC), **Reserve** (USDC tax bucket), **Earn** (on-chain vault
position). Built for the Encode x Arc "Programmable Money" hackathon.
Specification: SPEC.md · Brand & design: BRAND.md · Current state: PROGRESS.md.
Project slug `affluents` everywhere: repo name, VPS path `~/affluents`,
worker name, package names.

## Who you are working with
The operator is **not a developer**:
- You write 100% of the code. Never ask the operator to write or edit code.
- When a step needs a human (browser, approvals, faucet, Circle Console, video),
  STOP and give ONE numbered plain-language instruction at a time with exact
  commands/clicks; wait for confirmation; verify the result yourself; continue.
- Explain errors simply first, then fix them yourself.

## Hard deadlines (2026)
- **Sun Jul 26:** Checkpoint 2 — public repo + progress summary on Encode.
- **Sun Aug 9:** Internal freeze — submission-ready (MVP on Arc, repo, 3-min
  video, deck). Encode's page lists Aug 9 as final submission; the operator
  confirms the official deadline in the Encode dashboard during Phase 1.
- Scope discipline beats features. Cut scope, never the deadline.

## ⚠️ CRITICAL: Arc's dual USDC representation (source: docs.arc.io, EVM differences)
Native USDC and the ERC-20 USDC interface are THE SAME ASSET, two views:
- **Native — 18 decimals** — gas, native sends, `msg.value`, `addr.balance`.
- **ERC-20 — 6 decimals** — `balanceOf`, `transfer`, `approve`. Contract
  addresses fetched from docs.arc.io/arc/references/contract-addresses.
Project invariants:
1. ALL business/accounting amounts are 6-decimal ERC-20 units, in variables
   suffixed `...Usdc6` / `...Eurc6`. A bare `amount` is a code-review failure.
2. Native 18-dec values live ONLY in gas/boundary code, suffixed `...Native18`,
   converted explicitly at the boundary, never compared raw against 6-dec.
3. **Payment verification branches by payment type — there is NO single
   `tx.to` rule:**
   - ERC-20, direct UI payment (our payment page's `USDC.transfer`):
     successful receipt; `tx.to == the verified USDC contract`; a
     `Transfer(from, depositAddr, amountUsdc6)` log emitted BY THE USDC
     CONTRACT (filter on emitter address — Arc also emits EIP-7708 system
     Transfer logs at 18 dec from a system emitter; matching on emitter
     prevents double-count/confusion); amount in 6-dec units.
   - ERC-20, generic observed/manual payment: same receipt + USDC-contract
     Transfer-log requirements, but the OUTER `tx.to` is NOT constrained —
     smart accounts, routers, and batchers legitimately produce the
     authoritative Transfer log while targeting another contract. The emitter
     filter stays mandatory.
   - Native payment: successful receipt; `tx.to == depositAddr`; `tx.value` is
     18-dec, converted per the 18→6 floor+dust rule before comparison.
4. Detection fallback reads `USDC.balanceOf(depositAddr)` (6 dec) as a
   **delta above the wallet's recorded baseline** — one view of the single
   balance, catches both payment forms and aggregates partials.
5. Unit tests: 18↔6 conversion boundaries; a regression proving invoice
   comparison uses 6-dec ERC-20 units; verifier tests for BOTH payment
   branches; split-conservation test (see SPEC §5b).
6. anvil is a standard EVM and CANNOT reproduce Arc semantics — chain-behavior
   tests run against the real Arc testnet RPC.
Also: native transfers can revert even with sufficient balance (zero-address,
blocklist, burn rules) — handle reverts on every send.

## Money-handling invariants (see SPEC §5b–§5d for full detail)
- **Wallet layer:** primary = Circle Developer-Controlled **SCA** wallets +
  **Gas Station** (both documented for Arc testnet, Circle docs Jul 2026 —
  re-verify at session start; Gas Station requires SCA, not EOA, on EVM).
  Fallback = HD EOAs + pre-funded ops gas buffer.
- **Gas/ops accounting is separate from user buckets.** On the primary
  SCA+Gas-Station path deposit wallets need no buffer; on the EOA fallback,
  wallets carry a small pre-funded ops buffer. On BOTH paths: detection uses
  delta-above-baseline; the sweep moves exactly the verified payment amount;
  ops costs and residuals never touch Spend/Reserve/Earn ledger entries.
- **18→6 boundary:** `usdc6 = floor(native18 / 10^12)`; sub-micro dust
  (`native18 % 10^12`) is never promoted into business units — it stays
  operational residual. Boundary test required.
- **Split rounding:** floor Reserve, floor Earn, Spend = remainder
  (deterministic remainder → Spend); `spendIn + reserve + earn == routed
  amount` exactly, in integer 6-dec units. Branded types `Usdc6`/`Eurc6`.
- **Overpayment / unexpected payment: never auto-routed.** The invoice amount
  follows the policy; any excess or post-completion payment is swept to the
  internal `exception_hold` ledger state, flagged (`overpaid` /
  `unexpected_payment`), surfaced for review — never FX-swapped, never
  vault-deposited, never auto-counted as Reserve.
- **One wallet = one invoice, never reused.**

## Verified Arc testnet facts (July 2026 — re-verify at session start)
Chain ID **5042002** (0x4cef52) · RPCs (official, docs.arc.io Jul 16 2026):
https://rpc.testnet.arc.network (primary) · https://rpc.drpc.testnet.arc.network
· https://rpc.blockdaemon.testnet.arc.network · https://rpc.quicknode.testnet.arc.network
(earlier third-party URLs arc-testnet.drpc.org / 5042002.rpc.thirdweb.com are
superseded) · Docs (authoritative; index
https://docs.arc.io/llms.txt) https://docs.arc.io · Explorer
https://testnet.arcscan.app · Faucet (operator/browser) https://faucet.circle.com
· EVM Osaka baseline + EIP-7708 · deterministic sub-second finality (1
confirmation = final) · block timestamps non-decreasing (order by number).
Third-party RPC-provider docs have been wrong before; official docs override
everything including this file (update it on conflict).

## Architecture v3 (settled — do not redesign)
- `worker/` — Cloudflare Worker: frontend (landing, invoice creation, payment
  page, dashboard — styled per BRAND.md Direction A unless the operator picks
  otherwise) + JSON API + orchestrator-only internal API (shared secret
  header). **State of record: D1** — invoices, deposit_wallets, split_rules,
  executions, ledger. Wallet claim is an atomic D1 operation whose invariant is
  "two concurrent invoice creations can never receive the same wallet" —
  mechanism = whatever D1 supports at implementation time, proven by a
  concurrency test. Deployed non-interactively via wrangler.
- `orchestrator/` — Node 22 daemon on this VPS (pm2): chain + Circle API work;
  ALL application-state access goes through the Worker's authenticated
  internal API — an intentional design choice (D1 does expose an HTTP API;
  we deliberately don't use it from the VPS). Durable execution journal:
  intent row BEFORE any send; restart
  reconciliation against on-chain state before acting. Idempotent per
  execution_id.
- `WalletAdapter`: primary **Circle Developer-Controlled Wallets** (pre-created
  pool; CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET); fallback HD-mnemonic EOAs
  (generated only if needed — see START_HERE; never the operator's payer
  wallet). Go/no-go recorded in PROGRESS.md.
- `FxAdapter`: primary **Arc App Kit swap USDC→EURC** (real quote output, never
  hardcoded); fallback TreasuryFxAdapter (fixed labeled rate, honest UI copy).
- `YieldAdapter`: primary our `DemoVault` (honest copy per BRAND.md); real
  protocol only if verified live + permissionless.
- NO Paymaster/AA in MVP. Pitch: the payer needs no gas token — the USDC being
  paid also covers the ~cent fee.

## Non-negotiable rules
1. `.env` NEVER committed; `.gitignore` in the first commit; no key, entity
   secret, or mnemonic in logs, errors, commits, or chat output.
2. Testnet only. All application/business/accounting amounts use the 6-decimal
   ERC-20 USDC/EURC representation; native 18-dec values are isolated to
   explicitly named gas/boundary code; never compare raw 6-dec and 18-dec.
3. Adapters + fallbacks as above; the demo must survive any third-party outage.
4. Commit early and often; push to the public `affluents` repo.
5. Verify, don't recall — first-session checklist in KICKOFF_PROMPT.md.
6. Keep PROGRESS.md updated after every phase; assume the session dies anytime.

## Style
TypeScript everywhere; viem. Plain readable code; unit-suffixed amounts
mandatory. Frontend: server-rendered HTML + minimal vanilla JS from the Worker;
follow BRAND.md (palette tokens, type, voice, the confluence signature); the
payment page is the demo star — polish it first. README for judges: what/why
Arc, architecture diagram, Circle tools used, live link, honest demo-vault
disclosure.
