# VIDEO_SCRIPT — Affluents, 3-minute demo (Checkpoint 3) · v2 hybrid

**Format**: 1920×1080 (16:9 canvas), 30 fps, ≤ 3:00. No voice-over — text cards only
(BRAND.md voice: calm, precise, zero hype). Assembly: HyperFrames (HTML/CSS cards,
captions, phone-frame composition, transitions) with plain-ffmpeg fallback if the first
test render isn't clean by the time-box.
**Spine = real recordings of live flows. Cards dress the real; they never replace it.**

**v2 change (operator-signed)**: hybrid capture. **Mobile clips (operator, 3 clips)**
for creating, paying, and the client receipt — the product's true story, shot on real
phones. **Desktop clips (cc-driven Playwright video recordings on live pages)** for the
dashboard beats — dense surfaces that must stay legible on a projection screen.
Playwright records video, not just screenshots; same honest-artifact class.

**Mobile composition rule**: 9:16 clips are never shown full-bleed. They sit in a
centered phone frame on the mist background, captions beside the frame — reads
"mobile-first" without sacrificing legibility. The phone frame **crops the status/URL
bar** of the raw recording.

**Brand tokens for all cards** (from BRAND.md): bg `#F2F4F3` mist · text `#14232A` ink ·
accent `#23617A` river · `#B8893D` reserve · `#35684F` earn · display EB Garamond,
body Inter with tabular figures. Confluence glyph as the only motif. Light theme.

---

## Recording kit

### Operator — MOBILE ONLY (3 short clips, each re-takeable)
Phone screen recorder, portrait, highest quality. Do each as a separate take:
- **Clip M1 — Create**: open `/create` (or the landing form) on the phone, fill a
  fictional client (e.g. "Ferro & Fils — 2.20 USDC"), submit, hold 3 s on the instant
  payment URL + QR.
- **Clip M2 — Pay**: open the payment link, tap "Pay 2.20 USDC", sign in the wallet
  (Rabby, as in the existing 2026-018 clip), verify animation, hold on **Paid ✓** with
  the explorer link. Fallback if the fresh take fails: reuse
  `design/media/pay-flow-mobile-rabby-2026-018.mp4`.
- **Clip M3 — Receipt**: from the paid page, open "View receipt" (`/r/…`), scroll the
  receipt + status timeline slowly, 8–10 s.
Notes: the pay and portal URLs carry no dashboard secret; the portal token being
visible is the recorded demo-era exception (the receipt shows strictly less than the
pay page). The composition crops the URL bar anyway.

### cc session — DESKTOP via Playwright video (no operator recording)
Live pages on `affluents.money`, viewport 1920×1080, `recordVideo`, page-only frames
(no browser chrome, so no secret exposure by construction — same rule as `capture.mjs`,
`DASHBOARD_SECRET` from env at runtime). Shots 5–7 are read-only. **Shot 9 moves
money**: house discipline applies — announce amount/destination, wait for the operator
go, then the script clicks Confirm and records. It is the ONLY withdrawal (scripted,
single-pending respected).

### Pre-flight (operator, with cc, before any take)
Re-read `freeWallets` (≥ 1 needed); confirm no withdrawal in flight; FX_MODE=live
untouched. **Books change during recording** (one new paid invoice + one withdrawal) —
the deck's figures slide gets its final refresh AFTER the shoot, from the post-shoot
dashboard, verbatim.

---

## Shot list

### Beat 1 — Cold open (0:00–0:12) · CARDS ONLY
**Card 1a** (Garamond wordmark `affluents`, glyph draws itself as a single line):
> **affluents**
> One payment in. Your money routes itself.

**Card 1b** (small, the one French wink, italic):
> *un affluent — a tributary: a stream that feeds a river.*

### Beat 2 — Problem (0:12–0:25) · CARDS ONLY
**Card 2a**:
> You're a freelancer in the EU. Clients pay from anywhere.
**Card 2b**:
> Then the manual work starts: convert some, set aside taxes, save the rest.
> Every single payment.
**Card 2c** (river accent):
> Affluents does it the moment the money arrives. On Arc.

### Beat 3 — THE LIVE RUN (0:25–1:30) · the money shot
A visible timer overlay (top-right, small) starts at invoice creation and stops at
routed buckets — honest proof of "under a minute". The timer spans clips M1 → M2 →
Shot 5 and must match real elapsed time across them (no acceleration; if takes are
re-shot, the timer reflects the final sequence actually shown).

- **Shot 3** (0:25–0:35) — **Clip M1, phone frame**: invoice created on the phone,
  payment URL + QR instant.
  Caption (beside frame): *Create an invoice from your phone. The payment link is
  instant — a deposit wallet is already assigned.*
