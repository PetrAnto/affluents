import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';

/**
 * WalletAdapter primary path: Circle Developer-Controlled SCA wallets on
 * ARC-TESTNET (+ Gas Station sponsorship for sends, used from Phase 3).
 * Requires CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET (registered) in .env.
 */
export function circleClient(apiKey: string, entitySecret: string) {
  return initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
}

export type CircleClient = ReturnType<typeof circleClient>;

export interface CreatedWallet {
  circleWalletId: string;
  address: `0x${string}`;
}

export async function createScaWallets(
  client: CircleClient,
  walletSetId: string,
  count: number,
): Promise<CreatedWallet[]> {
  const res = await client.createWallets({
    walletSetId,
    blockchains: ['ARC-TESTNET'],
    count,
    accountType: 'SCA',
  });
  const wallets = res.data?.wallets ?? [];
  if (wallets.length !== count) {
    throw new Error(`asked Circle for ${count} wallets, got ${wallets.length}`);
  }
  return wallets.map((w) => ({ circleWalletId: w.id, address: w.address as `0x${string}` }));
}
