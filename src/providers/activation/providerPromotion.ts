import { SECURITY_CONFIG } from '../../lib/securityConfig';
import type {
  ProviderHealthStatus,
  ProviderLifecycleStage,
  ProviderManifestEntry,
} from '../registry/providerTypes';
import {
  evaluateProviderActivationReadiness,
  type ProviderActivationEvidence,
} from './providerActivation';

export type ProviderPromotionTarget = 'TESTED' | 'ENABLED';

export interface ProviderPromotionApproval {
  target: ProviderPromotionTarget;
  approvalRef: string;
  reviewerRef: string;
  approvedAt: string;
}

export interface ProviderPromotionRuntimeHealth {
  status: ProviderHealthStatus;
  checkedAt: number;
}

export interface ProviderPromotionDecision {
  providerId: string;
  target: ProviderPromotionTarget;
  allowed: boolean;
  reasons: string[];
  proposedLifecycleStage: ProviderLifecycleStage | null;
  proposedEnabled: boolean | null;
}

/**
 * Explicit provider lifecycle promotion gate.
 *
 * This function is intentionally pure and NEVER mutates the provider manifest.
 * A caller may use an allowed decision to prepare a reviewed manifest change,
 * but no provider is automatically promoted or enabled at runtime.
 */
export function evaluateProviderLifecyclePromotion(input: {
  entry: ProviderManifestEntry;
  evidence: ProviderActivationEvidence[];
  target: ProviderPromotionTarget;
  approval?: ProviderPromotionApproval | null;
  runtimeHealth?: ProviderPromotionRuntimeHealth | null;
  now?: number;
}): ProviderPromotionDecision {
  const {
    entry,
    evidence,
    target,
    approval,
    runtimeHealth,
    now = Date.now(),
  } = input;

  const reasons = new Set<string>();
  const readiness = evaluateProviderActivationReadiness(entry, evidence);

  // Phase 4D activation is testnet-only. Mainnet has a separate production
  // activation path and may never inherit a testnet approval.
  if (entry.environment !== 'testnet') {
    reasons.add('MAINNET_REQUIRES_SEPARATE_PRODUCTION_ACTIVATION');
  }

  if (!approval) {
    reasons.add('EXPLICIT_APPROVAL_REQUIRED');
  } else {
    if (approval.target !== target) reasons.add('APPROVAL_TARGET_MISMATCH');
    if (!approval.approvalRef.trim()) reasons.add('APPROVAL_REF_REQUIRED');
    if (!approval.reviewerRef.trim()) reasons.add('REVIEWER_REF_REQUIRED');

    const approvedAt = Date.parse(approval.approvedAt);
    if (!Number.isFinite(approvedAt)) {
      reasons.add('INVALID_APPROVAL_TIMESTAMP');
    } else {
      if (approvedAt > now) reasons.add('APPROVAL_FROM_FUTURE');

      const providerEvidenceTimes = evidence
        .filter((item) => item.providerId === entry.providerId)
        .map((item) => Date.parse(item.executedAt))
        .filter(Number.isFinite);

      const latestEvidenceAt = providerEvidenceTimes.length > 0
        ? Math.max(...providerEvidenceTimes)
        : null;

      if (latestEvidenceAt !== null && approvedAt < latestEvidenceAt) {
        reasons.add('APPROVAL_PREDATES_EVIDENCE');
      }
    }
  }

  if (target === 'TESTED') {
    if (entry.lifecycleStage !== 'IMPLEMENTED') {
      reasons.add('TESTED_REQUIRES_IMPLEMENTED_STAGE');
    }
    if (!readiness.readyForTested) {
      reasons.add('TESTED_EVIDENCE_INCOMPLETE');
    }

    return {
      providerId: entry.providerId,
      target,
      allowed: reasons.size === 0,
      reasons: [...reasons].sort(),
      proposedLifecycleStage: reasons.size === 0 ? 'TESTED' : null,
      proposedEnabled: reasons.size === 0 ? false : null,
    };
  }

  if (entry.lifecycleStage !== 'TESTED') {
    reasons.add('ENABLED_REQUIRES_TESTED_STAGE');
  }
  if (!readiness.readyForEnabled) {
    reasons.add('ENABLED_EVIDENCE_INCOMPLETE');
  }
  if (entry.enabled) {
    reasons.add('PROVIDER_ALREADY_ENABLED');
  }
  if (entry.trustStatus === 'UNVERIFIED' || entry.trustStatus === 'DISABLED') {
    reasons.add('PROVIDER_TRUST_NOT_ACTIVATABLE');
  }
  if (entry.riskClassification === 'CRITICAL' || entry.riskClassification === 'UNKNOWN') {
    reasons.add('PROVIDER_RISK_NOT_ACTIVATABLE');
  }

  if (!runtimeHealth) {
    reasons.add('FRESH_RUNTIME_HEALTH_REQUIRED');
  } else {
    const healthAge = now - runtimeHealth.checkedAt;
    if (
      healthAge < 0 ||
      healthAge > SECURITY_CONFIG.MAX_PROVIDER_HEALTH_AGE_MS
    ) {
      reasons.add('RUNTIME_HEALTH_STALE');
    }
    if (runtimeHealth.status !== 'OK') {
      reasons.add('RUNTIME_HEALTH_NOT_OK');
    }
  }

  return {
    providerId: entry.providerId,
    target,
    allowed: reasons.size === 0,
    reasons: [...reasons].sort(),
    proposedLifecycleStage: reasons.size === 0 ? 'ENABLED' : null,
    proposedEnabled: reasons.size === 0 ? true : null,
  };
}
