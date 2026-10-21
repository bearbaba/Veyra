import { describe, expect, it } from 'vitest';
import { assertHostedTestnetIdentityChain, IdentityRegistrationError } from '../../server/services/identityRegistrationService';
import { MANIFEST_CONSTANTS } from '../providers/registry/providerManifest';

describe('hosted Arc Testnet identity registration boundary', () => {
  const hosted: NodeJS.ProcessEnv = {
    VEYRA_ENV: 'testnet',
    VEYRA_HOSTED_BACKEND: '1',
    NODE_ENV: 'production',
  };
  it('accepts the exact pinned Arc Testnet chain', () => {
    expect(() => assertHostedTestnetIdentityChain(
      MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID, hosted,
    )).not.toThrow();
  });
  it.each([1, 5042, 8453, 84532, 11155111, 0, -1, 0x7fffffff])(
    'denies an unsupported chain %s on the public acceptance backend', chainId => {
      expect(() => assertHostedTestnetIdentityChain(chainId, hosted))
        .toThrow(IdentityRegistrationError);
      try { assertHostedTestnetIdentityChain(chainId, hosted); }
      catch (error) {
        expect(error).toMatchObject({code: 'UNSUPPORTED_TESTNET_CHAIN', httpStatus: 400});
      }
    },
  );
  it('retains the local isolated developer fixtures', () => {
    expect(() => assertHostedTestnetIdentityChain(11155111, {
      VEYRA_ENV: 'local',
      VEYRA_HOSTED_BACKEND: '0',
      NODE_ENV: 'test',
    })).not.toThrow();
  });
});
