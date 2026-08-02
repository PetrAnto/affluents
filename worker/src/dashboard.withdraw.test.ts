import { describe, expect, it } from 'vitest';
import type { getDashboardData, WithdrawalState } from './db';
import { dashboardPage } from './pages/dashboard';

/**
 * Withdraw-from-Earn dashboard states (WITHDRAW_HANDOFF.md Phase 3, signed
 * copy table). dashboardPage is pure — these pin the exact operator-facing
 * copy per state: never internal state names, never a failure state for
 * money that exists.
 */
type DashData = Awaited<ReturnType<typeof getDashboardData>>;

function wdState(partial: {
  state?: 'pending' | 'complete' | 'failed';
  destination?: 'spend' | 'reserve';
  vaultTx?: string | null;
  transferTx?: string | null;
}): WithdrawalState {
  const state = partial.state ?? 'complete';
  return {
    withdrawal: {
      id: 'wd_page000000000001',
      amount_usdc6: 10_000,
      destination: partial.destination ?? 'reserve',
      state,
      fail_reason: null,
      created_block: 54_960_000,
      created_at: '2026-08-02T16:00:00.000Z',
      updated_at: '2026-08-02T16:01:00.000Z',
    },
    steps: [
      {
        id: 'wd_page000000000001:vault',
        withdrawal_id: 'wd_page000000000001',
        step: 'vault',
        status: 'confirmed',
        provider_ref: 'ref-v',
        tx_hash: partial.vaultTx === undefined ? '0xvaulttx' : partial.vaultTx,
        amount_usdc6: 10_000,
        attempt_count: 1,
        created_at: '2026-08-02T16:00:10.000Z',
        updated_at: '2026-08-02T16:00:20.000Z',
      },
      {
        id: 'wd_page000000000001:transfer',
        withdrawal_id: 'wd_page000000000001',
        step: 'transfer',
        status: 'confirmed',
        provider_ref: 'ref-t',
        tx_hash: partial.transferTx === undefined ? '0xtransfertx' : partial.transferTx,
        amount_usdc6: 10_000,
        attempt_count: 1,
        created_at: '2026-08-02T16:00:30.000Z',
        updated_at: '2026-08-02T16:00:40.000Z',
      },
    ],
  };
}

function fixture(over: { earnUsdc6?: bigint; spendWithdrawnUsdc6?: bigint; reserveWithdrawnUsdc6?: bigint; withdrawals?: WithdrawalState[] }): DashData {
  return {
    totals: {
      spendEurc6: 4_421_938n,
      spendInUsdc6: 4_800_000n,
      reserveUsdc6: 2_030_000n,
      earnUsdc6: over.earnUsdc6 ?? 1_160_000n,
      exceptionUsdc6: 500_000n,
      totalReceivedUsdc6: 8_000_000n,
      spendWithdrawnUsdc6: over.spendWithdrawnUsdc6 ?? 0n,
      reserveWithdrawnUsdc6: over.reserveWithdrawnUsdc6 ?? 0n,
    },
    invoices: [],
    rule: { spend_pct: 60, reserve_pct: 25, earn_pct: 15, updated_at: '2026-07-16T00:00:00.000Z' },
    exceptions: [],
    fxHalted: [],
    fxLatestSource: 'appkit',
    withdrawals: over.withdrawals ?? [],
  };
}

const render = (data: DashData) => dashboardPage(data, 'testsecret', 'https://testnet.arcscan.app', new Date('2026-08-02T16:30:00Z'));

