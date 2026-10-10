import type {
  ProviderCapability,
  ProviderManifestEntry,
} from '../registry/providerTypes';

export interface ProviderActivationEvidence {
  providerId: string;
  capability: ProviderCapability;
  environment: 'testnet';
  executedAt: string;
  adapterVersion: string;
  realExecution: boolean;
  finalStateVerified: boolean;
  receiptVerified: boolean;
  signatureBudgetVerified: boolean;
  recoveryVerified?: boolean;
  duplicatePreventionVerified?: boolean;
  explainabilityVerified?: boolean;
  evidenceRefs: string[];
}

export interface ProviderActivationReadiness {
  providerId: string;
  readyForTested: boolean;
  readyForEnabled: boolean;
  missing: string[];
  matchedCapabilities: ProviderCapability[];
}

/**
 * Evidence gate for lifecycle promotion.
 *
 * This function never mutates the provider manifest and never enables a
 * provider automatically. It only answers whether the evidence required for a
 * human-reviewed lifecycle promotion is present.
 */
export function evaluateProviderActivationReadiness(
  entry: ProviderManifestEntry,
  evidence: ProviderActivationEvidence[],
): ProviderActivationReadiness {
  const missing = new Set<string>();
  const matchedCapabilities: ProviderCapability[] = [];

  if (entry.lifecycleStage === 'DISCOVERED' || entry.lifecycleStage === 'VERIFIED') {
    missing.add('adapterImplemented');
  }

  const requiredCapabilities = entry.capabilities.filter((capability) =>
    capability !== 'EARN_DISCOVER' &&
    capability !== 'EARN_POSITION' &&
    capability !== 'PORTFOLIO_READ' &&
    capability !== 'SIMULATION'
  );

  for (const capability of requiredCapabilities) {
    const candidates = evidence.filter(
      (item) =>
        item.providerId === entry.providerId &&
        item.capability === capability &&
        item.environment === 'testnet',
    );

    if (candidates.length === 0) {
      missing.add(`e2e:${capability}`);
      continue;
    }

    const accepted = candidates.some((item) => {
      if (!item.realExecution) return false;
      if (!item.finalStateVerified) return false;
      if (!item.receiptVerified) return false;
      if (!item.signatureBudgetVerified) return false;
      if (!item.adapterVersion.trim()) return false;
      if (
        entry.packageVersion &&
        item.adapterVersion.trim() !== entry.packageVersion.trim()
      ) return false;
      if (!Number.isFinite(Date.parse(item.executedAt))) return false;
      if (item.evidenceRefs.filter((ref) => ref.trim()).length === 0) return false;

      if (capability === 'BRIDGE') {
        if (!item.recoveryVerified || !item.duplicatePreventionVerified) return false;
      }

      if (capability === 'EARN_DEPOSIT' || capability === 'EARN_WITHDRAW') {
        if (!item.explainabilityVerified) return false;
      }

      return true;
    });

    if (!accepted) {
      missing.add(`verifiedE2E:${capability}`);
      continue;
    }

    matchedCapabilities.push(capability);
  }

  const readyForTested =
    missing.size === 0 &&
    entry.lifecycleStage !== 'DISCOVERED' &&
    entry.lifecycleStage !== 'VERIFIED';

  // ENABLED is a separate explicit sign-off. Evidence can make a provider
  // eligible for promotion to TESTED, but never silently turns enabled=true.
  const readyForEnabled =
    readyForTested &&
    (entry.lifecycleStage === 'TESTED' || entry.lifecycleStage === 'ENABLED');

  if (readyForTested && entry.lifecycleStage === 'IMPLEMENTED') {
    missing.add('explicitPromotionToTESTED');
  }
  if (entry.lifecycleStage === 'TESTED' && !entry.enabled) {
    missing.add('explicitEnableSignoff');
  }

  return {
    providerId: entry.providerId,
    readyForTested,
    readyForEnabled,
    missing: [...missing].sort(),
    matchedCapabilities,
  };
}
