/**
 * One-shot deposit-pool refill: create EXACTLY REFILL_COUNT new Circle SCA
 * wallets on ARC-TESTNET in the existing wallet set and register them in D1
 * through the Worker's internal API (INSERT OR IGNORE — additive only).
 *
 * Deliberately does NOT list the Circle wallet set: the set also contains the
 * treasury/spend/reserve ROLE wallets, and re-registering existing wallets
 * (circle-setup.ts's recovery behaviour) would insert them into the deposit
 * pool. This script only ever touches wallets it just created.
 *
 * If it fails AFTER "created at Circle" is printed, do not re-run blindly:
 * the printed wallets exist at Circle but may not be in D1. Paste the output
 * back instead — registration is idempotent by address and can be completed
 * separately.
 *
 * Run: cd orchestrator && npx tsx scripts/refill-pool.ts
 * No secret values are ever logged.
 */
import { fileURLToPath } from 'node:url';
import { createPublicClient, erc20Abi, http } from 'viem';
import { circleClient, createScaWallets } from '../src/circle';

const REFILL_COUNT = 12;
const RPC_GAP_MS = 1100; // Arc public RPC allows ~1 req/s per IP (measured 2026-07-23)

const envPath = fileURLToPath(new URL('../../.env', import.meta.url));
process.loadEnvFile(envPath);

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var: ${name}`);
  return v;
}

async function internalApi<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${required('WORKER_BASE_URL')}/api/internal${path}`, {
    method,
    headers: {
      'X-Internal-Key': required('INTERNAL_API_KEY'),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`internal API ${method} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function main(): Promise<void> {
  const before = await internalApi<{ freeWallets: number }>('GET', '/work');
  console.log(`pool before: ${before.freeWallets} free — creating ${REFILL_COUNT} new SCA wallet(s)…`);

  const client = circleClient(required('CIRCLE_API_KEY'), required('CIRCLE_ENTITY_SECRET'));
  const created = await createScaWallets(client, required('CIRCLE_WALLET_SET_ID'), REFILL_COUNT);
  console.log(`created at Circle (${created.length}):`);
  created.forEach((w, i) => console.log(`  #${i + 1}  ${w.circleWalletId}  ${w.address}`));

  // Record each wallet's on-chain 6-dec baseline (expected 0 for fresh SCAs;
  // read the real value anyway — detection is delta-above-baseline).
  const rpc = createPublicClient({ transport: http(required('ARC_RPC_URL')) });
  const usdc = (process.env.USDC_ADDRESS ?? '0x3600000000000000000000000000000000000000') as `0x${string}`;
  const wallets = [];
  for (const w of created) {
    let baseline: bigint | null = null;
    for (let attempt = 1; attempt <= 6 && baseline === null; attempt++) {
      try {
        baseline = await rpc.readContract({
          address: usdc,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [w.address],
        });
      } catch {
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    if (baseline === null) throw new Error(`could not read baseline for ${w.address} after retries`);
    wallets.push({
      address: w.address,
      circleWalletId: w.circleWalletId,
      baselineUsdc6: baseline.toString(),
    });
    await new Promise((r) => setTimeout(r, RPC_GAP_MS));
  }

  await internalApi('POST', '/wallets', { wallets });
  console.log(`registered in D1 (${wallets.length}):`);
  wallets.forEach((w, i) => console.log(`  #${i + 1}  ${w.circleWalletId}  ${w.address}  baseline ${w.baselineUsdc6} usdc6`));

  const after = await internalApi<{ freeWallets: number }>('GET', '/work');
  console.log(`pool after: ${after.freeWallets} free`);
  console.log('done ✓');
}

main().catch((e) => {
  console.error(`refill-pool failed: ${(e as Error).message}`);
  process.exit(1);
});
