import { describe, expect, it } from 'vitest';
import { loadDeploymentRegistry, validateDeploymentRegistry } from '../config/deploymentRegistry.js';

describe('Phase 3A deployment registry', () => {
  it('loads known testnet configuration for local development', () => {
    const registry = loadDeploymentRegistry('local');
    expect(registry.executionEnabled).toBe(true);
    expect(registry.chains.some((c) => c.chainId === 5042002)).toBe(true);
  });

  it('fails closed for mainnet when no explicit registry is supplied', () => {
    const registry = loadDeploymentRegistry('mainnet');
    expect(registry.executionEnabled).toBe(false);
    expect(registry.chains).toHaveLength(0);
  });

  it('rejects testnet chain leakage in a mainnet registry', () => {
    const errors = validateDeploymentRegistry({
      environment: 'mainnet', executionEnabled: true, verifiedAt: '2026-10-08', source: 'test',
      chains: [{ chainId: 11155111, name: 'bad', rpcUrl: 'https://example.com' }],
      tokens: [{ symbol: 'USDC', chainId: 11155111, address: '0x0000000000000000000000000000000000000001', decimals: 6 }],
    });
    expect(errors.some((e) => e.includes('testnet chain'))).toBe(true);
  });
});
