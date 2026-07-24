import { asEurc6, parseSdkDecimal6, type Eurc6, type Usdc6 } from '@affluents/shared';
import type { FxIntentState } from './internalApi';
import * as internalApi from './internalApi';
import type { Rpc } from './pacedRpc';
import { TRANSFER_TOPIC } from './verifier';

/**
 * The live FX leg (Decisions 1–5): estimate → journal intent (the derived
 * stopLimit is the durable commitment) → swap, in ONE step with no gap.
 * Failure ladders 50→75→100 bps, each attempt journaled; beyond that the leg
 * halts ("FX pending — rate unavailable") — never a silent downgrade, never
 * an execution fallback. On restart a pending intent is reconciled against
 * the CHAIN first, then re-executed with the JOURNALED stopLimit — a stale
 * estimate is never silently re-quoted.
 */

function log(msg: string): void {
  console.log(`${new Date().toISOString()} ${msg}`);
}

// ---- pure helpers (unit tested) ----

/**
 * stopLimit = estimate − tolerance, floored (Decision 2). The tolerance
 * amount is max(floor(estimate × bps/10000), minTolerance6) so micro-amounts
 * never fail on a rounding artifact (0.01 EURC absolute floor by default).
 */
export function computeStopLimitEurc6(estimatedOut6: bigint, toleranceBps: number, minTolerance6: bigint): Eurc6 {
  let tol = (estimatedOut6 * BigInt(toleranceBps)) / 10000n;
  if (tol < minTolerance6) tol = minTolerance6;
  const stop = estimatedOut6 - tol;
  return asEurc6(stop > 0n ? stop : 0n);
}

/**
 * Signed deviation of the App Kit estimate from the oracle reference, in bps.
 * Positive = estimate pays LESS than the oracle rate. Integer math throughout.
 */
export function oracleDeviationBps(amountInUsdc6: bigint, estimatedOut6: bigint, oracleRatePpm: bigint): number {
  if (amountInUsdc6 <= 0n || oracleRatePpm <= 0n) throw new RangeError('non-positive inputs');
  const estRatePpm = (estimatedOut6 * 1_000_000n) / amountInUsdc6;
  return Number(((oracleRatePpm - estRatePpm) * 10_000n) / oracleRatePpm);
}

/** Next ladder rung strictly above the current tolerance; null = exhausted. */
export function nextLadderTolerance(ladder: number[], currentBps: number): number | null {
  for (const rung of ladder) if (rung > currentBps) return rung;
  return null;
}

/**
 * ECB reference rate (EUR per USD) as parts-per-million, or null on ANY
 * failure — the oracle degrades to a journaled warning and must never become
 * a second way to halt (Decision 3).
 */
export async function fetchOracleRatePpm(
  url: string,
  timeoutMs = 5000,
  fetchImpl: typeof fetch = fetch,
): Promise<bigint | null> {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const body = (await res.json()) as { rates?: { EUR?: number | string } };
    const rate = body?.rates?.EUR;
    if (rate === undefined || rate === null) return null;
    return parseSdkDecimal6(String(rate)); // "0.87781" → 877810 ppm; string parse, no floats
  } catch {
    return null;
  }
}

// ---- the leg ----

export interface FxLegConfig {
  ladderBps: number[];
  minToleranceEurc6: bigint;
  maxOracleDeviationBps: number;
  oracleUrl: string;
  treasuryAddress: string;
  eurcAddress: string;
  retryBackoffMs: number;
}

export interface FxLegDeps {
  kit: { estimate: (amountIn6: Usdc6) => Promise<Eurc6>; swap: (amountIn6: Usdc6, stopLimit6: bigint) => Promise<{ amountOutEurc6: Eurc6; txHash: string; feesUsdc6: bigint }> };
  isStopLimitError: (e: unknown) => boolean;
  errorCodeOf: (e: unknown) => string;
  oracle: (url: string, timeoutMs?: number) => Promise<bigint | null>;
  api: Pick<typeof internalApi, 'journalFxIntent' | 'getFxIntent' | 'ladderFxIntent' | 'patchFxAttempt' | 'haltFxIntent' | 'postFxResult'>;
  rpc: Rpc;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
}

