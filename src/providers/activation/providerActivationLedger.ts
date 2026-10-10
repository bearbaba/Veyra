import type { ProviderManifestEntry } from '../registry/providerTypes';
import type { ProviderActivationEvidence } from './providerActivation';

export interface ProviderActivationEvidenceRecord {
  recordId: string;
  recordedAt: string;
  recordedBy: string;
  evidence: ProviderActivationEvidence;
}

/**
 * Repository-reviewed activation evidence ledger.
 *
 * IMPORTANT:
 * - Do not add synthetic, mocked, unit-test-only, or documentation-only evidence.
 * - A record is added only after a real execution produced independently
 *   reviewable evidence references.
 * - Git history is the audit trail for additions/changes to this ledger.
 *
 * The ledger intentionally starts empty for Phase 4D. Existing providers that
 * were enabled before this structured ledger keep their historical provenance
 * in the provider manifest; Phase 4D candidates must use records here.
 */
export const PROVIDER_ACTIVATION_EVIDENCE_LEDGER:
  readonly ProviderActivationEvidenceRecord[] = [];

const RECORD_ID_RE = /^[a-z0-9][a-z0-9._:-]{5,159}$/i;

export function validateProviderActivationEvidenceRecord(
  entry: ProviderManifestEntry,
  record: ProviderActivationEvidenceRecord,
): string[] {
  const errors: string[] = [];
  const evidence = record.evidence;

  if (!RECORD_ID_RE.test(record.recordId)) errors.push('INVALID_RECORD_ID');
  if (!record.recordedBy.trim()) errors.push('RECORDED_BY_REQUIRED');

  const recordedAt = Date.parse(record.recordedAt);
  const executedAt = Date.parse(evidence.executedAt);
  if (!Number.isFinite(recordedAt)) errors.push('INVALID_RECORDED_AT');
  if (!Number.isFinite(executedAt)) errors.push('INVALID_EXECUTED_AT');
  if (
    Number.isFinite(recordedAt) &&
    Number.isFinite(executedAt) &&
    recordedAt < executedAt
  ) {
    errors.push('RECORDED_BEFORE_EXECUTION');
  }

  if (evidence.providerId !== entry.providerId) {
    errors.push('PROVIDER_ID_MISMATCH');
  }
  if (evidence.environment !== 'testnet') {
    errors.push('TESTNET_EVIDENCE_REQUIRED');
  }
  if (!entry.capabilities.includes(evidence.capability)) {
    errors.push('CAPABILITY_NOT_DECLARED');
  }
  if (
    entry.packageVersion &&
    evidence.adapterVersion.trim() !== entry.packageVersion.trim()
  ) {
    errors.push('ADAPTER_VERSION_MISMATCH');
  }
  if (evidence.evidenceRefs.filter((ref) => ref.trim()).length === 0) {
    errors.push('EVIDENCE_REFERENCE_REQUIRED');
  }

  return [...new Set(errors)].sort();
}

export function validateProviderActivationLedger(
  entries: readonly ProviderManifestEntry[],
  records: readonly ProviderActivationEvidenceRecord[],
): string[] {
  const errors: string[] = [];
  const providerById = new Map(entries.map((entry) => [entry.providerId, entry]));
  const seenRecordIds = new Set<string>();

  for (const record of records) {
    if (seenRecordIds.has(record.recordId)) {
      errors.push(`DUPLICATE_RECORD_ID:${record.recordId}`);
    }
    seenRecordIds.add(record.recordId);

    const entry = providerById.get(record.evidence.providerId);
    if (!entry) {
      errors.push(`UNKNOWN_PROVIDER:${record.evidence.providerId}`);
      continue;
    }

    for (const error of validateProviderActivationEvidenceRecord(entry, record)) {
      errors.push(`${record.recordId}:${error}`);
    }
  }

  return errors.sort();
}

export function evidenceForProvider(
  records: readonly ProviderActivationEvidenceRecord[],
  providerId: string,
): ProviderActivationEvidence[] {
  return records
    .filter((record) => record.evidence.providerId === providerId)
    .map((record) => record.evidence);
}
