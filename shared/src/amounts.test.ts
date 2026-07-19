import { describe, expect, it } from 'vitest';
import {
  asNative18,
  asUsdc6,
  format6,
  NATIVE18_PER_USDC6,
  native18ToUsdc6,
  parseDecimalToUsdc6,
  splitUsdc6,
  validateSplitPercents,
  type Usdc6,
} from './amounts.js';

describe('18→6 boundary (SPEC §5b)', () => {
  it('converts exact multiples with zero dust', () => {
    const { usdc6, dustNative18 } = native18ToUsdc6(asNative18(100n * 10n ** 18n));
    expect(usdc6).toBe(100_000_000n); // 100 USDC in 6-dec units
    expect(dustNative18).toBe(0n);
  });

  it('floors and keeps sub-micro dust out of business units', () => {
    // 1.5 micro-USDC worth of native wei: 1 unit + half-unit dust
    const native = asNative18(NATIVE18_PER_USDC6 + NATIVE18_PER_USDC6 / 2n);
    const { usdc6, dustNative18 } = native18ToUsdc6(native);
    expect(usdc6).toBe(1n);
    expect(dustNative18).toBe(NATIVE18_PER_USDC6 / 2n);
  });

  it('pure dust converts to zero business units', () => {
    const { usdc6, dustNative18 } = native18ToUsdc6(asNative18(999_999_999_999n));
    expect(usdc6).toBe(0n);
    expect(dustNative18).toBe(999_999_999_999n);
  });

  it('reconstructs exactly: usdc6 * 10^12 + dust == native18', () => {
    for (const native of [0n, 1n, 10n ** 12n - 1n, 10n ** 12n, 123_456_789_012_345_678n, 10n ** 24n + 7n]) {
      const { usdc6, dustNative18 } = native18ToUsdc6(asNative18(native));
      expect(usdc6 * NATIVE18_PER_USDC6 + dustNative18).toBe(native);
      expect(dustNative18 < NATIVE18_PER_USDC6).toBe(true);
    }
  });

  it('rejects negative values at the brand boundary', () => {
    expect(() => asNative18(-1n)).toThrow(RangeError);
    expect(() => asUsdc6(-1n)).toThrow(RangeError);
  });
});

describe('invoice comparison regression: 6-dec ERC-20 units only', () => {
  it('a 100 USDC invoice is satisfied by the 6-dec ERC-20 amount, not the 18-dec value', () => {
    const invoiceAmount = parseDecimalToUsdc6('100'); // what the freelancer typed
    const erc20TransferAmount = asUsdc6(100_000_000n); // Transfer log value (6 dec)
    const nativeTxValue = asNative18(100n * 10n ** 18n); // native tx.value (18 dec)

    // ERC-20 branch: compare log amount directly — both 6-dec.
    expect(erc20TransferAmount >= invoiceAmount).toBe(true);

    // Native branch: MUST convert before comparing. The raw 18-dec value
    // compared against 6-dec units would be wrong by 10^12.
    expect(nativeTxValue === (invoiceAmount as bigint)).toBe(false);
    const { usdc6 } = native18ToUsdc6(nativeTxValue);
    expect(usdc6).toBe(invoiceAmount);
  });
});

describe('split rounding & conservation (SPEC §5d)', () => {
  const conservationHolds = (routed: Usdc6, spendPct: number, reservePct: number, earnPct: number) => {
    const r = splitUsdc6(routed, { spendPct, reservePct, earnPct });
    expect(r.spendInUsdc6 + r.reserveUsdc6 + r.earnUsdc6).toBe(routed);
    return r;
  };

  it('the demo split: 100 → 60/25/15 exactly', () => {
    const r = conservationHolds(asUsdc6(100_000_000n), 60, 25, 15);
    expect(r.spendInUsdc6).toBe(60_000_000n);
    expect(r.reserveUsdc6).toBe(25_000_000n);
    expect(r.earnUsdc6).toBe(15_000_000n);
  });

  it('rounding remainder goes to Spend deterministically', () => {
    // 1 unit (0.000001 USDC): floors send 0 to reserve/earn, all to spend.
    const r = conservationHolds(asUsdc6(1n), 60, 25, 15);
    expect(r.reserveUsdc6).toBe(0n);
    expect(r.earnUsdc6).toBe(0n);
    expect(r.spendInUsdc6).toBe(1n);
  });

  it('conservation holds across awkward amounts and rules', () => {
    const amounts = [0n, 1n, 2n, 3n, 99n, 101n, 999_999n, 1_000_001n, 33_333_333n, 123_456_789n];
    const rules: Array<[number, number, number]> = [
      [60, 25, 15],
      [0, 0, 100],
      [100, 0, 0],
      [1, 98, 1],
      [33, 33, 34],
      [17, 41, 42],
    ];
    for (const a of amounts) {
      for (const [s, re, e] of rules) conservationHolds(asUsdc6(a), s, re, e);
    }
  });

  it('pseudo-random sweep keeps exact conservation', () => {
    let seed = 0xdecafbadn;
    const next = () => {
      seed = (seed * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
      return seed;
    };
    for (let i = 0; i < 2000; i++) {
      const amount = asUsdc6(next() % 10n ** 13n);
      const s = Number(next() % 101n);
      const re = Number(next() % BigInt(101 - s));
      const e = 100 - s - re;
      conservationHolds(amount, s, re, e);
    }
  });

  it('rejects invalid rules', () => {
    expect(() => validateSplitPercents({ spendPct: 65, reservePct: 25, earnPct: 15 })).toThrow(/sum to 100/);
    expect(() => validateSplitPercents({ spendPct: 60.5, reservePct: 24.5, earnPct: 15 })).toThrow(/integer/);
    expect(() => validateSplitPercents({ spendPct: -10, reservePct: 95, earnPct: 15 })).toThrow(/integer/);
  });
});

describe('parse and format', () => {
  it('parses user decimals to 6-dec units', () => {
    expect(parseDecimalToUsdc6('100')).toBe(100_000_000n);
    expect(parseDecimalToUsdc6('100.00')).toBe(100_000_000n);
    expect(parseDecimalToUsdc6('0.000001')).toBe(1n);
    expect(parseDecimalToUsdc6('1,234.56')).toBe(1_234_560_000n);
  });

  it('rejects junk, negatives, and >6 decimals', () => {
    for (const bad of ['', 'abc', '-5', '1.2345678', '1e6', '.5']) {
      expect(() => parseDecimalToUsdc6(bad)).toThrow(RangeError);
    }
  });

  it('formats with truncation, never rounding up', () => {
    expect(format6(asUsdc6(100_000_000n))).toBe('100.00');
    expect(format6(asUsdc6(55_637_999n))).toBe('55.63'); // truncate, not 55.64
    expect(format6(asUsdc6(55_637_999n), 6)).toBe('55.637999');
    expect(format6(asUsdc6(1_240_000_000n))).toBe('1,240.00');
  });
});
