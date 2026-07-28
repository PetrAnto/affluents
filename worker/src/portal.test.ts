import { describe, expect, it } from 'vitest';
import type { FxIntentState } from './db';
import { buildPortalDto, clientStateOf } from './portal';
import type { InvoiceRow } from './types';

const EXPLORER = 'https://testnet.arcscan.app';

/**
 * THE exhaustive portal DTO allowlist (PORTAL_HANDOFF "DTO allowlist").
 * Adding any key to the DTO without amending this list — and the handoff
 * decision behind it — must fail here, loudly, before it can ship.
 */
const ALLOWED_KEYS = [
  'label',
  'amount_usdc6',
  'received_usdc6',
  'overpaid_usdc6',
  'unexpected_payment',
  'client_state',
  'funding_txs',
  'rate_label',
  'fx_pending',
  'fx_pending_usdc6',
  'fx_indicative_eur',
  'paid_at',
  'completed',
].sort();

/** Keys present in EVERY response; the rest are strictly conditional. */
const BASE_KEYS = [
  'label',
  'amount_usdc6',
  'received_usdc6',
  'unexpected_payment',
  'client_state',
  'funding_txs',
  'rate_label',
  'fx_pending',
  'paid_at',
  'completed',
].sort();

function inv(patch: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: 'inv_0123456789abcdef00',
    display_no: '2026-001',
    amount_usdc6: 1_000_000,
    label: 'Acme Studio',
    memo: 'private memo — must never appear in the DTO',
    status: 'awaiting_payment',
    wallet_id: 'dw_1',
    paid_txs: '[]',
    paid_at: null,
    received_usdc6: 0,
    overpaid_usdc6: 0,
    overpaid: 0,
    unexpected_payment: 0,
    portal_token: 'rcp_00000000000000000000000000000000',
    created_at: '2026-07-28T00:00:00.000Z',
    deposit_address: '0x1111111111111111111111111111111111111111',
    ...patch,
  };
}

function fx(patch: Partial<FxIntentState['intent']> = {}): FxIntentState {
  return {
    intent: {
      id: 'inv_0123456789abcdef00:fx',
      invoice_id: 'inv_0123456789abcdef00',
      amount_in_usdc6: 600_000,
      estimated_out_eurc6: 416_527,
      stop_limit_eurc6: 406_527,
      tolerance_bps: 50,
      rate_source: 'appkit',
      oracle_rate_ppm: 877_810,
      oracle_deviation_bps: 2091,
      estimated_at: '2026-07-28T00:00:00.000Z',
      estimated_block: 100,
      pre_swap_eurc6: 0,
      state: 'pending',
      ...patch,
    },
    attempts: [],
    result: null,
  };
}

describe('DTO key-set snapshot (allowlist is exhaustive)', () => {
  const scenarios: Array<[string, InvoiceRow, FxIntentState | null, string[]]> = [
    ['awaiting, no fx', inv(), null, BASE_KEYS],
    [
      'completed with live fx',
      inv({ status: 'completed', received_usdc6: 1_000_000, paid_at: '2026-07-28T01:00:00.000Z' }),
      fx({ state: 'complete' }),
      BASE_KEYS,
    ],
    [
      'overpaid adds ONLY overpaid_usdc6',
      inv({ status: 'completed', received_usdc6: 1_200_000, overpaid: 1, overpaid_usdc6: 200_000 }),
      fx({ state: 'complete' }),
      [...BASE_KEYS, 'overpaid_usdc6'].sort(),
    ],
    [
      'fx pending with oracle adds ONLY the two fx fields',
      inv({ status: 'routing', received_usdc6: 1_000_000 }),
      fx({ state: 'halted' }),
      [...BASE_KEYS, 'fx_pending_usdc6', 'fx_indicative_eur'].sort(),
    ],
    [
      'fx pending with NULL oracle omits the € figure',
      inv({ status: 'routing', received_usdc6: 1_000_000 }),
      fx({ state: 'halted', oracle_rate_ppm: null }),
      [...BASE_KEYS, 'fx_pending_usdc6'].sort(),
    ],
  ];

  for (const [name, row, fxState, expected] of scenarios) {
    it(name, () => {
      const keys = Object.keys(buildPortalDto(row, fxState, EXPLORER)).sort();
      expect(keys).toEqual(expected);
      for (const k of keys) expect(ALLOWED_KEYS).toContain(k);
    });
  }

  it('never leaks internal fields, whatever the invoice row carries', () => {
    const dto = buildPortalDto(inv({ status: 'completed' }), fx({ state: 'complete' }), EXPLORER) as unknown as Record<string, unknown>;
    for (const forbidden of ['id', 'memo', 'status', 'wallet_id', 'deposit_address', 'display_no', 'portal_token', 'paid_txs']) {
      expect(dto).not.toHaveProperty(forbidden);
    }
    expect(JSON.stringify(dto)).not.toContain('private memo');
  });
});

