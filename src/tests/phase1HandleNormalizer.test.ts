/**
 * Phase 1 — Handle normalizer tests (amendment 1)
 * Covers: case normalization, length limits, allowed chars,
 * Unicode/confusable defense, leading/trailing/consecutive underscores.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeHandle,
  HandleNormalizationError,
} from '../../server/db/handleNormalizer.js';

describe('normalizeHandle', () => {
  // Basic normalization
  it('lowercases ASCII handles', () => {
    expect(normalizeHandle('BearCrypto')).toBe('bearcrypto');
  });

  it('strips leading @ prefix', () => {
    expect(normalizeHandle('@alice')).toBe('alice');
  });

  it('accepts min-length handle (3 chars)', () => {
    expect(normalizeHandle('abc')).toBe('abc');
  });

  it('accepts max-length handle (30 chars)', () => {
    expect(normalizeHandle('a'.repeat(30))).toBe('a'.repeat(30));
  });

  it('accepts handles with digits and underscores', () => {
    expect(normalizeHandle('bear_42')).toBe('bear_42');
  });

  // Length violations
  it('throws TOO_SHORT for 2-char handle', () => {
    expect(() => normalizeHandle('ab')).toThrow(HandleNormalizationError);
    try { normalizeHandle('ab'); } catch (e) {
      expect((e as HandleNormalizationError).code).toBe('TOO_SHORT');
    }
  });

  it('throws TOO_LONG for 31-char handle', () => {
    expect(() => normalizeHandle('a'.repeat(31))).toThrow(HandleNormalizationError);
    try { normalizeHandle('a'.repeat(31)); } catch (e) {
      expect((e as HandleNormalizationError).code).toBe('TOO_LONG');
    }
  });

  // Invalid characters
  it('throws INVALID_CHARACTERS for handle with hyphen', () => {
    expect(() => normalizeHandle('bear-crypto')).toThrow(HandleNormalizationError);
    try { normalizeHandle('bear-crypto'); } catch (e) {
      expect((e as HandleNormalizationError).code).toBe('INVALID_CHARACTERS');
    }
  });

  it('throws INVALID_CHARACTERS for handle with space', () => {
    expect(() => normalizeHandle('bear crypto')).toThrow(HandleNormalizationError);
  });

  it('throws INVALID_CHARACTERS for handle with dot', () => {
    expect(() => normalizeHandle('bear.crypto')).toThrow(HandleNormalizationError);
  });

  // Unicode confusable defense (amendment 1)
  it('throws NON_ASCII for Cyrillic lookalike (а = U+0430)', () => {
    // Cyrillic 'а' looks identical to Latin 'a' but has a different codepoint
    const cyrillicA = '\u0430';
    const handle = `be${cyrillicA}rcrypto`;
    expect(() => normalizeHandle(handle)).toThrow(HandleNormalizationError);
    try { normalizeHandle(handle); } catch (e) {
      expect((e as HandleNormalizationError).code).toBe('NON_ASCII');
    }
  });

  it('throws NON_ASCII for Greek lookalike (ο = U+03BF)', () => {
    const greekO = '\u03BF';
    const handle = `hell${greekO}`;
    expect(() => normalizeHandle(handle)).toThrow(HandleNormalizationError);
    try { normalizeHandle(handle); } catch (e) {
      expect((e as HandleNormalizationError).code).toBe('NON_ASCII');
    }
  });

  it('throws NON_ASCII for emoji in handle', () => {
    expect(() => normalizeHandle('bear🐻')).toThrow(HandleNormalizationError);
    try { normalizeHandle('bear🐻'); } catch (e) {
      expect((e as HandleNormalizationError).code).toBe('NON_ASCII');
    }
  });

  // Underscore rules
  it('throws LEADING_TRAILING_UNDERSCORE for leading underscore', () => {
    expect(() => normalizeHandle('_bear')).toThrow(HandleNormalizationError);
    try { normalizeHandle('_bear'); } catch (e) {
      expect((e as HandleNormalizationError).code).toBe('LEADING_TRAILING_UNDERSCORE');
    }
  });

  it('throws LEADING_TRAILING_UNDERSCORE for trailing underscore', () => {
    expect(() => normalizeHandle('bear_')).toThrow(HandleNormalizationError);
    try { normalizeHandle('bear_'); } catch (e) {
      expect((e as HandleNormalizationError).code).toBe('LEADING_TRAILING_UNDERSCORE');
    }
  });

  it('throws CONSECUTIVE_UNDERSCORES for double underscore', () => {
    expect(() => normalizeHandle('bear__crypto')).toThrow(HandleNormalizationError);
    try { normalizeHandle('bear__crypto'); } catch (e) {
      expect((e as HandleNormalizationError).code).toBe('CONSECUTIVE_UNDERSCORES');
    }
  });

  // Edge cases
  it('accepts handle starting with digit', () => {
    expect(normalizeHandle('42bears')).toBe('42bears');
  });

  it('handles uppercase + underscore combo correctly', () => {
    expect(normalizeHandle('Bear_Crypto')).toBe('bear_crypto');
  });
});
