# Affluents — App Kit Live FX: Design Decisions

Status: **signed off** (amended after review) · 2026-07-24
Grounding: Arc docs (`docs.arc.network/app-kit/swap`, `/quickstarts/swap-tokens-same-chain`,
`/tutorials/swap/estimate-swap-rate`, `/tutorials/swap/set-slippage-tolerance-or-stop-limit`,
`/concepts/swap-fees`), fetched 2026-07-23. Unverified items are marked ⚠️ and become
Phase 0 measurement tasks in the handoff.

---

## The interface, as it actually is

- **There is no quote.** `kit.estimateSwap(params)` returns a non-binding
  `estimatedOutput`. No quote ID, no expiry, no price held for you. The docs say
  outright that the estimate does not guarantee the actual amount.
- **Price protection happens at execution**, via `kit.swap()` config:
  `slippageBps` (default **300 bps** — far too loose for a EUR/USD pair) or
  `stopLimit` (exact minimum `tokenOut` received; **takes precedence** if both set).
- **Fees:** a provider fee of **2 bps** of the swap amount applies on every swap,
  deducted from the input side. Output ≠ input × rate, ever.
- **The result object is the receipt:** actual `amountIn`, `amountOut`, `txHash`,
  `explorerUrl`, `fees[]` — human-readable decimal strings (`"0.99"`), not
  6-decimal integers.
- ⚠️ Ambiguous in docs: whether `slippageBps` measures against *our* earlier
  estimate or an internal re-estimate at execution. All recommendations use
  `stopLimit` so the ambiguity never matters.
- ⚠️ Unverified: whether `estimatedOutput` is net of the 2 bps provider fee;
  whether a `stopLimit` breach fails client-side or reverts on-chain (gas cost);
  whether `estimateSwap` routes through Arc RPC (rate-limit queue) or Circle's API;
  whether EURC on Arc has USDC's 18/6 dual-decimal split.

Consequence: **"quote lifetime" is not a property we inherit — it's a policy we
invent.** The estimate is informational; the `stopLimit` derived from it is the
only thing with teeth.

**Industry framing** (for Demo Day questions): guaranteed-rate providers (Wise,
payment processors) hold a price because they are market-makers absorbing the risk
themselves. On-chain execution follows the *execution-tolerance* model instead —
established practice for stable-stable pairs is 0.1–0.5% slippage tolerance
(volatile pairs run 1%+). Card networks convert at settlement-time rates the payer
never sees in advance; this system is *more* protective than that, not less.

---

## Decision 1 — Estimate lifetime, and expiry mid-route

**Decided: no TTL in-flow; refusal semantics on restart.**
Estimate and execute in one pipeline step — no gap for the price to move in.
The derived `stopLimit` is the durable commitment. If the market moves between
estimate and execution (seconds), the swap fails rather than executing at a worse
price. On restart, a stale estimate is never refreshed silently (see Decision 4).

Rejected: an explicit TTL with re-estimation — "re-estimate" is exactly the
"re-quote at a new price" failure the intent journal exists to prevent; and a TTL
protects nothing `stopLimit` doesn't already protect for a fiat-proxy pair.

---

## Decision 2 — Tolerance: fixed base with a journaled retry ladder

**Decided: fixed system constants, enforced as computed `stopLimit`, with an
escalating retry ladder.**

- `stopLimit = estimatedOutput × (1 − tolerance_bps/10000)`, floored to Eurc6.
- Base tolerance **50 bps**. On swap failure, re-estimate and retry at **75 bps**,
  then **100 bps** — each widening journaled in the fx intent row, so the ledger
  shows exactly what tolerance each swap ran at. Beyond 100 bps: this is no longer
  fluctuation, it's an anomaly → halt (Decision 3).
- **Absolute floor on the tolerance amount: 0.01 EURC** — so micro-payments never
  fail on a rounding artifact (a percentage of a tiny amount can round to zero
  tolerance).
- Rationale for 50: the SDK default of 300 bps would silently accept a 3% haircut;
  0 bps invites failures the docs warn about; 50 sits at the top of established
  stable-pair practice and absorbs the 2 bps provider fee ⚠️ even if the estimate
  turns out to be gross of it.

Rejected: per-user or per-invoice settings (scope with no demo value; a new way for
users to configure themselves into permanent failure); `slippageBps` (docs ambiguous
about its reference point; a computed floor is deterministic and restart-safe).

Noted as future work, not built: an absolute loss cap in EUR for large invoices
(a real production pattern, but each extra guard is an extra failure mode to test).

---

## Decision 3 — On failure: halt, with an independent reference oracle

**Decided: pure halt at runtime + ECB reference oracle for sanity checks and
display. No execution fallback of any kind.**

Core principle unchanged: an FX-rate API supplies a *price*, not an *exchange*.
If App Kit is down, no API on earth can move USDC into EURC in its place; a ledger
row claiming "converted at ECB rate" with no euros actually received would be the
invisible lie this project's values exclude.

The oracle (ECB reference rates via **frankfurter.app** — free, keyless ⚠️ verify
availability/format in Phase 0) serves two honest purposes:

