import { afterEach, describe, expect, it } from 'vitest';
import { installArcRpcFetchPacing } from './fetchPacing';
import { createRpcQueue } from './rpcQueue';

const ARC = 'https://rpc.testnet.arc.network';

describe('installArcRpcFetchPacing', () => {
  let uninstall: (() => void) | null = null;
  const realFetch = globalThis.fetch;

  afterEach(() => {
    uninstall?.();
    uninstall = null;
    globalThis.fetch = realFetch;
  });

  it('routes Arc-RPC-host fetches through the queue, others straight through', async () => {
    const order: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      order.push(new URL(String(input)).host);
      return new Response('{}');
    }) as typeof fetch;

    let enqueued = 0;
    const queue = createRpcQueue(0);
    const countingQueue = {
      enqueue<T>(fn: () => Promise<T>): Promise<T> {
        enqueued += 1;
        return queue.enqueue(fn);
      },
    };
    uninstall = installArcRpcFetchPacing(countingQueue, ARC);

    await fetch(`${ARC}/`);
    await fetch('https://api.circle.com/v1/ping');
    await fetch(`${ARC}/`);
    expect(enqueued).toBe(2); // only the two Arc RPC calls
    expect(order).toEqual(['rpc.testnet.arc.network', 'api.circle.com', 'rpc.testnet.arc.network']);
  });

  it('does NOT re-enqueue a fetch made from inside a queued task (no deadlock)', async () => {
    globalThis.fetch = (async () => new Response('{}')) as typeof fetch;
    let enqueued = 0;
    const queue = createRpcQueue(0);
    const countingQueue = {
      enqueue<T>(fn: () => Promise<T>): Promise<T> {
        enqueued += 1;
        return queue.enqueue(fn);
      },
    };
    uninstall = installArcRpcFetchPacing(countingQueue, ARC);

    // Simulates viem under createPacedRpc: the task ITSELF fetches the RPC.
    // Without the rpcQueueContext bypass this would enqueue behind itself and
    // hang forever — the test would time out.
    const res = await queue.enqueue(async () => {
      const r = await fetch(`${ARC}/`);
      return r.ok;
    });
    expect(res).toBe(true);
    expect(enqueued).toBe(0); // inner fetch passed straight through
  });

  it('spaces two concurrent SDK fetches by the queue gap', async () => {
    const starts: number[] = [];
    globalThis.fetch = (async () => {
      starts.push(Date.now());
      return new Response('{}');
    }) as typeof fetch;
    const queue = createRpcQueue(120);
    uninstall = installArcRpcFetchPacing(queue, ARC);

    await Promise.all([fetch(`${ARC}/`), fetch(`${ARC}/`)]); // the measured kit.swap burst shape
    expect(starts.length).toBe(2);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(100);
  });
});
