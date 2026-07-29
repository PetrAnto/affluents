import { createHash, randomUUID } from 'node:crypto';
import type { CircleClient } from './circle';

/**
 * Deterministic Circle idempotencyKey (UUID shape) derived from a stable
 * seed — used by the withdraw legs so a re-dispatch after a crash in the
 * send-then-journal window returns the SAME Circle transaction instead of
 * moving money twice. Different attempts use different seeds.
 */
export function deterministicIdempotencyKey(seed: string): string {
  const h = createHash('sha256').update(`affluents:idem:${seed}`).digest('hex');
  // Format as a valid v4-shaped UUID: version and variant nibbles fixed.
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Circle transaction plumbing for the split pipeline. All sends originate
 * from SCA wallets on ARC-TESTNET; Gas Station sponsors the fees, so no
 * deposit/role wallet carries a gas buffer (SPEC §5b primary path).
 *
 * Circle amounts are DECIMAL STRINGS in token units. The 6-dec integer →
 * decimal-string conversion below is exact (no floats, full 6 decimals).
 */
export function usdc6ToDecimalString(v: bigint): string {
  if (v < 0n) throw new RangeError('negative amount');
  return `${v / 1_000_000n}.${(v % 1_000_000n).toString().padStart(6, '0')}`;
}

export interface SentTx {
  providerRef: string; // Circle transaction UUID
}

export interface ConfirmedTx extends SentTx {
  txHash: string;
  state: string;
}

export async function sendTokenTransfer(
  client: CircleClient,
  args: {
    fromWalletId: string;
    tokenAddress: string;
    destinationAddress: string;
    amountUsdc6: bigint;
    refId: string;
    idempotencyKey?: string;
  },
): Promise<SentTx> {
  const res = await client.createTransaction({
    walletId: args.fromWalletId,
    tokenAddress: args.tokenAddress,
    // The SDK's blockchain union for transfers lags its Arc support — the
    // API accepts ARC-TESTNET (docs + wallet creation both confirm).
    blockchain: 'ARC-TESTNET' as never,
    destinationAddress: args.destinationAddress,
    amount: [usdc6ToDecimalString(args.amountUsdc6)],
    refId: args.refId,
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    idempotencyKey: args.idempotencyKey ?? randomUUID(),
  });
  const id = res.data?.id;
  if (!id) throw new Error('Circle createTransaction returned no id');
  return { providerRef: id };
}

export async function sendContractExecution(
  client: CircleClient,
  args: {
    fromWalletId: string;
    contractAddress: string;
    abiFunctionSignature: string;
    abiParameters: Array<string | number | boolean>;
    refId: string;
    idempotencyKey?: string;
  },
): Promise<SentTx> {
  const res = await client.createContractExecutionTransaction({
    walletId: args.fromWalletId,
    contractAddress: args.contractAddress,
    abiFunctionSignature: args.abiFunctionSignature,
    abiParameters: args.abiParameters,
    refId: args.refId,
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    idempotencyKey: args.idempotencyKey ?? randomUUID(),
  });
  const id = res.data?.id;
  if (!id) throw new Error('Circle createContractExecutionTransaction returned no id');
  return { providerRef: id };
}

const TERMINAL_FAILURE = new Set(['FAILED', 'CANCELLED', 'DENIED']);

/**
 * Wait for a Circle transaction to land on-chain. SCA txHash appears at
 * CONFIRMED; waitForTxHash polls for us and rejects on terminal failure.
 */
export async function waitForConfirmation(
  client: CircleClient,
  providerRef: string,
  timeoutMs = 120_000,
): Promise<ConfirmedTx> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await client.getTransaction({ id: providerRef, waitForTxHash: true, signal: controller.signal });
    const tx = res.data?.transaction;
    if (!tx?.txHash) throw new Error(`Circle tx ${providerRef} finished without txHash (state ${tx?.state})`);
    if (TERMINAL_FAILURE.has(tx.state)) throw new Error(`Circle tx ${providerRef} terminal state ${tx.state}`);
    return { providerRef, txHash: tx.txHash, state: tx.state };
  } finally {
    clearTimeout(timer);
  }
}

/** Look up a possibly-finished transaction without waiting (reconciliation). */
export async function getTransactionState(
  client: CircleClient,
  providerRef: string,
): Promise<{ state: string; txHash: string | null } | null> {
  const res = await client.getTransaction({ id: providerRef });
  const tx = res.data?.transaction;
  if (!tx) return null;
  return { state: tx.state, txHash: tx.txHash ?? null };
}

export function isTerminalFailure(state: string): boolean {
  return TERMINAL_FAILURE.has(state);
}
