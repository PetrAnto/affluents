import { asNative18, asUsdc6, native18ToUsdc6, type Usdc6 } from '@affluents/shared';

/**
 * Payment verification — branches per CLAUDE.md invariant #3 / SPEC §3.2.
 * There is NO single `tx.to` rule:
 *  - erc20_direct:  our payment page's USDC.transfer — outer tx.to IS the
 *    verified USDC contract, plus a USDC-emitted Transfer log to the deposit.
 *  - erc20_generic: smart accounts / routers / batchers — outer tx.to is NOT
 *    constrained; the USDC-contract-emitted Transfer log is authoritative.
 *  - native:        tx.to == deposit address; tx.value is 18-dec and crosses
 *    the 18→6 floor boundary; sub-micro dust never becomes business units.
 * The emitter filter (log.address == USDC) is mandatory in both ERC-20
 * branches: Arc also emits EIP-7708 system Transfer logs at 18 decimals from
 * a system emitter, which must never be credited as 6-dec amounts.
 */

export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export interface MinimalLog {
  address: string;
  topics: readonly string[];
  data: string;
}

export interface MinimalReceipt {
  status: 'success' | 'reverted';
  logs: readonly MinimalLog[];
}

export interface MinimalTx {
  to: string | null;
  value: bigint;
}

export type VerifiedBranch = 'erc20_direct' | 'erc20_generic' | 'native';

export interface VerifiedPayment {
  branch: VerifiedBranch;
  creditUsdc6: Usdc6;
  dustNative18: bigint;
}

function topicToAddress(topic: string): string {
  return ('0x' + topic.slice(-40)).toLowerCase();
}

/**
 * Classify and verify one transaction against a deposit address.
 * Returns null when the tx pays the deposit address nothing verifiable.
 * Pure function over receipt+tx — chain-agnostic, unit-tested with fixtures;
 * chain behavior itself is exercised against the real Arc testnet RPC.
 */
export function verifyPaymentTx(
  tx: MinimalTx,
  receipt: MinimalReceipt,
  usdcAddress: string,
  depositAddress: string,
): VerifiedPayment | null {
  if (receipt.status !== 'success') return null;
  const usdc = usdcAddress.toLowerCase();
  const deposit = depositAddress.toLowerCase();
  const outerTo = tx.to?.toLowerCase() ?? null;

  // ERC-20: sum Transfer logs EMITTED BY THE USDC CONTRACT to the deposit
  // address. Logs from any other emitter (incl. the EIP-7708 system emitter)
  // are ignored regardless of shape.
  let erc20Usdc6 = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== usdc) continue;
    if (log.topics[0] !== TRANSFER_TOPIC || log.topics.length < 3) continue;
    if (topicToAddress(log.topics[2]!) !== deposit) continue;
    erc20Usdc6 += BigInt(log.data === '0x' ? 0 : log.data);
  }

  if (erc20Usdc6 > 0n) {
    return {
      branch: outerTo === usdc ? 'erc20_direct' : 'erc20_generic',
      creditUsdc6: asUsdc6(erc20Usdc6),
      dustNative18: 0n,
    };
  }

  // Native: only when the outer tx targets the deposit address itself.
  if (outerTo === deposit && tx.value > 0n) {
    const { usdc6, dustNative18 } = native18ToUsdc6(asNative18(tx.value));
    if (usdc6 === 0n) return null; // pure dust never becomes a business credit
    return { branch: 'native', creditUsdc6: usdc6, dustNative18 };
  }

  return null;
}
