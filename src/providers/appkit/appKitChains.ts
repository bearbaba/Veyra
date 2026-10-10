/**
 * Circle App Kit chain identifiers understood by Veyra.
 *
 * Product/network discovery may know more networks than the current execution
 * registry. This file only translates product intent into the exact string
 * identifiers Circle App Kit expects. It is NOT an execution allow-list.
 */

export type CircleAppKitChain =
  | 'Arbitrum'
  | 'Arc'
  | 'Avalanche'
  | 'Base'
  | 'Ethereum'
  | 'HyperEVM'
  | 'Ink'
  | 'Linea'
  | 'Monad'
  | 'Optimism'
  | 'Plume'
  | 'Polygon'
  | 'Sei'
  | 'Solana'
  | 'Sonic'
  | 'Unichain'
  | 'World_Chain'
  | 'XDC'
  | 'Ethereum_Sepolia'
  | 'Avalanche_Fuji'
  | 'Optimism_Sepolia'
  | 'Arbitrum_Sepolia'
  | 'Solana_Devnet'
  | 'Base_Sepolia'
  | 'Polygon_Amoy_Testnet'
  | 'Unichain_Sepolia'
  | 'Sonic_Testnet'
  | 'World_Chain_Sepolia'
  | 'Sei_Testnet'
  | 'HyperEVM_Testnet'
  | 'Arc_Testnet';

const NETWORK_ID_TO_CIRCLE_CHAIN: Readonly<Record<string, CircleAppKitChain>> = {
  'arc': 'Arc',
  'arc-mainnet': 'Arc',
  'arc-testnet': 'Arc_Testnet',
  'ethereum': 'Ethereum',
  'ethereum-sepolia': 'Ethereum_Sepolia',
  'avalanche': 'Avalanche',
  'avalanche-fuji': 'Avalanche_Fuji',
  'optimism': 'Optimism',
  'op': 'Optimism',
  'optimism-sepolia': 'Optimism_Sepolia',
  'arbitrum': 'Arbitrum',
  'arbitrum-sepolia': 'Arbitrum_Sepolia',
  'base': 'Base',
  'base-sepolia': 'Base_Sepolia',
  'polygon': 'Polygon',
  'polygon-amoy': 'Polygon_Amoy_Testnet',
  'solana': 'Solana',
  'solana-devnet': 'Solana_Devnet',
  'unichain': 'Unichain',
  'unichain-sepolia': 'Unichain_Sepolia',
  'sonic': 'Sonic',
  'sonic-testnet': 'Sonic_Testnet',
  'world-chain': 'World_Chain',
  'world-chain-sepolia': 'World_Chain_Sepolia',
  'sei': 'Sei',
  'sei-testnet': 'Sei_Testnet',
  'hyperevm': 'HyperEVM',
  'hyperevm-testnet': 'HyperEVM_Testnet',
  'ink': 'Ink',
  'linea': 'Linea',
  'monad': 'Monad',
  'plume': 'Plume',
  'xdc': 'XDC',
};

const CIRCLE_CHAIN_VALUES = new Set<CircleAppKitChain>(
  Object.values(NETWORK_ID_TO_CIRCLE_CHAIN),
);

export function circleChainForNetworkId(networkId: string): CircleAppKitChain | null {
  return NETWORK_ID_TO_CIRCLE_CHAIN[networkId.trim().toLowerCase()] ?? null;
}

export function isCircleAppKitChain(value: string): value is CircleAppKitChain {
  return CIRCLE_CHAIN_VALUES.has(value as CircleAppKitChain);
}

export function assertCircleAppKitChain(value: string): CircleAppKitChain {
  if (!isCircleAppKitChain(value)) {
    throw new Error(`Unsupported Circle App Kit chain identifier: ${value}`);
  }
  return value;
}

export const CIRCLE_APP_KIT_CHAIN_PROVENANCE = {
  source:
    'https://github.com/circlefin/skills/tree/master/plugins/circle/skills',
  verifiedAt: '2026-10-10',
} as const;
