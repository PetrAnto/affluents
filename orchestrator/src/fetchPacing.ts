import { rpcQueueContext, type RpcQueue } from './rpcQueue';

/**
 * Route every outbound fetch to the Arc RPC host through the pacing queue.
 *
 * Why: Arc testnet allows ~1 req/s per IP (measured 2026-07-23). Our own RPC
 * calls are paced via pacedRpc, but `kit.swap` (App Kit) issues a handful of
 * DIRECT Arc RPC calls from inside the SDK — measured 2026-07-24: three POSTs,
 * two only ~440ms apart. Patching global fetch is the one place that catches
 * them without forking the SDK. Requests already running inside a queued task
 * (viem's transport under a paced call — see rpcQueueContext) pass through
 * untouched, so nothing is ever queued twice.
 */
export function installArcRpcFetchPacing(queue: RpcQueue, arcRpcUrl: string): () => void {
  const arcHost = new URL(arcRpcUrl).host;
  const realFetch = globalThis.fetch;

  const patched = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    let host = '';
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      host = new URL(url).host;
    } catch {
      /* non-URL input: pass through */
    }
    if (host === arcHost && !rpcQueueContext.getStore()) {
      return queue.enqueue(() => realFetch(input, init));
    }
    return realFetch(input, init);
  }) as typeof fetch;

  globalThis.fetch = patched;
  return () => {
    globalThis.fetch = realFetch;
  };
}
