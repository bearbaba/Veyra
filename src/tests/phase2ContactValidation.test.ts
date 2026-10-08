import { describe, expect, it } from 'vitest';
import { ContactError } from '../../server/services/contactService';

describe('Phase 2D contact errors', () => {
  it('preserves stable error code', () => {
    const err = new ContactError('INVALID_ALIAS', 'bad alias');
    expect(err.code).toBe('INVALID_ALIAS');
    expect(err.name).toBe('ContactError');
  });
});
