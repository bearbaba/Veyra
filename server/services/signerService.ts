/**
 * Production signer boundary.
 *
 * The concrete KMS/HSM implementation is intentionally not provided in Phase 3A.
 * Financial routes must depend on this interface rather than reading a private
 * key once production signing is implemented.
 */
export interface SignerRequest {
  chainId: number;
  payloadHash: `0x${string}`;
  purpose: 'CCTP_RECEIVE' | 'RELAYER_TRANSACTION';
}

export interface SignerResult {
  signerAddress: `0x${string}`;
  signature: `0x${string}`;
  keyReference: string;
}

export interface SignerService {
  readonly backend: 'kms' | 'hsm';
  sign(request: SignerRequest): Promise<SignerResult>;
}

export class SignerUnavailableError extends Error {
  constructor(message = 'Production signer service is not configured.') {
    super(message);
    this.name = 'SignerUnavailableError';
  }
}

/** Fail-closed placeholder used until the real KMS/HSM adapter is wired. */
export class UnconfiguredProductionSigner implements SignerService {
  readonly backend = 'kms' as const;
  async sign(_request: SignerRequest): Promise<SignerResult> {
    throw new SignerUnavailableError();
  }
}
