import type { VeyraCapability } from '../capabilities/capabilityTypes';
import {
  getVeyraFeePolicy,
  type VeyraFeeCollectionMode,
} from './feePolicy';
import {
  validateVeyraTreasuryAddress,
  type TreasuryEnvironment,
} from './treasuryConfig';

export type VeyraFeeStatus =
  | 'NO_FEE_POLICY'
  | 'PROVIDER_NOT_SUPPORTED'
  | 'TREASURY_NOT_CONFIGURED'
  | 'COLLECTIBLE';

export interface VeyraFeeQuote {
  capability: VeyraCapability;
  providerId: string;
  status: VeyraFeeStatus;
  collectionMode: VeyraFeeCollectionMode;
  percentageBps: number;
  treasuryAddress: string | null;
  /** Veyra may never add a wallet signature in order to collect revenue. */
  veyraAddedSignatures: 0;
  explanation: string;
}

export interface QuoteVeyraFeeInput {
  capability: VeyraCapability;
  providerId: string;
  environment: TreasuryEnvironment;
  treasuryAddress?: string | null;
}

/**
 * Decide whether Veyra may collect a fee on a concrete provider route.
 *
 * This function never creates a transfer. If the provider cannot embed the fee
 * in its existing transaction, the result is zero fee.
 */
export function quoteVeyraFee(input: QuoteVeyraFeeInput): VeyraFeeQuote {
  const policy = getVeyraFeePolicy(input.capability);

  if (policy.targetBps === 0 || policy.collectionMode === 'NONE') {
    return {
      capability: input.capability,
      providerId: input.providerId,
      status: 'NO_FEE_POLICY',
      collectionMode: 'NONE',
      percentageBps: 0,
      treasuryAddress: null,
      veyraAddedSignatures: 0,
      explanation:
        policy.targetBps > 0
          ? `${policy.note} No embedded fee support is active, so Veyra charges zero.`
          : policy.note,
    };
  }

  if (!policy.embeddedFeeProviderIds.includes(input.providerId)) {
    return {
      capability: input.capability,
      providerId: input.providerId,
      status: 'PROVIDER_NOT_SUPPORTED',
      collectionMode: 'NONE',
      percentageBps: 0,
      treasuryAddress: null,
      veyraAddedSignatures: 0,
      explanation:
        `Provider ${input.providerId} has no verified Veyra embedded-fee path. Fee is zero; no extra transaction is allowed.`,
    };
  }

  if (!input.treasuryAddress) {
    return {
      capability: input.capability,
      providerId: input.providerId,
      status: 'TREASURY_NOT_CONFIGURED',
      collectionMode: 'NONE',
      percentageBps: 0,
      treasuryAddress: null,
      veyraAddedSignatures: 0,
      explanation:
        `Veyra Treasury is not configured for ${input.environment}. Fee collection is disabled rather than falling back to another wallet.`,
    };
  }

  const treasuryAddress = validateVeyraTreasuryAddress(input.treasuryAddress);

  return {
    capability: input.capability,
    providerId: input.providerId,
    status: 'COLLECTIBLE',
    collectionMode: 'PROVIDER_EMBEDDED',
    percentageBps: policy.targetBps,
    treasuryAddress,
    veyraAddedSignatures: 0,
    explanation:
      `Veyra fee is embedded by ${input.providerId} at ${policy.targetBps} bps and routed to the configured ${input.environment} Treasury. No Veyra-only signature is added.`,
  };
}
