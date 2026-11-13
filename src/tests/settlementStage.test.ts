import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TX_DISPLAY_STEPS, TxStepper, txDisplayStep } from '../components/ui/primitives';
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

describe('Compact Pay progress: Complete is a verified milestone, never a premature success', () => {
  it('uses Review → Confirm → Complete for the user-facing milestone names', () => {
    expect(TX_DISPLAY_STEPS).toEqual(['Review', 'Confirm', 'Complete']);
    expect(txDisplayStep('Review')).toBe('Review');
    expect(txDisplayStep('Confirm in wallet')).toBe('Confirm');
    expect(txDisplayStep('Verified')).toBe('Complete');
    const initial = renderToStaticMarkup(createElement(TxStepper, {stage:'Review'}));
    expect(initial).toContain('>Complete</span>');
    expect(initial).toContain('Review amount, recipient and fees.');
  });
  it('keeps processing and unknown outcomes explicitly unverified', () => {
    const processing = renderToStaticMarkup(createElement(TxStepper, {stage:'Processing'}));
    expect(processing).toContain('>Processing</span>');
    expect(processing).not.toContain('>Complete</span>');
    expect(processing).toContain('Processing. Awaiting onchain verification.');
    const unresolved = renderToStaticMarkup(createElement(TxStepper, {stage:'Processing', stalled:true}));
    expect(unresolved).toContain('>Pending</span>');
    expect(unresolved).not.toContain('>Complete</span>');
    expect(unresolved).toContain('Outcome unresolved. Do not submit again.');
  });
  it('marks Complete only after independently verified receipt', () => {
    const verified = renderToStaticMarkup(createElement(TxStepper, {stage:'Verified'}));
    expect(verified).toContain('>Complete</span>');
    expect(verified).toContain('Transaction verified onchain');
    expect(verified).not.toContain('>Pending</span>');
  });
});
