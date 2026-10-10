import { describe, expect, it } from 'vitest';
import { findManifestEntry } from '../providers/registry/providerManifest';
import {
  evaluateProviderActivationReadiness,
  type ProviderActivationEvidence,
} from '../providers/activation/providerActivation';

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
});
