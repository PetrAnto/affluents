# SUBMISSION_HANDOFF — Checkpoint 3 package (final cycle before submission)

Operator-signed decisions: 2026-08-06. Session scope: judge-facing README + architecture
diagram + two submission texts + link-verification pass. **Zero backend changes, zero
deploys, zero money movements.** Submission target: **Sat Aug 8** (internal freeze).
Platform deadline (read verbatim from the Encode form, operator-witnessed 2026-08-06):
**Monday, August 10, 2026 at 1:59 PM Europe/Paris** — the Aug 8→10 margin is incident
reserve, never schedule slack.

---

## SIGNED DECISIONS (frozen — do not reopen)

- **D1 — README structure**: the 9 sections listed below, replacing the current
  README entirely (git history preserves the old one; no second README file).
- **D2 — Architecture diagram**: one SVG, BRAND.md tokens (mist/ink/river/reserve/
  earn/contour; Inter for labels), committed under `design/`, embedded in the README
  via relative path. GitHub renders SVG natively — no PNG conversion step.
- **D3 — Live exposure**: the README/submission NEVER links a payable invoice
  (including awaiting invoice 2026-021). A judge with faucet funds paying it would
  change the frozen books and break deck-slide-4/video coherence. Exposed links:
  landing, /deck, /deck.pdf, YouTube video, ONE completed-invoice portal receipt
  (`/r/:token`), ArcScan pages (vault + representative txs). Dashboard secret never
  appears anywhere.
- **D4 — Video hosting**: YouTube, Unlisted (the form's Demo Video field expects a
  YouTube URL). Repo file `design/media/affluents-demo-3min.mp4` remains the copy of
  record. Operator uploads; link verified in a logged-out/private window before use.
- **D5 — Scope**: writes limited to `README.md`, one new file under `design/`
  (the SVG), and `PROGRESS.md` (closing entry). Any other write is a stop-and-ask.
  No `wrangler deploy`, no worker/orchestrator/contract/migration changes, no pm2
  actions, no D1 writes. The internal freeze standing order holds: **no live money
  movements until after submission.**
- **D6 — Team video (Accelerator field)**: YES, minimal version. Operator records
  60–90 s phone selfie video (who I am · why Affluents · why the accelerator —
  continuing post-hackathon). Same YouTube account, Unlisted. Optional field: if the
  take doesn't happen by Aug 8, submit without it — it never blocks the checkpoint.
- **D7 — Project Description (Core block, replaces the Checkpoint 2 text)** —
  operator-authored, verbatim, paste as-is:

```
Affluents.money
One payment in. Your money routes itself.
A programmable income router on Arc:
One USDC payment, automatically routed to Spend (USDC→EURC at the live App Kit rate), Reserve, and Earn (on-chain ERC-4626 position). Sub-second settlement, ~$0.01 fee paid in the same USDC.
Shipped: live USDC→EURC FX (journaled, crash-tested) · tokenized client receipts with status timeline · two-way Earn — withdrawals with intent-first journaling, exact conservation, proven crash recovery (real SIGKILL tests) · 15 invoices, 12 withdrawals, 156 tests, all on Arc testnet.
```

---

## FROZEN FACTS (sole numeric source — never chat arithmetic, never memory)

Books (frozen 2026-08-06, verbatim from dashboard): received **20.60 USDC** · Spend
**9.65 EURC** (auto-swapped from 12.06 USDC, live rate) **+ 0.03 USDC** withdrawn from
Earn · Reserve **6.21 USDC** (incl. 1.19 withdrawn from Earn) · Earn **1.79 USDC**
(vault on-chain **1,795,000 usdc6**) · exception hold 0.50 · **15 invoices / 12
withdrawals** · **156 tests**. Artifacts: video `design/media/affluents-demo-3min.mp4`
(3:00, 8.8 MB) @ `60f73d6` · deck 10 slides at `/deck`, PDF at `/deck.pdf`
(`final-deck.pdf`) · repo `github.com/PetrAnto/affluents` · live `affluents.money` ·
Worker version `b7f3cc13` · D1 migrations through 0005.

If any live read during Phase 0 disagrees with these figures: **STOP**, surface the
discrepancy to the operator, do not proceed to writing.

---

## PHASE 0 — Inventory & diagnosis (read-only, before any writing)

1. `git pull`; confirm working tree clean; confirm this is the only active session
   (one writer per repo — standing rule).
2. Read the current `README.md` end to end; list anything worth carrying over
   (badges, links, wording) and anything that must not survive (build-era framing,
   stale figures).
