import type { VeyraAction } from '../actions/actionSchema';
import { assertActionValid } from '../actions/actionSchema';
import { assertSecurityGateReady } from '../../lib/securityGate';
import { checkProviderEligibility } from '../../providers/registry/providerRegistry';
import type {
  ProviderCapability,
  ProviderEligibilityResult,
} from '../../providers/registry/providerTypes';

export type ExecutionRuntimeEnvironment = 'local' | 'testnet' | 'mainnet';

export interface ExecutionReadinessRequest {
  action: VeyraAction;
  providerId?: string;
  providerCapability?: ProviderCapability;
  assetAddress?: string;
  runtimeEnvironment: ExecutionRuntimeEnvironment;
  degradedProviderConfirmed?: boolean;
}

export interface ExecutionReadinessSnapshot {
  checkedAt: number;
  providerId?: string;
  providerEligibility?: ProviderEligibilityResult;
}

/**
 * Canonical final execution boundary.
 *
 * This MUST run immediately before any wallet signature or other fund-moving
 * provider call. Review-time checks are not sufficient because provenance,
 * quotes, provider health and lifecycle state can change while the review UI
 * is open.
 *
 * The boundary is deterministic and fail-closed:
 * - security stores must be READY;
 * - action schema/provenance/quote freshness must still be valid;
 * - provider-backed actions require a currently eligible provider;
 * - DEGRADED providers require explicit confirmation at execution time.
 */
export function assertExecutionReady(
  request: ExecutionReadinessRequest,
): ExecutionReadinessSnapshot {
  assertSecurityGateReady();
  assertActionValid(request.action);

  if (!request.providerId && !request.providerCapability) {
    return { checkedAt: Date.now() };
  }

  if (!request.providerId || !request.providerCapability) {
    throw new Error(
      '[executionReadiness] providerId and providerCapability must be supplied together.',
    );
  }

  const eligibility = checkProviderEligibility(
    request.providerId,
    request.providerCapability,
    request.action.chainId,
    request.assetAddress,
    request.runtimeEnvironment,
  );

  if (!eligibility.eligible || eligibility.status !== 'ELIGIBLE') {
    throw new Error(
      `[executionReadiness] Provider "${request.providerId}" is not execution-ready: ${eligibility.status}. ${eligibility.detail}`,
    );
  }

  if (eligibility.requiresConfirmation && !request.degradedProviderConfirmed) {
    throw new Error(
      `[executionReadiness] Provider "${request.providerId}" is DEGRADED and requires explicit execution-time confirmation.`,
    );
  }

  return {
    checkedAt: Date.now(),
    providerId: request.providerId,
    providerEligibility: eligibility,
  };
}
