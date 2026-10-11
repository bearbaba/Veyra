import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, type TransactionReceipt } from 'viem';
import {
  extractUniqueCctpSourceMessage,
  parseUniqueCctpAttestationResponse,
  verifyCctpSourceReceiptEvidence,
} from '../providers/cctp/cctpV2Adapter';
import { sourceReceiptContainsCctpMessage } from '../../server/services/activityReceiptVerificationService.js';
import { MANIFEST_CONSTANTS } from '../providers/registry/providerManifest';

const MESSAGE_SENT_TOPIC =
  '0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036';
const MESSAGE = '0x12345678' as const;
const OTHER_MESSAGE = '0xaabbccdd' as const;

function messageLog(message: `0x${string}`): { address: string; topics: string[]; data: `0x${string}` } {
  return {
    address: MANIFEST_CONSTANTS.CCTP_V2_MESSAGE_TRANSMITTER,
    topics: [MESSAGE_SENT_TOPIC],
    data: encodeAbiParameters([{ type: 'bytes' }], [message]),
  };
}

function source(logs: Array<ReturnType<typeof messageLog>>): Pick<TransactionReceipt, 'status' | 'logs'> {
  return { status: 'success', logs } as unknown as Pick<TransactionReceipt, 'status' | 'logs'>;
}

describe('Phase 5 CCTP unique source message/attestation selection', () => {
  it('strictly decodes the one canonical MessageSent and matches attested bytes', () => {
    const receipt = source([messageLog(MESSAGE)]);
    expect(extractUniqueCctpSourceMessage(receipt)).toBe(MESSAGE);
    expect(sourceReceiptContainsCctpMessage(receipt, MESSAGE)).toBe(true);
    expect(sourceReceiptContainsCctpMessage(receipt, OTHER_MESSAGE)).toBe(false);
    expect(verifyCctpSourceReceiptEvidence(receipt).verified).toBe(true);
  });

  it('rejects two messages even if one matches the Circle response', () => {
    for (const receipt of [
      source([messageLog(MESSAGE), messageLog(OTHER_MESSAGE)]),
      source([messageLog(MESSAGE), messageLog(MESSAGE)]),
    ]) {
      expect(extractUniqueCctpSourceMessage(receipt)).toBeNull();
      expect(sourceReceiptContainsCctpMessage(receipt, MESSAGE)).toBe(false);
      expect(verifyCctpSourceReceiptEvidence(receipt).verified).toBe(false);
    }
  });

  it('rejects malformed, missing, reverted, and wrong-emitter MessageSent logs', () => {
    const good = messageLog(MESSAGE);
    const malformed = source([{ ...good, data: '0x1234' }]);
    const unrelated = source([
      { ...good, address: MANIFEST_CONSTANTS.CCTP_V2_TOKEN_MESSENGER },
    ]);
    const reverted = {
      ...source([good]),
      status: 'reverted' as const,
    };

    expect(extractUniqueCctpSourceMessage(malformed)).toBeNull();
    expect(extractUniqueCctpSourceMessage(unrelated)).toBeNull();
    expect(extractUniqueCctpSourceMessage(reverted)).toBeNull();
    expect(extractUniqueCctpSourceMessage(source([]))).toBeNull();
    expect(verifyCctpSourceReceiptEvidence(malformed).verified).toBe(false);
  });

  it('parses a complete unique Circle message and retains pending status', () => {
    expect(parseUniqueCctpAttestationResponse({
      messages: [{ status: 'complete', message: MESSAGE, attestation: '0xabcdef' }],
    })).toEqual({ status: 'complete', message: MESSAGE, attestation: '0xabcdef' });
    expect(parseUniqueCctpAttestationResponse({ messages: [] }))
      .toEqual({ status: 'pending' });
    expect(parseUniqueCctpAttestationResponse({
      messages: [{ status: 'pending' }],
    })).toEqual({ status: 'pending' });
  });

  it('fails closed for multiple Circle messages and malformed complete attestation', () => {
    const valid = { status: 'complete', message: MESSAGE, attestation: '0xabcdef' };
    for (const payload of [
      { messages: [valid, valid] },
      { messages: [valid, { status: 'pending' }] },
      { messages: [valid, { status: 'complete', message: OTHER_MESSAGE, attestation: '0x1234' }] },
      { messages: [null] },
      { messages: [42] },
      { messages: [ { ...valid, message: '0x123' } ] },
      { messages: [ { ...valid, attestation: '0x' } ] },
      { messages: 'not-an-array' },
      { error: 'invalid' },
      null,
    ]) {
      expect(() => parseUniqueCctpAttestationResponse(payload)).toThrow();
    }
  });
});
