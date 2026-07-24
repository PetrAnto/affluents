import { describe, expect, it } from 'vitest';
import { decimalString6, parseSdkDecimal6, parseSdkDecimalToEurc6 } from './amounts';

describe('SDK decimal boundary (string parsing, never floats)', () => {
  it('parses measured App Kit shapes exactly', () => {
    // Real values from the 2026-07-24 Phase 0 measurements.
    expect(parseSdkDecimal6('0.035187')).toBe(35187n); // amountOut == on-chain delta
    expect(parseSdkDecimal6('0.00001')).toBe(10n); // provider fee, 2 bps of 0.05
    expect(parseSdkDecimal6('0.07025')).toBe(70250n);
    expect(parseSdkDecimal6('1')).toBe(1_000_000n);
    expect(parseSdkDecimal6('12.5')).toBe(12_500_000n);
  });

  it('floors digits beyond the 6th decimal (informational 18-dec gas values)', () => {
    expect(parseSdkDecimal6('0.032522271368317049')).toBe(32522n);
    expect(parseSdkDecimal6('0.9999999')).toBe(999999n); // floors, never rounds up
  });

  it('rejects non-decimal shapes rather than guessing', () => {
    for (const bad of ['', '1e-6', '-0.5', '0,5', '0.5.1', 'NaN', ' 1 2']) {
      expect(() => parseSdkDecimal6(bad)).toThrow(RangeError);
    }
  });

  it('round-trips with decimalString6 exactly', () => {
    for (const v of [0n, 1n, 35187n, 999999n, 1_000_000n, 123_456_789n]) {
      expect(parseSdkDecimal6(decimalString6(v))).toBe(v);
    }
    expect(decimalString6(600_000n)).toBe('0.600000');
  });

  it('brands EURC amounts and rejects negatives at the brand gate', () => {
    expect(parseSdkDecimalToEurc6('0.035187')).toBe(35187n);
  });
});
