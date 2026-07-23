# PROGRESS — Affluents
Updated: 2026-07-23 12:40 UTC
Phase: 3 — Split pipeline CORE COMPLETE on testnet (fallback FX adapter)
→ next: Checkpoint 2 submission draft (due Jul 26), then Phase 4
Live Worker URL: https://affluents.money (canonical, custom domain + www)
GitHub: https://github.com/PetrAnto/affluents

## Phase 3 — split pipeline PROVEN end-to-end 2026-07-16
- DemoVault deployed: 0x2c22bf430369aaa2caf83a473a702d3aa2a99ee0 (deployer
  EOA in .env, testnet-only). Treasury max-allowance granted via Circle
  contract execution (Gas Station sponsored, no gas held by any role wallet).
- Role wallets (Circle SCA): treasury 0x87ae…99cd · spend 0x083b…dbc8 ·
  reserve 0x6b04…6ffe. FX = TreasuryFxAdapter, fixed demo rate 0.92
  EURC/USDC (FX_RATE_EURC_PER_USDC_PPM=920000), labeled "demo rate" in UI.
- FOUR invoices routed automatically (sweep→fx→reserve→earn, all journaled,
  every step gasless via Gas Station): 2026-003 (1.00), 2026-004 (0.50),
  2026-005 (0.50 routed + 0.50 excess → exception_hold, NOT routed),
  2026-006 (1.00).
- Conservation verified THREE ways, exact to the unit:
  ledger: spend-in 1,800,000 + reserve 750,000 + earn 450,000 = 3,000,000
  routed; spend out 1,656,000 EURC = 1,800,000 × 0.92; exception 500,000.
  on-chain: spend wallet EURC 1,656,000 ✓ · reserve wallet USDC 750,000 ✓ ·
  vault position 450,000 ✓ · treasury USDC 2,300,000 (spend-in + held) ✓.
- Restart-safety: every step journaled intent-first with Circle provider_ref;
  re-runs reconcile, completion is one atomic D1 batch (idempotent).
- Remaining Phase 3 niceties → Phase 4: routed-summary rows verified on the
  payment page (data present; visually check), withdraw-from-Earn, App Kit FX.

## Phase 2 acceptance — PASSED 2026-07-16
1. Wallet-button payment (invoice 2026-003, 1.00 USDC): verified via
   erc20_direct branch; EIP-7708 system log (emitter 0xff…fe) ignored; page
   flips Paid ✓. Fallback watcher ALSO proven (report POST never arrived;
   delta-above-baseline credited it).
2. Underpayment + aggregation (2026-004, 0.50): manual native send 0.20 →
   Partial "Received 0.20 of 0.50", bar 40%, remaining-button 0.30 →
   erc20_direct; 200000+300000 = 500000 exact; native 18→6 floor proven with
   real tx (zero dust). Mixed native+ERC-20 partials aggregate on one invoice.
3. Overpayment (2026-005, 0.50 invoiced, 1.00 sent native): Paid ✓ with glyph
   hidden (exception state), payer note; dashboard Exceptions card exactly
   "Extra 0.50 USDC received — held, not routed"; D1: overpaid=1,
   overpaid_usdc6=500000. Excess will NOT be routed in Phase 3 — sweep splits
   only amount_usdc6, excess → exception_hold ledger.
Paid UI links every verified funding tx to ArcScan (operator request).
Open minor item: stale operator invoice 2026-001 (awaiting_wallet, created
when the pool was empty) — offered deletion; also awaiting_wallet invoices are
not auto-assigned a wallet when the pool refills (backlog for Phase 3/4).

## Phase 2 state (2026-07-16 afternoon)
- Circle: entity secret registered programmatically (recovery files in
  ~/affluents-secrets/, OUTSIDE repo); wallet set
  <redacted — see .env on server>; 10 SCA deposit wallets live in pool.
