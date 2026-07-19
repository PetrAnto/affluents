import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

export const config = {
  arcRpcUrl: required('ARC_RPC_URL'),
  arcChainId: Number(required('ARC_CHAIN_ID')),
  workerBaseUrl: required('WORKER_BASE_URL').replace(/\/$/, ''),
  internalApiKey: required('INTERNAL_API_KEY'),
  usdcAddress: (process.env.USDC_ADDRESS ?? '0x3600000000000000000000000000000000000000') as `0x${string}`,
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 5000),
  // Present once Circle setup ran; the pipeline no-ops without them.
  circleApiKey: process.env.CIRCLE_API_KEY ?? '',
  circleEntitySecret: process.env.CIRCLE_ENTITY_SECRET ?? '',
};
