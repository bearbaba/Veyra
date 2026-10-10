import type { ProviderCapability } from '@/providers/registry/providerTypes';

/**
 * User-facing capabilities. These describe what Veyra can understand and plan.
 * They are intentionally higher level than low-level onchain ActionType values.
 */
export type VeyraCapability =
  | 'PAY'
  | 'UNIFIED'
  | 'BRIDGE'
  | 'SWAP'
  | 'EARN'
  | 'ONRAMP'
  | 'IDENTITY'
  | 'RESERVE';

export type CapabilityAvailability = 'ACTIVE' | 'GATED' | 'ADVISORY';

export interface CapabilityDescriptor {
  capability: VeyraCapability;
  label: string;
  description: string;
  availability: CapabilityAvailability;
  providerCapabilities: readonly ProviderCapability[];
  multiNetwork: boolean;
  requiresMoneyExplanation: boolean;
  /** Veyra never adds a wallet signature just to approve its own plan/receipt. */
  veyraAddedSignatureBudget: 0;
}
