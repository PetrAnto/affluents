import { asUsdc6, decimalString6, parseSdkDecimal6, parseSdkDecimalToEurc6, type Eurc6, type Usdc6 } from '@affluents/shared';
import { config } from './config';

/**
 * Thin facade over @circle-fin/app-kit for the one pair we trade:
 * USDC → EURC on Arc testnet, swapped by the treasury SCA wallet.
 *
 * Everything crossing this boundary is converted by exact string decimal
 * parsing (shared/amounts.ts) — the SDK speaks decimal strings ("0.05"),
 * the app speaks 6-dec integers, floats never appear.
 *
 * Measured behaviour this code relies on (Phase 0, 2026-07-24):
 * - `estimatedOutput` is NET of the 2 bps provider fee — a fresh estimate
 *   equalled the actual on-chain amountOut to the unit.
 * - A breached stopLimit fails in Circle's API BEFORE any transaction exists
 *   (error name INPUT_SLIPPAGE_CONSTRAINT_NOT_MET, code 1009) — no gas, no
 *   on-chain trace, so laddering after it is free.
 * - `kit.swap` makes a few direct Arc RPC calls; fetchPacing.ts routes them
 *   through the RPC queue so they cannot burst past the ~1 req/s limit.
 * - SCA wallets need allowanceStrategy 'approve' (ERC-1271 incompatibility).
 */

interface KitBundle {
  kit: { estimateSwap: (p: unknown) => Promise<unknown>; swap: (p: unknown) => Promise<unknown> };
  adapter: unknown;
}

let kitPromise: Promise<KitBundle> | null = null;

async function getKit(): Promise<KitBundle> {
  kitPromise ??= (async () => {
    const { AppKit } = await import('@circle-fin/app-kit');
    const { createCircleWalletsAdapter } = await import('@circle-fin/adapter-circle-wallets');
    const kit = new AppKit() as KitBundle['kit'];
    const adapter = createCircleWalletsAdapter({
      apiKey: config.circleApiKey,
      entitySecret: config.circleEntitySecret,
    });
    return { kit, adapter };
  })();
  return kitPromise;
}

function swapParams(adapter: unknown, treasuryAddress: string, amountInUsdc6: Usdc6, stopLimitEurc6?: bigint) {
  return {
    from: { adapter, chain: 'Arc_Testnet', address: treasuryAddress },
    tokenIn: 'USDC',
    tokenOut: 'EURC',
    amountIn: decimalString6(amountInUsdc6),
    config: {
      kitKey: config.kitKey,
      allowanceStrategy: 'approve',
      ...(stopLimitEurc6 !== undefined ? { stopLimit: decimalString6(stopLimitEurc6) } : {}),
    },
  };
}

export async function estimateSwapOutEurc6(treasuryAddress: string, amountInUsdc6: Usdc6): Promise<Eurc6> {
  const { kit, adapter } = await getKit();
  const est = (await kit.estimateSwap(swapParams(adapter, treasuryAddress, amountInUsdc6))) as {
    estimatedOutput?: { amount?: string };
  };
  const amount = est.estimatedOutput?.amount;
  if (!amount) throw new Error('estimateSwap returned no estimatedOutput.amount');
  return parseSdkDecimalToEurc6(amount);
}

export interface SwapActuals {
  amountOutEurc6: Eurc6;
  txHash: string;
  feesUsdc6: bigint;
}

export async function swapUsdcToEurc(
  treasuryAddress: string,
  amountInUsdc6: Usdc6,
  stopLimitEurc6: bigint,
): Promise<SwapActuals> {
  const { kit, adapter } = await getKit();
  const result = (await kit.swap(swapParams(adapter, treasuryAddress, amountInUsdc6, stopLimitEurc6))) as {
    amountOut?: string;
    txHash?: string;
    fees?: Array<{ token?: string; amount?: string; type?: string }>;
  };
  if (!result.amountOut || !result.txHash) {
    throw new Error(`kit.swap returned without amountOut/txHash (keys: ${Object.keys(result).join(',')})`);
  }
  const feesUsdc6 = (result.fees ?? [])
    .filter((f) => f.type === 'provider' && f.token === 'USDC' && f.amount)
    .reduce((t, f) => t + parseSdkDecimal6(f.amount!), 0n);
  return { amountOutEurc6: parseSdkDecimalToEurc6(result.amountOut), txHash: result.txHash, feesUsdc6 };
}

/** The measured pre-dispatch stopLimit refusal — the only error the ladder retries. */
export function isStopLimitError(e: unknown): boolean {
  const err = e as { name?: string; code?: number } | null;
  return err?.name === 'INPUT_SLIPPAGE_CONSTRAINT_NOT_MET' || err?.code === 1009;
}

/** Compact, value-free error tag for the attempts journal. */
export function errorCodeOf(e: unknown): string {
  const err = e as { name?: string; code?: number; message?: string } | null;
  return String(err?.name ?? err?.code ?? err?.message ?? 'unknown').slice(0, 120);
}

/** Test seam: real estimate/swap bundled for injection into runFxLeg. */
export function realKitFx(treasuryAddress: string) {
  return {
    estimate: (amountIn6: Usdc6) => estimateSwapOutEurc6(treasuryAddress, amountIn6),
    swap: (amountIn6: Usdc6, stopLimit6: bigint) => swapUsdcToEurc(treasuryAddress, amountIn6, stopLimit6),
  };
}

export type KitFx = ReturnType<typeof realKitFx>;

// re-exported for convenience of callers building amounts
export { asUsdc6 };
