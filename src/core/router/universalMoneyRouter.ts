import type { RouteCandidate, RoutePlan, RoutePreference } from './routeTypes';

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function assertCandidate(candidate: RouteCandidate): void {
  if (!candidate.routeId.trim()) throw new Error('routeId is required');
  if (candidate.ux.protocolSignatures < 0 || !Number.isInteger(candidate.ux.protocolSignatures)) {
    throw new Error(`Invalid protocol signature count for ${candidate.routeId}`);
  }
  if (candidate.ux.veyraAddedSignatures !== 0) {
    throw new Error(`Veyra must never add wallet signatures (${candidate.routeId})`);
  }
  if (candidate.ux.manualNetworkSwitches < 0 || !Number.isInteger(candidate.ux.manualNetworkSwitches)) {
    throw new Error(`Invalid manual network switch count for ${candidate.routeId}`);
  }
  if (!Number.isFinite(candidate.riskScore) || candidate.riskScore < 0 || candidate.riskScore > 100) {
    throw new Error(`Invalid risk score for ${candidate.routeId}`);
  }
}

/**
 * Manual UX burden is deliberately visible to routing. A route that saves a few
 * cents must not silently cost the user extra wallet signatures or chain hops.
 */
export function routeUxBurden(candidate: RouteCandidate): number {
  return (
    candidate.ux.protocolSignatures * 1000 +
    candidate.ux.manualNetworkSwitches * 500 +
    candidate.ux.extraManualConfirmations * 100
  );
}

function tuple(candidate: RouteCandidate, preference: RoutePreference): readonly number[] {
  const fee = finiteOr(candidate.cost.feeUsd, Number.MAX_SAFE_INTEGER / 1000);
  const eta = finiteOr(candidate.cost.etaSeconds, Number.MAX_SAFE_INTEGER / 1000);
  const ux = routeUxBurden(candidate);

  // Eligibility is filtered before sorting. Risk never disappears: FAST can
  // prefer ETA only among routes already admitted by policy/risk gates.
  if (preference === 'SAFE') return [candidate.riskScore, ux, fee, eta];
  if (preference === 'FAST') return [ux, eta, candidate.riskScore, fee];
  return [ux, candidate.riskScore, fee, eta];
}

function compareTuple(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Deterministic route selection. Input order never changes the result.
 */
export function buildRoutePlan(
  input: readonly RouteCandidate[],
  preference: RoutePreference = 'BALANCED',
): RoutePlan {
  const seen = new Set<string>();
  const candidates = input.map((candidate) => ({ ...candidate, ux: { ...candidate.ux }, cost: { ...candidate.cost } }));
  for (const candidate of candidates) {
    assertCandidate(candidate);
    if (seen.has(candidate.routeId)) throw new Error(`Duplicate routeId: ${candidate.routeId}`);
    seen.add(candidate.routeId);
  }

  const rejected = candidates
    .filter((candidate) => !candidate.eligible || candidate.health === 'DOWN' || candidate.health === 'UNKNOWN')
    .map((candidate) => ({
      ...candidate,
      eligible: false,
      rejectionReason: candidate.rejectionReason ?? (candidate.health === 'DOWN' ? 'PROVIDER_DOWN' : candidate.health === 'UNKNOWN' ? 'PROVIDER_HEALTH_UNKNOWN' : 'INELIGIBLE'),
    }))
    .sort((a, b) => a.routeId.localeCompare(b.routeId));

  const eligible = candidates
    .filter((candidate) => candidate.eligible && candidate.health !== 'DOWN' && candidate.health !== 'UNKNOWN')
    .sort((a, b) => compareTuple(tuple(a, preference), tuple(b, preference)) || a.routeId.localeCompare(b.routeId));

  return {
    selected: eligible[0] ?? null,
    alternatives: eligible.slice(1),
    rejected,
    preference,
  };
}

export function countPlanWalletSignatures(plan: RoutePlan): number {
  return plan.selected?.ux.protocolSignatures ?? 0;
}
