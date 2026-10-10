import { describe, expect, it } from 'vitest';
import { PROVIDER_MANIFEST, findManifestEntry } from '../providers/registry/providerManifest';
import type { ProviderActivationEvidenceRecord } from '../providers/activation/providerActivationLedger';
import {
  PROVIDER_ACTIVATION_EVIDENCE_LEDGER,
  validateProviderActivationEvidenceRecord,
  validateProviderActivationLedger,
} from '../providers/activation/providerActivationLedger';
import {
  buildProviderActivationReport,
  CURRENT_PROVIDER_ACTIVATION_REPORT,
} from '../providers/activation/providerActivationReport';

function bridgeRecord(
  overrides: Partial<ProviderActivationEvidenceRecord> = {},
): ProviderActivationEvidenceRecord {
  return {
    recordId: 'circle-appkit-bridge:e2e:2026-10-10',
    recordedAt: '2026-10-10T07:00:00.000Z',
    recordedBy: 'maintainer:reviewed',
    evidence: {
      providerId: 'circle-appkit-bridge',
      capability: 'BRIDGE',
      environment: 'testnet',
      executedAt: '2026-10-10T06:00:00.000Z',
      adapterVersion: '1.15.2',
      realExecution: true,
      finalStateVerified: true,
      receiptVerified: true,
      signatureBudgetVerified: true,
      recoveryVerified: true,
      duplicatePreventionVerified: true,
      evidenceRefs: ['tx:0xabc', 'receipt:verified'],
    },
    ...overrides,
  };
}

describe('Phase 4D activation evidence ledger', () => {
  it('contains no fabricated Phase 4D E2E evidence by default', () => {
    expect(PROVIDER_ACTIVATION_EVIDENCE_LEDGER).toEqual([]);
    expect(validateProviderActivationLedger(
      PROVIDER_MANIFEST,
      PROVIDER_ACTIVATION_EVIDENCE_LEDGER,
    )).toEqual([]);
  });

  it('accepts a structurally valid reviewed bridge evidence record', () => {
    const entry = findManifestEntry('circle-appkit-bridge')!;
    expect(validateProviderActivationEvidenceRecord(entry, bridgeRecord())).toEqual([]);
  });

  it('rejects an evidence record for the wrong adapter version', () => {
    const entry = findManifestEntry('circle-appkit-bridge')!;
    const record = bridgeRecord({
      evidence: {
        ...bridgeRecord().evidence,
        adapterVersion: '1.15.1',
      },
    });

    expect(validateProviderActivationEvidenceRecord(entry, record))
      .toContain('ADAPTER_VERSION_MISMATCH');
  });

  it('rejects structurally present but unverified activation claims', () => {
    const entry = findManifestEntry('circle-appkit-bridge')!;
    const record = bridgeRecord({
      evidence: {
        ...bridgeRecord().evidence,
        realExecution: false,
        finalStateVerified: false,
        receiptVerified: false,
        signatureBudgetVerified: false,
        recoveryVerified: false,
        duplicatePreventionVerified: false,
      },
    });

    const errors = validateProviderActivationEvidenceRecord(entry, record);
    expect(errors).toContain('REAL_EXECUTION_REQUIRED');
    expect(errors).toContain('FINAL_STATE_VERIFICATION_REQUIRED');
    expect(errors).toContain('RECEIPT_VERIFICATION_REQUIRED');
    expect(errors).toContain('SIGNATURE_BUDGET_VERIFICATION_REQUIRED');
    expect(errors).toContain('DUPLICATE_PREVENTION_VERIFICATION_REQUIRED');
    expect(errors).toContain('RECOVERY_VERIFICATION_REQUIRED');
  });

  it('rejects duplicate audit record IDs', () => {
    const record = bridgeRecord();
    const errors = validateProviderActivationLedger(
      PROVIDER_MANIFEST,
      [record, record],
    );
    expect(errors).toContain(`DUPLICATE_RECORD_ID:${record.recordId}`);
  });
});

describe('Phase 4D provider activation report', () => {
  it('reports current App Kit and StableFX candidates as awaiting real E2E', () => {
    for (const providerId of [
      'circle-stablefx',
      'circle-appkit-unified-balance',
      'circle-appkit-bridge',
      'circle-appkit-swap',
      'circle-appkit-earn',
    ]) {
      const row = CURRENT_PROVIDER_ACTIVATION_REPORT.find(
        (candidate) => candidate.providerId === providerId,
      );
      expect(row).toBeDefined();
      expect(row!.status).toBe('AWAITING_E2E');
      expect(row!.enabled).toBe(false);
    }
  });

  it('keeps mainnet candidates on a separate production activation path', () => {
    for (const providerId of ['mainnet-usdc-transfer', 'cctp-v2-mainnet']) {
      const row = CURRENT_PROVIDER_ACTIVATION_REPORT.find(
        (candidate) => candidate.providerId === providerId,
      );
      expect(row).toBeDefined();
      expect(row!.status).toBe('MAINNET_SEPARATE_ACTIVATION');
      expect(row!.enabled).toBe(false);
      expect(row!.missing).toContain('separateProductionActivation');
    }
  });

  it('reports already-enabled testnet providers without asking for a new promotion', () => {
    for (const providerId of [
      'arc-erc20-transfer',
      'viem-simulation',
      'arc-portfolio-read',
      'cctp-v2-bridge',
    ]) {
      const row = CURRENT_PROVIDER_ACTIVATION_REPORT.find(
        (candidate) => candidate.providerId === providerId,
      );
      expect(row).toBeDefined();
      expect(row!.status).toBe('ENABLED');
      expect(row!.missing).toEqual([]);
    }
  });

  it('moves a fully evidenced IMPLEMENTED bridge to TESTED review readiness without enabling it', () => {
    const rows = buildProviderActivationReport(
      PROVIDER_MANIFEST,
      [bridgeRecord()],
    );
    const row = rows.find((candidate) => candidate.providerId === 'circle-appkit-bridge')!;

    expect(row.status).toBe('READY_FOR_TESTED_REVIEW');
    expect(row.enabled).toBe(false);
    expect(row.matchedCapabilities).toContain('BRIDGE');
    expect(row.nextAction).toMatch(/IMPLEMENTED to TESTED/i);
  });
});
