import type { VeyraEnv } from '../lib/env';

export interface DeploymentChain {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorerUrl?: string;
}

export interface DeploymentToken {
  symbol: string;
  chainId: number;
  address: `0x${string}`;
  decimals: number;
}

export interface DeploymentRegistry {
  environment: VeyraEnv;
  executionEnabled: boolean;
  verifiedAt?: string;
  source?: string;
  chains: DeploymentChain[];
  tokens: DeploymentToken[];
}

const TESTNET_CHAIN_IDS = new Set([5042002, 11155111, 84532, 421614, 43113, 80002, 11155420, 1301, 10143, 1328]);

const DEFAULT_TESTNET_REGISTRY: DeploymentRegistry = {
  environment: 'testnet',
  executionEnabled: true,
  verifiedAt: '2026-10-08',
  source: 'Veyra verified testnet configuration',
  chains: [
    { chainId: 5042002, name: 'Arc Testnet', rpcUrl: 'https://rpc.testnet.arc.io' },
    { chainId: 11155111, name: 'Ethereum Sepolia', rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com' },
    { chainId: 84532, name: 'Base Sepolia', rpcUrl: 'https://sepolia.base.org' },
  ],
  tokens: [
    { symbol: 'USDC', chainId: 5042002, address: '0x3600000000000000000000000000000000000000', decimals: 6 },
    { symbol: 'EURC', chainId: 5042002, address: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a', decimals: 6 },
    { symbol: 'USDC', chainId: 11155111, address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', decimals: 6 },
    { symbol: 'USDC', chainId: 84532, address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', decimals: 6 },
  ],
};

export function validateDeploymentRegistry(registry: DeploymentRegistry): string[] {
  const errors: string[] = [];
  const chainIds = new Set<number>();
  for (const chain of registry.chains) {
    if (!Number.isInteger(chain.chainId) || chain.chainId <= 0) errors.push(`Invalid chainId ${chain.chainId}.`);
    if (chainIds.has(chain.chainId)) errors.push(`Duplicate chainId ${chain.chainId}.`);
    chainIds.add(chain.chainId);
    try { new URL(chain.rpcUrl); } catch { errors.push(`Invalid RPC URL for chain ${chain.chainId}.`); }
    if (registry.environment === 'mainnet' && TESTNET_CHAIN_IDS.has(chain.chainId)) {
      errors.push(`Mainnet registry contains testnet chain ${chain.chainId}.`);
    }
  }
  for (const token of registry.tokens) {
    if (!chainIds.has(token.chainId)) errors.push(`${token.symbol} references unknown chain ${token.chainId}.`);
    if (!/^0x[0-9a-fA-F]{40}$/.test(token.address)) errors.push(`${token.symbol} has invalid address.`);
    if (!Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 36) errors.push(`${token.symbol} has invalid decimals.`);
  }
  if (registry.environment === 'mainnet' && registry.executionEnabled) {
    if (!registry.verifiedAt) errors.push('Enabled mainnet registry requires verifiedAt.');
    if (!registry.source) errors.push('Enabled mainnet registry requires source provenance.');
    if (registry.chains.length === 0 || registry.tokens.length === 0) errors.push('Enabled mainnet registry cannot be empty.');
  }
  return errors;
}

export function loadDeploymentRegistry(environment: VeyraEnv, rawJson?: string): DeploymentRegistry {
  if (environment === 'local' || environment === 'testnet') {
    return { ...DEFAULT_TESTNET_REGISTRY, environment };
  }
  if (!rawJson) {
    return { environment: 'mainnet', executionEnabled: false, chains: [], tokens: [] };
  }
  let parsed: DeploymentRegistry;
  try { parsed = JSON.parse(rawJson) as DeploymentRegistry; }
  catch { throw new Error('[deployment-registry] VITE_VEYRA_DEPLOYMENT_REGISTRY_JSON is invalid JSON.'); }
  parsed.environment = 'mainnet';
  const errors = validateDeploymentRegistry(parsed);
  if (errors.length > 0) throw new Error(`[deployment-registry] Invalid mainnet registry:\n- ${errors.join('\n- ')}`);
  return parsed;
}