describe('clientStateOf — internal→client mapping per the handoff table', () => {
  const cases: Array<[InvoiceRow['status'], string]> = [
    ['created', 'awaiting'],
    ['awaiting_wallet', 'awaiting'],
    ['awaiting_payment', 'awaiting'],
    ['payment_reported', 'verifying'],
    ['payment_verified', 'verified'],
    ['routing', 'allocating'],
    ['failed_retryable', 'allocating'],
    // A client is never shown a failure state for received money.
    ['failed_terminal', 'allocating'],
    ['completed', 'complete'],
  ];
  for (const [status, expected] of cases) {
    it(`${status} → ${expected}`, () => {
      expect(clientStateOf(inv({ status }))).toBe(expected);
    });
  }
});

describe('DTO values', () => {
  it('amounts are 6-dec integer strings; label and paid_at pass through', () => {
    const dto = buildPortalDto(
      inv({ status: 'completed', received_usdc6: 1_000_000, paid_at: '2026-07-28T01:00:00.000Z' }),
      null,
      EXPLORER,
    );
    expect(dto.amount_usdc6).toBe('1000000');
    expect(dto.received_usdc6).toBe('1000000');
    expect(dto.label).toBe('Acme Studio');
    expect(dto.paid_at).toBe('2026-07-28T01:00:00.000Z');
    expect(dto.completed).toBe(true);
    expect(dto.client_state).toBe('complete');
  });

  it('funding_txs carries ONLY verified txs, as hash + explorer URL', () => {
    const dto = buildPortalDto(
      inv({
        paid_txs: JSON.stringify([
          { txHash: '0xaa', source: 'reported', status: 'verified' },
          { txHash: '0xbb', source: 'observed', status: 'pending' },
          { txHash: '0xcc', source: 'reported', status: 'invalid' },
        ]),
      }),
      null,
      EXPLORER,
    );
    expect(dto.funding_txs).toEqual([{ hash: '0xaa', explorer_url: `${EXPLORER}/tx/0xaa` }]);
  });

  it('rate_label maps journaled rate_source only — label, never an EURC amount', () => {
    expect(buildPortalDto(inv(), fx(), EXPLORER).rate_label).toBe('live rate');
    expect(buildPortalDto(inv(), fx({ rate_source: 'demo' }), EXPLORER).rate_label).toBe('demo rate');
    expect(buildPortalDto(inv(), null, EXPLORER).rate_label).toBeNull();
  });

  it('overpaid_usdc6 requires the flag, not just a non-zero amount', () => {
    const flagged = buildPortalDto(inv({ overpaid: 1, overpaid_usdc6: 250_000 }), null, EXPLORER);
    expect(flagged.overpaid_usdc6).toBe('250000');
    const unflagged = buildPortalDto(inv({ overpaid: 0, overpaid_usdc6: 250_000 }), null, EXPLORER);
    expect(unflagged).not.toHaveProperty('overpaid_usdc6');
  });

  it('unexpected_payment surfaces as a boolean', () => {
    expect(buildPortalDto(inv({ unexpected_payment: 1 }), null, EXPLORER).unexpected_payment).toBe(true);
    expect(buildPortalDto(inv(), null, EXPLORER).unexpected_payment).toBe(false);
  });

  it('fx_indicative_eur uses the journaled oracle rate, floored integer math', () => {
    // 600000 × 877810 / 1e6 = 526686 → "0.52" (truncated, never rounded up)
    const dto = buildPortalDto(inv({ status: 'routing' }), fx({ state: 'halted' }), EXPLORER);
    expect(dto.fx_pending).toBe(true);
    expect(dto.fx_pending_usdc6).toBe('600000');
    expect(dto.fx_indicative_eur).toBe('0.52');
  });

  it('a complete fx intent on a completed invoice is not "pending"', () => {
    const dto = buildPortalDto(inv({ status: 'completed' }), fx({ state: 'complete' }), EXPLORER);
    expect(dto.fx_pending).toBe(false);
    expect(dto).not.toHaveProperty('fx_pending_usdc6');
    expect(dto).not.toHaveProperty('fx_indicative_eur');
  });
});
