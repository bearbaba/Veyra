import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getBridgeCheckpoint,
  loadResumableBridgeCheckpoints,
  nextBridgeResumeInstruction,
  parseBridgeRecoveryCheckpoint,
  reconcileBridgeRecoveryCandidates,
  resetBridgeCheckpointStoreForTesting,
  saveBridgeCheckpoint,
  type BridgeRecoveryCheckpoint,
} from '../core/execution/bridgeCheckpointStore';

function checkpoint(
  stage: BridgeRecoveryCheckpoint['stage'],
): BridgeRecoveryCheckpoint {
  return {
    planId: 'veyra-plan-test',
    stage,
    burnTxHash: '0x' + '11'.repeat(32),
    sourceChainId: 5042002,
    destinationChainId: 11155111,
    walletAddress: '0x1111111111111111111111111111111111111111',
    recipientAddress: '0x2222222222222222222222222222222222222222',
    amount: '1000000',
    tokenAddress: '0x3600000000000000000000000000000000000000',
    balanceBefore: '10000000',
    createdAt: 1,
    updatedAt: 1,
  };
}

beforeEach(async () => {
  await resetBridgeCheckpointStoreForTesting();
});

describe('Phase 4C bridge recovery checkpoints', () => {
  it('persists a source burn checkpoint across reads', async () => {
    const value = checkpoint('SOURCE_BROADCAST');
    await saveBridgeCheckpoint(value);
    expect(await getBridgeCheckpoint(value.planId)).toEqual(value);
  });

  it('never returns an instruction to burn again after a burn exists', () => {
    const stages: BridgeRecoveryCheckpoint['stage'][] = [
      'SOURCE_BROADCAST',
      'SOURCE_CONFIRMED',
      'ATTESTATION_READY',
      'DESTINATION_BROADCAST',
      'VERIFIED',
    ];

    for (const stage of stages) {
      expect(nextBridgeResumeInstruction(checkpoint(stage))).not.toBe('REBURN');
    }
  });

  it('resumes source-confirmed bridges by polling attestation', () => {
    expect(nextBridgeResumeInstruction(checkpoint('SOURCE_CONFIRMED')))
      .toBe('POLL_ATTESTATION');
  });

  it('resumes attested bridges at receive instead of source burn', () => {
    expect(nextBridgeResumeInstruction(checkpoint('ATTESTATION_READY')))
      .toBe('SUBMIT_RECEIVE');
  });

  it('only keeps non-verified checkpoints in the resumable list', async () => {
    await saveBridgeCheckpoint(checkpoint('SOURCE_CONFIRMED'));
    await saveBridgeCheckpoint({
      ...checkpoint('VERIFIED'),
      planId: 'veyra-plan-done',
      updatedAt: 2,
    });

    const resumable = await loadResumableBridgeCheckpoints();
    expect(resumable).toHaveLength(1);
    expect(resumable[0].stage).toBe('SOURCE_CONFIRMED');
  });

  it('rejects malformed or incomplete runtime checkpoints', () => {
    const malformed = {
      ...checkpoint('SOURCE_CONFIRMED'),
      burnTxHash: '0x1234',
    };

    expect(parseBridgeRecoveryCheckpoint(malformed)).toBeNull();
  });

  it('drops malformed remote checkpoints during reconciliation', () => {
    const malformedRemote: BridgeRecoveryCheckpoint = {
      ...checkpoint('SOURCE_CONFIRMED'),
      planId: 'remote-malformed',
      recipientAddress: 'not-an-address',
    };

    expect(
      reconcileBridgeRecoveryCandidates([], [malformedRemote]),
    ).toEqual([]);
  });

  it('imports a remote-only checkpoint for cross-device recovery', () => {
    const remote = {
      ...checkpoint('SOURCE_CONFIRMED'),
      updatedAt: 2,
    };
    expect(reconcileBridgeRecoveryCandidates([], [remote])).toEqual([remote]);
  });

  it('takes the more advanced matching checkpoint', () => {
    const local = checkpoint('SOURCE_BROADCAST');
    const remote = {
      ...checkpoint('SOURCE_CONFIRMED'),
      updatedAt: 2,
    };
    expect(reconcileBridgeRecoveryCandidates([local], [remote])[0].stage)
      .toBe('SOURCE_CONFIRMED');
  });

  it('keeps local immutable source execution when a remote row conflicts', () => {
    const local = checkpoint('SOURCE_CONFIRMED');
    const remote = {
      ...checkpoint('ATTESTATION_READY'),
      burnTxHash: '0x' + '22'.repeat(32),
      attestationMessage: '0x1234',
      attestationSignature: '0xabcd',
      updatedAt: 2,
    };
    const merged = reconcileBridgeRecoveryCandidates([local], [remote]);
    expect(merged[0].burnTxHash).toBe(local.burnTxHash);
    expect(merged[0].stage).toBe('SOURCE_CONFIRMED');
  });

});
