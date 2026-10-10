import type { VeyraCapability } from '../capabilities/capabilityTypes';

export type VeyraFeeCollectionMode = 'NONE' | 'PROVIDER_EMBEDDED';

export interface VeyraFeePolicyEntry {
  capability: VeyraCapability;
  /** Target developer fee in basis points. 1 bp = 0.01%. */
  targetBps: number;
  collectionMode: VeyraFeeCollectionMode;
  /**
   * Only providers with independently verified embedded-fee support belong
   * here. Empty means Veyra must charge zero rather than add a transaction.
   */
  embeddedFeeProviderIds: readonly string[];
  note: string;
}

/**
 * Veyra Fee Model v1.
 *
 * Product policy may describe a future target fee, but collection is allowed
 * only where the provider natively embeds it in the underlying transaction.
 * No embedded fee support => no Veyra fee.
 *
 * We deliberately do not implement USD min/max caps yet because Circle App
 * Kit custom fees are expressed as percentageBps. Enforcing dollar caps for
 * non-USDC inputs would require trusted pricing and could otherwise mislead.
 */
export const VEYRA_FEE_POLICY_V1: readonly VeyraFeePolicyEntry[] = [
  {
    capability: 'PAY',
    targetBps: 0,
    collectionMode: 'NONE',
    embeddedFeeProviderIds: [],
    note: 'Pay is free at the Veyra layer to maximize adoption.',
  },
  {
    capability: 'BRIDGE',
    targetBps: 8,
    collectionMode: 'NONE',
    embeddedFeeProviderIds: [],
    note:
      '8 bps is the product target, but Veyra charges zero until a verified bridge provider exposes an embedded developer-fee primitive.',
  },
  {
    capability: 'SWAP',
    targetBps: 10,
    collectionMode: 'PROVIDER_EMBEDDED',
    embeddedFeeProviderIds: ['circle-appkit-swap'],
    note:
      'Circle App Kit swap customFee is the currently verified embedded-fee path. It adds no Veyra-only transaction or signature.',
  },
  {
    capability: 'UNIFIED',
    targetBps: 5,
    collectionMode: 'NONE',
    embeddedFeeProviderIds: [],
    note:
      '5 bps is the product target, but Veyra charges zero until embedded fee support is verified for the active Unified route.',
  },
  {
    capability: 'EARN',
    targetBps: 0,
    collectionMode: 'NONE',
    embeddedFeeProviderIds: [],
    note: 'Earn deposit and withdrawal have no Veyra fee in v1.',
  },
  {
    capability: 'ONRAMP',
    targetBps: 0,
    collectionMode: 'NONE',
    embeddedFeeProviderIds: [],
    note: 'No Veyra onramp fee until a provider-specific commercial model is verified.',
  },
  {
    capability: 'IDENTITY',
    targetBps: 0,
    collectionMode: 'NONE',
    embeddedFeeProviderIds: [],
    note: 'Veyra ID is not a money-movement fee surface.',
  },
  {
    capability: 'RESERVE',
    targetBps: 0,
    collectionMode: 'NONE',
    embeddedFeeProviderIds: [],
    note: 'Reserve is a planning constraint and never charges a fee.',
  },
] as const;

export function getVeyraFeePolicy(capability: VeyraCapability): VeyraFeePolicyEntry {
  const policy = VEYRA_FEE_POLICY_V1.find((entry) => entry.capability === capability);
  if (!policy) throw new Error(`Missing Veyra fee policy for capability ${capability}`);
  return policy;
}
