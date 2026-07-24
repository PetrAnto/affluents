import { asUsdc6, splitUsdc6, type SplitPercents, type Usdc6 } from '@affluents/shared';
import { errorCodeOf, isStopLimitError, realKitFx } from './appKitFx';
import { circleClient, type CircleClient } from './circle';
import {
  getTransactionState,
  isTerminalFailure,
  sendContractExecution,
  sendTokenTransfer,
  waitForConfirmation,
  type SentTx,
} from './circleTx';
import { config } from './config';
import { fetchOracleRatePpm, runFxLeg, type FxLegConfig, type FxLegDeps } from './fx';
import * as internalApi from './internalApi';
import {
  completeInvoice,
  journalIntent,
  journalUpdate,
  postFxResult,
  type LedgerEntryPayload,
  type WorkItem,
} from './internalApi';
import type { Rpc } from './pacedRpc';

/**
 * The split pipeline (SPEC §3.2.4, §5b–§5d), journaled and idempotent:
 *   sweep (deposit → treasury, full received amount)
 *   fx      (treasury EURC → spend wallet, TreasuryFxAdapter fixed demo rate)
 *   reserve (treasury USDC → reserve wallet)
 *   earn    (treasury USDC → DemoVault deposit)
 *   complete (ledger deltas + exception_hold for excess + retire wallet)
 *
 * Every step: intent row journaled BEFORE any send; execution id is
 * `${invoiceId}:${step}` so re-runs find the existing row and reconcile
 * against Circle state instead of re-sending. Ledger conservation is checked
 * in code before completion: spendIn + reserve + earn == routed amount.
 */

function log(msg: string): void {
  console.log(`${new Date().toISOString()} ${msg}`);
}

interface RoleConfig {
  treasuryWalletId: string;
  treasuryAddress: string;
  spendAddress: string;
  reserveAddress: string;
  vaultAddress: string;
  eurcAddress: string;
  fxRatePpm: bigint; // EURC per USDC, parts-per-million (fixed demo rate)
}

export function roleConfigFromEnv(): RoleConfig | null {
  const req = (n: string) => process.env[n];
  const treasuryWalletId = req('TREASURY_WALLET_ID');
  const treasuryAddress = req('TREASURY_WALLET_ADDRESS');
  const spendAddress = req('SPEND_WALLET_ADDRESS');
  const reserveAddress = req('RESERVE_WALLET_ADDRESS');
  const vaultAddress = req('VAULT_ADDRESS');
  const eurcAddress = req('EURC_ADDRESS') ?? '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a';
  if (!treasuryWalletId || !treasuryAddress || !spendAddress || !reserveAddress || !vaultAddress) return null;
  return {
    treasuryWalletId,
    treasuryAddress,
    spendAddress,
    reserveAddress,
    vaultAddress,
    eurcAddress,
    fxRatePpm: BigInt(process.env.FX_RATE_EURC_PER_USDC_PPM ?? '920000'),
  };
}

/** TreasuryFxAdapter: fixed labeled demo rate, exact integer math. */
export function fxQuoteEurc6(spendInUsdc6: Usdc6, ratePpm: bigint): bigint {
  return (spendInUsdc6 * ratePpm) / 1_000_000n;
}

/**
 * Run one journaled step to confirmation. Returns the confirmed txHash.
 * Reconciliation: an existing 'sent' row with a provider_ref is polled, not
 * re-sent; a 'confirmed' row is returned as-is; terminal failure clears the
 * ref so the next attempt re-sends.
 */