export type FxLegOutcome =
  | { kind: 'swapped'; amountOutEurc6: bigint; swapTxHash: string }
  | { kind: 'demo'; amountOutEurc6: bigint }
  | { kind: 'halted' };

function pad32Topic(address: string): `0x${string}` {
  return ('0x' + address.replace(/^0x/, '').toLowerCase().padStart(64, '0')) as `0x${string}`;
}

const RECONCILE_CHUNK_BLOCKS = 2_000n;
const RECONCILE_MAX_CHUNKS = 25;
const RECONCILE_FALLBACK_LOOKBACK = 40_000n;

/**
 * Window-2 reconciliation (Decision 4): did a dispatched swap land on-chain
 * before the crash? Authoritative signal: an EURC Transfer INTO the treasury
 * (emitter = the EURC contract, enforced via the getLogs address filter)
 * since the journaled estimate block, with a value inside the intent's
 * acceptance band. kit.swap is assumed NOT idempotent, so this runs before
 * any re-dispatch.
 */
export async function findSwapOutputOnChain(
  rpc: Rpc,
  intent: internalApi.FxIntentRow,
  eurcAddress: string,
  treasuryAddress: string,
): Promise<{ txHash: string; valueEurc6: bigint } | null> {
  const head = await rpc.getBlockNumber();
  let from =
    intent.estimated_block !== null
      ? BigInt(intent.estimated_block)
      : head > RECONCILE_FALLBACK_LOOKBACK
        ? head - RECONCILE_FALLBACK_LOOKBACK
        : 0n;
  const floor = BigInt(intent.stop_limit_eurc6);
  const ceil = (BigInt(intent.estimated_out_eurc6) * 10010n) / 10000n;
  for (let i = 0; i < RECONCILE_MAX_CHUNKS && from <= head; i++) {
    const to = from + RECONCILE_CHUNK_BLOCKS - 1n > head ? head : from + RECONCILE_CHUNK_BLOCKS - 1n;
    const logs = (await rpc.request({
      method: 'eth_getLogs',
      params: [
        {
          address: eurcAddress,
          fromBlock: `0x${from.toString(16)}`,
          toBlock: `0x${to.toString(16)}`,
          topics: [TRANSFER_TOPIC, null, pad32Topic(treasuryAddress)],
        },
      ],
    })) as Array<{ transactionHash?: `0x${string}`; data?: `0x${string}` }>;
    for (const l of logs) {
      if (!l.transactionHash || !l.data) continue;
      const value = BigInt(l.data);
      if (value >= floor && value <= ceil) return { txHash: l.transactionHash, valueEurc6: value };
    }
    from = to + 1n;
  }
  return null;
}

/**
 * Run the FX leg for one invoice. `spendInUsdc6` is the recomputed spend-leg
 * input; the journaled intent is the commitment and a mismatch refuses loudly
 * (Decision 4 divergence check — mirrors runStep).
 *
 * Demo mode: journal the intent (rate_source 'demo', stop = estimate = the
 * fixed-rate quote) and return `demo` — the executor writes the fx_result
 * after the EURC transfer confirms, with the transfer tx as evidence.
 */
