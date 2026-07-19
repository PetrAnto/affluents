/**
 * Money math for Affluents.
 *
 * Invariants (CLAUDE.md / SPEC §5b–§5d):
 * - ALL business/accounting amounts are integer 6-decimal ERC-20 units
 *   (branded `Usdc6` / `Eurc6` bigints).
 * - Native Arc values are 18-decimal, live only at gas/boundary code
 *   (branded `Native18`), and are converted here — nowhere else.
 * - No floats anywhere near money.
 */

export type Usdc6 = bigint & { readonly __brand: 'Usdc6' };
export type Eurc6 = bigint & { readonly __brand: 'Eurc6' };
export type Native18 = bigint & { readonly __brand: 'Native18' };

/** 10^12: how many native-18 wei equal one 6-decimal USDC unit. */
export const NATIVE18_PER_USDC6 = 10n ** 12n;

export function asUsdc6(v: bigint): Usdc6 {
  if (v < 0n) throw new RangeError(`Usdc6 amounts are non-negative, got ${v}`);
  return v as Usdc6;
}

export function asEurc6(v: bigint): Eurc6 {
  if (v < 0n) throw new RangeError(`Eurc6 amounts are non-negative, got ${v}`);
  return v as Eurc6;
}

export function asNative18(v: bigint): Native18 {
  if (v < 0n) throw new RangeError(`Native18 amounts are non-negative, got ${v}`);
  return v as Native18;
}

/**
 * The ONLY 18→6 boundary (SPEC §5b): floor to 6-dec units; the sub-micro
 * remainder is dust that must never be promoted into business units.
 */
export function native18ToUsdc6(native: Native18): { usdc6: Usdc6; dustNative18: Native18 } {
  return {
    usdc6: asUsdc6(native / NATIVE18_PER_USDC6),
    dustNative18: asNative18(native % NATIVE18_PER_USDC6),
  };
}

export interface SplitPercents {
  spendPct: number;
  reservePct: number;
  earnPct: number;
}

export function validateSplitPercents(p: SplitPercents): void {
  for (const [name, v] of Object.entries(p)) {
    if (!Number.isInteger(v) || v < 0 || v > 100) {
      throw new RangeError(`${name} must be an integer in [0,100], got ${v}`);
    }
  }
  if (p.spendPct + p.reservePct + p.earnPct !== 100) {
    throw new RangeError(
      `split percents must sum to 100, got ${p.spendPct}+${p.reservePct}+${p.earnPct}`,
    );
  }
}

export interface SplitResult {
  spendInUsdc6: Usdc6;
  reserveUsdc6: Usdc6;
  earnUsdc6: Usdc6;
}

/**
 * SPEC §5d: floor Reserve, floor Earn, Spend takes the remainder, so
 * spendIn + reserve + earn == routed amount exactly, in integer 6-dec units.
 */
export function splitUsdc6(routed: Usdc6, p: SplitPercents): SplitResult {
  validateSplitPercents(p);
  const reserveUsdc6 = asUsdc6((routed * BigInt(p.reservePct)) / 100n);
  const earnUsdc6 = asUsdc6((routed * BigInt(p.earnPct)) / 100n);
  const spendInUsdc6 = asUsdc6(routed - reserveUsdc6 - earnUsdc6);
  return { spendInUsdc6, reserveUsdc6, earnUsdc6 };
}

/** Parse a user-typed decimal string ("100", "100.5", "100.000001") to Usdc6. */
export function parseDecimalToUsdc6(input: string): Usdc6 {
  const s = input.trim().replace(/,/g, '');
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(s);
  if (!m) throw new RangeError(`not a valid amount: ${JSON.stringify(input)}`);
  const whole = BigInt(m[1]!);
  const frac = BigInt((m[2] ?? '').padEnd(6, '0') || '0');
  return asUsdc6(whole * 1_000_000n + frac);
}

/**
 * Display formatting (BRAND.md: amounts show 2 decimals in UI, full precision
 * on detail). Truncates — never rounds money up.
 */
export function format6(v: Usdc6 | Eurc6, decimals: 2 | 6 = 2): string {
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, '0');
  const wholeStr = whole.toLocaleString('en-US');
  return `${wholeStr}.${frac.slice(0, decimals)}`;
}
