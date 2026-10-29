import { describe, expect, it } from 'vitest';
import { canDiscardConvertDraft, convertErrorState } from '../core/pipeline/convertRecoveryPolicy';

describe('Swap unknown-broadcast outcome recovery', () => {
  it('reports transport errors after broadcast as pending, not as a failed trade', () => {
    expect(convertErrorState(true)).toBe('SETTLEMENT_PENDING');
    expect(convertErrorState(false)).toBe('FAILED');
  });

  it('does not let asset edit / reset create a second trade during signing or funding', () => {
    for (const status of ['SIGNING','BROADCASTING','VERIFYING','SETTLEMENT_PENDING'] as const) {
      expect(canDiscardConvertDraft(status)).toBe(false);
    }
    expect(canDiscardConvertDraft('FAILED')).toBe(true);
    expect(canDiscardConvertDraft('PENDING')).toBe(true);
    expect(canDiscardConvertDraft('AWAITING_APPROVAL')).toBe(true);
  });
});
