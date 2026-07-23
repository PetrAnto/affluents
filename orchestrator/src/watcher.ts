import { erc20Abi } from 'viem';
import { config } from './config';
import { postVerification, type WorkItem } from './internalApi';
import type { Rpc } from './pacedRpc';
import { TRANSFER_TOPIC, verifyPaymentTx } from './verifier';

interface PaidTxEntry {
  txHash: string;
  source: 'reported' | 'observed';
  status?: 'pending' | 'verified' | 'invalid';
  amountUsdc6?: string;
  attempts?: number;
}

/**
 * Audit-scan bounds. Blocks are sub-second; the delta watcher notices a
 * payment within one ~5s tick while running, so the funding tx is almost
 * always in the newest chunk. The per-wallet cursor lets successive ticks
 * keep digging deeper (up to the lookback) after orchestrator downtime.
 * Chunks stay small because the RPC caps eth_getLogs results (~20k).
 */
const SCAN_LOOKBACK_BLOCKS = 400_000n;
const SCAN_CHUNK_BLOCKS = 2_000n;
const SCAN_MAX_CHUNKS_PER_TICK = 5;
const MAX_PENDING_ATTEMPTS = 10;

/** Per-wallet scan cursor: next `toBlock` to continue from (in-memory). */
const scanCursor = new Map<string, bigint>();

function log(msg: string): void {
  console.log(`${new Date().toISOString()} ${msg}`);
}

function pad32Topic(address: string): `0x${string}` {
  return ('0x' + address.replace(/^0x/, '').toLowerCase().padStart(64, '0')) as `0x${string}`;
}

async function verifyOneTx(rpc: Rpc, txHash: `0x${string}`, depositAddress: string) {
  const [tx, receipt] = await Promise.all([
    rpc.getTransaction({ hash: txHash }),
    rpc.getTransactionReceipt({ hash: txHash }),
  ]);
  return verifyPaymentTx(
    { to: tx.to ?? null, value: tx.value },
    { status: receipt.status, logs: receipt.logs },
    config.usdcAddress,
    depositAddress,
  );
}

/**
 * Audit-trail scan (SPEC §3.2.3): when the balance delta exceeds what the
 * recorded txs explain, walk Transfer logs to the deposit address backwards
 * in bounded chunks. No emitter filter here on purpose — EIP-7708 system
 * logs also locate native funding txs; each candidate tx is then verified
 * through the branch rules, which do enforce the emitter filter.
 */
async function scanForFundingTxs(
  rpc: Rpc,
  depositAddress: string,
  knownHashes: Set<string>,
): Promise<`0x${string}`[]> {
  const head = await rpc.getBlockNumber();
  const floor = head > SCAN_LOOKBACK_BLOCKS ? head - SCAN_LOOKBACK_BLOCKS : 0n;
  const found: `0x${string}`[] = [];
  const key = depositAddress.toLowerCase();
  // New payments land near the head; also resume any deeper unfinished scan.
  let to = head;
  const resumeAt = scanCursor.get(key);
  for (let i = 0; i < SCAN_MAX_CHUNKS_PER_TICK && to > floor; i++) {
    const from = to > SCAN_CHUNK_BLOCKS ? to - SCAN_CHUNK_BLOCKS : 0n;
    // Raw eth_getLogs: viem's typed getLogs has no raw-topics parameter.
    // Topic-only filter (no emitter) on purpose — EIP-7708 system logs also
    // locate native funding txs; the verifier then applies the mandatory
    // emitter filter per branch.
    const logs = (await rpc.request({
      method: 'eth_getLogs',
      params: [
        {
          fromBlock: `0x${(from < floor ? floor : from).toString(16)}`,
          toBlock: `0x${to.toString(16)}`,
          topics: [TRANSFER_TOPIC, null, pad32Topic(depositAddress)],
        },
      ],
    })) as Array<{ transactionHash?: `0x${string}` }>;
    for (const l of logs) {
      if (l.transactionHash && !knownHashes.has(l.transactionHash)) {
        knownHashes.add(l.transactionHash);
        found.push(l.transactionHash);
      }
    }
    if (found.length > 0) break;
    to = from - 1n;
    // After the first (head) chunk, jump to the stored cursor if it's deeper.
    if (i === 0 && resumeAt !== undefined && resumeAt < to) to = resumeAt;
    if (to <= floor) break;
  }
  if (found.length > 0) scanCursor.delete(key);
  else scanCursor.set(key, to > floor ? to : floor);
  return found;
}

