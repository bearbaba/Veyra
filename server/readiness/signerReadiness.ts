import { readServerRuntimeConfig } from '../config/runtimeConfig.js';
import { probeSignerGateway, type SignerGatewayHealth } from '../services/signerGatewayService.js';

export interface SignerReadinessReport {
  ready: boolean;
  checks: Array<{ id: string; ok: boolean; detail: string }>;
  health?: SignerGatewayHealth;
}

export async function probeSignerReadiness(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<SignerReadinessReport> {
  const runtime = readServerRuntimeConfig(env);
  const checks: Array<{ id: string; ok: boolean; detail: string }> = [];

  const configured = runtime.signerBackend === 'kms' && Boolean(runtime.kmsKeyId && runtime.signerUrl && runtime.signerAuthTokenConfigured);
  checks.push({
    id: 'signer-config',
    ok: configured,
    detail: configured
      ? 'KMS signer gateway configuration is present.'
      : 'KMS signer gateway requires VEYRA_SIGNER_BACKEND=kms, VEYRA_KMS_KEY_ID, VEYRA_SIGNER_URL, and VEYRA_SIGNER_AUTH_TOKEN.',
  });

  if (!configured || !runtime.kmsKeyId || !runtime.signerUrl || !env.VEYRA_SIGNER_AUTH_TOKEN) {
    return { ready: false, checks };
  }

  const health = await probeSignerGateway({
    baseUrl: runtime.signerUrl,
    authToken: env.VEYRA_SIGNER_AUTH_TOKEN,
    keyReference: runtime.kmsKeyId,
  }, fetchImpl);
  checks.push({ id: 'signer-health', ok: health.ok, detail: health.detail });
  return { ready: checks.every((check) => check.ok), checks, health };
}
