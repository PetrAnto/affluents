/**
 * One-shot: create the three ROLE wallets (treasury, spend, reserve) as
 * Circle SCA wallets on ARC-TESTNET. These are NOT deposit-pool wallets and
 * are never registered in D1's deposit_wallets. Idempotent: skips any role
 * already present in .env. Also generates a fresh testnet-only deployer EOA
 * for the DemoVault if none exists (key stays in .env, never logged).
 *
 * Run: cd orchestrator && npx tsx scripts/create-role-wallets.ts
 */
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { circleClient, createScaWallets } from '../src/circle';

const envPath = fileURLToPath(new URL('../../.env', import.meta.url));
process.loadEnvFile(envPath);

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var: ${name}`);
  return v;
}

function upsertEnv(key: string, value: string): void {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (idx >= 0) lines[idx] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  writeFileSync(envPath, lines.join('\n'));
  chmodSync(envPath, 0o600);
  process.env[key] = value;
}

const ROLES = ['TREASURY', 'SPEND', 'RESERVE'] as const;

async function main(): Promise<void> {
  const missing = ROLES.filter((r) => !process.env[`${r}_WALLET_ADDRESS`]);
  if (missing.length > 0) {
    const client = circleClient(required('CIRCLE_API_KEY'), required('CIRCLE_ENTITY_SECRET'));
    const created = await createScaWallets(client, required('CIRCLE_WALLET_SET_ID'), missing.length);
    missing.forEach((role, i) => {
      const w = created[i]!;
      upsertEnv(`${role}_WALLET_ID`, w.circleWalletId);
      upsertEnv(`${role}_WALLET_ADDRESS`, w.address);
      console.log(`${role.toLowerCase()} wallet: ${w.address}`);
    });
  } else {
    console.log('role wallets: all present in .env');
    for (const r of ROLES) console.log(`  ${r.toLowerCase()}: ${process.env[`${r}_WALLET_ADDRESS`]}`);
  }

  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    const pk = generatePrivateKey();
    const account = privateKeyToAccount(pk);
    upsertEnv('DEPLOYER_PRIVATE_KEY', pk);
    upsertEnv('DEPLOYER_ADDRESS', account.address);
    console.log(`deployer EOA generated (testnet-only): ${account.address}`);
  } else {
    console.log(`deployer EOA: ${process.env.DEPLOYER_ADDRESS}`);
  }
  console.log('done ✓');
}

main().catch((e) => {
  console.error(`create-role-wallets failed: ${(e as Error).message}`);
  process.exit(1);
});
