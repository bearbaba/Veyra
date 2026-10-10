import { describe, expect, it } from 'vitest';
import { findManifestEntry } from '../providers/registry/providerManifest';
import {
  evaluateProviderActivationReadiness,
  type ProviderActivationEvidence,
} from '../providers/activation/providerActivation';
import { evaluateProviderLifecyclePromotion } from '../providers/activation/providerPromotion';

function evidence(
  capability: ProviderActivationEvidence['capability'],
  extra: Partial<ProviderActivationEvidence> = {},
): ProviderActivationEvidence {
  return {
    providerId: 'circle-appkit-bridge',
    capability,
    environment: 'testnet',
    executedAt: '2026-10-10T06:00:00.000Z',
    adapterVersion: '1.15.2',
    realExecution: true,
    finalStateVerified: true,
    receiptVerified: true,
    signatureBudgetVerified: true,
    evidenceRefs: ['tx:0xabc', 'receipt:verified'],
    ...extra,
  };
}

describe('Phase 4D provider activation evidence', () => {
  it('does not treat implementation alone as TESTED evidence', () => {
    const entry = findManifestEntry('circle-appkit-bridge')!;
    const result = evaluateProviderActivationReadiness(entry, []);
    expect(result.readyForTested).toBe(false);
    expect(result.missing).toContain('e2e:BRIDGE');
  });

  it('requires bridge recovery and duplicate-prevention evidence', () => {
    const entry = findManifestEntry('circle-appkit-bridge')!;
    const result = evaluateProviderActivationReadiness(entry, [evidence('BRIDGE')]);
    expect(result.readyForTested).toBe(false);
    expect(result.missing).toContain('verifiedE2E:BRIDGE');
  });

  it('recognizes complete bridge E2E evidence but still requires explicit lifecycle promotion', () => {
    const entry = findManifestEntry('circle-appkit-bridge')!;
    const result = evaluateProviderActivationReadiness(entry, [
      evidence('BRIDGE', {
        recoveryVerified: true,
        duplicatePreventionVerified: true,
      }),
    ]);

    expect(result.readyForTested).toBe(true);
    expect(result.readyForEnabled).toBe(false);
    expect(result.missing).toContain('explicitPromotionToTESTED');
  });

  it('requires Earn explainability evidence for fund-moving Earn capabilities', () => {
    const entry = findManifestEntry('circle-appkit-earn')!;
    const base = {
      providerId: 'circle-appkit-earn',
      adapterVersion: '1.15.2',
    };
    const result = evaluateProviderActivationReadiness(entry, [
      evidence('EARN_DEPOSIT', base),
      evidence('EARN_WITHDRAW', base),
    ]);

    expect(result.readyForTested).toBe(false);
    expect(result.missing).toContain('verifiedE2E:EARN_DEPOSIT');
    expect(result.missing).toContain('verifiedE2E:EARN_WITHDRAW');
  });

  it('never auto-enables an IMPLEMENTED provider even with complete evidence', () => {
    const entry = findManifestEntry('circle-appkit-bridge')!;
    const result = evaluateProviderActivationReadiness(entry, [
      evidence('BRIDGE', {
        recoveryVerified: true,
        duplicatePreventionVerified: true,
      }),
    ]);

    expect(entry.enabled).toBe(false);
    expect(entry.lifecycleStage).toBe('IMPLEMENTED');
    expect(result.readyForEnabled).toBe(false);
  });

  it('rejects E2E evidence from a different adapter version', () => {
    const entry = findManifestEntry('circle-appkit-bridge')!;
    const result = evaluateProviderActivationReadiness(entry, [
      evidence('BRIDGE', {
        adapterVersion: '1.15.1',
        recoveryVerified: true,
        duplicatePreventionVerified: true,
      }),
    ]);

    expect(result.readyForTested).toBe(false);
    expect(result.missing).toContain('verifiedE2E:BRIDGE');
  });

  it('allows an explicit IMPLEMENTED → TESTED promotion proposal with complete evidence', () => {
    const entry = findManifestEntry('circle-appkit-bridge')!;
    const now = Date.parse('2026-10-10T08:00:00.000Z');
    const decision = evaluateProviderLifecyclePromotion({
      entry,
      evidence: [
        evidence('BRIDGE', {
          recoveryVerified: true,
          duplicatePreventionVerified: true,
        }),
      ],
      target: 'TESTED',
      approval: {
        target: 'TESTED',
        approvalRef: 'pr-review:phase4d-test',
        reviewerRef: 'maintainer:reviewed',
        approvedAt: '2026-10-10T07:00:00.000Z',
      },
      now,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.proposedLifecycleStage).toBe('TESTED');
    expect(decision.proposedEnabled).toBe(false);
    expect(entry.lifecycleStage).toBe('IMPLEMENTED');
    expect(entry.enabled).toBe(false);
  });

  it('blocks TESTED promotion without explicit approval', () => {
    const entry = findManifestEntry('circle-appkit-bridge')!;
    const decision = evaluateProviderLifecyclePromotion({
      entry,
      evidence: [
        evidence('BRIDGE', {
          recoveryVerified: true,
          duplicatePreventionVerified: true,
        }),
      ],
      target: 'TESTED',
      now: Date.parse('2026-10-10T08:00:00.000Z'),
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain('EXPLICIT_APPROVAL_REQUIRED');
  });

  it('blocks an approval that predates the E2E evidence', () => {
    const entry = findManifestEntry('circle-appkit-bridge')!;
    const decision = evaluateProviderLifecyclePromotion({
      entry,
      evidence: [
        evidence('BRIDGE', {
          recoveryVerified: true,
          duplicatePreventionVerified: true,
        }),
      ],
      target: 'TESTED',
      approval: {
        target: 'TESTED',
        approvalRef: 'pr-review:too-early',
        reviewerRef: 'maintainer:reviewed',
        approvedAt: '2026-10-10T05:00:00.000Z',
      },
      now: Date.parse('2026-10-10T08:00:00.000Z'),
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain('APPROVAL_PREDATES_EVIDENCE');
  });

  it('never skips TESTED when an IMPLEMENTED provider is proposed for ENABLED', () => {
    const entry = findManifestEntry('circle-appkit-bridge')!;
    const decision = evaluateProviderLifecyclePromotion({
      entry,
      evidence: [
        evidence('BRIDGE', {
          recoveryVerified: true,
          duplicatePreventionVerified: true,
        }),
      ],
      target: 'ENABLED',
      approval: {
        target: 'ENABLED',
        approvalRef: 'pr-review:enable-too-soon',
        reviewerRef: 'maintainer:reviewed',
        approvedAt: '2026-10-10T07:00:00.000Z',
      },
      runtimeHealth: {
        status: 'OK',
        checkedAt: Date.parse('2026-10-10T07:59:30.000Z'),
      },
      now: Date.parse('2026-10-10T08:00:00.000Z'),
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain('ENABLED_REQUIRES_TESTED_STAGE');
  });

  it('allows TESTED → ENABLED only with complete evidence, approval, and fresh OK health', () => {
    const implemented = findManifestEntry('circle-appkit-bridge')!;
    const tested = {
      ...implemented,
      lifecycleStage: 'TESTED' as const,
      enabled: false,
    };
    const now = Date.parse('2026-10-10T08:00:00.000Z');

    const decision = evaluateProviderLifecyclePromotion({
      entry: tested,
      evidence: [
        evidence('BRIDGE', {
          recoveryVerified: true,
          duplicatePreventionVerified: true,
        }),
      ],
      target: 'ENABLED',
      approval: {
        target: 'ENABLED',
        approvalRef: 'pr-review:enable',
        reviewerRef: 'maintainer:reviewed',
        approvedAt: '2026-10-10T07:00:00.000Z',
      },
      runtimeHealth: {
        status: 'OK',
        checkedAt: now - 1_000,
      },
      now,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.proposedLifecycleStage).toBe('ENABLED');
    expect(decision.proposedEnabled).toBe(true);
    expect(tested.enabled).toBe(false);
  });

  it('blocks ENABLED promotion when runtime health is stale or not OK', () => {
    const implemented = findManifestEntry('circle-appkit-bridge')!;
    const tested = {
      ...implemented,
      lifecycleStage: 'TESTED' as const,
      enabled: false,
    };
    const now = Date.parse('2026-10-10T08:00:00.000Z');
    const common = {
      entry: tested,
      evidence: [
        evidence('BRIDGE', {
          recoveryVerified: true,
          duplicatePreventionVerified: true,
        }),
      ],
      target: 'ENABLED' as const,
      approval: {
        target: 'ENABLED' as const,
        approvalRef: 'pr-review:enable',
        reviewerRef: 'maintainer:reviewed',
        approvedAt: '2026-10-10T07:00:00.000Z',
      },
      now,
    };

    const stale = evaluateProviderLifecyclePromotion({
      ...common,
      runtimeHealth: {
        status: 'OK',
        checkedAt: now - 120_000,
      },
    });
    expect(stale.allowed).toBe(false);
    expect(stale.reasons).toContain('RUNTIME_HEALTH_STALE');

    const degraded = evaluateProviderLifecyclePromotion({
      ...common,
      runtimeHealth: {
        status: 'DEGRADED',
        checkedAt: now - 1_000,
      },
    });
    expect(degraded.allowed).toBe(false);
    expect(degraded.reasons).toContain('RUNTIME_HEALTH_NOT_OK');
  });

});
