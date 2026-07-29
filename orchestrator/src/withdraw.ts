import type { WithdrawalFeedItem, WithdrawalStepResponse, WithdrawalStepRow } from './internalApi';

/**
 * Withdraw-from-Earn leg (WITHDRAW_HANDOFF.md, Gate 0 signed 2026-07-29).
 *
 * Two hops, each journaled in withdrawal_steps and reconciled independently:
 *   vault    — Circle contract execution DemoVault.withdraw(amount) from the
 *              treasury SCA (Gas Station sponsored; Phase 0 measured).
 *   transfer — treasury USDC → destination wallet (spend|reserve), exact
 *              journaled amount, band = 0 on both destinations.
 *
 * Crash-window handling, in order of trust:
 *   1. journaled provider_ref → ask Circle for THAT transaction; never
 *      re-send while it is non-terminal.
 *   2. no provider_ref (crash inside the send-then-journal window): every
 *      dispatch uses a DETERMINISTIC Circle idempotencyKey derived from
 *      (step id, attempt_count), so a re-dispatch returns the SAME Circle
 *      transaction instead of moving money twice — both hops.
 *   3. vault hop only, belt-and-braces per the handoff: scan Withdraw events
 *      (emitter == vault, owner == treasury, exact amount) from the
 *      journaled created_block before dispatching; a found tx is adopted as
 *      the confirmed result (discovered by reconciliation).
 *
 * The amount sent is ALWAYS the journaled withdrawal amount — the Worker
 * refuses divergent step journals server-side; this module additionally
 * refuses to dispatch when the feed and journal disagree (runStep precedent).
 * Completion is the Worker's atomic batch; a refusal is logged and the
 * withdrawal stays pending, operator-visible — never invisible, never failed
 * after a dispatched hop (amendment A1 is enforced server-side).
 */

export interface WithdrawDeps {
  getWithdrawal: (id: string) => Promise<{ withdrawal: { state: string; amount_usdc6: number; destination: string; created_block: number | null }; steps: WithdrawalStepRow[] } | null>;
  postStep: (id: string, payload: { step: 'vault' | 'transfer'; amountUsdc6: string; createdBlock?: string }) => Promise<WithdrawalStepResponse>;
  postStepUpdate: (
    id: string,
    payload: { step: 'vault' | 'transfer'; status?: 'sent' | 'confirmed' | 'failed'; providerRef?: string; txHash?: string; bumpAttempt?: boolean },
  ) => Promise<WithdrawalStepResponse>;
  postComplete: (id: string, amountUsdc6: string) => Promise<{ ok: true; idempotent: boolean } | { ok: false; status: number; reasons: string[] }>;
  /** Dispatchers: must pass idempotencyKey through to Circle. */
  sendVaultWithdraw: (amountUsdc6: bigint, idempotencyKey: string, refId: string) => Promise<{ providerRef: string }>;
  sendTransfer: (destinationAddress: string, amountUsdc6: bigint, idempotencyKey: string, refId: string) => Promise<{ providerRef: string }>;
  getTransactionState: (providerRef: string) => Promise<{ state: string; txHash: string | null } | null>;
  waitForConfirmation: (providerRef: string) => Promise<{ txHash: string }>;
  isTerminalFailure: (state: string) => boolean;
  deterministicKey: (seed: string) => string;
  /** Withdraw-event scan (vault hop reconciliation); null when none found. */
  scanVaultWithdraw: (fromBlock: bigint, amountUsdc6: bigint) => Promise<{ txHash: string } | null>;
  getBlockNumber: () => Promise<bigint>;
  spendAddress: string;
  reserveAddress: string;
  log: (msg: string) => void;
}

function refuse(id: string, what: string, res: { status: number; reasons: string[] }): never {
  throw new Error(`withdrawal ${id}: ${what} refused (${res.reasons.join('; ')})`);
}