async function runStep(
  invoiceId: string,
  step: string,
  amountUsdc6: bigint,
  send: () => Promise<SentTx>,
  client: CircleClient,
  extra?: { amountOut6?: string; outputToken?: string },
): Promise<string> {
  const id = `${invoiceId}:${step}`;
  const row = await journalIntent(id, invoiceId, step, amountUsdc6.toString());

  /**
   * The journal is the truth a restart reconciles against, so the amount we are
   * about to send MUST equal the amount journaled as the intent. `journalIntent`
   * is idempotent and returns an existing row untouched, so a retry that
   * recomputes a different amount would otherwise send one figure while the
   * journal claims another — exactly what happened when the credit-erasure bug
   * made a re-run recompute earn as 0 against a journaled 150000. Refuse loudly
   * rather than move money the journal does not describe.
   */
  if (row.amount_usdc6 !== null && BigInt(row.amount_usdc6) !== amountUsdc6) {
    throw new Error(
      `journal divergence on ${id}: intent recorded ${row.amount_usdc6}, recomputed ${amountUsdc6} — refusing to send`,
    );
  }

  if (row.status === 'confirmed' && row.tx_hash) return row.tx_hash;

  let providerRef = row.provider_ref;
  if (providerRef) {
    const state = await getTransactionState(client, providerRef);
    if (state?.txHash && !isTerminalFailure(state.state)) {
      await journalUpdate(id, { status: 'confirmed', txHash: state.txHash, ...extra });
      return state.txHash;
    }
    if (state && !isTerminalFailure(state.state)) {
      // still in flight — wait for it below
    } else {
      providerRef = null; // failed or unknown: re-send
    }
  }

  if (!providerRef) {
    const sent = await send();
    providerRef = sent.providerRef;
    await journalUpdate(id, { status: 'sent', providerRef, bumpAttempt: true });
  }

  const confirmed = await waitForConfirmation(client, providerRef);
  await journalUpdate(id, { status: 'confirmed', txHash: confirmed.txHash, ...extra });
  log(`  ${step} confirmed: ${confirmed.txHash}`);
  return confirmed.txHash;
}

function fxLegConfig(roles: RoleConfig): FxLegConfig {
  return {
    ladderBps: config.fxToleranceLadderBps,
    minToleranceEurc6: config.fxToleranceMinEurc6,
    maxOracleDeviationBps: config.fxOracleMaxDeviationBps,
    oracleUrl: config.fxOracleUrl,
    treasuryAddress: roles.treasuryAddress,
    eurcAddress: roles.eurcAddress,
    retryBackoffMs: 2000,
  };
}

function fxLegDeps(roles: RoleConfig, rpc: Rpc): FxLegDeps {
  return {
    kit: realKitFx(roles.treasuryAddress),
    isStopLimitError,
    errorCodeOf,
    oracle: fetchOracleRatePpm,
    api: internalApi,
    rpc,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => new Date(),
  };
}

