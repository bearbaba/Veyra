import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { displayVeyraId, normalizeFriendLookup, readKnownHandle, rememberKnownHandle } from '../identity-beta/identityPresentation';
describe('single public Veyra ID', () => {
  it('sign-in is the default for connected wallets, registration requires an explicit choice', () => {
    const app = readFileSync(new URL('../identity-beta/IdentityBetaApp.tsx', import.meta.url), 'utf8');
    expect(app).toContain('const [showRegistration, setShowRegistration] = useState(false)');
    expect(app).toContain(': !showRegistration ? <>');
    expect(app).toContain('New to Veyra? Create an ID');
    expect(app).toContain('Already registered? Continue with wallet');
    expect(app).toContain('This wallet already has a Veyra ID. Continue with wallet to sign in.');
    expect(app).toContain('No Veyra ID found for this wallet. Choose a name to create one.');
    expect(app).not.toContain('Already have a Veyra ID? Sign in');
  });
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
