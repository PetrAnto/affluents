# Claude Code Handoff — App Kit Live FX

You are working in `PetrAnto/affluents`. Read `PROGRESS.md` and `SPEC.md` first —
PROGRESS.md is the authoritative technical state. This session implements live
USDC→EURC FX via Circle App Kit, replacing the labeled fixed 0.92 demo rate.
All design decisions are settled in `APPKIT_FX_DECISIONS.md` (in this kit) —
**do not re-litigate them; implement them.** If a Phase 0 measurement contradicts
a decision, STOP and report before writing any implementation code.

## Diagnosis before writing (mandatory)

Before changing anything, read the current FX step in the orchestrator and the
Worker's ledger/intent code, then confirm or correct this stated understanding:

- The FX leg currently converts at a fixed 0.92 rate, labeled as a demo rate.
- An intent journal exists with a divergence check that refuses when journaled
  intent ≠ amount about to be sent.
- The orchestrator talks to D1 exclusively through the Worker's internal API.
- Amounts are handled as branded `Usdc6`/`Eurc6` integers; 18→6 conversion uses
  floor division; no floats in money paths.

State what you found, including anything that differs. Only then proceed.

## Phase 0 — Measurements (report findings before Phase 1)

Use tiny amounts (≤ 0.10 USDC) on Arc Testnet. Measure, don't assume:

1. **estimateSwap transport.** Call `kit.estimateSwap` while logging outbound
   requests. Does it hit the Arc RPC endpoint (→ must go through the serialising
   RPC queue, ~1.1s spacing) or Circle's API (→ queue not required)?
2. **Estimate vs provider fee.** Estimate then immediately swap the same amount
   with a loose tolerance. Is `amountOut` ≈ `estimatedOutput` (estimate is net of
   the 2 bps provider fee) or ≈ `estimatedOutput` − 2 bps (gross)?
3. **stopLimit failure mode.** Set an impossible `stopLimit` (e.g. 1.05 × estimate)
   on a tiny swap. Does it fail client-side before dispatch, or produce an on-chain
   revert? If on-chain: what does the failed tx cost in gas?
4. **EURC decimals.** Read `decimals()` on the EURC contract on Arc Testnet, and
   check whether EURC exhibits the USDC 18/6 native-vs-ERC-20 split.
5. **Adapter.** Confirm which wallet performs the swap in our architecture (the
   treasury/spend-leg wallet holding swept funds) and whether
   `@circle-fin/adapter-circle-wallets` works with our dev-controlled SCA wallets.
   If it doesn't cleanly, report options — do not silently switch wallet strategy.
6. **Oracle.** Fetch `https://api.frankfurter.app/latest?from=USD&to=EUR`. Confirm
   availability without a key, response shape, and update cadence. No API keys, no
   paid services.

Write findings to a `PHASE0_FINDINGS` section in your session notes and pause for
review before Phase 1 if finding 1, 3, or 5 is surprising.

## Phase 1 — Journal schema (Worker + D1)

Migration adding fx intent/result to the ledger, per Decision 4:

- `fx_intent`: `invoice_id`, `amount_in_usdc6`, `estimated_out_eurc6`,
  `stop_limit_eurc6`, `tolerance_bps`, `estimated_at`, `state`
  (`pending|complete|halted`), plus an attempts log (or superseded rows) so every
  ladder retry's tolerance and floor stays visible.
- `fx_result`: actual `amount_out_eurc6`, `tx_hash`, `fees_usdc6`, `completed_at`.
- Server-side guards in the Worker (state of record): intent immutable once
  written except state transitions and ladder updates; result writes require a
  matching pending intent; divergence check extended — refuse execution reporting
  if reported `amount_in` ≠ journaled intent.

**Review gate:** show the exact migration SQL before applying. Check: additive
only, no destructive statements, `--remote` explicit and deliberate.

## Phase 2 — Orchestrator FX step

Replace the fixed-rate leg, per Decisions 1–3:

1. Oracle sanity check: fetch ECB rate; if App Kit estimate deviates > 200 bps,
   refuse (halt path). If the oracle is unreachable: skip the check, journal a
   warning, proceed — the oracle must never be a second way to halt on its own.
2. `estimateSwap` → compute
   `stopLimit = floor(estimated_out_eurc6 × (1 − tolerance_bps/10000))`, with an
   absolute minimum tolerance of 0.01 EURC (10000 Eurc6) so micro-amounts never
   fail on rounding. Journal `fx_intent` via the Worker. Then `kit.swap` with
   `stopLimit` — same pipeline step, no gap.
3. On swap failure: ladder — re-estimate, retry at 75 bps, then 100 bps, each
   attempt journaled. Beyond 100: leg state `halted`, status copy
   "FX pending — rate unavailable" (neutral wording, house style). Backoff between
   retries; respect the RPC queue if Phase 0 finding 1 says App Kit uses Arc RPC.
4. Journal `fx_result` from the swap result object.
5. All SDK boundary parsing by **string decimal parsing** (`"0.99"` → `990000`),
   never floats, in one boundary module next to the existing 18→6 code.
6. Config: `FX_MODE=live|demo`, `FX_TOLERANCE_BPS=50`, `FX_TOLERANCE_LADDER=50,75,100`,
   `FX_TOLERANCE_MIN_EURC6=10000`, `FX_ORACLE_MAX_DEVIATION_BPS=200`, `KIT_KEY`.
   Validate all at startup in `config.ts`, exit non-zero on invalid, log variable
   NAMES only, never values. `FX_MODE=demo` keeps the current fixed rate and labels
   every affected ledger row and UI surface "demo rate".

## Phase 3 — Restart reconciliation

On startup, for any `fx_intent` in `pending`:

1. Reconcile on-chain first: EURC balance delta on the swapping wallet and/or scan
   for a swap tx from it since `estimated_at`. Found → journal the discovered
   `fx_result`, mark complete. (Assume `kit.swap` is NOT idempotent.)
2. Not found → re-execute with the **journaled** `stopLimit`. Never re-estimate on
   restart. A floor breached by market movement fails into the halt path, where
   accepting a new price is an operator action.

Test this by killing the orchestrator between intent-journal and swap, and (if
achievable with a delay or breakpoint) between dispatch and result-journal.

## Phase 4 — Conservation + UI

- Input side unchanged and exact (sum of legs = credited, in Usdc6).
- Output side: accept iff `stop_limit ≤ actual_out ≤ estimated_out × 1.001`
  (ε = 10 bps). Out of bounds → leg does not complete, operator review.
- Dashboard/portal display journaled **actuals** only; during a halt, may display
  "≈ €X at ECB reference rate — indicative, conversion pending".

## Out of scope — do not start

Client portal, withdraw-from-Earn, dashboard time ranges, `swept_usdc6` migration,
per-user tolerance settings, absolute EUR loss caps, any deck regeneration.

## House rules (unchanged)

- Never `cat` `~/.pm2/dump.pm2` or print `.env` values; variable names only.
- `npx tsc --noEmit` before every deploy; `wrangler deploy` does not typecheck.
- One-off data repairs via targeted `wrangler d1 execute --remote` with
  self-guarding predicates — never via new endpoints.
- Cloudflare edge serves stale for ~30s post-deploy; not a failed deploy.

## Done means

A real testnet payment routed end-to-end with a live App Kit rate, shown via:
explorer link for the swap tx, the fx_intent/fx_result rows, and the dashboard
displaying the actual EURC amount. Plus a restart-reconciliation demonstration,
a `PROGRESS.md` entry, and a push.