export async function runPipeline(item: WorkItem, rule: SplitPercents, rpc: Rpc): Promise<void> {
  const roles = roleConfigFromEnv();
  if (!roles) {
    log(`pipeline: role wallets/vault not configured yet — leaving ${item.id} at payment_verified`);
    return;
  }
  if (!item.circle_wallet_id) {
    log(`pipeline: invoice ${item.id} wallet has no circle_wallet_id (HD fallback not implemented) — skipping`);
    return;
  }

  const client = circleClient(config.circleApiKey, config.circleEntitySecret);
  const received = asUsdc6(BigInt(item.received_usdc6));
  const invoiced = asUsdc6(BigInt(item.amount_usdc6));
  const routed = received > invoiced ? invoiced : received;
  const excess = asUsdc6(received - routed);
  const split = splitUsdc6(routed, rule);

  // §5d conservation — enforced before any money moves.
  if (split.spendInUsdc6 + split.reserveUsdc6 + split.earnUsdc6 !== routed) {
    throw new Error(`conservation violation for ${item.id} — refusing to route`);
  }

  log(`pipeline ${item.id}: routed=${routed} (spend ${split.spendInUsdc6} USDC, reserve ${split.reserveUsdc6}, earn ${split.earnUsdc6}) excess=${excess} fxMode=${config.fxMode}`);

  // 1. sweep: full received amount, deposit wallet → treasury
  const sweepTx = await runStep(item.id, 'sweep', received, () =>
    sendTokenTransfer(client, {
      fromWalletId: item.circle_wallet_id!,
      tokenAddress: config.usdcAddress,
      destinationAddress: roles.treasuryAddress,
      amountUsdc6: received,
      refId: `${item.id}:sweep`,
    }),
  client);

  // 2. fx leg: USDC → EURC. Live mode swaps via App Kit (journaled in
  //    fx_intents/fx_results, stopLimit-protected, ladder + halt path);
  //    demo mode keeps the fixed labeled rate (journaled with
  //    rate_source='demo'). A halted leg defers ONLY the EURC transfer and
  //    completion — reserve/earn still run, and the invoice stays 'routing'
  //    with status copy "FX pending — rate unavailable" until resolved.
  const leg = await runFxLeg(
    item.id,
    split.spendInUsdc6,
    config.fxMode,
    fxQuoteEurc6(split.spendInUsdc6, roles.fxRatePpm),
    fxLegConfig(roles),
    fxLegDeps(roles, rpc),
  );

  // 2b. the EURC transfer (treasury → spend wallet) of the ACTUAL output —
  //     journaled actuals are the numbers of record (Decision 5).
  let fxTx: string | null = null;
  let spendOutEurc6: bigint | null = null;
  if (leg.kind !== 'halted') {
    spendOutEurc6 = leg.amountOutEurc6;
    const out6 = spendOutEurc6;
    fxTx = await runStep(
      item.id,
      'fx',
      split.spendInUsdc6,
      () =>
        sendTokenTransfer(client, {
          fromWalletId: roles.treasuryWalletId,
          tokenAddress: roles.eurcAddress,
          destinationAddress: roles.spendAddress,
          amountUsdc6: asUsdc6(out6), // EURC shares the 6-dec format
          refId: `${item.id}:fx`,
        }),
      client,
      { amountOut6: out6.toString(), outputToken: 'EURC' },
    );
    if (leg.kind === 'demo') {
      // Demo evidence is the transfer tx itself; idempotent on re-runs.
      const post = await postFxResult({
        intentId: `${item.id}:fx`,
        invoiceId: item.id,
        amountInUsdc6: split.spendInUsdc6.toString(),
        amountOutEurc6: out6.toString(),
        txHash: fxTx,
        discoveredBy: 'swap',
        completedAt: new Date().toISOString(),
      });
      if (!post.ok) log(`pipeline ${item.id}: demo fx_result refused (${post.reasons.join('; ')}) — continuing, ledger unaffected`);
    }
  }

  // 3. reserve: treasury USDC → reserve wallet
  const reserveTx = await runStep(item.id, 'reserve', split.reserveUsdc6, () =>
    sendTokenTransfer(client, {
      fromWalletId: roles.treasuryWalletId,
      tokenAddress: config.usdcAddress,
      destinationAddress: roles.reserveAddress,
      amountUsdc6: split.reserveUsdc6,
      refId: `${item.id}:reserve`,
    }),
  client);

  // 4. earn: treasury deposits USDC into the DemoVault (allowance is granted
  //    once at setup; see scripts/deploy-vault.ts)
  const earnTx = await runStep(item.id, 'earn', split.earnUsdc6, () =>
    sendContractExecution(client, {
      fromWalletId: roles.treasuryWalletId,
      contractAddress: roles.vaultAddress,
      abiFunctionSignature: 'deposit(uint256)',
      abiParameters: [split.earnUsdc6.toString()],
      refId: `${item.id}:earn`,
    }),
  client);

  // FX halted → reserve/earn are done and journaled, but the invoice must
  // not complete with an unconverted spend leg. Next tick re-enters here;
  // resolution (market recovery via reconciliation, or an operator action on
  // the halted intent) lets completion proceed.
  if (leg.kind === 'halted' || spendOutEurc6 === null || fxTx === null) {
    log(`pipeline ${item.id}: FX pending — rate unavailable; completion deferred (reserve/earn journaled)`);
    return;
  }

  // 5. complete: ledger deltas (+ exception_hold for the excess, which was
  //    swept to treasury but is NEVER routed), retire the wallet.
  const entries: LedgerEntryPayload[] = [
    { bucket: 'spend', token: 'EURC', delta6: spendOutEurc6.toString(), txHash: fxTx },
    { bucket: 'spend', token: 'USDC', delta6: split.spendInUsdc6.toString(), txHash: sweepTx },
    { bucket: 'reserve', token: 'USDC', delta6: split.reserveUsdc6.toString(), txHash: reserveTx },
    { bucket: 'earn', token: 'USDC', delta6: split.earnUsdc6.toString(), txHash: earnTx },
  ];
  if (excess > 0n) {
    entries.push({ bucket: 'exception_hold', token: 'USDC', delta6: excess.toString(), txHash: sweepTx });
  }
  const res = await completeInvoice(item.id, entries);
  log(`pipeline ${item.id}: completed (ledger applied: ${res.applied})`);
}
