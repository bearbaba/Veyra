import { describe, expect, it } from 'vitest';
import { CAPABILITY_REGISTRY, getCapability, hasExecutableProvider } from '../core/capabilities/capabilityRegistry';

describe('Phase 4A capability engine', () => {
  it('keeps the public capability set unique and signature-free at Veyra layer', () => {
    expect(new Set(CAPABILITY_REGISTRY.map((item) => item.capability)).size).toBe(CAPABILITY_REGISTRY.length);
    expect(CAPABILITY_REGISTRY.every((item) => item.veyraAddedSignatureBudget === 0)).toBe(true);
  });

  it('maps Pay to transfer and Swap to swap/convert providers', () => {
    expect(getCapability('PAY').providerCapabilities).toContain('TRANSFER');
    expect(getCapability('SWAP').providerCapabilities).toEqual(expect.arrayContaining(['SWAP', 'CONVERT']));
  });

  it('keeps gated capabilities understood without pretending they can execute', () => {
    expect(getCapability('EARN').availability).toBe('GATED');
    expect(hasExecutableProvider('EARN')).toBe(false);
    expect(hasExecutableProvider('PAY')).toBe(true);
  });
});
