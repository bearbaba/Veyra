/**
 * Veyra mainnet catalog.
 *
 * Only entries independently verified against Circle's official docs belong here.
 * This catalog is metadata, not an execution allow-list. Provider lifecycle and
 * runtime health gates still decide whether a route may execute.
 */

export interface MainnetChainCatalogEntry {
  chainId: number;
  name: string;
  usdc: `0x${string}`;
  cctpDomain: number;
  rpcEnvKey: string;
  explorerUrl: string;
}

export const CCTP_V2_MAINNET = {
  tokenMessengerV2: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d' as `0x${string}`,
  messageTransmitterV2: '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64' as `0x${string}`,
  tokenMinterV2: '0xfd78EE919681417d192449715b2594ab58f5D002' as `0x${string}`,
  messageV2: '0xec546b6B005471ECf012e5aF77FBeC07e0FD8f78' as `0x${string}`,
  verifiedAt: '2026-10-08',
  sourceUrl: 'https://developers.circle.com/cctp/references/contract-addresses',
} as const;

export const MAINNET_CHAIN_CATALOG: readonly MainnetChainCatalogEntry[] = [
  {
    chainId: 1,
    name: 'Ethereum',
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    cctpDomain: 0,
    rpcEnvKey: 'ETHEREUM_RPC_URL',
    explorerUrl: 'https://etherscan.io',
  },
  {
    chainId: 43114,
    name: 'Avalanche C-Chain',
    usdc: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
    cctpDomain: 1,
    rpcEnvKey: 'AVALANCHE_RPC_URL',
    explorerUrl: 'https://snowtrace.io',
  },
  {
    chainId: 10,
    name: 'OP Mainnet',
    usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    cctpDomain: 2,
    rpcEnvKey: 'OPTIMISM_RPC_URL',
    explorerUrl: 'https://optimistic.etherscan.io',
  },
  {
    chainId: 42161,
    name: 'Arbitrum',
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    cctpDomain: 3,
    rpcEnvKey: 'ARBITRUM_RPC_URL',
    explorerUrl: 'https://arbiscan.io',
  },
  {
    chainId: 8453,
    name: 'Base',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    cctpDomain: 6,
    rpcEnvKey: 'BASE_RPC_URL',
    explorerUrl: 'https://basescan.org',
  },
  {
    chainId: 137,
    name: 'Polygon PoS',
    usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    cctpDomain: 7,
    rpcEnvKey: 'POLYGON_RPC_URL',
    explorerUrl: 'https://polygonscan.com',
  },
] as const;

export const MAINNET_CATALOG_PROVENANCE = {
  usdcSourceUrl: 'https://developers.circle.com/stablecoins/usdc-contract-addresses',
  cctpSourceUrl: CCTP_V2_MAINNET.sourceUrl,
  verifiedAt: '2026-10-08',
} as const;

export function getMainnetChain(chainId: number): MainnetChainCatalogEntry | undefined {
  return MAINNET_CHAIN_CATALOG.find((chain) => chain.chainId === chainId);
}

export function validateMainnetCatalog(): string[] {
  const errors: string[] = [];
  const seen = new Set<number>();
  const domains = new Set<number>();
  for (const chain of MAINNET_CHAIN_CATALOG) {
    if (seen.has(chain.chainId)) errors.push(`Duplicate mainnet chainId ${chain.chainId}.`);
    if (domains.has(chain.cctpDomain)) errors.push(`Duplicate CCTP domain ${chain.cctpDomain}.`);
    seen.add(chain.chainId);
    domains.add(chain.cctpDomain);
    if (!/^0x[0-9a-fA-F]{40}$/.test(chain.usdc)) errors.push(`${chain.name} has invalid USDC address.`);
    if (!/^https:\/\//.test(chain.explorerUrl)) errors.push(`${chain.name} explorer must use HTTPS.`);
  }
  return errors;
}