3. Sweep the repo for residual handoff/scaffolding files that a judge should not
   trip over (`*_HANDOFF.md`, `*_DECISIONS.md`, scratch scripts). Report the list —
   removal is an operator-approved action, not automatic (some are deliberate
   documentation).
4. Verify serving surfaces read-only, on the custom domain: `/` (landing), `/deck`
   (10 slides), `/deck.pdf` (downloads `final-deck.pdf`). Verify served Worker
   version where visible.
5. Read the dashboard books (read-only) and diff against FROZEN FACTS above.
6. Pick the ONE completed-invoice portal receipt to feature (a clean, fully-routed
   invoice with a complete timeline — a 2026-017…020 series row is the natural
   choice). Verify `/r/:token` renders logged-out. Propose it at Gate 1.
7. Collect the ArcScan URLs to feature: DemoVault address page; one payment tx; the
   two hops of one completed withdrawal. Verify each resolves.

**Gate 1 (operator)**: discrepancies (if any) acknowledged · scaffolding-removal list
approved · featured receipt + ArcScan link set approved.

---

## DELIVERABLE 1 — Judge-facing README (`README.md`, full replacement)

Voice per BRAND.md: calm, precise, zero hype; sentence case; no
"revolutionary/seamless/magic"; amounts exactly as the UI renders them. Plain text +
one table + one diagram; no badge wall, no emoji.

Structure (D1, frozen):

1. **Header** — wordmark `affluents`, tagline, one tightened paragraph (SPEC §1),
   then an immediate link block: Live · Deck · Deck PDF · Video (YouTube) · Vault on
   ArcScan. Judges click before they read.
2. **The 60-second story** — the acceptance script as 5 short bullets (invoice →
   instant link → client pays USDC on Arc → verified payment triggers the split:
   Spend swapped to EURC live, Reserve held, Earn deposited on-chain → every
   movement on ArcScan). Mirror of the video's Beat 3.
3. **Why Arc** — USDC-as-gas (payer needs no gas token; the ~cent fee comes from the
   same USDC); sub-second deterministic finality (1 confirmation = final); and the
   Arc-specific engineering: dual 18/6 decimal handling with branded `Usdc6`/`Eurc6`
   types, EIP-7708 emitter filtering in the payment verifier. Built *for* Arc, not
   just on it.
4. **Circle stack — infrastructure, not name-drops** — 4-row table: SCA Wallets +
   Gas Station · Arc App Kit · USDC + EURC · Arc L1. Columns: what it does here /
   where in the code (relative links to the actual files).
5. **Architecture** — the SVG + ~5 lines per component: Worker + D1 (state of
   record; all orchestrator access through the authenticated internal API),
   orchestrator (Node 22, pm2, intent-first journal, on-chain reconciliation on
   restart), DemoVault (ERC-4626), adapters with fallbacks.
6. **Honest money engineering** — exact conservation to the unit (band = 0);
   overpayments/unexpected payments → `exception_hold`, never auto-routed; live FX
   with computed `stopLimit` and a halt-not-degrade failure mode; the ECB oracle
   sanity check and the openly-stated testnet pool deviation; **Demo Vault
   disclosure** ("Demo Vault — on-chain position", no invented APY); the three real
   crash tests, one sentence each (graceful SIGINT mid-transfer; SIGKILL mid-vault
   with later adoption from the Circle ref; true window-1 kill with idempotent
   re-dispatch — one Withdraw event ever).
7. **See it live** — landing, deck, PDF, the featured receipt, ArcScan links.
   Explicitly per D3: no payable invoice link.
8. **Repo tour** — `worker/` · `orchestrator/` · `contracts/` · `design/` ·
   migrations · tests (156 green).
9. **Roadmap** — CCTP pay-from-any-chain · EURC-on-withdraw via the same FX engine ·
   privacy pass · policy-driven treasuries.

**Gate 2 (operator)**: full README text reviewed in-conversation before commit —
special attention to section 6 wording and the vault disclosure. The YouTube URL must
be the real one (operator supplies it before this gate; no placeholder ever commits).

## DELIVERABLE 2 — Architecture diagram (`design/architecture.svg`)

One SVG, landscape, BRAND.md tokens. Flow: client → payment link → deposit wallet
(Circle SCA) → verify (emitter-filtered) → sweep (Gas Station, gasless) → split →
three branches: Spend (App Kit USDC→EURC) / Reserve (USDC) / Earn (DemoVault
ERC-4626) — with the Worker+D1 / orchestrator boundary and the intent-first journal
visible. The confluence glyph as the skeleton. Text as real `<text>` elements
(searchable), Inter/system stack, no external font fetch (GitHub sandboxes SVG).
Verify rendering in the GitHub README preview at Gate 2.

