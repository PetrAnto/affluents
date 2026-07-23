import type { createPublicClient } from 'viem';
import { createRpcQueue, type RpcQueue } from './rpcQueue';

type ViemClient = ReturnType<typeof createPublicClient>;

/**
 * The exact viem surface the orchestrator uses, every method routed through a
 * shared {@link RpcQueue} so requests are spaced to stay under Arc testnet's
 * ~1 req/s limit (see rpcQueue.ts). The watcher depends on THIS interface, not
 * the full client, which also lets tests count RPC calls.
 */
export interface Rpc {
  readContract: ViemClient['readContract'];
  getTransaction: ViemClient['getTransaction'];
  getTransactionReceipt: ViemClient['getTransactionReceipt'];
  getBlockNumber: ViemClient['getBlockNumber'];
  request: ViemClient['request'];
  getChainId: ViemClient['getChainId'];
}

export function createPacedRpc(client: ViemClient, queue: RpcQueue): Rpc {
  return {
    readContract: ((args: Parameters<ViemClient['readContract']>[0]) =>
      queue.enqueue(() => client.readContract(args))) as ViemClient['readContract'],
    getTransaction: ((args: Parameters<ViemClient['getTransaction']>[0]) =>
      queue.enqueue(() => client.getTransaction(args))) as ViemClient['getTransaction'],
    getTransactionReceipt: ((args: Parameters<ViemClient['getTransactionReceipt']>[0]) =>
      queue.enqueue(() => client.getTransactionReceipt(args))) as ViemClient['getTransactionReceipt'],
    getBlockNumber: ((args?: Parameters<ViemClient['getBlockNumber']>[0]) =>
      queue.enqueue(() => client.getBlockNumber(args))) as ViemClient['getBlockNumber'],
    request: ((args: Parameters<ViemClient['request']>[0]) =>
      queue.enqueue(() => client.request(args))) as ViemClient['request'],
    getChainId: (() => queue.enqueue(() => client.getChainId())) as ViemClient['getChainId'],
  };
}

export { createRpcQueue };
