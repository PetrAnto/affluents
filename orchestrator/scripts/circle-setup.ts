/**
 * One-shot Circle setup (idempotent, safe to re-run):
 *   1. Generate + register the entity secret if .env has none. The recovery
 *      file is written OUTSIDE the repo (~/affluents-secrets/), never printed.
 *   2. Create the wallet set if .env has no CIRCLE_WALLET_SET_ID.
 *   3. Top the deposit pool up to POOL_TARGET free SCA wallets on ARC-TESTNET,
 *      registering each in D1 through the Worker's internal API.
 *
 * Run: cd orchestrator && npx tsx scripts/circle-setup.ts
 * No secret values are ever logged.
 */
import { registerEntitySecretCiphertext } from '@circle-fin/developer-controlled-wallets';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, erc20Abi, http } from 'viem';
import { circleClient, createScaWallets } from '../src/circle';

const POOL_TARGET = 10;

const envPath = fileURLToPath(new URL('../../.env', import.meta.url));
process.loadEnvFile(envPath);

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var: ${name}`);
  return v;
}

/** Set or replace KEY=value in .env (values never logged). */
function upsertEnv(key: string, value: string): void {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (idx >= 0) lines[idx] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  writeFileSync(envPath, lines.join('\n'));
  chmodSync(envPath, 0o600);
  process.env[key] = value;
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

async function ensureEntitySecret(): Promise<string> {
  const existing = process.env.CIRCLE_ENTITY_SECRET;
  if (existing) {
    console.log('entity secret: already present in .env (skipping registration)');
    return existing;
  }
  const secret = randomBytes(32).toString('hex');
  console.log('entity secret: generated, registering with Circle…');
  const res = await registerEntitySecretCiphertext({
    apiKey: required('CIRCLE_API_KEY'),
    entitySecret: secret,
  });
  const recovery = res.data?.recoveryFile;
  if (!recovery) throw new Error('Circle did not return a recovery file — registration state unclear, not saving the secret');
  const secretsDir = join(homedir(), 'affluents-secrets');
  mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
  const recoveryPath = join(secretsDir, `circle-entity-recovery-${Date.now()}.dat`);
  writeFileSync(recoveryPath, recovery, { mode: 0o600 });
  upsertEnv('CIRCLE_ENTITY_SECRET', secret);
  console.log(`entity secret: registered ✓ · recovery file saved to ${recoveryPath} (outside the repo — keep it safe)`);
  return secret;
}

async function ensureWalletSet(apiKey: string, entitySecret: string): Promise<string> {
  const existing = process.env.CIRCLE_WALLET_SET_ID;
  if (existing) {
    console.log(`wallet set: using existing ${existing}`);
    return existing;
  }
  const client = circleClient(apiKey, entitySecret);
  const res = await client.createWalletSet({ name: 'affluents-deposit-pool' });
  const id = res.data?.walletSet?.id;
  if (!id) throw new Error('wallet set creation returned no id');
  upsertEnv('CIRCLE_WALLET_SET_ID', id);
  console.log(`wallet set: created ${id}`);
  return id;
}

async function main(): Promise<void> {
  const apiKey = required('CIRCLE_API_KEY');
  const entitySecret = await ensureEntitySecret();
  const walletSetId = await ensureWalletSet(apiKey, entitySecret);

  const work = await internalApi<{ freeWallets: number }>('GET', '/work');
  const client = circleClient(apiKey, entitySecret);

  // Recovery-safe: wallets may already exist at Circle from a crashed run.
  // Register ALL wallet-set wallets (idempotent by address), then only
  // create the shortfall.
  const listed = await client.listWallets({ walletSetId, pageSize: 50 });
  const existing = (listed.data?.wallets ?? []).map((w) => ({
    circleWalletId: w.id,
    address: w.address as `0x${string}`,
  }));
  const missing = POOL_TARGET - Math.max(work.freeWallets, existing.length);
  console.log(`pool: ${work.freeWallets} free in D1, ${existing.length} wallet(s) at Circle, creating ${Math.max(0, missing)} more…`);
  const created = missing > 0 ? await createScaWallets(client, walletSetId, missing) : [];
  created.push(...existing);

  // Record each wallet's on-chain 6-dec baseline (expected 0 for fresh SCAs;
  // read the real value anyway — detection is delta-above-baseline).
  const rpc = createPublicClient({ transport: http(required('ARC_RPC_URL')) });
  const usdc = (process.env.USDC_ADDRESS ?? '0x3600000000000000000000000000000000000000') as `0x${string}`;
  const wallets = [];
  for (const w of created) {
    // Public testnet RPCs rate-limit: pace the reads and retry with backoff.
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
    await new Promise((r) => setTimeout(r, 400));
  }
  await internalApi('POST', '/wallets', { wallets });
  console.log(`pool: registered ${wallets.length} wallet(s):`);
  for (const w of wallets) console.log(`  ${w.address} (baseline ${w.baselineUsdc6} usdc6)`);
  console.log('done ✓');
}

main().catch((e) => {
  console.error(`circle-setup failed: ${(e as Error).message}`);
  process.exit(1);
});
