/**
 * Tests: src/core/receipt/receiptId.ts
 */
import { describe, it, expect } from 'vitest';
import {
  generateUUIDv4,
  generatePlanReceiptId,
  generateExecutionReceiptId,
  generateFallbackReceiptId,
  isValidReceiptId,
  isPlanReceiptId,
  isExecutionReceiptId,
} from '../core/receipt/receiptId.js';

describe('generateUUIDv4', () => {
  it('generates a valid UUID v4 format', () => {
    const id = generateUUIDv4();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('generates unique values', () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateUUIDv4()));
    expect(ids.size).toBe(20);
  });
});

describe('generatePlanReceiptId', () => {
  it('starts with veyra-plan-', () => {
    expect(generatePlanReceiptId()).toMatch(/^veyra-plan-/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 20 }, () => generatePlanReceiptId()));
    expect(ids.size).toBe(20);
  });

  it('is detected as a plan ID', () => {
    expect(isPlanReceiptId(generatePlanReceiptId())).toBe(true);
  });
});

describe('generateExecutionReceiptId', () => {
  it('starts with veyra-', () => {
    const id = generateExecutionReceiptId(5042002, '0xabc123');
    expect(id).toMatch(/^veyra-/);
  });

  it('is deterministic for same inputs', () => {
    const id1 = generateExecutionReceiptId(5042002, '0xdeadbeef');
    const id2 = generateExecutionReceiptId(5042002, '0xdeadbeef');
    expect(id1).toBe(id2);
  });

  it('differs for different txHashes', () => {
    const id1 = generateExecutionReceiptId(5042002, '0xaaa');
    const id2 = generateExecutionReceiptId(5042002, '0xbbb');
    expect(id1).not.toBe(id2);
  });

  it('differs for different chainIds', () => {
    const id1 = generateExecutionReceiptId(1, '0xaaa');
    const id2 = generateExecutionReceiptId(5042002, '0xaaa');
    expect(id1).not.toBe(id2);
  });

  it('is detected as an execution ID', () => {
    const id = generateExecutionReceiptId(5042002, '0xdeadbeef12345678');
    expect(isExecutionReceiptId(id)).toBe(true);
  });
});

describe('generateFallbackReceiptId', () => {
  it('starts with veyra-', () => {
    expect(generateFallbackReceiptId()).toMatch(/^veyra-/);
  });

  it('generates unique values', () => {
    const ids = new Set(Array.from({ length: 10 }, () => generateFallbackReceiptId()));
    expect(ids.size).toBe(10);
  });
});

describe('isValidReceiptId', () => {
  it('returns true for valid veyra- IDs', () => {
    expect(isValidReceiptId('veyra-abc123')).toBe(true);
    expect(isValidReceiptId(generatePlanReceiptId())).toBe(true);
    expect(isValidReceiptId(generateFallbackReceiptId())).toBe(true);
  });

  it('returns false for invalid IDs', () => {
    expect(isValidReceiptId('receipt-123')).toBe(false);
    expect(isValidReceiptId('')).toBe(false);
    expect(isValidReceiptId('veyra-')).toBe(false); // too short
  });
});

describe('ID classification', () => {
  it('isPlanReceiptId is false for non-plan IDs', () => {
    expect(isPlanReceiptId('veyra-abc123')).toBe(false);
    expect(isPlanReceiptId(generateFallbackReceiptId())).toBe(false);
  });
});
