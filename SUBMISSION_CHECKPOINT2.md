# Affluents — Checkpoint 2 progress summary
Encode x Arc "Programmable Money" hackathon · DeFi / Payments track
Submitted: July 2026 (checkpoint due Jul 26)

**Live app:** https://affluents.money · **Repo:** https://github.com/PetrAnto/affluents

## One payment in. Your money routes itself.

Affluents is a programmable income router for freelancers on Arc. Share a
payment link; when your client pays USDC, the payment itself executes your
allocation policy: **Spend** (auto-converted to EURC), **Reserve** (tax
bucket), **Earn** (on-chain vault position). The invoice is the entry point —
the product is that money routes itself the moment it arrives.

## Working today on Arc testnet (not mocked, not local)

- **Full payment loop, live:** create an invoice at affluents.money → unique
  payment link + QR with a dedicated deposit wallet → client pays with
  MetaMask (or manually) → payment verified on-chain → the split pipeline
  automatically sweeps, converts, reserves, and vault-deposits — every
  movement linked to ArcScan from the dashboard and the payment page.
- **Real money proven:** four invoices routed end-to-end on testnet.
  Conservation is exact to the micro-dollar, verified against both our ledger
  and on-chain balances: 3.00 USDC routed as 1.656 EURC (Spend) + 0.75 USDC
  (Reserve) + 0.45 USDC (vault Earn position).
- **Honest edge cases:** partial payments aggregate (a native send and an
  ERC-20 transfer summed to one invoice); overpayments are **held, never
  auto-routed** — flagged on the dashboard as "Extra X USDC received — held,
  not routed", because an overpayment may be someone's mistake.
- **Arc-correct verification:** the verifier branches by payment type
  (direct ERC-20 / smart-account ERC-20 / native), filters Transfer logs by
  emitter so Arc's 18-decimal EIP-7708 system logs can never be miscounted
  as 6-decimal amounts, and applies the documented 18→6 floor-and-dust rule
  at the native boundary. All of this is unit-tested (29 tests) plus a
  concurrency test proving two simultaneous invoices can never claim the
  same deposit wallet.
- **Crash-safe money movement:** every pipeline step journals an intent row
  before any send and reconciles provider/on-chain state on restart — no
  double-spends, ever.

## Circle / Arc tools used as core infrastructure

- **Arc:** settlement layer; USDC-as-gas (payer needs no separate gas token);
  sub-second deterministic finality — payments verify in ~1 block.
- **Circle Developer-Controlled Wallets (SCA):** the entire wallet layer —
  a pre-created pool of deposit wallets (one per invoice, never reused) plus
  treasury/spend/reserve role wallets.
- **Circle Gas Station:** every sweep, transfer, and vault deposit is
  sponsored — no wallet in the system holds a gas buffer.
- **USDC + EURC:** pay in USDC, hold Spend in EURC (multi-currency by
  default). The EURC conversion currently uses a fixed, clearly-labeled
  demo rate; swapping to the real Arc App Kit USDC→EURC quote is next.

## Next (by final submission)

Arc App Kit live FX quotes · dashboard upgrades (time-range selector,
by-client view, auto-refresh) · read-only client portal · withdraw from
Earn · demo video. Architecture, invariants, and money-handling rules are
documented in SPEC.md and CLAUDE.md in the repo.
