/**
 * Maps the Settlement flow's internal step onto the shared transaction
 * lifecycle shown by TxStepper. Presentation only: it never decides whether a
 * payment happened.
 */
import type { TxStage } from '@/components/ui/primitives';

export type SettlementStep =
  | 'form'
  | 'loading-fees'
  | 'review'
  | 'approve'
  | 'revalidating'
  | 'execute'
  | 'pending'
  | 'verified'
  | 'confirmed'
  | 'error';

export interface StageView {
  stage: TxStage;
  /** True while the outcome is unresolved; the stepper then warns against a second submission. */
  stalled: boolean;
}

export function settlementStageView(step: SettlementStep): StageView | null {
  switch (step) {
    case 'form':
      return { stage: 'Enter details', stalled: false };
    case 'loading-fees':
    case 'review':
      return { stage: 'Review', stalled: false };
    case 'approve':
    case 'revalidating':
    case 'execute':
      return { stage: 'Confirm in wallet', stalled: false };
    case 'pending':
      return { stage: 'Processing', stalled: true };
    case 'verified':
      return { stage: 'Verified', stalled: false };
    // Confirmed onchain but one or more checks failed: never presented as Verified.
    case 'confirmed':
      return { stage: 'Processing', stalled: true };
    case 'error':
      return null;
  }
}
