import { describe, expect, it } from 'vitest';
import { TRANSFER_TOPIC, verifyPaymentTx, type MinimalReceipt, type MinimalTx } from './verifier';

const USDC = '0x3600000000000000000000000000000000000000';
const DEPOSIT = '0x7a3f9e4b8d06c5a1f2e8b94d7c3a65e10fb4c21d';
const ROUTER = '0x1111111111111111111111111111111111111111';
const SYSTEM_EMITTER = '0xfffefdfcfbfaf9f8f7f6f5f4f3f2f1f0efeeedec';

function pad(addr: string): string {
  return '0x' + addr.replace(/^0x/, '').padStart(64, '0');
}

function transferLog(emitter: string, to: string, amount: bigint) {
  return {
    address: emitter,
    topics: [TRANSFER_TOPIC, pad(ROUTER), pad(to)],
    data: '0x' + amount.toString(16),
  };
}

const ok = (logs: MinimalReceipt['logs']): MinimalReceipt => ({ status: 'success', logs });

describe('payment verifier branches (CLAUDE.md invariant #3)', () => {
  it('erc20_direct: payment-page transfer — tx.to is the USDC contract', () => {
    const tx: MinimalTx = { to: USDC, value: 0n };
    const r = verifyPaymentTx(tx, ok([transferLog(USDC, DEPOSIT, 100_000_000n)]), USDC, DEPOSIT);
    expect(r).toEqual({ branch: 'erc20_direct', creditUsdc6: 100_000_000n, dustNative18: 0n });
  });

  it('erc20_generic: router/smart-account payment — outer tx.to unconstrained', () => {
    const tx: MinimalTx = { to: ROUTER, value: 0n };
    const r = verifyPaymentTx(tx, ok([transferLog(USDC, DEPOSIT, 42_500_000n)]), USDC, DEPOSIT);
    expect(r).toEqual({ branch: 'erc20_generic', creditUsdc6: 42_500_000n, dustNative18: 0n });
  });

  it('EIP-7708 regression: system-emitter Transfer logs are NEVER credited', () => {
    // Same shape as a real Transfer, but 18-dec and from the system emitter.
    const tx: MinimalTx = { to: ROUTER, value: 0n };
    const spoof = transferLog(SYSTEM_EMITTER, DEPOSIT, 100n * 10n ** 18n);
    expect(verifyPaymentTx(tx, ok([spoof]), USDC, DEPOSIT)).toBeNull();
  });

  it('emitter filter keeps 18-dec system logs out even alongside a real log', () => {
    const tx: MinimalTx = { to: USDC, value: 0n };
    const r = verifyPaymentTx(
      tx,
      ok([transferLog(SYSTEM_EMITTER, DEPOSIT, 100n * 10n ** 18n), transferLog(USDC, DEPOSIT, 100_000_000n)]),
      USDC,
      DEPOSIT,
    );
    expect(r!.creditUsdc6).toBe(100_000_000n); // only the 6-dec USDC-emitted amount
  });

  it('native: tx.to == deposit, 18-dec value floors to 6-dec with dust kept out', () => {
    const value = 100n * 10n ** 18n + 999_999_999_999n; // 100 USDC + sub-micro dust
    const tx: MinimalTx = { to: DEPOSIT, value };
    const r = verifyPaymentTx(tx, ok([]), USDC, DEPOSIT);
    expect(r).toEqual({ branch: 'native', creditUsdc6: 100_000_000n, dustNative18: 999_999_999_999n });
  });

  it('native pure dust is not a payment', () => {
    const tx: MinimalTx = { to: DEPOSIT, value: 10n ** 12n - 1n };
    expect(verifyPaymentTx(tx, ok([]), USDC, DEPOSIT)).toBeNull();
  });

  it('native transfer to someone else is not credited', () => {
    const tx: MinimalTx = { to: ROUTER, value: 100n * 10n ** 18n };
    expect(verifyPaymentTx(tx, ok([]), USDC, DEPOSIT)).toBeNull();
  });

  it('reverted receipts are never credited (Arc native sends can revert)', () => {
    const tx: MinimalTx = { to: USDC, value: 0n };
    const receipt: MinimalReceipt = { status: 'reverted', logs: [transferLog(USDC, DEPOSIT, 100_000_000n)] };
    expect(verifyPaymentTx(tx, receipt, USDC, DEPOSIT)).toBeNull();
  });

  it('transfers to a different recipient are not credited', () => {
    const tx: MinimalTx = { to: USDC, value: 0n };
    expect(verifyPaymentTx(tx, ok([transferLog(USDC, ROUTER, 100_000_000n)]), USDC, DEPOSIT)).toBeNull();
  });

  it('multiple USDC transfers to the deposit in one tx aggregate', () => {
    const tx: MinimalTx = { to: ROUTER, value: 0n };
    const r = verifyPaymentTx(
      tx,
      ok([transferLog(USDC, DEPOSIT, 60_000_000n), transferLog(USDC, DEPOSIT, 40_000_000n)]),
      USDC,
      DEPOSIT,
    );
    expect(r!.creditUsdc6).toBe(100_000_000n);
    expect(r!.branch).toBe('erc20_generic');
  });

  it('is case-insensitive on addresses', () => {
    const tx: MinimalTx = { to: USDC.toUpperCase().replace('0X', '0x'), value: 0n };
    const r = verifyPaymentTx(tx, ok([transferLog(USDC, DEPOSIT.toUpperCase().replace('0X', '0x'), 1_000_000n)]), USDC, DEPOSIT);
    expect(r!.branch).toBe('erc20_direct');
  });
});