/** Run one hop to confirmation; mirrors executor.runStep against withdrawal_steps. */
async function runHop(
  id: string,
  step: 'vault' | 'transfer',
  amount: bigint,
  createdBlock: bigint | null,
  send: (idempotencyKey: string) => Promise<{ providerRef: string }>,
  deps: WithdrawDeps,
): Promise<string> {
  const posted = await deps.postStep(id, {
    step,
    amountUsdc6: amount.toString(),
    ...(createdBlock !== null ? { createdBlock: createdBlock.toString() } : {}),
  });
  if (!posted.ok) refuse(id, `step '${step}' intent`, posted);
  const row = posted.step;

  // Divergence guard, runStep precedent: the journal is what a restart
  // reconciles against — never send an amount the journal does not describe.
  if (BigInt(row.amount_usdc6) !== amount) {
    throw new Error(`withdrawal ${id}: journal divergence on '${step}' (journal ${row.amount_usdc6}, recomputed ${amount}) — refusing to send`);
  }

  if (row.status === 'confirmed' && row.tx_hash) return row.tx_hash;

  let providerRef = row.provider_ref;
  if (providerRef) {
    const state = await deps.getTransactionState(providerRef);
    if (state?.txHash && !deps.isTerminalFailure(state.state)) {
      await deps.postStepUpdate(id, { step, status: 'confirmed', txHash: state.txHash });
      deps.log(`withdrawal ${id}: '${step}' reconciled from Circle ref (tx ${state.txHash})`);
      return state.txHash;
    }
    if (state && !deps.isTerminalFailure(state.state)) {
      // still in flight — wait below
    } else {
      providerRef = null; // terminal or unknown: a fresh attempt is required
      const failed = await deps.postStepUpdate(id, { step, status: 'failed', bumpAttempt: true });
      if (!failed.ok) refuse(id, `step '${step}' failure journal`, failed);
      deps.log(`withdrawal ${id}: '${step}' Circle ref terminal/unknown — journaled step failure, will re-attempt with a new key`);
    }
  } else if (step === 'vault' && createdBlock !== null) {
    // Belt-and-braces (handoff): before ever dispatching the vault hop with
    // no journaled ref, look for our Withdraw event on-chain.
    const found = await deps.scanVaultWithdraw(createdBlock, amount);
    if (found) {
      const adopted = await deps.postStepUpdate(id, { step, status: 'confirmed', txHash: found.txHash });
      if (!adopted.ok) refuse(id, `step '${step}' reconciliation adopt`, adopted);
      deps.log(`withdrawal ${id}: '${step}' discovered on-chain by reconciliation (tx ${found.txHash}) — not re-dispatched`);
      return found.txHash;
    }
  }

  if (!providerRef) {
    // attempt_count is bumped when 'sent' is journaled, so a crash between
    // dispatch and journal reuses the SAME key → Circle returns the same tx.
    const current = await deps.getWithdrawal(id);
    const attempt = current?.steps.find((s) => s.step === step)?.attempt_count ?? row.attempt_count;
    const key = deps.deterministicKey(`${id}:${step}:${attempt}`);
    const sent = await send(key);
    providerRef = sent.providerRef;
    const updated = await deps.postStepUpdate(id, { step, status: 'sent', providerRef, bumpAttempt: true });
    if (!updated.ok) refuse(id, `step '${step}' sent journal`, updated);
  }

  const confirmed = await deps.waitForConfirmation(providerRef);
  const done = await deps.postStepUpdate(id, { step, status: 'confirmed', txHash: confirmed.txHash });
  if (!done.ok) refuse(id, `step '${step}' confirm journal`, done);
  deps.log(`withdrawal ${id}: '${step}' confirmed: ${confirmed.txHash}`);
  return confirmed.txHash;
}

export async function runWithdrawal(item: WithdrawalFeedItem, deps: WithdrawDeps): Promise<void> {
  const state = await deps.getWithdrawal(item.id);
  if (!state) {
    deps.log(`withdrawal ${item.id}: gone from journal — skipping`);
    return;
  }
  if (state.withdrawal.state !== 'pending') return;
  const amount = BigInt(state.withdrawal.amount_usdc6);
  const destination = state.withdrawal.destination as 'spend' | 'reserve';
  const destinationAddress = destination === 'spend' ? deps.spendAddress : deps.reserveAddress;

  // Reconciliation scan start: journaled once at first contact, never moved.
  const createdBlock = state.withdrawal.created_block !== null ? BigInt(state.withdrawal.created_block) : await deps.getBlockNumber();

  deps.log(`withdrawal ${item.id}: ${amount} usdc6 from Earn to ${destination} (two hops)`);
  await runHop(item.id, 'vault', amount, createdBlock, (key) => deps.sendVaultWithdraw(amount, key, `${item.id}:vault`), deps);
  await runHop(item.id, 'transfer', amount, createdBlock, (key) => deps.sendTransfer(destinationAddress, amount, key, `${item.id}:transfer`), deps);

  const completed = await deps.postComplete(item.id, amount.toString());
  if (!completed.ok) {
    // Server guard refused (should not happen after two confirmed hops) —
    // stay pending and visible; the operator reviews. NEVER auto-fail here:
    // both hops are dispatched, so parent failure is forbidden (A1).
    deps.log(`withdrawal ${item.id}: completion REFUSED (${completed.reasons.join('; ')}) — staying pending for operator review`);
    return;
  }
  deps.log(`withdrawal ${item.id}: complete${completed.idempotent ? ' (idempotent)' : ''} — Earn −${amount}, ${destination} +${amount}`);
}

