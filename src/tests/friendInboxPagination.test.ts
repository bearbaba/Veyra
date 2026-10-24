import { describe, expect, it } from 'vitest';
import { FriendInboxInputError, parseFriendInboxPagination } from '../../server/services/friendInboxService';

describe('friend inbox pagination and privacy boundary', () => {
  it('defaults to a small bounded owner-scoped page', () => {
    expect(parseFriendInboxPagination(undefined, undefined)).toEqual({ limit: 20, offset: 0 });
  });
  it('accepts explicit bounded pagination', () => {
    expect(parseFriendInboxPagination('50', '1000')).toEqual({ limit: 50, offset: 1000 });
  });
  it.each([
    ['0', '0'], ['51', '0'], ['1', '1001'], ['-1', '0'],
    ['1.5', '0'], ['1', '01'], ['1', 'NaN'], ['9999999999999999999', '0'],
  ])('rejects malformed or unbounded pagination (%s, %s)', (limit, offset) => {
    expect(() => parseFriendInboxPagination(limit, offset)).toThrow(FriendInboxInputError);
  });
  it('refuses nonstring and repeated query parameter arrays', () => {
    expect(() => parseFriendInboxPagination(['20'], '0')).toThrow(FriendInboxInputError);
    expect(() => parseFriendInboxPagination('20', { value: '0' })).toThrow(FriendInboxInputError);
  });
});
