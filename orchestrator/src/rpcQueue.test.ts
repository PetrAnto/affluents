import { describe, expect, it } from 'vitest';
import { createRpcQueue, isRateLimitError } from './rpcQueue';

/** Virtual clock: sleep advances `t`; now reads it. No real time passes. */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advanceTo: (v: number) => {
      t = v;
    },
  };
}

describe('createRpcQueue', () => {
  it('spaces consecutive requests by at least the min gap', async () => {
    const clk = fakeClock();
    const q = createRpcQueue(1000, 0, clk.sleep, clk.now);
    const starts: number[] = [];
    const task = () => {
      starts.push(clk.now());
      return Promise.resolve('ok');
    };
    await q.enqueue(task);
    await q.enqueue(task);
    await q.enqueue(task);
    expect(starts).toEqual([0, 1000, 2000]);
  });

  it('does not delay a request that already comes after the gap', async () => {
    const clk = fakeClock();
    const q = createRpcQueue(1000, 0, clk.sleep, clk.now);
    await q.enqueue(() => Promise.resolve(1));
    clk.advanceTo(5000); // caller idle well past the gap
    let observed = -1;
    await q.enqueue(() => {
      observed = clk.now();
      return Promise.resolve(2);
    });
    expect(observed).toBe(5000); // no artificial wait added
  });

  it('retries rate-limit errors (spaced), then succeeds', async () => {
    const clk = fakeClock();
    const q = createRpcQueue(1000, 3, clk.sleep, clk.now);
    let attempts = 0;
    const res = await q.enqueue(() => {
      attempts++;
      if (attempts < 3) throw new Error('request limit reached');
      return Promise.resolve('done');
    });
    expect(res).toBe('done');
    expect(attempts).toBe(3);
    expect(clk.now()).toBe(2000); // 3 attempts, 2 gaps between them
  });

  it('does NOT retry a non-rate-limit error', async () => {
    const clk = fakeClock();
    const q = createRpcQueue(1000, 3, clk.sleep, clk.now);
    let attempts = 0;
    await expect(
      q.enqueue(() => {
        attempts++;
        throw new Error('reverted: insufficient balance');
      }),
    ).rejects.toThrow('reverted');
    expect(attempts).toBe(1);
  });

  it('keeps serving after a failure (chain not broken)', async () => {
    const clk = fakeClock();
    const q = createRpcQueue(1000, 0, clk.sleep, clk.now);
    await expect(q.enqueue(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(q.enqueue(() => Promise.resolve('after'))).resolves.toBe('after');
  });

  it('isRateLimitError matches Arc code and message', () => {
    expect(isRateLimitError(new Error('request limit reached'))).toBe(true);
    expect(isRateLimitError(new Error('RPC error -32011'))).toBe(true);
    expect(isRateLimitError(new Error('nonce too low'))).toBe(false);
  });
});
