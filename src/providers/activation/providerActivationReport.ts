import { PROVIDER_MANIFEST } from '../registry/providerManifest';
import type {
  ProviderCapability,
  ProviderManifestEntry,
} from '../registry/providerTypes';
import {
  evaluateProviderActivationReadiness,
  type ProviderActivationEvidence,
} from './providerActivation';
import {
  evidenceForProvider,
  PROVIDER_ACTIVATION_EVIDENCE_LEDGER,
  type ProviderActivationEvidenceRecord,
} from './providerActivationLedger';

export type ProviderActivationStatus =
  | 'ENABLED'
  | 'AWAITING_IMPLEMENTATION'
  | 'AWAITING_E2E'
  | 'READY_FOR_TESTED_REVIEW'
  | 'TESTED_AWAITING_ENABLE_REVIEW'
  | 'MAINNET_SEPARATE_ACTIVATION';

export interface ProviderActivationReportRow {
  providerId: string;
  displayName: string;
  environment: ProviderManifestEntry['environment'];
  lifecycleStage: ProviderManifestEntry['lifecycleStage'];
  enabled: boolean;
  status: ProviderActivationStatus;
  evidenceRecordCount: number;
  matchedCapabilities: ProviderCapability[];
  missing: string[];
  nextAction: string;
}

function requiredFundMovingCapabilities(
  entry: ProviderManifestEntry,
): ProviderCapability[] {
  return entry.capabilities.filter((capability) =>
    capability !== 'EARN_DISCOVER' &&
    capability !== 'EARN_POSITION' &&
    capability !== 'PORTFOLIO_READ' &&
    capability !== 'SIMULATION'
  );
}

function reportRow(
  entry: ProviderManifestEntry,
  records: readonly ProviderActivationEvidenceRecord[],
): ProviderActivationReportRow {
  const evidence = evidenceForProvider(records, entry.providerId);
  const readiness = evaluateProviderActivationReadiness(entry, evidence);

  if (entry.lifecycleStage === 'ENABLED' && entry.enabled) {
    return {
      providerId: entry.providerId,
      displayName: entry.displayName,
      environment: entry.environment,
      lifecycleStage: entry.lifecycleStage,
      enabled: entry.enabled,
      status: 'ENABLED',
      evidenceRecordCount: evidence.length,
      matchedCapabilities: readiness.matchedCapabilities,
      missing: [],
      nextAction: 'No lifecycle promotion action required.',
    };
  }

  if (entry.environment === 'mainnet') {
    return {
      providerId: entry.providerId,
      displayName: entry.displayName,
      environment: entry.environment,
      lifecycleStage: entry.lifecycleStage,
      enabled: entry.enabled,
      status: 'MAINNET_SEPARATE_ACTIVATION',
      evidenceRecordCount: evidence.length,
      matchedCapabilities: readiness.matchedCapabilities,
      missing: ['separateProductionActivation'],
      nextAction:
        'Use the separate mainnet production activation path; testnet Phase 4D evidence cannot enable mainnet.',
    };
  }

  if (entry.lifecycleStage === 'DISCOVERED' || entry.lifecycleStage === 'VERIFIED') {
    return {
      providerId: entry.providerId,
      displayName: entry.displayName,
      environment: entry.environment,
      lifecycleStage: entry.lifecycleStage,
      enabled: entry.enabled,
      status: 'AWAITING_IMPLEMENTATION',
      evidenceRecordCount: evidence.length,
      matchedCapabilities: readiness.matchedCapabilities,
      missing: readiness.missing,
      nextAction: 'Complete and review the provider adapter before collecting activation E2E evidence.',
    };
  }

  if (entry.lifecycleStage === 'IMPLEMENTED') {
    const required = requiredFundMovingCapabilities(entry);
    const missingE2E = required.filter(
      (capability) => !readiness.matchedCapabilities.includes(capability),
    );

    if (missingE2E.length > 0) {
      return {
        providerId: entry.providerId,
        displayName: entry.displayName,
        environment: entry.environment,
        lifecycleStage: entry.lifecycleStage,
        enabled: entry.enabled,
        status: 'AWAITING_E2E',
        evidenceRecordCount: evidence.length,
        matchedCapabilities: readiness.matchedCapabilities,
        missing: readiness.missing,
        nextAction:
          `Collect real testnet E2E evidence for: ${missingE2E.join(', ')}. Do not enable before verification.`,
      };
    }

    return {
      providerId: entry.providerId,
      displayName: entry.displayName,
      environment: entry.environment,
      lifecycleStage: entry.lifecycleStage,
      enabled: entry.enabled,
      status: 'READY_FOR_TESTED_REVIEW',
      evidenceRecordCount: evidence.length,
      matchedCapabilities: readiness.matchedCapabilities,
      missing: readiness.missing,
      nextAction: 'Request explicit reviewed promotion from IMPLEMENTED to TESTED.',
    };
  }

  return {
    providerId: entry.providerId,
    displayName: entry.displayName,
    environment: entry.environment,
    lifecycleStage: entry.lifecycleStage,
    enabled: entry.enabled,
    status: 'TESTED_AWAITING_ENABLE_REVIEW',
    evidenceRecordCount: evidence.length,
    matchedCapabilities: readiness.matchedCapabilities,
    missing: readiness.missing,
    nextAction:
      'Obtain explicit ENABLED approval with fresh OK runtime health; do not auto-enable.',
  };
}

export function buildProviderActivationReport(
  entries: readonly ProviderManifestEntry[],
  records: readonly ProviderActivationEvidenceRecord[],
): ProviderActivationReportRow[] {
  return entries
    .map((entry) => reportRow(entry, records))
    .sort((a, b) => a.providerId.localeCompare(b.providerId));
}

export function activationEvidenceForReport(
  records: readonly ProviderActivationEvidenceRecord[],
): ProviderActivationEvidence[] {
  return records.map((record) => record.evidence);
}

export const CURRENT_PROVIDER_ACTIVATION_REPORT = buildProviderActivationReport(
  PROVIDER_MANIFEST,
  PROVIDER_ACTIVATION_EVIDENCE_LEDGER,
);
