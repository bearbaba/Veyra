import type { SignerRequest, SignerResult, SignerService } from './signerService.js';

export interface SignerGatewayConfig {
  baseUrl: string;
  authToken: string;
  keyReference: string;
  timeoutMs?: number;
}

export interface SignerGatewayHealth {
  ok: boolean;
  backend?: 'kms' | 'hsm';
  signerAddress?: `0x${string}`;
  keyReference?: string;
  latencyMs?: number;
  detail: string;
}

type FetchLike = typeof fetch;

function isHexSignature(value: unknown): value is `0x${string}` {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{130}$/.test(value);
}

function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

export async function probeSignerGateway(
  config: SignerGatewayConfig,
  fetchImpl: FetchLike = fetch,
): Promise<SignerGatewayHealth> {
  const startedAt = Date.now();
  try {
    const response = await fetchImpl(endpoint(config.baseUrl, '/health'), {
      method: 'GET',
      headers: { authorization: `Bearer ${config.authToken}` },
      signal: AbortSignal.timeout(config.timeoutMs ?? 4_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json() as Record<string, unknown>;
    const backend = body.backend === 'kms' || body.backend === 'hsm' ? body.backend : undefined;
    if (body.ok !== true) throw new Error('Signer gateway reported unhealthy status.');
    if (!backend) throw new Error('Signer gateway did not report kms/hsm backend.');
    if (!isAddress(body.signerAddress)) throw new Error('Signer gateway returned invalid signerAddress.');
    if (body.keyReference !== config.keyReference) throw new Error('Signer gateway keyReference does not match VEYRA_KMS_KEY_ID.');
    return {
      ok: true,
      backend,
      signerAddress: body.signerAddress,
      keyReference: String(body.keyReference),
      latencyMs: Date.now() - startedAt,
      detail: 'Signer gateway is healthy and key identity matches runtime configuration.',
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export class RemoteKmsSignerService implements SignerService {
  readonly backend = 'kms' as const;

  constructor(
    private readonly config: SignerGatewayConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async sign(request: SignerRequest): Promise<SignerResult> {
    const response = await this.fetchImpl(endpoint(this.config.baseUrl, '/sign'), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.config.authToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 8_000),
    });
    if (!response.ok) throw new Error(`Signer gateway request failed with HTTP ${response.status}.`);
    const body = await response.json() as Record<string, unknown>;
    if (!isAddress(body.signerAddress)) throw new Error('Signer gateway returned invalid signerAddress.');
    if (!isHexSignature(body.signature)) throw new Error('Signer gateway returned invalid signature.');
    if (body.keyReference !== this.config.keyReference) throw new Error('Signer gateway keyReference mismatch.');
    return {
      signerAddress: body.signerAddress,
      signature: body.signature,
      keyReference: String(body.keyReference),
    };
  }
}

export function createProductionSignerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = fetch,
): RemoteKmsSignerService {
  const baseUrl = env.VEYRA_SIGNER_URL;
  const authToken = env.VEYRA_SIGNER_AUTH_TOKEN;
  const keyReference = env.VEYRA_KMS_KEY_ID;
  if (!baseUrl || !authToken || !keyReference || env.VEYRA_SIGNER_BACKEND !== 'kms') {
    throw new Error('Production signer gateway is not fully configured.');
  }
  return new RemoteKmsSignerService({ baseUrl, authToken, keyReference }, fetchImpl);
}
