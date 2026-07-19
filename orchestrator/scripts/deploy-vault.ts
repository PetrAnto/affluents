/**
 * One-shot DemoVault deployment (idempotent):
 *   1. Deploy contracts/out DemoVault from the fresh testnet-only deployer
 *      EOA (needs faucet USDC for gas) unless VAULT_ADDRESS is already set.
 *   2. Grant the treasury's one-time max USDC allowance to the vault via a
 *      Circle contract-execution tx (Gas Station sponsored), so the pipeline's
 *      earn step is a single deposit call.
 *
 * Run: cd orchestrator && npx tsx scripts/deploy-vault.ts
 */
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, defineChain, erc20Abi, http, maxUint256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { circleClient } from '../src/circle';
import { sendContractExecution, waitForConfirmation } from '../src/circleTx';

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

const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network'] } },
  blockExplorers: { default: { name: 'ArcScan', url: 'https://testnet.arcscan.app' } },
});

async function main(): Promise<void> {
  const usdc = (process.env.USDC_ADDRESS ?? '0x3600000000000000000000000000000000000000') as `0x${string}`;
  const rpc = createPublicClient({ chain: arcTestnet, transport: http() });

  let vault = process.env.VAULT_ADDRESS as `0x${string}` | undefined;
  if (!vault) {
    const artifact = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../contracts/out/DemoVault.sol/DemoVault.json', import.meta.url)), 'utf8'),
    );
    const account = privateKeyToAccount(required('DEPLOYER_PRIVATE_KEY') as `0x${string}`);
    const gasBalanceNative18 = await rpc.getBalance({ address: account.address });
    if (gasBalanceNative18 === 0n) {
      throw new Error(`deployer ${account.address} has no gas USDC yet — faucet it at https://faucet.circle.com`);
    }
    const wallet = createWalletClient({ account, chain: arcTestnet, transport: http() });
    console.log(`deploying DemoVault from ${account.address}…`);
    const hash = await wallet.deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode.object as `0x${string}`,
      args: [usdc],
    });
    const receipt = await rpc.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success' || !receipt.contractAddress) {
      throw new Error(`vault deployment reverted (tx ${hash})`);
    }
    vault = receipt.contractAddress;
    upsertEnv('VAULT_ADDRESS', vault);
    console.log(`DemoVault deployed: ${vault} (tx ${hash})`);
  } else {
    console.log(`DemoVault: already at ${vault}`);
  }

  // One-time treasury → vault allowance (USDC ERC-20, 6-dec view).
  const treasuryAddress = required('TREASURY_WALLET_ADDRESS') as `0x${string}`;
  const allowance = await rpc.readContract({
    address: usdc,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [treasuryAddress, vault],
  });
  if (allowance > maxUint256 / 2n) {
    console.log('treasury allowance to vault: already granted');
  } else {
    console.log('granting treasury max USDC allowance to the vault (Circle, sponsored)…');
    const client = circleClient(required('CIRCLE_API_KEY'), required('CIRCLE_ENTITY_SECRET'));
    const sent = await sendContractExecution(client, {
      fromWalletId: required('TREASURY_WALLET_ID'),
      contractAddress: usdc,
      abiFunctionSignature: 'approve(address,uint256)',
      abiParameters: [vault, maxUint256.toString()],
      refId: 'setup:treasury-vault-allowance',
    });
    const confirmed = await waitForConfirmation(client, sent.providerRef, 180_000);
    console.log(`allowance granted: ${confirmed.txHash}`);
  }
  console.log('done ✓');
}

main().catch((e) => {
  console.error(`deploy-vault failed: ${(e as Error).message}`);
  process.exit(1);
});
