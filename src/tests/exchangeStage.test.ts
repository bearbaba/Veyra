import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exchangeStageView, type RecoveryStatus } from '../mainnet/exchangeStage';

const base = { hasLiveQuote: false, busy: false, recoveryStatus: null, unknownStorage: false } as const;

describe('Swap/Bridge lifecycle stage', () => {
  it('starts at Enter details, moves to Review with a live quote, then Confirm in wallet while signing', () => {
    expect(exchangeStageView(base)).toEqual({ stage: 'Enter details', stalled: false });
    expect(exchangeStageView({ ...base, busy: true })).toEqual({ stage: 'Enter details', stalled: false });   // fetching a quote
    expect(exchangeStageView({ ...base, hasLiveQuote: true })).toEqual({ stage: 'Review', stalled: false });
    expect(exchangeStageView({ ...base, hasLiveQuote: true, busy: true })).toEqual({ stage: 'Confirm in wallet', stalled: false });
  });

  it('an unresolved operation is Processing and flagged, whatever else is on screen', () => {
    for (const recoveryStatus of ['UNKNOWN', 'PENDING'] as RecoveryStatus[]) {
      for (const hasLiveQuote of [true, false]) {
        expect(exchangeStageView({ ...base, hasLiveQuote, recoveryStatus })).toEqual({ stage: 'Processing', stalled: true });
      }
    }
    expect(exchangeStageView({ ...base, unknownStorage: true })).toEqual({ stage: 'Processing', stalled: true });
  });

  it('Verified comes only from a VERIFIED recovery record, never from quote or busy state', () => {
    const verifiedWays: string[] = [];
    for (const hasLiveQuote of [true, false]) for (const busy of [true, false]) for (const unknownStorage of [true, false]) {
      for (const recoveryStatus of [null, 'UNKNOWN', 'PENDING', 'REVERTED', 'VERIFIED'] as const) {
        if (exchangeStageView({ hasLiveQuote, busy, recoveryStatus, unknownStorage })?.stage === 'Verified') verifiedWays.push(String(recoveryStatus));
      }
    }
    expect(new Set(verifiedWays)).toEqual(new Set(['VERIFIED']));
  });

  it('a reverted transaction shows no progress bar (it has its own message)', () => {
    expect(exchangeStageView({ ...base, recoveryStatus: 'REVERTED' })).toBeNull();
  });

  it('the Exchange component renders it from its own state', () => {
    const circle = readFileSync(new URL('../components/pages/MainnetCirclePage.tsx', import.meta.url), 'utf8');
    expect(circle).toContain('exchangeStageView({');
    expect(circle).toContain('<TxStepper stage=');
  });
});