describe('withdraw amount parsing — the EMITTED client validator', () => {
  /**
   * Regression for the 2026-08-02 UI incident: the client script is emitted
   * from a TS template literal, which cooks `\d` down to `d` — the shipped
   * regex matched nothing and every amount was refused. These tests extract
   * toUsdc6 FROM THE RENDERED HTML and execute it, so they validate what the
   * browser actually receives, not what the source file appears to say.
   */
  function emittedToUsdc6(): (s: string) => string | null {
    const html = render(fixture({}));
    const start = html.indexOf('function toUsdc6');
    expect(start).toBeGreaterThan(-1);
    const end = html.indexOf('\n  }', start);
    const src = html.slice(start, end + 4);
    return new Function(`return ${src}`)() as (s: string) => string | null;
  }

  it('accepts dot input: "0.01" → 10000, "1.160000" → 1160000, "5" → 5000000', () => {
    const toUsdc6 = emittedToUsdc6();
    expect(toUsdc6('0.01')).toBe('10000');
    expect(toUsdc6('1.160000')).toBe('1160000');
    expect(toUsdc6('5')).toBe('5000000');
  });

  it('accepts comma input (EU keyboards): "0,01" → 10000', () => {
    const toUsdc6 = emittedToUsdc6();
    expect(toUsdc6('0,01')).toBe('10000');
    expect(toUsdc6(' 1,5 ')).toBe('1500000');
  });

  it('still refuses empty, zero, garbage, and >6 decimals', () => {
    const toUsdc6 = emittedToUsdc6();
    for (const bad of ['', '0', '0.000000', '0,00', 'abc', '1.2.3', '1.2345678', '-1', '1e3']) {
      expect(toUsdc6(bad), `input ${JSON.stringify(bad)}`).toBeNull();
    }
  });
});

describe('dashboard withdraw control states', () => {
  it('positive position, no pending: control with both USDC destinations and the confirm affordance', () => {
    const html = render(fixture({}));
    expect(html).toContain('Withdraw from Earn');
    expect(html).toContain('To Reserve (USDC)');
    expect(html).toContain('To Spend (USDC)');
    expect(html).toContain('Move '); // confirm copy template lives in the script
    expect(html).toContain('data-max="1.160000"');
  });

  it('zero position: "Nothing in Earn yet", no control', () => {
    const html = render(fixture({ earnUsdc6: 0n }));
    expect(html).toContain('Nothing in Earn yet');
    expect(html).not.toContain('id="wdGo"');
  });

  it('non-terminal withdrawal: "Withdrawal in progress", no amount input, poll armed', () => {
    const html = render(fixture({ withdrawals: [wdState({ state: 'pending' })] }));
    expect(html).toContain('Withdrawal in progress');
    expect(html).toContain('data-poll="1"');
    expect(html).not.toContain('id="wdAmt"');
    // never internal state names on the card
    expect(html).not.toMatch(/vault_confirmed|provider_ref|intent</);
  });

  it('failed (pre-dispatch only): "Withdrawal not completed — funds remain in Earn."', () => {
    const html = render(fixture({ withdrawals: [wdState({ state: 'failed' })] }));
    expect(html).toContain('Withdrawal not completed — funds remain in Earn.');
    expect(html).toContain('id="wdGo"'); // control stays usable
  });

  it('defluence glyph animates during "Withdrawal in progress" and ships hidden with the form', () => {
    const pending = render(fixture({ withdrawals: [wdState({ state: 'pending' })] }));
    // visible in the pending card, reverse-drawn earn-branch + channel paths
    expect(pending).toContain('class="defl"');
    expect(pending).toContain('class="d br"');
    expect(pending).toContain('class="d ch"');
    const form = render(fixture({}));
    expect(form).toContain('id="wdDefl" hidden'); // revealed by JS on confirm
  });

  it('completed withdrawal: history line with both explorer links', () => {
    const html = render(fixture({ withdrawals: [wdState({})] }));
    expect(html).toContain('Withdrawals');
    expect(html).toContain('0.01 USDC · Earn → Reserve');
    expect(html).toContain('https://testnet.arcscan.app/tx/0xvaulttx');
    expect(html).toContain('https://testnet.arcscan.app/tx/0xtransfertx');
  });

  it('spend card separates withdrawn USDC from the auto-swapped figure', () => {
    const html = render(fixture({ spendWithdrawnUsdc6: 10_000n }));
    expect(html).toContain('Auto-swapped from 4.80 USDC');
    expect(html).toContain('+ 0.01 USDC — Withdrawn from Earn');
  });

  it('reserve card notes withdrawn inclusion', () => {
    const html = render(fixture({ reserveWithdrawnUsdc6: 30_000n }));
    expect(html).toContain('incl. 0.03 USDC withdrawn from Earn');
  });
});