/** One verification pass over a single invoice. Returns true if it posted. */
export async function processInvoice(rpc: Rpc, item: WorkItem): Promise<boolean> {
  const deposit = item.deposit_address as `0x${string}`;
  const balance = (await rpc.readContract({
    address: config.usdcAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [deposit],
  })) as bigint;

  const entries: PaidTxEntry[] = JSON.parse(item.paid_txs ?? '[]');
  const txResults = [];

  for (const e of entries) {
    if (e.status === 'verified' || e.status === 'invalid') continue;
    try {
      const v = await verifyOneTx(rpc, e.txHash as `0x${string}`, deposit);
      txResults.push(
        v
          ? {
              txHash: e.txHash,
              source: e.source,
              result: 'verified' as const,
              branch: v.branch,
              amountUsdc6: v.creditUsdc6.toString(),
              dustNative18: v.dustNative18.toString(),
            }
          : { txHash: e.txHash, source: e.source, result: 'invalid' as const },
      );
    } catch {
      // Not found yet (or RPC hiccup). Finality is deterministic on Arc, so a
      // real tx appears within a tick or two; give up after enough attempts.
      const attempts = (e.attempts ?? 0) + 1;
      txResults.push({
        txHash: e.txHash,
        source: e.source,
        result: attempts >= MAX_PENDING_ATTEMPTS ? ('invalid' as const) : ('pending' as const),
        attempts,
      });
    }
  }

  // Balance delta the recorded txs don't explain → locate funding txs.
  const baseline = BigInt(item.baseline_usdc6);
  const delta = balance > baseline ? balance - baseline : 0n;
  const explained = entries
    .filter((e) => e.status === 'verified')
    .concat(txResults.filter((r) => r.result === 'verified') as PaidTxEntry[])
    .reduce((t, e) => t + BigInt(e.amountUsdc6 ?? 0), 0n);
  // Delta-gated audit scan: the eth_getLogs walk exists ONLY to locate funding
  // txs (and their hashes) when the balance shows more than the recorded txs
  // explain — it reconciles nothing else. So a wallet at (or below) baseline
  // has nothing to find and skips the whole chunked scan. This is the common
  // case every tick — an unpaid invoice awaiting funds, or a post-sweep wallet
  // sitting at 0 (delta 0, baseline 0) whose credit the Worker guard already
  // preserves — and it keeps such a wallet's per-tick cost at a single
  // balanceOf call instead of balanceOf + up to SCAN_MAX_CHUNKS_PER_TICK
  // getLogs requests. `delta > explained` already implies delta > 0.
  if (delta > explained) {
    const known = new Set(entries.map((e) => e.txHash).concat(txResults.map((r) => r.txHash)));
    try {
      const hashes = await scanForFundingTxs(rpc, deposit, known);
      for (const h of hashes) {
        try {
          const v = await verifyOneTx(rpc, h, deposit);
          if (v) {
            txResults.push({
              txHash: h,
              source: 'observed' as const,
              result: 'verified' as const,
              branch: v.branch,
              amountUsdc6: v.creditUsdc6.toString(),
              dustNative18: v.dustNative18.toString(),
            });
          }
        } catch {
          /* skip unverifiable candidates */
        }
      }
    } catch (e) {
      log(`audit scan failed for ${deposit}: ${(e as Error).message} (delta credit unaffected)`);
    }
  }

  const receivedChanged = delta.toString() !== String(item.received_usdc6);
  if (!receivedChanged && txResults.length === 0) return false;

  const res = await postVerification(item.id, balance.toString(), txResults);
  log(
    `invoice ${item.id}: balance=${balance} baseline=${baseline} delta=${delta} → status=${res.status} (${txResults.length} tx update(s))`,
  );
  return true;
}
