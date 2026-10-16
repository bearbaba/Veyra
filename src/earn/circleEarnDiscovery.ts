/**
 * Circle Earn Kit (Phase 7B): public opportunity discovery only.
 *
 * The SDK exposes third-party Morpho vaults; Circle does NOT issue the
 * underlying lending strategy or guarantee yield, withdrawals or capital.
 * No financial execution method is imported, wrapped or exported here.
 *
 * Never use the output as an execution allowlist. All potential Earn write
 * operations remain blocked until production policy + user consent + audit.
 */
import { isAddress } from 'viem';

export const ARC_TESTNET_EARN_CHAIN = 'Arc_Testnet' as const;
export const ARC_TESTNET_EARN_CHAIN_ID = 5_042_002;
export const ARC_TESTNET_EARN_USDC = '0x3600000000000000000000000000000000000000' as const;
export const EARN_PUBLIC_EXECUTION_ENABLED = false as boolean;

export interface DiscoveredEarnVault {
  vaultAddress: `0x${string}`;
  chain: typeof ARC_TESTNET_EARN_CHAIN;
  chainId: typeof ARC_TESTNET_EARN_CHAIN_ID;
  asset: 'USDC';
  name: string;
  protocol: 'MORPHO';
  variableApy: number | null;
  status: 'DISCOVERY_ONLY';
  caution: 'Variable return or loss; third-party vault; deposit and withdrawal unavailable in Veyra.';
}

const CAUTION = 'Variable return or loss; third-party vault; deposit and withdrawal unavailable in Veyra.' as const;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/**
 * Fail closed on unsupported chain/asset/protocol, untrusted amounts, unknown
 * schema or malformed addresses. Duplicate vaults never get duplicated cards.
 * All validated output is DISCOVERY_ONLY, never an executable destination.
 */
export function parseCircleEarnDiscovery(payload: unknown): readonly DiscoveredEarnVault[] {
  const page = record(payload);
  if (!page || !Array.isArray(page.vaults)) throw new Error('Circle Earn discovery response unavailable.');
  const results: DiscoveredEarnVault[] = [];
  const seen = new Set<string>();
  for (const raw of page.vaults.slice(0, 50) as unknown[]) {
    const v = record(raw);
    if (!v || typeof v.vaultAddress !== 'string' || !isAddress(v.vaultAddress) ||
        v.chain !== ARC_TESTNET_EARN_CHAIN || v.asset !== 'USDC' ||
        typeof v.assetAddress !== 'string' ||
        v.assetAddress.toLowerCase() !== ARC_TESTNET_EARN_USDC.toLowerCase() ||
        v.protocol !== 'MORPHO' || v.status !== 'active') continue;
    const vaultAddress = v.vaultAddress.toLowerCase() as `0x${string}`;
    if (seen.has(vaultAddress)) continue;
    const name = typeof v.name === 'string' && v.name.trim().length > 0 &&
      v.name.length <= 120 ? v.name.trim() : 'USDC lending vault';
    // APY can be missing or malformed. Never invent 0%, fixed rates or
    // annual profit projections. 2 means 200% (extreme but still variable).
    const apy = typeof v.currentApy === 'number' && Number.isFinite(v.currentApy) &&
      v.currentApy >= -1 && v.currentApy <= 2 ? v.currentApy : null;
    seen.add(vaultAddress);
    results.push({
      vaultAddress, chain: ARC_TESTNET_EARN_CHAIN,
      chainId: ARC_TESTNET_EARN_CHAIN_ID,
      asset: 'USDC', name, protocol: 'MORPHO',
      variableApy: apy, status: 'DISCOVERY_ONLY', caution: CAUTION,
    });
  }
  return results;
}

export function explainEarnVariableApy(apy: number | null): string {
  return apy === null ? 'Variable APY unavailable'
    : `Variable APY (not guaranteed): ${(apy * 100).toFixed(2)}%`;
}
