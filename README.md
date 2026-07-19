# affluents

**One payment in. Your money routes itself.**

Affluents is a programmable income router on [Arc](https://arc.io), Circle's
stablecoin-native L1 — built for the Encode x Arc "Programmable Money"
hackathon (DeFi / Payments track).

**Live:** https://affluents.money

A freelancer shares a payment link. The client pays USDC on Arc — sub-second
settlement, ~cent fee, and the USDC being paid also covers gas (no separate
gas token). The moment the payment verifies, Affluents executes the
freelancer's allocation policy:

```
                        ┌──→  Spend    (auto-converted to EURC)
income ──→  affluents ──┼──→  Reserve  (tax bucket, USDC)
                        └──→  Earn     (on-chain vault position)
```

The invoice is the entry point; the product is that **the payment itself
triggers the recipient's financial policy**.

## What works today (Arc testnet, real transactions)

- Invoice → unique payment link + QR, dedicated deposit wallet per invoice
  (never reused), claimed atomically (proven by a concurrency test).
- Client pays via MetaMask button or manual transfer; verification branches
  correctly for direct ERC-20, smart-account/router ERC-20, and native
  payments — with mandatory emitter filtering so Arc's 18-decimal EIP-7708
  system Transfer logs can never be miscounted as 6-decimal amounts.
- Balance-delta detection: partial payments aggregate naturally; a payment
  needs no browser report to be found.
- Split pipeline: sweep → FX → reserve → vault deposit, every step journaled
  intent-first and idempotent (crash-safe, no double-spends), every fee
  sponsored by Circle Gas Station.
- Exact conservation, enforced and tested: `spend + reserve + earn ==
  routed amount` in integer 6-decimal units. Overpayments are **held, never
  auto-routed** and surfaced on the dashboard.
- Dashboard: bucket totals, cumulative-received chart, split-rule editor,
  exceptions, per-movement ArcScan links.

## Circle / Arc tools as core infrastructure

| Tool | Role |
|---|---|
| **Arc** | Settlement; USDC-as-gas; sub-second deterministic finality |
| **Circle Dev-Controlled Wallets (SCA)** | Entire wallet layer: deposit pool + treasury/spend/reserve |
| **Circle Gas Station** | Sponsors every sweep/transfer/deposit — no gas buffers anywhere |
| **USDC + EURC** | Pay in USDC, hold Spend in EURC |
| **Arc App Kit** (next) | Real USDC→EURC swap quotes |

**Honest-demo notes:** the Earn bucket is our own `DemoVault` — a minimal
on-chain position, clearly labeled, no invented yield. The EURC conversion
currently uses a fixed rate labeled "demo rate" in the UI until the App Kit
swap integration lands.

## Architecture

```
worker/        Cloudflare Worker — web app + JSON API + orchestrator-only
               internal API (shared secret). State of record: D1.
orchestrator/  Node 22 daemon (pm2, outbound-only) — chain watching, payment
               verification, and the split pipeline via Circle APIs. All state
               access goes through the Worker's authenticated internal API.
contracts/     Foundry — DemoVault.sol (ERC-4626-style, 6-dec USDC interface).
shared/        Branded money-math (Usdc6/Eurc6/Native18): the single 18→6
               boundary, split conservation — unit-tested, no floats anywhere.
design/        Validated design reference (tokens, screens, confluence glyph).
```

Key invariants live in [CLAUDE.md](CLAUDE.md) (money-handling rules) and
[SPEC.md](SPEC.md) (full specification). Progress log: [PROGRESS.md](PROGRESS.md).

## Running tests

```bash
npm install
npx vitest run          # money math + verifier branches (29 tests)
cd contracts && forge test   # DemoVault logic
# wallet-claim concurrency test (against a deployed instance):
BASE_URL=... INTERNAL_API_KEY=... node worker/test/claim-concurrency.mjs
```

Testnet only. No secrets are committed; see `.env` handling in START_HERE.md.
