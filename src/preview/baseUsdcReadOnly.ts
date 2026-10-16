/**
 * Public, wallet-signature-free USDC observations on Base.
 *
 * Only native Circle USDC, never USDbC. A public, rate-limited Base RPC can be
 * temporarily unavailable: callers MUST show unavailable, never fake zero.
 * Base network metadata and token addresses are pinned, not user-controlled.
 *
 * NOTE: This is an informational multi-chain balance reader, NOT Circle
 * Gateway Unified Balance, a bridge, a payment, a contract allowance or
 * an execution authorization.
 */
import { getAddress, isAddress, type Address } from 'viem';
import { getMainnetChain } from '../config/mainnetCatalog';

export type BaseUsdcEnvironment = 'testnet' | 'mainnet';

export interface BaseUsdcNetwork {
  readonly chainId: number;
  readonly name: string;
  readonly rpc: string;
  readonly usdc: Address;
  readonly explorerUrl: string;
}

const BASE_NETWORKS: Record<BaseUsdcEnvironment, BaseUsdcNetwork> = {
  testnet: {
    chainId: 84532,
    name: 'Base Sepolia',
    rpc: 'https://sepolia.base.org',
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    explorerUrl: 'https://sepolia.basescan.org',
  },
  mainnet: {
    chainId: 8453,
    name: 'Base',
    rpc: 'https://mainnet.base.org',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    explorerUrl: 'https://basescan.org',
  },
} as const;

export interface BaseUsdcSnapshot {
  chainId: number;
  address: Address;
  amountUnits: bigint;
  decimals: 6;
  blockNumber: bigint;
  observedAt: number;
}

type ReadMethod = 'eth_chainId' | 'eth_blockNumber' | 'eth_call' | 'eth_getCode';

export function getBaseUsdcNetwork(environment: BaseUsdcEnvironment): BaseUsdcNetwork {
  const entry = BASE_NETWORKS[environment];
  if (!entry) throw new Error('Unsupported Base network environment.');
  if (entry.chainId === 8453) {
    const mainnet = getMainnetChain(8453);
    if (!mainnet || mainnet.usdc.toLowerCase() !== entry.usdc.toLowerCase()) {
      throw new Error('Base USDC configuration mismatch; read blocked.');
    }
  }
  return entry;
}

export class BaseUsdcReadError extends Error {
  constructor(message: string) { super(message); this.name = 'BaseUsdcReadError'; }
}

function parseQuantity(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value) ||
      value.length > 66) throw new BaseUsdcReadError('Invalid ' + label + ' response from Base RPC.');
  return BigInt(value);
}

function balanceOf(address: Address): `0x${string}` {
  return `0x70a08231${address.slice(2).toLowerCase().padStart(64, '0')}`;
}

export async function readBaseUsdcBalance(
  rawAddress: string,
  environment: BaseUsdcEnvironment,
  options?: { signal?: AbortSignal; fetchFn?: typeof fetch },
): Promise<BaseUsdcSnapshot> {
  if (!isAddress(rawAddress)) throw new BaseUsdcReadError('Connect a valid EVM wallet address first.');
  const address = getAddress(rawAddress);
  const network = getBaseUsdcNetwork(environment);
  const fetchFn = options?.fetchFn ?? fetch;
  const timeoutSignal = AbortSignal.timeout(12_000);
  const signal = options?.signal
    ? AbortSignal.any([timeoutSignal, options.signal])
    : timeoutSignal;
  let counter = 0;
  async function rpc(method: ReadMethod, params: unknown[]): Promise<unknown> {
    const id = ++counter;
    let response: Response;
    try {
      response = await fetchFn(network.rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        cache: 'no-store',
        signal,
      });
    } catch {
      throw new BaseUsdcReadError('Base RPC is unavailable. Retry in a moment.');
    }
    if (!response.ok) throw new BaseUsdcReadError('Base RPC is unavailable or rate-limited.');
    let result: unknown;
    try { result = await response.json(); }
    catch { throw new BaseUsdcReadError('Base RPC returned invalid JSON.'); }
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new BaseUsdcReadError('Base RPC returned an untrusted response.');
    }
    const parsed = result as Record<string, unknown>;
    if (parsed.jsonrpc !== '2.0' || parsed.id !== id || 'error' in parsed ||
        !Object.prototype.hasOwnProperty.call(parsed, 'result')) {
      throw new BaseUsdcReadError('Base RPC returned an untrusted response.');
    }
    return parsed.result;
  }

  const actualChain = parseQuantity(await rpc('eth_chainId', []), 'chain ID');
  if (actualChain !== BigInt(network.chainId)) {
    throw new BaseUsdcReadError('Base RPC chain mismatch. Balance not displayed.');
  }
  const height = parseQuantity(await rpc('eth_blockNumber', []), 'block height');
  if (height <= 0n) throw new BaseUsdcReadError('Base RPC has no confirmed block.');

  const code = await rpc('eth_getCode', [network.usdc, 'latest']);
  if (typeof code !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(code) || code === '0x') {
    throw new BaseUsdcReadError('Base USDC contract code unavailable.');
  }
  const decimals = parseQuantity(await rpc('eth_call', [
    { to: network.usdc, data: '0x313ce567' }, 'latest',
  ]), 'USDC decimals');
  if (decimals !== 6n) throw new BaseUsdcReadError('Base USDC decimals mismatch; balance blocked.');

  const amountUnits = parseQuantity(await rpc('eth_call', [
    { to: network.usdc, data: balanceOf(address) }, 'latest',
  ]), 'USDC balance');
  if (signal.aborted) throw new BaseUsdcReadError('Base balance request cancelled.');
  return { chainId: network.chainId, address, amountUnits, decimals: 6,
    blockNumber: height, observedAt: Date.now() };
}
