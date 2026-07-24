import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateEnvConfig } from './configValidation';

// Secrets live in the repo-root .env (never committed).
const envPath = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    // Name only — never echo values; .env may hold keys.
    throw new Error(`missing required env var: ${name} (set it in the repo-root .env)`);
  }
  return v;
}

/**
 * Fail fast on malformed money-moving config, BEFORE any work starts.
 * Names and reasons only — never values (see configValidation.ts).
 */
const validation = validateEnvConfig(process.env);
if (validation.errors.length > 0) {
  console.error('FATAL: invalid orchestrator configuration — refusing to start:');
  for (const e of validation.errors) console.error(`  - ${e}`);
  console.error('Fix the named variables in the repo-root .env, then restart.');
  process.exit(1);
}
if (validation.roleConfigAbsent) {
  console.warn(
    'WARNING: no role wallets configured (TREASURY/SPEND/RESERVE/VAULT) — ' +
      'payments will be verified but NOT routed. Expected only before Circle setup has run.',
  );
}

export const config = {
  arcRpcUrl: required('ARC_RPC_URL'),
  arcChainId: Number(required('ARC_CHAIN_ID')),
  workerBaseUrl: required('WORKER_BASE_URL').replace(/\/$/, ''),
  internalApiKey: required('INTERNAL_API_KEY'),
  usdcAddress: (process.env.USDC_ADDRESS ?? '0x3600000000000000000000000000000000000000') as `0x${string}`,
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 5000),
  // Min gap between Arc RPC requests. Arc testnet allows ~1 req/s per IP
  // (measured 2026-07-23); 1100ms keeps a margin. See rpcQueue.ts.
  rpcMinGapMs: Number(process.env.RPC_MIN_GAP_MS ?? 1100),
  // Present once Circle setup ran; the pipeline no-ops without them.
  circleApiKey: process.env.CIRCLE_API_KEY ?? '',
  circleEntitySecret: process.env.CIRCLE_ENTITY_SECRET ?? '',
  // ---- live FX (App Kit) — all validated by validateEnvConfig above ----
  // demo = fixed labeled rate (an explicit operator choice, journaled per row).
  fxMode: (process.env.FX_MODE ?? 'demo') as 'live' | 'demo',
  fxToleranceLadderBps: (process.env.FX_TOLERANCE_LADDER ?? '50,75,100').split(',').map(Number),
  fxToleranceMinEurc6: BigInt(process.env.FX_TOLERANCE_MIN_EURC6 ?? '10000'),
  // Production default 200; FX_MODE=live REQUIRES an explicit value in .env
  // (testnet override 3000 — see configValidation.ts for why).
  fxOracleMaxDeviationBps: Number(process.env.FX_ORACLE_MAX_DEVIATION_BPS ?? 200),
  fxOracleUrl: process.env.FX_ORACLE_URL ?? 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR',
  kitKey: process.env.KIT_KEY ?? '',
};
