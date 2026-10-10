import { describe, expect, it } from 'vitest';
import {
  BridgeRecoveryConflictError,
  evaluateBridgeRelayDecision,
  mergeBridgeRecoveryCheckpoint,
  type BridgeRecoveryInput,
} from '../../server/db/repositories/bridgeRecoveryRepository';

function checkpoint(
  stage: BridgeRecoveryInput['stage'] = 'SOURCE_BROADCAST',
): BridgeRecoveryInput {
  return {
    planId: 'veyra-plan-durable-test',
    stage,
    burnTxHash: '0x' + '11'.repeat(32),
    sourceChainId: 5042002,
    destinationChainId: 11155111,
    walletAddress: '0x1111111111111111111111111111111111111111',
    recipientAddress: '0x2222222222222222222222222222222222222222',
    amount: '1000000',
    tokenAddress: '0x3600000000000000000000000000000000000000',
    balanceBefore: '9000000',
    createdAt: 1000,
    updatedAt: 1000,
  };
}

describe('Phase 4C durable bridge recovery merge', () => {
  it('accepts advancement while preserving immutable source execution', () => {
    const existing = checkpoint('SOURCE_BROADCAST');
    const incoming = {
      ...checkpoint('SOURCE_CONFIRMED'),
      updatedAt: 2000,
    };

    const merged = mergeBridgeRecoveryCheckpoint(existing, incoming);
    expect(merged.stage).toBe('SOURCE_CONFIRMED');
    expect(merged.burnTxHash).toBe(existing.burnTxHash);
  });

  it('rejects stage regression', () => {
    const existing = {
      ...checkpoint('SOURCE_CONFIRMED'),
      updatedAt: 2000,
    };
    expect(() =>
      mergeBridgeRecoveryCheckpoint(existing, checkpoint('SOURCE_BROADCAST')),
    ).toThrow(BridgeRecoveryConflictError);
  });

  it('rejects any attempt to replace the source burn', () => {
    const incoming = {
      ...checkpoint('SOURCE_CONFIRMED'),
      burnTxHash: '0x' + '22'.repeat(32),
      updatedAt: 2000,
    };
    expect(() =>
      mergeBridgeRecoveryCheckpoint(checkpoint(), incoming),
    ).toThrow(/burnTxHash/i);
  });

  it('requires attestation evidence before ATTESTATION_READY', () => {
    expect(() =>
      mergeBridgeRecoveryCheckpoint(null, checkpoint('ATTESTATION_READY')),
    ).toThrow(/Attestation/i);
  });

  it('requires a receive hash before DESTINATION_BROADCAST', () => {
    const value = {
      ...checkpoint('DESTINATION_BROADCAST'),
      attestationMessage: '0x1234',
      attestationSignature: '0xabcd',
    };
    expect(() =>
      mergeBridgeRecoveryCheckpoint(null, value),
    ).toThrow(/receiveTxHash/i);
  });

  it('allows relay only from ATTESTATION_READY and uses persisted evidence', () => {
    const ready = {
      ...checkpoint('ATTESTATION_READY'),
      attestationMessage: '0x1234',
      attestationSignature: '0xabcd',
      updatedAt: 2000,
    };

    expect(evaluateBridgeRelayDecision(ready)).toEqual({
      mode: 'SUBMIT',
      destinationChainId: ready.destinationChainId,
      message: '0x1234',
      attestation: '0xabcd',
    });

    expect(() =>
      evaluateBridgeRelayDecision(checkpoint('SOURCE_CONFIRMED')),
    ).toThrow(/not allowed/i);
  });

  it('returns the existing destination tx instead of relaying twice', () => {
    const broadcast = {
      ...checkpoint('DESTINATION_BROADCAST'),
      attestationMessage: '0x1234',
      attestationSignature: '0xabcd',
      receiveTxHash: '0x' + '33'.repeat(32),
      updatedAt: 2000,
    };

    expect(evaluateBridgeRelayDecision(broadcast)).toEqual({
      mode: 'ALREADY_SUBMITTED',
      destinationChainId: broadcast.destinationChainId,
      receiveTxHash: broadcast.receiveTxHash,
    });
  });

  it('keeps previously persisted evidence when later updates omit it', () => {
    const existing = {
      ...checkpoint('ATTESTATION_READY'),
      attestationMessage: '0x1234',
      attestationSignature: '0xabcd',
      updatedAt: 2000,
    };
    const incoming = {
      ...checkpoint('ATTESTATION_READY'),
      updatedAt: 3000,
      attestationMessage: '0x1234',
      attestationSignature: '0xabcd',
    };
    const merged = mergeBridgeRecoveryCheckpoint(existing, incoming);
    expect(merged.attestationMessage).toBe('0x1234');
    expect(merged.attestationSignature).toBe('0xabcd');
  });
});
