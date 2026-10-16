/**
 * Public Unified discovery catalog. Asset visibility does NOT imply liquidity,
 * deposits, balance indexing, or permission to trade. Provider registry and
 * financial policy exclusively control execution.
 */
import { PRODUCT_ASSETS, PRODUCT_NETWORKS } from '../config/productRegistry';

export type UnifiedEnvironment = 'testnet' | 'mainnet';
export type UnifiedStatus = 'ARC_BALANCE_READ' | 'CATALOG_ONLY';
export type UnifiedAsset = {
  id: string; symbol: string; name: string; logoKey: string; status: UnifiedStatus;
};
export type UnifiedChain = {
  id: string; name: string; chainId: number; logoKey: string;
  status: UnifiedStatus; network: UnifiedEnvironment;
};

export const UNIFIED_ASSETS: readonly UnifiedAsset[] = PRODUCT_ASSETS.map(asset => ({
  id: asset.id, symbol: asset.symbol, name: asset.name, logoKey: asset.logoKey,
  // Arc USDC is the only asset with a vetted, live browser read in both
  // environments. Everything else is metadata, not a verified wallet holding.
  status: asset.id === 'usdc' ? 'ARC_BALANCE_READ' : 'CATALOG_ONLY',
}));

const ARC_MAINNET: UnifiedChain = {
  id: 'arc-mainnet', name: 'Arc Mainnet', chainId: 5042,
  logoKey: 'arc', status: 'ARC_BALANCE_READ', network: 'mainnet',
};
const TESTNET_NETWORKS: readonly UnifiedChain[] = [
  { id: 'arc-testnet', name: 'Arc Testnet', chainId: 5042002,
    logoKey: 'arc', status: 'ARC_BALANCE_READ', network: 'testnet' },
  { id: 'ethereum-sepolia', name: 'Ethereum Sepolia', chainId: 11155111,
    logoKey: 'ethereum', status: 'CATALOG_ONLY', network: 'testnet' },
  { id: 'base-sepolia', name: 'Base Sepolia', chainId: 84532,
    logoKey: 'base', status: 'CATALOG_ONLY', network: 'testnet' },
];
// Product registry is the source of mainstream network metadata. A listed
// mainnet never becomes an executable destination merely by appearing here.
const MAINNET_NETWORKS: readonly UnifiedChain[] = [
  ARC_MAINNET,
  ...PRODUCT_NETWORKS.filter(network => network.id !== 'arc-testnet' && typeof network.chainId === 'number')
    .map(network => ({ id: network.id, name: network.name, chainId: network.chainId!,
      logoKey: network.logoKey, status: 'CATALOG_ONLY' as const, network: 'mainnet' as const })),
];
export function unifiedChains(environment: UnifiedEnvironment): readonly UnifiedChain[] {
  return environment === 'testnet' ? TESTNET_NETWORKS : MAINNET_NETWORKS;
}

export function filterUnifiedCatalog<T extends { name: string; id: string }>(
  entries: readonly T[], query: string, aliases?: (entry: T) => string,
): T[] {
  const q = query.trim().toLocaleLowerCase('en-US');
  if (!q) return [...entries];
  return entries.filter(entry => [entry.name, entry.id, aliases?.(entry) ?? '']
    .some(value => value.toLocaleLowerCase('en-US').includes(q)));
}
