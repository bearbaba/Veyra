import { describe, expect, it } from 'vitest';
import { buildRoutePlan, countPlanWalletSignatures } from '../core/router/universalMoneyRouter';
import type { RouteCandidate } from '../core/router/routeTypes';

const arc = { networkId: 'arc', displayName: 'Arc', family: 'EVM' as const, chainId: 5042 };
const arbitrum = { networkId: 'arbitrum', displayName: 'Arbitrum', family: 'EVM' as const, chainId: 42161 };

function route(overrides: Partial<RouteCandidate> & Pick<RouteCandidate, 'routeId'>): RouteCandidate {
  const { routeId, ...rest } = overrides;
  return {
    routeId,
    capability: 'BRIDGE',
    providerId: 'provider',
    source: arc,
    destination: arbitrum,
    eligible: true,
    riskScore: 20,
    health: 'OK',
    ux: { protocolSignatures: 1, veyraAddedSignatures: 0, manualNetworkSwitches: 0, extraManualConfirmations: 0 },
    cost: { feeUsd: 0.2, etaSeconds: 45 },
    explanation: 'Eligible route.',
    ...rest,
  };
}

describe('Phase 4A universal money router', () => {
  it('prefers fewer wallet signatures over a tiny fee saving in balanced mode', () => {
    const oneSign = route({ routeId: 'one-sign', cost: { feeUsd: 0.30, etaSeconds: 50 } });
    const twoSign = route({ routeId: 'two-sign', ux: { protocolSignatures: 2, veyraAddedSignatures: 0, manualNetworkSwitches: 0, extraManualConfirmations: 0 }, cost: { feeUsd: 0.01, etaSeconds: 40 } });
    expect(buildRoutePlan([twoSign, oneSign], 'BALANCED').selected?.routeId).toBe('one-sign');
  });

  it('prefers a route without manual chain switching', () => {
    const abstracted = route({ routeId: 'abstracted' });
    const manual = route({ routeId: 'manual', ux: { protocolSignatures: 1, veyraAddedSignatures: 0, manualNetworkSwitches: 1, extraManualConfirmations: 0 }, cost: { feeUsd: 0.05, etaSeconds: 30 } });
    expect(buildRoutePlan([manual, abstracted]).selected?.routeId).toBe('abstracted');
  });

  it('is deterministic regardless of candidate input order', () => {
    const a = route({ routeId: 'a' });
    const b = route({ routeId: 'b' });
    expect(buildRoutePlan([b, a]).selected?.routeId).toBe('a');
    expect(buildRoutePlan([a, b]).selected?.routeId).toBe('a');
  });

  it('fails loudly if any route tries to add a Veyra-only signature', () => {
    const bad = route({ routeId: 'bad', ux: { protocolSignatures: 1, veyraAddedSignatures: 1, manualNetworkSwitches: 0, extraManualConfirmations: 0 } });
    expect(() => buildRoutePlan([bad])).toThrow(/must never add wallet signatures/i);
  });

  it('reports the actual selected protocol signature count', () => {
    const selected = route({ routeId: 'bridge', ux: { protocolSignatures: 2, veyraAddedSignatures: 0, manualNetworkSwitches: 0, extraManualConfirmations: 0 } });
    expect(countPlanWalletSignatures(buildRoutePlan([selected]))).toBe(2);
  });

  it('rejects unknown provider health instead of routing through it', () => {
    const unknown = route({ routeId: 'unknown', health: 'UNKNOWN' });
    const plan = buildRoutePlan([unknown]);
    expect(plan.selected).toBeNull();
    expect(plan.rejected[0]?.rejectionReason).toBe('PROVIDER_HEALTH_UNKNOWN');
  });
});