1. **Pre-swap sanity check:** compare App Kit's estimate to the ECB EUR/USD rate.
   Deviation beyond **200 bps** → refuse the swap (pool likely broken). This gives
   Decision 5's bounds an *independent* source of truth. Nuance: ECB publishes the
   fiat EUR/USD rate, not the EURC/USDC pool rate — close but not identical, hence
   200 bps rather than a tight band. ECB rates update once per business day; the
   check degrades gracefully (skip with a journaled warning) if the oracle is
   unreachable — the oracle must never become a second way to halt on its own.
2. **Display during outage:** on halt, funds remain in USDC (nothing lost, nothing
   invented); the UI may show "≈ €X at ECB reference rate — indicative, conversion
   pending". The client sees a meaningful figure; the ledger contains only truth.

Runtime failure behaviour: bounded retries with backoff (respecting the RPC queue
if applicable ⚠️), tolerance ladder from Decision 2, then the leg stays pending with
neutral status copy ("FX pending — rate unavailable"). Never silently downgrade.

`FX_MODE=live|demo` startup flag retained: in `demo`, the fixed labeled rate is
used and every affected ledger row and UI surface says "demo rate". Chosen by a
human before the run, journaled per-row, never entered dynamically.

---

## Decision 4 — Journaling, and restart without re-quoting

**Decided: two-phase journal with on-chain reconciliation before any re-execution.**

**Window 1 — crash after journaling intent, before `kit.swap()`.**
`fx_intent` written first (via the Worker's internal API; D1 is the state of
record): `amount_in_usdc6`, `estimated_out_eurc6`, `stop_limit_eurc6`,
`tolerance_bps`, `estimated_at`, state `pending`. On restart, a pending intent
re-executes **with the journaled `stopLimit`, never a fresh estimate**. If the
market moved past the floor meanwhile, the swap fails into the Decision 3 halt
path — accepting a new price becomes a deliberate, journaled operator action.

**Window 2 — crash after dispatch, before result journaled.**
⚠️ Assume `kit.swap` is not idempotent. Before re-executing any pending intent,
reconcile on-chain first: check the swapping wallet's EURC balance delta and/or
scan for a swap transaction from that wallet since `estimated_at`. Found → journal
the discovered result (`fx_result`: actual `amount_out_eurc6`, `tx_hash`, fees)
and mark complete. Not found → Window 1 path. The chain is the truth; the journal
catches up to it, never the reverse.

The existing divergence check extends naturally: refuse if the amount about to be
passed to `kit.swap` differs from `fx_intent.amount_in_usdc6`. Ladder retries
update `tolerance_bps` and `stop_limit_eurc6` on the same intent row (journaled
history preserved via an attempts log or superseded rows — implementation's choice,
but every attempted floor must remain visible).

---

## Decision 5 — Conservation checks under a floating rate

**Decided: exact on the input side; bounded plus oracle-checked on the output side;
journaled actuals are the numbers of record.**

- **Input side — exact.** USDC allocated to the FX leg = `fx_intent.amount_in_usdc6`
  = amount passed to `kit.swap`. Sum of legs still equals credited amount exactly,
  in Usdc6, before the boundary.
- **Output side — bounded.** Accept iff
  `stop_limit_eurc6 ≤ actual_out_eurc6 ≤ estimated_out_eurc6 × (1 + ε)`, ε = 10 bps.
  The lower bound restates the SDK's guarantee; the upper bound catches a broken
  pool paying absurdly *high* — for a money router, as alarming as too low.
  Out-of-bounds → leg does not complete; funds sit; operator review
  (`exception_hold` philosophy).
- The pre-swap ECB oracle check (Decision 3) is the independent complement to this
  band.
- Journaled actual `amount_out_eurc6` from the result object is thenceforth the
  number of record for the Spend bucket — dashboards and client portal display
  actuals, never estimates.
- **Boundary discipline:** the SDK speaks human-readable decimal strings both ways.
  Parse `"0.99"` → `990000` (Eurc6) by **string decimal parsing, never floats**,
  mirroring the 18→6 floor-division rule. ⚠️ Verify on-chain that EURC's ERC-20
  interface on Arc is 6 decimals before trusting the branded type.

---

## Summary

| # | Decision | Signed-off position |
|---|---|---|
| 1 | Estimate lifetime | Estimate + swap in one step; `stopLimit` is the commitment; restart → refuse, don't re-quote |
| 2 | Tolerance | Fixed base 50 bps as computed `stopLimit`; journaled retry ladder 50→75→100; 0.01 EURC absolute floor; halt beyond 100 |
| 3 | Failure behaviour | Halt + ladder + neutral "FX pending"; ECB oracle (frankfurter.app) for pre-swap sanity (200 bps) and indicative display; `FX_MODE=demo` as explicit labeled operator choice only; no execution fallback ever |
| 4 | Journaling / restart | `fx_intent` before swap, on-chain reconcile before re-execution, `fx_result` actuals after; all in D1 via Worker |
| 5 | Conservation | Exact input side; output within `[stopLimit, estimate×1.001]`; journaled actuals are the record |

**Phase 0 measurement tasks (docs don't settle these):** estimateSwap transport
(Arc RPC vs Circle API); estimate net vs gross of provider fee; stopLimit failure
mode (client-side vs on-chain revert, gas cost); EURC decimals on Arc ERC-20;
Circle Wallets adapter with existing dev-controlled SCA wallets; frankfurter.app
availability and response format.
