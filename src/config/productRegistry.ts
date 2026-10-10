export type RegistryStatus = 'ACTIVE' | 'VERIFIED' | 'RECOGNIZED';

export interface ProductNetwork {
  id: string;
  name: string;
  shortName: string;
  chainId?: number;
  status: RegistryStatus;
  executionEnabled: boolean;
  logoKey: 'arc' | 'ethereum' | 'base' | 'arbitrum' | 'optimism' | 'avalanche' | 'polygon';
}

export interface ProductAsset {
  id: string;
  symbol: string;
  name: string;
  status: RegistryStatus;
  executionEnabled: boolean;
  logoKey: 'usdc' | 'eurc' | 'cirbtc' | 'usyc' | 'eth' | 'weth' | 'wbtc' | 'usdt' | 'dai';
}

/**
 * Product-facing registry.
 *
 * IMPORTANT: status is capability metadata, not an execution allow-list.
 * Only entries with executionEnabled=true may be presented as executable.
 * Provider Registry + Policy + runtime health remain the execution authority.
 */
export const PRODUCT_NETWORKS: readonly ProductNetwork[] = [
  { id: 'arc-testnet', name: 'Arc Testnet', shortName: 'Arc', chainId: 5042002, status: 'ACTIVE', executionEnabled: true, logoKey: 'arc' },
  { id: 'ethereum', name: 'Ethereum', shortName: 'Ethereum', chainId: 1, status: 'VERIFIED', executionEnabled: false, logoKey: 'ethereum' },
  { id: 'base', name: 'Base', shortName: 'Base', chainId: 8453, status: 'VERIFIED', executionEnabled: false, logoKey: 'base' },
  { id: 'arbitrum', name: 'Arbitrum', shortName: 'Arbitrum', chainId: 42161, status: 'VERIFIED', executionEnabled: false, logoKey: 'arbitrum' },
  { id: 'optimism', name: 'OP Mainnet', shortName: 'Optimism', chainId: 10, status: 'VERIFIED', executionEnabled: false, logoKey: 'optimism' },
  { id: 'avalanche', name: 'Avalanche C-Chain', shortName: 'Avalanche', chainId: 43114, status: 'VERIFIED', executionEnabled: false, logoKey: 'avalanche' },
  { id: 'polygon', name: 'Polygon PoS', shortName: 'Polygon', chainId: 137, status: 'VERIFIED', executionEnabled: false, logoKey: 'polygon' },
] as const;

export const PRODUCT_ASSETS: readonly ProductAsset[] = [
  { id: 'usdc', symbol: 'USDC', name: 'USD Coin', status: 'ACTIVE', executionEnabled: true, logoKey: 'usdc' },
  { id: 'eurc', symbol: 'EURC', name: 'Euro Coin', status: 'VERIFIED', executionEnabled: false, logoKey: 'eurc' },
  { id: 'cirbtc', symbol: 'cirBTC', name: 'Circle Wrapped Bitcoin', status: 'VERIFIED', executionEnabled: false, logoKey: 'cirbtc' },
  { id: 'usyc', symbol: 'USYC', name: 'Tokenized Treasury', status: 'RECOGNIZED', executionEnabled: false, logoKey: 'usyc' },
  { id: 'eth', symbol: 'ETH', name: 'Ether', status: 'RECOGNIZED', executionEnabled: false, logoKey: 'eth' },
  { id: 'weth', symbol: 'WETH', name: 'Wrapped Ether', status: 'RECOGNIZED', executionEnabled: false, logoKey: 'weth' },
  { id: 'wbtc', symbol: 'WBTC', name: 'Wrapped Bitcoin', status: 'RECOGNIZED', executionEnabled: false, logoKey: 'wbtc' },
  { id: 'usdt', symbol: 'USDT', name: 'Tether USD', status: 'RECOGNIZED', executionEnabled: false, logoKey: 'usdt' },
  { id: 'dai', symbol: 'DAI', name: 'Dai', status: 'RECOGNIZED', executionEnabled: false, logoKey: 'dai' },
] as const;

export const REGISTRY_STATUS_COPY: Record<RegistryStatus, string> = {
  ACTIVE: 'Active',
  VERIFIED: 'Registry verified',
  RECOGNIZED: 'Recognized',
};
