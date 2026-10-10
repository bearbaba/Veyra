import { describe, expect, it } from 'vitest';
import { PRODUCT_ASSETS, PRODUCT_NETWORKS } from '../config/productRegistry.js';

describe('Phase 3D product registry', () => {
  it('uses unique network IDs and concrete chain IDs where declared', () => {
    const ids = PRODUCT_NETWORKS.map((network) => network.id);
    expect(new Set(ids).size).toBe(ids.length);
    const chainIds = PRODUCT_NETWORKS.flatMap((network) => network.chainId === undefined ? [] : [network.chainId]);
    expect(new Set(chainIds).size).toBe(chainIds.length);
  });

  it('never marks execution enabled unless the product status is ACTIVE', () => {
    for (const network of PRODUCT_NETWORKS) {
      if (network.executionEnabled) expect(network.status).toBe('ACTIVE');
    }
    for (const asset of PRODUCT_ASSETS) {
      if (asset.executionEnabled) expect(asset.status).toBe('ACTIVE');
    }
  });

  it('includes the core Arc and Circle-facing product identities', () => {
    expect(PRODUCT_NETWORKS.some((network) => network.id === 'arc-testnet' && network.executionEnabled)).toBe(true);
    expect(PRODUCT_ASSETS.some((asset) => asset.symbol === 'USDC')).toBe(true);
    expect(PRODUCT_ASSETS.some((asset) => asset.symbol === 'EURC')).toBe(true);
    expect(PRODUCT_ASSETS.some((asset) => asset.symbol === 'cirBTC')).toBe(true);
  });

  it('contains recognized assets without implying execution support', () => {
    expect(PRODUCT_ASSETS.some((asset) => asset.status === 'RECOGNIZED' && !asset.executionEnabled)).toBe(true);
  });
});
