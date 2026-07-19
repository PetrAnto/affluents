import { randomUUID } from 'node:crypto';
import type { CircleClient } from './circle';

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
    idempotencyKey: randomUUID(),
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
  },
): Promise<SentTx> {
  const res = await client.createContractExecutionTransaction({
    walletId: args.fromWalletId,
    contractAddress: args.contractAddress,
    abiFunctionSignature: args.abiFunctionSignature,
    abiParameters: args.abiParameters,
    refId: args.refId,
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    idempotencyKey: randomUUID(),
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
