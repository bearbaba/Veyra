import { describe, expect, it } from 'vitest';
import { SignerUnavailableError, UnconfiguredProductionSigner } from '../../server/services/signerService.js';

describe('Phase 3A production signer boundary', () => {
  it('fails closed until a real KMS/HSM adapter is configured', async () => {
    const signer = new UnconfiguredProductionSigner();
    await expect(signer.sign({
      chainId: 1,
      payloadHash: `0x${'00'.repeat(32)}`,
      purpose: 'RELAYER_TRANSACTION',
    })).rejects.toBeInstanceOf(SignerUnavailableError);
  });
});