- **Shot 4** (0:35–0:55) — **Clip M2, phone frame**: the client pays, verify
  animation, **Paid ✓**.
  Caption: *The client pays USDC on Arc. No gas token — the USDC itself covers the
  ~cent fee. Settlement is sub-second.*
- **Shot 5** (0:55–1:20) — **Playwright, full 16:9**: dashboard; the confluence
  animation routes the payment; the three buckets fill. Hold on the totals.
  Caption: *Verified payment → the split executes itself. Spend swapped to EURC at the
  live rate. Reserve held for taxes. Earn deposited on-chain.*
- **Shot 6** (1:20–1:30) — Timer stops. Card over a corner of the dashboard:
  > One payment in. Routed in under a minute. Every movement on ArcScan.

### Beat 4 — Honest FX (1:30–1:45) · Playwright, full 16:9
- **Shot 7** — Dashboard/invoice detail showing the FX line: journaled live rate,
  EURC actual output.
  Caption: *The rate is the pool's real quote, journaled — never a number we invented.
  If the swap can't clear our tolerance, it halts. Funds wait; the ledger never lies.*

### Beat 5 — Client receipt (1:45–2:00) · Clip M3, phone frame
- **Shot 8** — The client's receipt on their phone: status timeline, amounts.
  Caption: *The client gets a tokenized receipt — status and amounts, nothing internal.*

### Beat 6 — Withdraw from Earn (2:00–2:30) · Playwright, full 16:9
- **Shot 9** (2:00–2:20) — Dashboard: Withdraw, small amount (e.g. 0.30 → Reserve),
  confirmation step, Confirm → **defluence animation** during pending. Hold until
  completed. (Money moves: operator go before this take.)
  Caption: *Earn is a real on-chain position — and it's two-way. Withdrawals are
  journaled, idempotent, crash-safe.*
- **Shot 10** (2:20–2:30) — Withdrawals history row: two hops, two explorer links;
  click one to flash ArcScan.
  Caption: *Two hops, two transactions, exact conservation — to the unit.*

### Beat 7 — Under the hood (2:30–2:47) · CARD over a soft still
**Card 7** (single card, tabular layout, names only, no logos):
> **Built on Arc, with Circle's stack.**
> Circle Dev-Controlled SCA wallets + Gas Station — the deposit pool & gasless sweeps
> Arc App Kit — real USDC → EURC conversion
> USDC in, EURC out — one payment, two currencies
> Intent-first journal on every money path — restart-safe by design

### Beat 8 — Roadmap + close (2:47–3:00) · CARDS ONLY
**Card 8a**:
> Next: pay from any chain (CCTP) · EURC on withdraw · policy-driven treasuries
**Card 8b** (glyph converges, wordmark, URL):
> **affluents.money**
> One payment in. Your money routes itself.

---

## Card copy rules (binding)
- Sentence case, active voice, no hype adjectives, no "revolutionary/seamless/magic".
- Amounts in Inter tabular figures; never round differently than the UI does.
- "Demo Vault — on-chain position" wording if the vault is named; no invented APY.
- The French wink appears once (Card 1b) and never again.
- Captions ≤ 2 lines on screen; ≥ 2.5 s per line of reading time.

## Assembly notes (for the HyperFrames session)
- Timeline: cards are HyperFrames scenes; real clips embedded as media segments
  (mobile clips inside the phone-frame composition, URL bar cropped); hard cuts
  everywhere except ≤ 3 shader transitions (open, into Beat 3, close).
- The Beat 3 timer is an overlay synced across M1/M2/Shot 5 — it must match what the
  clips actually show (honesty rule).
- Lint → preview → one low-res test render FIRST (time-box: if not clean, fall back
  to ffmpeg concat + static title cards from the same copy; the phone-frame becomes a
  simple centered pillarbox in the fallback).
- Output: `design/media/affluents-demo-3min.mp4`, H.264, ≤ 3:00, target < 100 MB.

## Done means
- [ ] M1–M3 recorded (or M2 fallback clip adopted); dashboard secret never on screen
      (Playwright page-only by construction; phone frame crops mobile URL bars).
- [ ] Shot 9 withdrawal announced and operator-approved before the take; the only
      withdrawal of the shoot.
- [ ] Timer overlay matches real elapsed time across Beat 3.
- [ ] Final render ≤ 3:00, plays start-to-finish, silent or clean track.
- [ ] Post-shoot dashboard totals read verbatim → deck figures slide refreshed
      (both deck files), redeployed, PDF re-printed.
- [ ] Video committed under `design/media/` (or uploaded per Encode's requirement)
      and linked in the submission.