export async function runFxLeg(
  invoiceId: string,
  spendInUsdc6: Usdc6,
  mode: 'live' | 'demo',
  demoQuoteEurc6: bigint,
  cfg: FxLegConfig,
  deps: FxLegDeps,
): Promise<FxLegOutcome> {
  const id = `${invoiceId}:fx`;
  const nowIso = () => deps.now().toISOString();

  // 404 → null; transient errors THROW (they must not look like "absent").
  let state: FxIntentState | null = await deps.api.getFxIntent(id);
  let fresh = false;

  if (!state) {
    if (mode === 'demo') {
      state = await deps.api.journalFxIntent({
        id,
        invoiceId,
        amountInUsdc6: spendInUsdc6.toString(),
        estimatedOutEurc6: demoQuoteEurc6.toString(),
        stopLimitEurc6: demoQuoteEurc6.toString(),
        toleranceBps: 0,
        rateSource: 'demo',
        estimatedAt: nowIso(),
      });
    } else {
      // Oracle sanity check (Decision 3): independent reference, wide margin.
      const oracleRatePpm = await deps.oracle(cfg.oracleUrl);
      if (oracleRatePpm === null) {
        log(`fx ${invoiceId}: oracle unreachable — sanity check skipped, journaled as NULL (never a halt reason)`);
      }
      const estimatedOut6 = await deps.kit.estimate(spendInUsdc6);
      const baseTol = cfg.ladderBps[0] ?? 50;
      const stop6 = computeStopLimitEurc6(estimatedOut6, baseTol, cfg.minToleranceEurc6);
      let deviationBps: number | null = null;
      if (oracleRatePpm !== null) {
        deviationBps = oracleDeviationBps(spendInUsdc6, estimatedOut6, oracleRatePpm);
      }

      // Journal facts for restart reconciliation: chain head + treasury EURC
      // balance at estimate time (paced reads).
      const estimatedBlock = await deps.rpc.getBlockNumber();
      const preSwapEurc6 = (await deps.rpc.readContract({
        address: cfg.eurcAddress as `0x${string}`,
        abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] }],
        functionName: 'balanceOf',
        args: [cfg.treasuryAddress as `0x${string}`],
      })) as bigint;

      const sentEstimatedAt = nowIso();
      state = await deps.api.journalFxIntent({
        id,
        invoiceId,
        amountInUsdc6: spendInUsdc6.toString(),
        estimatedOutEurc6: estimatedOut6.toString(),
        stopLimitEurc6: stop6.toString(),
        toleranceBps: baseTol,
        rateSource: 'appkit',
        oracleRatePpm: oracleRatePpm?.toString() ?? null,
        oracleDeviationBps: deviationBps,
        estimatedAt: sentEstimatedAt,
        estimatedBlock: estimatedBlock.toString(),
        preSwapEurc6: preSwapEurc6.toString(),
      });
      // The upsert is idempotent: if a concurrent/crashed run journaled first,
      // the returned row is THEIRS (different estimated_at) and this run must
      // take the reconciliation path, not treat the intent as freshly created.
      fresh = state.intent.estimated_at === sentEstimatedAt;

      if (deviationBps !== null && Math.abs(deviationBps) > cfg.maxOracleDeviationBps) {
        // Pool likely broken — refuse BEFORE dispatch, visibly (Decision 3).
        await deps.api.patchFxAttempt(id, 1, 'error', `ORACLE_DEVIATION_${deviationBps}BPS_MAX_${cfg.maxOracleDeviationBps}`);
        await deps.api.haltFxIntent(id);
        log(
          `fx ${invoiceId}: REFUSED — estimate deviates ${deviationBps} bps from ECB reference (max ${cfg.maxOracleDeviationBps}) — halted`,
        );
        return { kind: 'halted' };
      }
    }
  }

  // Divergence check (Decision 4): journaled intent is the commitment.
  if (BigInt(state.intent.amount_in_usdc6) !== spendInUsdc6) {
    throw new Error(
      `fx journal divergence on ${id}: intent recorded ${state.intent.amount_in_usdc6}, recomputed ${spendInUsdc6} — refusing`,
    );
  }

  if (state.result) {
    return { kind: 'swapped', amountOutEurc6: BigInt(state.result.amount_out_eurc6), swapTxHash: state.result.tx_hash };
  }
  if (state.intent.state === 'halted') return { kind: 'halted' };
  if (mode === 'demo') {
    // Journaled estimate is the record — NOT a recomputation (restart-stable).
    return { kind: 'demo', amountOutEurc6: BigInt(state.intent.estimated_out_eurc6) };
  }

  // Pending intent that predates this call → a swap may already be on-chain
  // (crash after dispatch, before the result was journaled). Chain first.
  if (!fresh) {
    const found = await findSwapOutputOnChain(deps.rpc, state.intent, cfg.eurcAddress, cfg.treasuryAddress);
    if (found) {
      const post = await deps.api.postFxResult({
        intentId: id,
        invoiceId,
        amountInUsdc6: state.intent.amount_in_usdc6.toString(),
        amountOutEurc6: found.valueEurc6.toString(),
        txHash: found.txHash,
        discoveredBy: 'reconciliation',
        completedAt: nowIso(),
      });
      if (post.ok) {
        log(`fx ${invoiceId}: reconciled on-chain swap ${found.txHash} (${found.valueEurc6} EURC) — journal caught up`);
        return { kind: 'swapped', amountOutEurc6: found.valueEurc6, swapTxHash: found.txHash };
      }
      await deps.api.haltFxIntent(id);
      log(`fx ${invoiceId}: reconciliation result refused (${post.reasons.join('; ')}) — halted for review`);
      return { kind: 'halted' };
    }
    // Window 1: nothing landed. Re-execute with the JOURNALED stopLimit —
    // never a fresh estimate; a floor breached meanwhile fails into the halt
    // path where accepting a new price is an operator action.
    const lastNo = state.attempts.at(-1)?.attempt_no ?? 1;
    state = await deps.api.ladderFxIntent(id, {
      attemptNo: lastNo + 1,
      toleranceBps: state.intent.tolerance_bps,
      estimatedOutEurc6: state.intent.estimated_out_eurc6.toString(),
      stopLimitEurc6: state.intent.stop_limit_eurc6.toString(),
      estimatedAt: state.intent.estimated_at, // unchanged: not a re-quote
    });
    log(`fx ${invoiceId}: no on-chain swap found — re-dispatching with journaled stopLimit ${state.intent.stop_limit_eurc6}`);
  }

  // Dispatch, laddering on stopLimit refusals (Decision 2).
  for (;;) {
    const attemptNo = state.attempts.at(-1)?.attempt_no ?? 1;
    try {
      const swap = await deps.kit.swap(
        BigInt(state.intent.amount_in_usdc6) as Usdc6,
        BigInt(state.intent.stop_limit_eurc6),
      );
      const post = await deps.api.postFxResult({
        intentId: id,
        invoiceId,
        amountInUsdc6: state.intent.amount_in_usdc6.toString(),
        amountOutEurc6: swap.amountOutEurc6.toString(),
        txHash: swap.txHash,
        feesUsdc6: swap.feesUsdc6.toString(),
        discoveredBy: 'swap',
        completedAt: nowIso(),
      });
      if (!post.ok) {
        // The swap EXECUTED but the actual is outside the acceptance band
        // (Decision 5). Funds sit as EURC in treasury; operator review.
        await deps.api.patchFxAttempt(id, attemptNo, 'error', `OUT_OF_BAND_${swap.amountOutEurc6}_${swap.txHash.slice(0, 18)}`);
        await deps.api.haltFxIntent(id);
        log(`fx ${invoiceId}: result refused by acceptance band (${post.reasons.join('; ')}) — HALTED for operator review`);
        return { kind: 'halted' };
      }
      log(`fx ${invoiceId}: swapped ${state.intent.amount_in_usdc6} USDC → ${swap.amountOutEurc6} EURC (tx ${swap.txHash}, tolerance ${state.intent.tolerance_bps} bps)`);
      return { kind: 'swapped', amountOutEurc6: swap.amountOutEurc6, swapTxHash: swap.txHash };
    } catch (e) {
      if (!deps.isStopLimitError(e)) {
        await deps.api.patchFxAttempt(id, attemptNo, 'error', deps.errorCodeOf(e)).catch(() => {});
        throw e; // pipeline retries next tick → reconciliation path re-enters
      }
      await deps.api.patchFxAttempt(id, attemptNo, 'stop_limit_not_met', deps.errorCodeOf(e));
      const nextTol = nextLadderTolerance(cfg.ladderBps, state.intent.tolerance_bps);
      if (nextTol === null) {
        await deps.api.haltFxIntent(id);
        log(`fx ${invoiceId}: ladder exhausted (${cfg.ladderBps.join('/')} bps) — FX pending — rate unavailable`);
        return { kind: 'halted' };
      }
      await deps.sleep(cfg.retryBackoffMs);
      // Ladder retry IS allowed to re-estimate (Decision 2) — only restarts
      // must reuse the journaled price.
      const reEst = await deps.kit.estimate(BigInt(state.intent.amount_in_usdc6) as Usdc6);
      const stop6 = computeStopLimitEurc6(reEst, nextTol, cfg.minToleranceEurc6);
      state = await deps.api.ladderFxIntent(id, {
        attemptNo: attemptNo + 1,
        toleranceBps: nextTol,
        estimatedOutEurc6: reEst.toString(),
        stopLimitEurc6: stop6.toString(),
        estimatedAt: nowIso(),
      });
      log(`fx ${invoiceId}: stopLimit not met — retrying at ${nextTol} bps (stop ${stop6})`);
    }
  }
}
