/**
 * Phase 1 — dedup_key construction tests (amendments 4 & 5)
 * Covers: 9-axis uniqueness, environment separation, determinism,
 * clientIntentId validation, collision resistance.
 */
import { describe, it, expect } from 'vitest';
import { buildDedupKey, type DedupParams } from '../../server/db/dedup.js';
import { isValidClientIntentId, newClientIntentId } from '../../server/db/ids.js';

const BASE_PARAMS: DedupParams = {
  environment:         'testnet',
  senderAddress:       '0x4c7cb73ac8f8999af21cfc9ff4cf2333a9508dcb',
  recipientSnapshotId: 'snp_abc123',
  amountRaw:           '1000000',
  assetId:             'usdc',
  sourceChainId:       5042002,
  destinationChainId:  11155111,
  providerId:          'cctp-v2-bridge',
  clientIntentId:      '550e8400-e29b-41d4-a716-446655440000',
};

describe('buildDedupKey', () => {
  it('produces a 64-char hex string (SHA-256)', () => {
    const key = buildDedupKey(BASE_PARAMS);
    expect(key).toHaveLength(64);
    expect(key).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic for the same inputs', () => {
    expect(buildDedupKey(BASE_PARAMS)).toBe(buildDedupKey(BASE_PARAMS));
  });

  it('differs when environment changes (amendment 4)', () => {
    const testnetKey = buildDedupKey({ ...BASE_PARAMS, environment: 'testnet' });
    const mainnetKey = buildDedupKey({ ...BASE_PARAMS, environment: 'mainnet' });
    expect(testnetKey).not.toBe(mainnetKey);
  });

  it('differs when senderAddress changes', () => {
    const k1 = buildDedupKey(BASE_PARAMS);
    const k2 = buildDedupKey({ ...BASE_PARAMS, senderAddress: '0xdeadbeef00000000000000000000000000000001' });
    expect(k1).not.toBe(k2);
  });

  it('differs when recipientSnapshotId changes', () => {
    const k1 = buildDedupKey(BASE_PARAMS);
    const k2 = buildDedupKey({ ...BASE_PARAMS, recipientSnapshotId: 'snp_different' });
    expect(k1).not.toBe(k2);
  });

  it('differs when amountRaw changes', () => {
    const k1 = buildDedupKey(BASE_PARAMS);
    const k2 = buildDedupKey({ ...BASE_PARAMS, amountRaw: '2000000' });
    expect(k1).not.toBe(k2);
  });

  it('differs when assetId changes', () => {
    const k1 = buildDedupKey(BASE_PARAMS);
    const k2 = buildDedupKey({ ...BASE_PARAMS, assetId: 'eurc' });
    expect(k1).not.toBe(k2);
  });

  it('differs when sourceChainId changes', () => {
    const k1 = buildDedupKey(BASE_PARAMS);
    const k2 = buildDedupKey({ ...BASE_PARAMS, sourceChainId: 1 });
    expect(k1).not.toBe(k2);
  });

  it('differs when destinationChainId changes', () => {
    const k1 = buildDedupKey(BASE_PARAMS);
    const k2 = buildDedupKey({ ...BASE_PARAMS, destinationChainId: 8453 });
    expect(k1).not.toBe(k2);
  });

  it('differs when providerId changes', () => {
    const k1 = buildDedupKey(BASE_PARAMS);
    const k2 = buildDedupKey({ ...BASE_PARAMS, providerId: 'across-bridge' });
    expect(k1).not.toBe(k2);
  });

  it('differs when clientIntentId changes (amendment 5)', () => {
    const k1 = buildDedupKey(BASE_PARAMS);
    const k2 = buildDedupKey({ ...BASE_PARAMS, clientIntentId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8' });
    expect(k1).not.toBe(k2);
  });

  it('is insensitive to key ordering in params object', () => {
    // Different key insertion order should produce the same key (sorted JSON)
    const reordered: DedupParams = {
      clientIntentId:      BASE_PARAMS.clientIntentId,
      environment:         BASE_PARAMS.environment,
      senderAddress:       BASE_PARAMS.senderAddress,
      recipientSnapshotId: BASE_PARAMS.recipientSnapshotId,
      amountRaw:           BASE_PARAMS.amountRaw,
      assetId:             BASE_PARAMS.assetId,
      sourceChainId:       BASE_PARAMS.sourceChainId,
      destinationChainId:  BASE_PARAMS.destinationChainId,
      providerId:          BASE_PARAMS.providerId,
    };
    expect(buildDedupKey(BASE_PARAMS)).toBe(buildDedupKey(reordered));
  });
});

describe('clientIntentId validation (amendment 5)', () => {
  it('newClientIntentId() produces a valid UUID v4', () => {
    const id = newClientIntentId();
    expect(isValidClientIntentId(id)).toBe(true);
  });

  it('accepts valid UUID v4', () => {
    expect(isValidClientIntentId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('rejects timestamp-derived strings', () => {
    expect(isValidClientIntentId('1728389012345')).toBe(false);
  });

  it('rejects UUID v1 (different version digit)', () => {
    // UUID v1 has version digit '1', not '4'
    expect(isValidClientIntentId('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidClientIntentId('')).toBe(false);
  });

  it('rejects arbitrary string', () => {
    expect(isValidClientIntentId('not-a-uuid')).toBe(false);
  });

  it('produces unique IDs on repeated calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newClientIntentId()));
    expect(ids.size).toBe(100);
  });
});
