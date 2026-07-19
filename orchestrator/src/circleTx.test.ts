import { describe, expect, it } from 'vitest';
import { asUsdc6 } from '@affluents/shared';
import { usdc6ToDecimalString } from './circleTx';
import { fxQuoteEurc6 } from './executor';

describe('usdc6 → Circle decimal string (exact, no floats)', () => {
  it('converts full precision', () => {
    expect(usdc6ToDecimalString(1_000_000n)).toBe('1.000000');
    expect(usdc6ToDecimalString(1n)).toBe('0.000001');
    expect(usdc6ToDecimalString(0n)).toBe('0.000000');
    expect(usdc6ToDecimalString(1_234_567n)).toBe('1.234567');
    expect(usdc6ToDecimalString(100_000_000n)).toBe('100.000000');
    expect(usdc6ToDecimalString(55_200_000n)).toBe('55.200000');
  });

  it('rejects negatives', () => {
    expect(() => usdc6ToDecimalString(-1n)).toThrow(RangeError);
  });
});

describe('TreasuryFxAdapter quote (fixed demo rate)', () => {
  it('60 USDC at 0.92 → 55.20 EURC exactly', () => {
    expect(fxQuoteEurc6(asUsdc6(60_000_000n), 920_000n)).toBe(55_200_000n);
  });

  it('floors, never rounds up', () => {
    // 1 unit at 0.92 → 0.92 of a unit → floors to 0
    expect(fxQuoteEurc6(asUsdc6(1n), 920_000n)).toBe(0n);
    expect(fxQuoteEurc6(asUsdc6(3n), 920_000n)).toBe(2n); // 2.76 → 2
  });
});
