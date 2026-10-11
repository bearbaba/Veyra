import { describe, expect, it } from 'vitest';
import {
  excludeAuthoritativelyResolvedBridgeCheckpoints,
  type BridgeRecoveryCheckpoint,
} from '../core/execution/bridgeCheckpointStore';

function checkpoint(planId: string): BridgeRecoveryCheckpoint {
  return {
    planId,
    stage: 'DESTINATION_BROADCAST',
    burnTxHash: `0x${'1'.repeat(64)}`,
    sourceChainId: 5042002,
    destinationChainId: 11155111,
    walletAddress: '0x1111111111111111111111111111111111111111',
    recipientAddress: '0x2222222222222222222222222222222222222222',
    amount: '1000000',
    tokenAddress: '0x3600000000000000000000000000000000000000',
    balanceBefore: '0',
    attestationMessage: '0x1234',
    attestationSignature: '0xabcd',
    receiveTxHash: `0x${'2'.repeat(64)}`,
    createdAt: 1000,
    updatedAt: 1001,
  };
}

describe('Phase 5 authoritative recovery candidate suppression', () => {
  it('hides an old recovery checkpoint after authenticated COMPLETE', () => {
    const a = checkpoint('completed-plan');
    const b = checkpoint('in-flight-plan');
    expect(excludeAuthoritativelyResolvedBridgeCheckpoints(
      [a, b],
      [
        { providerId: 'cctp-v2-bridge', routeId: a.planId, status: 'COMPLETE' },
        { providerId: 'cctp-v2-bridge', routeId: b.planId, status: 'CONFIRMED' },
      ],
    )).toEqual([b]);
  });

  it('hides only independently verified reverted-source FAILED receipts', () => {
    const verified = checkpoint('verified-revert');
    const uncertain = checkpoint('uncertain-failure');
    expect(excludeAuthoritativelyResolvedBridgeCheckpoints(
      [verified, uncertain],
      [
        {
          providerId: 'cctp-v2-bridge',
          routeId: verified.planId,
          status: 'FAILED',
          failureReason: 'SOURCE_TRANSACTION_REVERTED_VERIFIED',
        },
        {
          providerId: 'cctp-v2-bridge',
          routeId: uncertain.planId,
          status: 'FAILED',
          failureReason: 'RPC_TIMEOUT',
        },
      ],
    )).toEqual([uncertain]);
  });

  it('never accepts unrelated providers or nonterminal statuses as closure', () => {
    const target = checkpoint('same-route');
    expect(excludeAuthoritativelyResolvedBridgeCheckpoints(
      [target],
      [
        { providerId: 'circle-appkit-bridge', routeId: target.planId, status: 'COMPLETE' },
        { providerId: 'cctp-v2-bridge', routeId: target.planId, status: 'RECEIVE_FAILED_RETRYABLE' },
        { providerId: 'cctp-v2-bridge', routeId: 'another-plan', status: 'COMPLETE' },
      ],
    )).toEqual([target]);
  });
});
