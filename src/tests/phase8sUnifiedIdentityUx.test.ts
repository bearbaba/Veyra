import { describe, expect, it, vi } from 'vitest';
import { displayVeyraId, normalizeFriendLookup, readKnownHandle, rememberKnownHandle } from '../identity-beta/identityPresentation';
describe('single public Veyra ID', () => {
  it('normalizes and shares the canonical namespace', () => {
    expect(displayVeyraId('Alice_42')).toBe('@alice_42.veyra');
    expect(normalizeFriendLookup('@ALICE_42')).toBe('@alice_42.veyra');
    expect(normalizeFriendLookup('@alice_42.veyra')).toBe('@alice_42.veyra');
  });
  it('accepts immutable internal IDs only for backward compatibility', () => {
    expect(normalizeFriendLookup('usr_123456789ABCDEFGJ')).toBe('usr_123456789ABCDEFGJ');
  });
  it.each(['alice.eth','alice.x','https://x.com/alice','a@b','@.veyra'])('rejects ambiguous aliases %s', input => {
    expect(() => normalizeFriendLookup(input)).toThrow();
  });
  it('remembers public handle only, never sessions or signatures', () => {
    const values = new Map<string,string>();
    vi.stubGlobal('localStorage', {getItem:(key:string)=>values.get(key) ?? null,setItem:(key:string,val:string)=>{values.set(key,val);}});
    try {
      const wallet = '0x1111111111111111111111111111111111111111';
      expect(readKnownHandle(wallet)).toBeNull();
      rememberKnownHandle(wallet,'Alice');
      expect(readKnownHandle(wallet)).toBe('alice');
      expect([...values.values()]).toEqual(['alice']);
      expect(readKnownHandle('invalid')).toBeNull();
    } finally { vi.unstubAllGlobals(); }
  });
});
