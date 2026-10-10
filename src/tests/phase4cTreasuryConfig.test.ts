import { describe, expect, it } from 'vitest';
import {
  resolveVeyraTreasuryAddress,
  VEYRA_TESTNET_TREASURY_ADDRESS,
} from '../core/fees/treasuryConfig';

describe('Phase 4C Treasury configuration', () => {
  it('uses the canonical committed testnet Treasury when no override exists', () => {
    expect(resolveVeyraTreasuryAddress('testnet')).toEqual({
      environment: 'testnet',
      address: VEYRA_TESTNET_TREASURY_ADDRESS,
      source: 'DEFAULT_TESTNET',
    });
  });

  it('allows a valid explicit testnet override', () => {
    const override = '0x1111111111111111111111111111111111111111';
    expect(resolveVeyraTreasuryAddress('testnet', override)).toEqual({
      environment: 'testnet',
      address: override,
      source: 'ENVIRONMENT_OVERRIDE',
    });
  });

  it('fails closed on an invalid explicit override instead of falling back', () => {
    expect(resolveVeyraTreasuryAddress('testnet', 'not-an-address')).toEqual({
      environment: 'testnet',
      address: null,
      source: 'UNCONFIGURED',
    });
  });

  it('keeps mainnet unconfigured by default', () => {
    expect(resolveVeyraTreasuryAddress('mainnet')).toEqual({
      environment: 'mainnet',
      address: null,
      source: 'UNCONFIGURED',
    });
  });
});
