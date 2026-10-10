import { describe, expect, it } from 'vitest';
import {
  analyzeAppKitBridgeRecovery,
  assertRetryBridgeAllowed,
} from '../core/router/bridgeRecovery';

describe('Phase 4B App Kit bridge recovery', () => {
  it('requires retryBridge after source burn succeeds', () => {
    const result = {
      state: 'error',
      steps: [
        { name: 'approve', state: 'success', txHash: '0xapprove' },
        { name: 'burn', state: 'success', txHash: '0xburn' },
        { name: 'fetchAttestation', state: 'error', error: 'timeout' },
      ],
    };
    const recovery = analyzeAppKitBridgeRecovery(result);
    expect(recovery.mode).toBe('RETRY_BRIDGE');
    expect(recovery.fundsInFlight).toBe(true);
    expect(recovery.sourceTransferSubmitted).toBe(true);
    expect(() => assertRetryBridgeAllowed(result)).not.toThrow();
  });

  it('detects CCTPx transfer submission from tx hash even before success state', () => {
    const result = {
      state: 'error',
      steps: [
        { name: 'approve', state: 'success', txHash: '0xapprove' },
        { name: 'transfer', state: 'error', txHash: '0xsubmitted', error: 'forward timeout' },
      ],
    };
    const recovery = analyzeAppKitBridgeRecovery(result);
    expect(recovery.mode).toBe('RETRY_BRIDGE');
    expect(recovery.sourceTransferSubmitted).toBe(true);
  });

  it('permits a fresh review only when no source transfer was submitted', () => {
    const result = {
      state: 'error',
      steps: [
        { name: 'approve', state: 'error', error: 'user rejected' },
      ],
    };
    const recovery = analyzeAppKitBridgeRecovery(result);
    expect(recovery.mode).toBe('START_NEW_AFTER_FIX');
    expect(recovery.fundsInFlight).toBe(false);
    expect(() => assertRetryBridgeAllowed(result)).toThrow(/retry is not allowed/i);
  });

  it('does not retry a successful result', () => {
    const result = {
      state: 'success',
      steps: [
        { name: 'burn', state: 'success', txHash: '0xburn' },
        { name: 'mint', state: 'success', txHash: '0xmint' },
      ],
    };
    const recovery = analyzeAppKitBridgeRecovery(result);
    expect(recovery.mode).toBe('NONE');
    expect(recovery.nextAction).toMatch(/verify destination state/i);
  });
});
