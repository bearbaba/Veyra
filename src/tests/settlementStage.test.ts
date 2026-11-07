import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { settlementStageView, type SettlementStep } from '../lib/settlementStage';

const STEPS: SettlementStep[] = ['form', 'loading-fees', 'review', 'approve', 'revalidating', 'execute', 'pending', 'verified', 'confirmed', 'error'];

describe('Settlement lifecycle mapping', () => {
  it('follows Enter, Review, Confirm, Processing, Verified in order', () => {
    expect(settlementStageView('form')?.stage).toBe('Enter details');
    expect(settlementStageView('review')?.stage).toBe('Review');
    for (const step of ['approve', 'revalidating', 'execute'] as const) {
      expect(settlementStageView(step)?.stage).toBe('Confirm in wallet');
    }
    expect(settlementStageView('pending')?.stage).toBe('Processing');
    expect(settlementStageView('verified')?.stage).toBe('Verified');
  });
  it('only a fully verified payment reaches the Verified stage', () => {
    const verified = STEPS.filter(step => settlementStageView(step)?.stage === 'Verified');
    expect(verified).toEqual(['verified']);
  });
  it('treats submitted and confirmed-but-unverified payments as unresolved', () => {
    expect(settlementStageView('pending')?.stalled).toBe(true);
    expect(settlementStageView('confirmed')).toEqual({ stage: 'Processing', stalled: true });
  });
  it('shows no progress for a blocked transaction', () => {
    expect(settlementStageView('error')).toBeNull();
  });
  it('is wired into the Settlement page without a second step definition', () => {
    const page = readFileSync(new URL('../components/pages/SettlementPage.tsx', import.meta.url), 'utf8');
    expect(page).toContain('type Step = SettlementStep;');
    expect(page).toContain('<TxStepper stage={stageView.stage} stalled={stageView.stalled} />');
  });
});