// ---- production wiring ----

import { circleClient } from './circle';
import { deterministicIdempotencyKey, getTransactionState, isTerminalFailure, sendContractExecution, sendTokenTransfer, waitForConfirmation } from './circleTx';
import { config } from './config';
import { roleConfigFromEnv } from './executor';
import * as internalApi from './internalApi';
import type { Rpc } from './pacedRpc';

// keccak256('Withdraw(address,uint256)') — DemoVault's withdraw event
// (verified against the live Phase 0 micro-withdrawal receipt 2026-07-29).
const WITHDRAW_TOPIC = '0x884edad9ce6fa2440d8a54cc123490eb96d2768479d49ff9c7366125a9424364' as const;

function pad32Topic(address: string): `0x${string}` {
  return ('0x' + address.replace(/^0x/, '').toLowerCase().padStart(64, '0')) as `0x${string}`;
}

const SCAN_CHUNK_BLOCKS = 2_000n;
const SCAN_MAX_CHUNKS = 25;

/**
 * Vault-hop reconciliation: our Withdraw(owner=treasury, amount) event since
 * the journaled created_block. Uniquely ours: only this pipeline moves vault
 * funds, one withdrawal is pending at a time, and the scan starts at the
 * withdrawal's own first-contact block.
 */
async function scanVaultWithdrawOnChain(
  rpc: Rpc,
  vaultAddress: string,
  treasuryAddress: string,
  fromBlock: bigint,
  amountUsdc6: bigint,
): Promise<{ txHash: string } | null> {
  const head = await rpc.getBlockNumber();
  let from = fromBlock;
  for (let i = 0; i < SCAN_MAX_CHUNKS && from <= head; i++) {
    const to = from + SCAN_CHUNK_BLOCKS - 1n > head ? head : from + SCAN_CHUNK_BLOCKS - 1n;
    const logs = (await rpc.request({
      method: 'eth_getLogs',
      params: [
        {
          address: vaultAddress,
          fromBlock: `0x${from.toString(16)}`,
          toBlock: `0x${to.toString(16)}`,
          topics: [WITHDRAW_TOPIC, pad32Topic(treasuryAddress)],
        },
      ],
    })) as Array<{ transactionHash?: `0x${string}`; data?: `0x${string}` }>;
    for (const l of logs) {
      if (!l.transactionHash || !l.data) continue;
      if (BigInt(l.data) === amountUsdc6) return { txHash: l.transactionHash };
    }
    from = to + 1n;
  }
  return null;
}

function log(msg: string): void {
  console.log(`${new Date().toISOString()} ${msg}`);
}

/** Process one pending withdrawal from the work feed with production deps. */
export async function processWithdrawal(item: WithdrawalFeedItem, rpc: Rpc): Promise<void> {
  const roles = roleConfigFromEnv();
  if (!roles) {
    log(`withdrawal ${item.id}: role wallets/vault not configured yet — skipping`);
    return;
  }
  const client = circleClient(config.circleApiKey, config.circleEntitySecret);
  await runWithdrawal(item, {
    getWithdrawal: internalApi.getWithdrawal,
    postStep: internalApi.postWithdrawalStep,
    postStepUpdate: internalApi.postWithdrawalStepUpdate,
    postComplete: internalApi.postWithdrawalComplete,
    sendVaultWithdraw: (amount, idempotencyKey, refId) =>
      sendContractExecution(client, {
        fromWalletId: roles.treasuryWalletId,
        contractAddress: roles.vaultAddress,
        abiFunctionSignature: 'withdraw(uint256)',
        abiParameters: [amount.toString()],
        refId,
        idempotencyKey,
      }),
    sendTransfer: (destinationAddress, amount, idempotencyKey, refId) =>
      sendTokenTransfer(client, {
        fromWalletId: roles.treasuryWalletId,
        tokenAddress: config.usdcAddress,
        destinationAddress,
        amountUsdc6: amount,
        refId,
        idempotencyKey,
      }),
    getTransactionState: (ref) => getTransactionState(client, ref),
    waitForConfirmation: (ref) => waitForConfirmation(client, ref),
    isTerminalFailure,
    deterministicKey: deterministicIdempotencyKey,
    scanVaultWithdraw: (fromBlock, amount) => scanVaultWithdrawOnChain(rpc, roles.vaultAddress, roles.treasuryAddress, fromBlock, amount),
    getBlockNumber: () => rpc.getBlockNumber(),
    spendAddress: roles.spendAddress,
    reserveAddress: roles.reserveAddress,
    log,
  });
}
