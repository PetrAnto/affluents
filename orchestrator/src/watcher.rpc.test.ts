import { beforeEach, describe, expect, it, vi } from 'vitest';

// postVerification hits the Worker over HTTP; stub it so the test is pure and
// we count only Arc RPC calls. vi.hoisted lets the factory reference it safely.
const { postVerification } = vi.hoisted(() => ({
  postVerification: vi.fn(async () => ({ status: 'awaiting_payment', receivedUsdc6: '0' })),
}));
vi.mock('./internalApi', () => ({ postVerification }));
// watcher.ts imports ./config, whose module side effect validates env and may
// process.exit. Stub it to a minimal shape so importing the watcher is inert.
vi.mock('./config', () => ({ config: { usdcAddress: '0x3600000000000000000000000000000000000000' } }));

import { processInvoice } from './watcher';
import type { Rpc } from './pacedRpc';
import type { WorkItem } from './internalApi';

const DEPOSIT = '0x8cce2ebfd73c6c0405a895a109f1febbb4d5db78';

/** Counts every RPC method invocation; balanceOf returns a configurable value. */
function countingRpc(balance: bigint) {
  const calls: string[] = [];
  const rpc = {
    readContract: async () => {
      calls.push('readContract');
      return balance;
    },
    getBlockNumber: async () => {
      calls.push('getBlockNumber');
      return 1000n;
    },
    request: async () => {
      calls.push('request(eth_getLogs)');
      return [];
    },
    getTransaction: async () => {
      calls.push('getTransaction');
      return { to: DEPOSIT, value: 0n };
    },
    getTransactionReceipt: async () => {
      calls.push('getTransactionReceipt');
      return { status: 'success', logs: [] };
    },
    getChainId: async () => {
      calls.push('getChainId');
      return 5042002;
    },
  } as unknown as Rpc;
  return { rpc, calls };
}

function item(over: Partial<WorkItem>): WorkItem {
  return {
    id: 'inv_x',
    amount_usdc6: 1_000_000,
    received_usdc6: 0,
    status: 'awaiting_payment',
    deposit_address: DEPOSIT,
    baseline_usdc6: 0,
    wallet_id: 'dw_x',
    circle_wallet_id: null,
    paid_txs: '[]',
    ...over,
  };
}

describe('processInvoice RPC cost', () => {
  beforeEach(() => postVerification.mockClear());

  it('zero-delta wallet issues exactly ONE RPC call (balanceOf), no getLogs scan', async () => {
    const { rpc, calls } = countingRpc(0n); // balance 0, baseline 0 → delta 0
    await processInvoice(rpc, item({ paid_txs: '[]' }));
    expect(calls).toEqual(['readContract']);
    expect(calls.filter((c) => c.includes('eth_getLogs'))).toHaveLength(0);
  });

  it('post-sweep routing wallet at balance 0 also costs one call and does not scan', async () => {
    const { rpc, calls } = countingRpc(0n);
    await processInvoice(rpc, item({ status: 'routing', received_usdc6: 1_000_000, paid_txs: '[]' }));
    expect(calls).toEqual(['readContract']);
  });

  it('nonzero-delta wallet performs the getLogs scan', async () => {
    // balance above baseline with no recorded txs to explain it → scan runs.
    const { rpc, calls } = countingRpc(1_000_000n);
    await processInvoice(rpc, item({ paid_txs: '[]' }));
    expect(calls[0]).toBe('readContract');
    expect(calls.some((c) => c.includes('eth_getLogs'))).toBe(true);
  });
});
