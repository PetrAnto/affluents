import { createPublicClient, erc20Abi, http } from 'viem';
import { config } from './config';
import { runPipeline } from './executor';
import { installArcRpcFetchPacing } from './fetchPacing';
import { ping, pullWork } from './internalApi';
import { createPacedRpc, createRpcQueue } from './pacedRpc';
import { processInvoice } from './watcher';

function log(msg: string): void {
  console.log(`${new Date().toISOString()} ${msg}`);
}

// retryCount 0: viem's default 3-retry backoff would re-burst on a rate-limit
// error and defeat the pacing. The queue owns retries, spaced by the same gap.
const rawClient = createPublicClient({
  transport: http(config.arcRpcUrl, { retryCount: 0 }),
});
// Arc testnet allows ~1 req/s per IP (measured 2026-07-23). Space requests
// 1100ms apart so a full tick's reads stay under the limit instead of bursting.
const rpcQueue = createRpcQueue(config.rpcMinGapMs);
const client = createPacedRpc(rawClient, rpcQueue);
// App Kit's kit.swap issues direct Arc RPC calls from inside the SDK
// (measured 2026-07-24: bursts above the ~1 req/s limit). Route any fetch to
// the RPC host through the same queue; our own paced calls pass through.
installArcRpcFetchPacing(rpcQueue, config.arcRpcUrl);

async function startupChecks(): Promise<void> {
  // Chain connectivity: right chain, live blocks, ERC-20 view answering.
  const chainId = await client.getChainId();
  if (chainId !== config.arcChainId) {
    throw new Error(`RPC chain id mismatch: expected ${config.arcChainId}, got ${chainId}`);
  }
  const block = await client.getBlockNumber();
  // Read via the 6-decimal ERC-20 interface (the business-unit view).
  const zeroBalUsdc6 = await client.readContract({
    address: config.usdcAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: ['0x0000000000000000000000000000000000000001'],
  });
  log(`arc ok: chainId=${chainId} block=${block} usdcErc20View=ok (probe balance ${zeroBalUsdc6} usdc6)`);

  const pong = await ping();
  log(`internal API ok: worker time ${pong.time}`);
}

let lastSummary = '';

async function tick(): Promise<void> {
  const work = await pullWork();
  const summary = `reported=${work.reported.length} watching=${work.watching.length} freeWallets=${work.freeWallets}`;
  if (summary !== lastSummary) {
    log(`work: ${summary}`);
    lastSummary = summary;
  }
  // Verify payments: reported invoices first (a tx hash is waiting), then the
  // balance-delta watcher over every awaiting invoice (SPEC §3.2.2–3).
  for (const item of [...work.reported, ...work.watching]) {
    try {
      await processInvoice(client, item);
    } catch (e) {
      log(`verify ${item.id} failed: ${(e as Error).message}`);
    }
  }
  // Split pipeline: route verified payments (journaled, idempotent, resumes
  // mid-pipeline after a restart via the executions journal).
  for (const item of work.watching) {
    if (item.status !== 'payment_verified' && item.status !== 'routing') continue;
    try {
      await runPipeline(item, work.rule, client);
    } catch (e) {
      log(`pipeline ${item.id} failed (will retry next tick): ${(e as Error).message}`);
    }
  }
}

async function main(): Promise<void> {
  log('affluents orchestrator starting (outbound-only; no listening port)');
  await startupChecks();

  let stopping = false;
  const stop = (sig: string) => {
    log(`${sig} received, shutting down`);
    stopping = true;
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  let failures = 0;
  while (!stopping) {
    try {
      await tick();
      failures = 0;
    } catch (e) {
      failures += 1;
      log(`tick error (${failures} in a row): ${(e as Error).message}`);
    }
    // Back off up to 60s when the Worker or RPC is unreachable.
    const delay = Math.min(config.pollIntervalMs * Math.max(1, failures), 60_000);
    await new Promise((r) => setTimeout(r, delay));
  }
  log('stopped');
}

main().catch((e) => {
  log(`fatal: ${(e as Error).message}`);
  process.exit(1);
});