## DELIVERABLE 3 — Submission Details text (form field, required)

~250–350 words, **plain text with simple dashes** (field may not render Markdown —
do not depend on it). Structure: (1) what it is, two sentences; (2) what was built —
the full invoice→payment→routing pipeline, live journaled FX, client receipts,
two-way Earn; (3) the process — intent-first journaling, real crash tests, exact
conservation to the unit, honest Demo Vault + testnet pool-deviation disclosure;
(4) Circle stack used as infrastructure (SCA + Gas Station, App Kit, USDC/EURC);
(5) pointers: README for the architecture walkthrough, deck, video. Figures only
from FROZEN FACTS.

**Gate 3 (operator)**: text approved in-conversation. Delivered as a paste-ready
block; the operator pastes it into the form.

## DELIVERABLE 4 — PROGRESS.md closing entry

Cycle record: what shipped (README, diagram, submission), links, the D1–D7 decision
set, and how-to-resume pointing at Demo Day prep (Q&A rehearsal: FX deviation ·
single-pending withdrawal rule; Tech Check Aug 13).

---

## OPERATOR TASKS (browser — cc emits ONE instruction at a time, bare commands, no `! `)

A. **YouTube uploads** (before Gate 2): demo video `affluents-demo-3min.mp4`,
   Unlisted, title "Affluents — One payment in. Your money routes itself. (3-min
   demo)". Team video (D6) same account, Unlisted, when recorded. Verify both play
   in a private/logged-out window. Report both URLs.
B. **Form filling** (after Gates 2–3): Project Description ← D7 text verbatim ·
   Submission Details ← Gate-3 text · Link to Demo Video ← YouTube URL · Live Demo
   Link ← `https://affluents.money` · verify pre-filled fields (Name "Affluents",
   Link to Code, Link to Presentation `https://affluents.money/deck`, project
   image, DeFi Track chip) · **tick "DeFi Track" in the required track selector**
   (DeFi only — not Agentic Economy) · Tell us about your team ← D6 URL if recorded.
C. **Commits/pushes** per the standing division of labor; long file contents via the
   GitHub web editor if SSH paste truncates.

---

## LINK-VERIFICATION PASS (operator, private/logged-out window — the "no placeholders" test)

1. `https://github.com/PetrAnto/affluents` — opens without login; README renders
   with the diagram visible; no secrets; no residual scaffolding beyond what Gate 1
   kept.
2. `https://affluents.money` — landing serves the current version.
3. `https://affluents.money/deck` — 10 slides.
4. `https://affluents.money/deck.pdf` — downloads `final-deck.pdf`, 10 slides.
5. YouTube demo link — plays start to finish, 3:00, from the exact URL going in the
   form.
6. Featured receipt `/r/:token` — renders, full timeline.
7. Every ArcScan link in the README — resolves.
8. (If D6 recorded) team video link plays logged-out.

Then: **Submit Checkpoint** (Sat Aug 8) → screenshot the confirmation (crop the URL
bar) → if the platform displays the recorded submission, re-click every link from
that view.

---

## OUT OF SCOPE (stop-and-ask on any of these)

Worker/orchestrator/contract code · migrations · deploys of any kind · pm2 actions ·
D1 writes · any money movement (standing order until after submission) · dashboard
changes · deck changes (frozen at 10 slides / `final-deck.pdf`) · video re-edits ·
landing copy edits · new routes or files beyond the three named deliverable paths.

## DONE MEANS

- [ ] Phase 0 inventory reported; books match FROZEN FACTS (or discrepancy
      operator-acknowledged before writing).
- [ ] Gate 1 passed (scaffolding list · featured receipt · ArcScan set).
- [ ] YouTube demo URL live and verified logged-out (operator task A).
- [ ] Gate 2 passed: README + SVG reviewed, committed, pushed; diagram renders in
      the GitHub preview; no placeholder anywhere in the committed README.
- [ ] Gate 3 passed: Submission Details text approved and delivered paste-ready.
- [ ] Form filled per operator task B; DeFi Track ticked in the required selector.
- [ ] Full link-verification pass green, in a private window.
- [ ] Submitted on Encode (Sat Aug 8 target); confirmation screenshot captured.
- [ ] PROGRESS.md closing entry committed and pushed.
- [ ] Nothing moves afterward: no pushes, no deploys, no withdrawals, books intact
      through Tech Check (Aug 13) and Demo Day (Aug 20).
