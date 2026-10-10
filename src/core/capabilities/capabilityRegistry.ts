import type { CapabilityDescriptor, VeyraCapability } from './capabilityTypes';
import { getProvidersForCapability } from '@/providers/registry/providerRegistry';

/**
 * Product capability registry.
 *
 * ACTIVE here means the capability exists in the product model. Execution is
 * still decided by provider lifecycle + health + policy + risk + preflight.
 * GATED capabilities are understood by Agent and may be explained/planned, but
 * are not executable until at least one provider is independently ENABLED.
 */
export const CAPABILITY_REGISTRY: readonly CapabilityDescriptor[] = [
  {
    capability: 'PAY',
    label: 'Pay',
    description: 'Send value to a verified recipient. Arc is the home-network default when no destination is requested.',
    availability: 'ACTIVE',
    providerCapabilities: ['TRANSFER'],
    multiNetwork: true,
    requiresMoneyExplanation: false,
    veyraAddedSignatureBudget: 0,
  },
  {
    capability: 'UNIFIED',
    label: 'Unified',
    description: 'Use a chain-abstracted balance and let Veyra choose eligible source allocations.',
    availability: 'GATED',
    providerCapabilities: ['UNIFIED_BALANCE'],
    multiNetwork: true,
    requiresMoneyExplanation: true,
    veyraAddedSignatureBudget: 0,
  },
  {
    capability: 'BRIDGE',
    label: 'Bridge',
    description: 'Explicit point-to-point cross-network movement.',
    availability: 'ACTIVE',
    providerCapabilities: ['BRIDGE'],
    multiNetwork: true,
    requiresMoneyExplanation: true,
    veyraAddedSignatureBudget: 0,
  },
  {
    capability: 'SWAP',
    label: 'Swap',
    description: 'Exchange one asset for another; legacy Convert intent maps here.',
    availability: 'GATED',
    providerCapabilities: ['SWAP', 'CONVERT'],
    multiNetwork: true,
    requiresMoneyExplanation: true,
    veyraAddedSignatureBudget: 0,
  },
  {
    capability: 'EARN',
    label: 'Earn',
    description: 'Discover, deposit into, inspect and withdraw from eligible yield positions.',
    availability: 'GATED',
    providerCapabilities: ['EARN_DISCOVER', 'EARN_DEPOSIT', 'EARN_WITHDRAW', 'EARN_POSITION'],
    multiNetwork: true,
    requiresMoneyExplanation: true,
    veyraAddedSignatureBudget: 0,
  },
  {
    capability: 'ONRAMP',
    label: 'Add funds',
    description: 'Acquire supported assets through an eligible onramp integration.',
    availability: 'GATED',
    providerCapabilities: ['ONRAMP'],
    multiNetwork: true,
    requiresMoneyExplanation: true,
    veyraAddedSignatureBudget: 0,
  },
  {
    capability: 'IDENTITY',
    label: 'Veyra ID',
    description: 'Resolve Veyra handle, linked X identity and verified receive wallets.',
    availability: 'ACTIVE',
    providerCapabilities: [],
    multiNetwork: true,
    requiresMoneyExplanation: false,
    veyraAddedSignatureBudget: 0,
  },
  {
    capability: 'RESERVE',
    label: 'Keep available',
    description: 'A planning constraint that reserves liquid balance before other actions are routed.',
    availability: 'ACTIVE',
    providerCapabilities: [],
    multiNetwork: true,
    requiresMoneyExplanation: false,
    veyraAddedSignatureBudget: 0,
  },
] as const;

export function getCapability(capability: VeyraCapability): CapabilityDescriptor {
  const found = CAPABILITY_REGISTRY.find((item) => item.capability === capability);
  if (!found) throw new Error(`Unknown Veyra capability: ${capability}`);
  return found;
}

/**
 * Runtime-safe execution signal. Identity/Reserve are internal capabilities;
 * financial capabilities require at least one provider at ENABLED + enabled.
 * Health/chain/asset eligibility is checked later for the concrete route.
 */
export function hasExecutableProvider(capability: VeyraCapability): boolean {
  const descriptor = getCapability(capability);
  if (descriptor.providerCapabilities.length === 0) return descriptor.availability === 'ACTIVE';
  return descriptor.providerCapabilities.some((providerCapability) =>
    getProvidersForCapability(providerCapability).some(
      (provider) => provider.enabled && provider.lifecycleStage === 'ENABLED',
    ),
  );
}
