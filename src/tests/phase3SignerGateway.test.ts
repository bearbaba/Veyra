import { describe, expect, it } from 'vitest';
import { probeSignerReadiness } from '../../server/readiness/signerReadiness.js';
import { RemoteKmsSignerService, createProductionSignerFromEnv, probeSignerGateway } from '../../server/services/signerGatewayService.js';

const keyReference = 'alias/veyra-mainnet-relayer';
const signerAddress = '0x1111111111111111111111111111111111111111' as const;
const signature = `0x${'11'.repeat(65)}`;

function jsonFetch(body: unknown, status = 200): typeof fetch {
  return (() => Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })));
}

describe('Phase 3C signer gateway', () => {
  it('accepts a healthy KMS gateway only when key identity matches', async () => {
    const result = await probeSignerGateway({
      baseUrl: 'https://signer.example.com', authToken: 'x'.repeat(32), keyReference,
    }, jsonFetch({ ok: true, backend: 'kms', signerAddress, keyReference }));
    expect(result.ok).toBe(true);
    expect(result.keyReference).toBe(keyReference);
  });

  it('fails closed when signer key identity differs', async () => {
    const result = await probeSignerGateway({
      baseUrl: 'https://signer.example.com', authToken: 'x'.repeat(32), keyReference,
    }, jsonFetch({ ok: true, backend: 'kms', signerAddress, keyReference: 'alias/wrong' }));
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('keyReference');
  });

  it('validates remote signatures before returning them', async () => {
    const signer = new RemoteKmsSignerService({
      baseUrl: 'https://signer.example.com', authToken: 'x'.repeat(32), keyReference,
    }, jsonFetch({ signerAddress, signature, keyReference }));
    const result = await signer.sign({ chainId: 1, payloadHash: `0x${'22'.repeat(32)}`, purpose: 'RELAYER_TRANSACTION' });
    expect(result.signature).toBe(signature);
  });


  it('creates the production signer only from complete KMS configuration', () => {
    expect(() => createProductionSignerFromEnv({ VEYRA_SIGNER_BACKEND: 'kms' })).toThrow('not fully configured');
    const signer = createProductionSignerFromEnv({
      VEYRA_SIGNER_BACKEND: 'kms', VEYRA_KMS_KEY_ID: keyReference,
      VEYRA_SIGNER_URL: 'https://signer.example.com', VEYRA_SIGNER_AUTH_TOKEN: 'x'.repeat(32),
    }, jsonFetch({ signerAddress, signature, keyReference }));
    expect(signer.backend).toBe('kms');
  });

  it('reports signer readiness from production configuration', async () => {
    const report = await probeSignerReadiness({
      VEYRA_ENV: 'mainnet', VEYRA_SIGNER_BACKEND: 'kms', VEYRA_KMS_KEY_ID: keyReference,
      VEYRA_SIGNER_URL: 'https://signer.example.com', VEYRA_SIGNER_AUTH_TOKEN: 'x'.repeat(32),
    }, jsonFetch({ ok: true, backend: 'kms', signerAddress, keyReference }));
    expect(report.ready).toBe(true);
  });
});
