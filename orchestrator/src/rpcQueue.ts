/**
 * Serialising RPC queue with a minimum gap between requests.
 *
 * Measured against https://rpc.testnet.arc.network on 2026-07-23: the endpoint
 * allows roughly ONE request per second per IP. Sequential requests with no
 * spacing fail from the second one onward with
 * `{"code":-32011,"message":"request limit reached"}` (40-request burst: 1 ok,
 * 39 failed). At a 1000ms gap, 6/6 succeeded; at 500ms, 3/6; at 200ms, 2/6.
 *
 * So the limit is a function of REQUEST SPACING, not of how many requests a
 * tick makes in total or how often the tick runs. The orchestrator issues its
 * per-wallet reads back-to-back inside one tick, which is why watching three
 * invoices produced exactly two failures per tick, every tick, regardless of
 * POLL_INTERVAL_MS.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface RpcQueue {
  enqueue<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * Set while a queued task runs. The global-fetch interceptor
 * (fetchPacing.ts) checks it so a request made INSIDE a queued task — e.g.
 * viem's transport fetch under a paced readContract — passes straight through
 * instead of re-enqueueing behind itself (which would deadlock the chain).
 */
export const rpcQueueContext = new AsyncLocalStorage<true>();

export function isRateLimitError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes('request limit reached') || msg.includes('-32011');
}

/**
 * @param minGapMs   minimum delay between the START of consecutive requests
 * @param maxRetries extra attempts for rate-limit errors only (each re-queued,
 *                   so retries are spaced by the same gap rather than bursting)
 */
export function createRpcQueue(
  minGapMs: number,
  maxRetries = 3,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => number = () => Date.now(),
): RpcQueue {
  let chain: Promise<unknown> = Promise.resolve();
  let lastStart = -Infinity;

  async function runSpaced<T>(fn: () => Promise<T>): Promise<T> {
    const wait = minGapMs - (now() - lastStart);
    if (wait > 0) await sleep(wait);
    lastStart = now();
    return rpcQueueContext.run(true, fn);
  }

  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    // Tail of the chain: every caller queues behind the previous one, so the
    // gap is honoured across concurrent callers, not just sequential ones.
    const result = chain.then(async () => {
      let lastErr: unknown;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await runSpaced(fn);
        } catch (e) {
          lastErr = e;
          if (!isRateLimitError(e)) throw e;
        }
      }
      throw lastErr;
    });
    // Keep the chain alive regardless of individual failures.
    chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result as Promise<T>;
  }

  return { enqueue };
}