- REAL PAYMENT VERIFIED end-to-end: invoice 2026-003 (1.00 USDC), tx
  0xc64fdf2f…c476 — erc20_direct branch, USDC-emitter log credited at 6-dec,
  EIP-7708 system log (18-dec, emitter 0xff…fe — real address observed)
  correctly ignored. Detection came from the balance-delta watcher (the
  page's payment-report never arrived → fallback path ALSO proven). Page
  shows Paid ✓; audit trail attached by the log scan.
- payState mapping: payment_verified/routing/completed → paid (payer view);
  payment_reported → verifying. Audit scan uses raw eth_getLogs, 2k-block
  chunks, per-wallet resume cursor; verified invoices stay watched until
  routing consumes them.
- Remaining for Phase 2 acceptance: underpayment (partial) and overpayment
  (exception_hold flag) demos on testnet.

## Verified facts (from docs, with dates)
All verified 2026-07-16 from official sources unless noted.
- **Arc testnet chain ID:** 5042002 (docs.arc.io/arc/references/connect-to-arc).
- **Official RPCs:** https://rpc.testnet.arc.network (primary),
  https://rpc.drpc.testnet.arc.network, https://rpc.blockdaemon.testnet.arc.network,
  https://rpc.quicknode.testnet.arc.network. WebSocket: wss://rpc.testnet.arc.network.
  Explorer: https://testnet.arcscan.app. (CLAUDE.md updated; .env uses the primary.)
- **USDC (native, dual interface):** `0x3600000000000000000000000000000000000000`
  — native 18 dec (gas, msg.value, addr.balance), ERC-20 interface 6 dec
  (balanceOf/transfer/approve). Same underlying balance; ERC-20 view truncates.
- **EURC (ERC-20, 6 dec):** `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`.
- **EVM differences confirmed:** Osaka baseline; EIP-7708 system Transfer logs
  (18-dec, system emitter) on every native movement — verifier MUST filter
  Transfer logs by emitter == USDC contract; native transfers can revert
  despite sufficient balance (zero address, blocklist, self-destruct rules);
  deterministic instant finality (1 conf); block timestamps non-decreasing,
  may repeat — order by block number; PREVRANDAO=0; no blob txs.
- **Circle Dev-Controlled Wallets on Arc testnet:** supported — `ARC-TESTNET`
  with EOA ✅ SCA ✅ MSCA ✅ (developers.circle.com/wallets/supported-blockchains).
- **Gas Station on Arc testnet:** supported for developer-controlled wallets;
  requires ERC-4337 SCA on EVM chains (developers.circle.com/wallets/gas-station).
  "Preconfigured testnet policy" not confirmed on-page — check in Console/API
  when activating (we can create a policy via API if needed).
- **Arc App Kit swap:** `@circle-fin/app-kit` + `@circle-fin/adapter-circle-wallets`;
  documented example swaps USDC→EURC on Arc testnet with dev-controlled wallets;
  `kit.estimateSwap(params)` / `kit.swap(params)`
  (docs.arc.io/app-kit/quickstarts/swap-tokens-same-chain).
- **D1 atomicity:** `batch()` = implicit transaction (rolls back whole sequence
  on error); single statements serialized. Wallet claim implemented as a
  conditional single-statement UPDATE inside a batch — **proven by
  worker/test/claim-concurrency.mjs on the live deployment: 20 concurrent
  creations, 8-wallet pool, 8 unique assignments, 12 awaiting_wallet, PASS.**
- **Cloudflare token:** Workers deploy + D1 create/migrate both proven live.
- **VPS environment:** Node v22.23.1, npm 10.9.8, git 2.43.0, pm2 7.0.3,
  gh 2.93.0 authed as PetrAnto with push access. Other services (cloudflared
  tunnel, ttyd, node on 127.0.0.1:8080/8090/3000) untouched. Orchestrator is
  outbound-only; no tunnel ingress needed (public surface = Worker).

## Adapter go/no-go
- WalletAdapter: **circle (go, primary)** — Arc testnet SCA + Gas Station
  documented; entity secret not yet registered (programmatic registration
  planned in Phase 2). HD fallback dormant.
- FxAdapter: **appkit (go, primary)** — USDC→EURC on Arc testnet documented.
  Treasury fallback will be implemented regardless.
- YieldAdapter: **vault (go, primary)** — DemoVault; no verified live
  permissionless lending market on Arc testnet as of today.

## Done
- 2026-07-16 (session 1, morning): verification — git push access; design kit
  intact (15 files); .gitignore covers .env/.dev.vars/.wrangler before first
  commit; facts above; D1 database `affluents` created
  (uuid 5734395a-b99e-47be-9194-d257e63002d7).
- 2026-07-16 (session 1): **Phase 1 complete.**
  - npm workspaces monorepo: `shared/` + `worker/` + `orchestrator/`.
  - `shared/`: branded `Usdc6`/`Eurc6`/`Native18` types; the ONLY 18→6
    boundary (floor + dust rule); split math (floor Reserve/Earn, remainder →
    Spend); parse/format. **14 unit tests green** (boundary, conservation
    incl. 2000-case sweep, 6-dec invoice-comparison regression).
  - `worker/`: Hono app deployed. Pages implemented faithfully from /design:
    landing, create (success card + real QR via uqr), payment page (states
    awaiting/verifying/paid/partial/extra driven by status JSON, confluence
    glyph state indicator, signature animation CSS, EIP-681 deposit QR,
    MetaMask pay via USDC.transfer + payment-report), dashboard (bucket cards,
    cumulative-received step chart, split-rule editor with live validation,
    exceptions with exact copy "Extra X USDC received — held, not routed",
    invoice table). D1 migration 0001 applied remotely (all SPEC §3.1 tables +
    exception_hold bucket). Internal API (X-Internal-Key): ping, work,
    wallets, test-cleanup. Secrets INTERNAL_API_KEY + DASHBOARD_SECRET set.
  - Atomic wallet claim proven live (see D1 fact above).
  - `orchestrator/`: pm2 `affluents-orchestrator` ONLINE — verified chainId
    5042002, live block reads, ERC-20 balanceOf view, authenticated internal
    API, 5s work poll with backoff. pm2 process list saved.
- Smoke-test invoice removed; display counter reset.

## Next (Phase 2 — Payment loop, target Jul 22)
1. Circle entity secret: generate + register programmatically (API path);
   then create SCA wallet pool on ARC-TESTNET, register via internal API.
2. Orchestrator verification: both ERC-20 branches (direct UI strict tx.to;
   generic log-only) with EIP-7708 emitter filtering + native branch with
   18→6 conversion; balance-delta fallback watcher; partial aggregation;
   overpay → exception_hold (never auto-routed).
3. Operator test payment with the payer MetaMask; underpay/overpay demos.
- Operator (week 1): confirm official Encode deadline; faucet claims; run
  `pm2 startup` one-liner (needs sudo) for reboot persistence.

## Phase 4 worklist (operator-reviewed 2026-07-16; build AFTER Phase 3)
Wave 1 (small): chart timeframe selector (7d/30d/90d/All, adaptive ticks);
Outstanding stat in dashboard header; invoice table status filter + per-row
copy-pay-link + pagination.
Wave 2 (one migration, two features): `clients` table + invoice.client_id +
create-form autocomplete → by-client aggregation table (invoiced/received/
outstanding/last payment) AND the read-only client portal at `/client/:secret`
(pending + paid invoices, same URL-secret pattern, no auth — from kickoff
backlog; **do not build before the full MVP is done**).
If time before freeze: CSV export (invoices + ledger), Referrer-Policy:
no-referrer on dashboard/portal, dashboard secret rotation, exception "mark
reviewed" action.
Secrets model (documented for README): single-profile dashboard secret in
.env/Cloudflare; payment links are unguessable per-invoice URLs delivered
out-of-band; future portal = per-client random URL; production path =
passwordless magic links. Also backlog: auto-assign wallet to awaiting_wallet
invoices when the pool refills; stale invoice 2026-001 deletion (operator to
confirm).

## Blockers / decisions
- None blocking. pm2 reboot persistence pending an operator sudo one-liner.
- Design reference in /design overrides BRAND.md where more specific; glyph
  never used on exception states; dashboard chart = step chart of cumulative
  received USDC. Tunnel rule: any local public exposure goes through existing
  cloudflared config.yml (backup first), 127.0.0.1 only, operator adds Access
  policy — currently unnecessary (Worker is the public surface; orchestrator
  is outbound-only).

## How to resume
cd ~/affluents && claude   →  "Read PROGRESS.md and continue."
Worker deploy: cd worker && npx wrangler deploy (token in ../.env).
Orchestrator: pm2 status / pm2 logs affluents-orchestrator.
Tests: npx vitest run (shared) · worker/test/claim-concurrency.mjs (needs
BASE_URL + INTERNAL_API_KEY from .env).

## Checkpoint 2 deck served from the Worker — 2026-07-23
- `worker/src/pages/deck.ts` (7 slides, 1920x1080, scale-to-fit; screenshots
  loaded from the public repo) wired into `worker/src/index.ts`:
  - `GET /deck` — server-rendered HTML deck, HTML_HEADERS.
  - `GET /deck.pdf` — fetches design/checkpoint2-deck.pdf from raw.github
    usercontent and re-serves the bytes with Content-Type application/pdf +
    Content-Disposition inline, so judges get an in-browser view instead of a
    forced download. Upstream failure → 502 plain text.
- Deployed (version b5d06f7f). Verified live: /deck 200 text/html with 7
  `class="slide"` blocks · /deck.pdf 200 application/pdf, body starts %PDF-1.7
  · regression check /, /create and /pay/inv_03ebe9199588b316d9 still 200.
- Note: the first request after `wrangler deploy` hit the previous version
  (404 on the new route) for a few seconds — re-check after ~30s before
  diagnosing a deploy as failed.

## Deck assets regenerated with Chromium; deck now 9 slides — 2026-07-23
- **Deck PDFs are now generated in-repo from `design/deck-print.html` via
  Playwright/Chromium**, replacing the external WeasyPrint step. WeasyPrint is
  no longer used for the deck: it did not render the web fonts or the CSS the
  deck relies on. New procedure (tooling lives in `~/deck-tools`, OUTSIDE the
  repo — never add node_modules/package.json to this repo):
  - `npm i playwright && npx playwright install chromium` (the `--with-deps`
    variant needs sudo/TTY and is not required on this VPS).
  - `page.goto('file://.../design/deck-print.html', {waitUntil:'networkidle'})`,
    wait 1500ms so Google Fonts finish, then
    `page.pdf({printBackground:true, preferCSSPageSize:true,
    width:'1920px', height:'1080px'})`.
- Screenshots retaken at **deviceScaleFactor 2**, viewport 1440x832,
  `waitUntil:'networkidle'` + 1s, written to `design/screenshots/`:
  - `landing.png` 2880x1664 — viewport crop.
  - `dashboard.png` 2880x2642 — **fullPage** (page is 1321 CSS px tall; the
    832 viewport crop cut the invoice ledger).
  - `03-payment.png` 2880x1704 — **fullPage**, from the LIVE page
    `/pay/inv_dcc00e32c56f3f03e1` (invoice 2026-003, Meridian Studio, 1.00
    USDC, Routed).
- Correction recorded: the previous `03-payment.png` was a screenshot of the
  local design prototype `design/payment.html`, not the live app — its
  invoice "2026-014 · Meridian Studio · 100.00 USDC" is mock data and no such
  invoice exists in D1, and the shot included the prototype's
  "REVIEW ONLY / Awaiting / Verifying / Paid / Partial / Extra" state
  switcher. Deck slides now use live-app captures only.
- Deck grew **7 → 9 slides**: "The payment experience" added, then dashboard
  and payment split onto dedicated slides with images constrained by
  max-height/max-width so any capture aspect ratio fits. This fixed a real
  overflow: with the fullPage dashboard on the old combined slide, content
  measured 1392px in the 1080px box and silently clipped the ledger and the
  whole routing caption. Both `design/deck-print.html` and
  `worker/src/pages/deck.ts` carry all 9 slides.
- Slide 4 figures verified against the live D1 ledger before publishing —
  spend 1.80 USDC / 1.656 EURC, reserve 0.75, earn 0.45 across 4 rows each;
  1.80 + 0.75 + 0.45 = 3.000000 exactly in 6-dec units. The 0.50 USDC
  `exception_hold` (invoice 2026-005 overpayment) is correctly excluded from
  the routed total.
- Verified after generation: all 9 slides measure scrollHeight 1080 in the
  1080 box (no clipping anywhere); PDF root /Pages /Count 9 with 9 /Type /Page
  objects; MediaBox [0 0 1440 810] pt = 1920x1080 px.
- Gotcha confirmed again: the first `/deck` read after `wrangler deploy`
  served a stale edge-cached copy (8 slides); a cache-busted request returned
  9. Re-check with `?cb=$RANDOM` before diagnosing a deploy as failed.
