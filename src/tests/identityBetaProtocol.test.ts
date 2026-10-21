import { describe, expect, it } from 'vitest';
import {
  ARC_TESTNET_CHAIN_ID, normalizeBetaHandle, parseArcChainId, requireArcWallet,
  verifiedTypedData, type SignedChallenge,
} from '../identity-beta/protocol';

const address = '0x1111111111111111111111111111111111111111';
const origin = 'https://veyra-identity-beta.vercel.app';
const now = Date.now();
const fields = (items: string[]) => items.map(item => {
  const [name, type] = item.split(':');
  return { name, type };
});
const base = (mode: 'register'|'login'): SignedChallenge => ({
  ...(mode === 'login' ? { challengeId: 'lgn_' + 'a'.repeat(32) } : { claimToken: 'x'.repeat(100) }),
  typedData: {
    domain: { name: mode === 'login' ? 'Veyra Login' : 'Veyra', version: '1',
      chainId: ARC_TESTNET_CHAIN_ID, verifyingContract: '0x0000000000000000000000000000000000000000' },
    primaryType: mode === 'login' ? 'WalletLogin' : 'IdentityClaim',
    types: mode === 'login'
      ? { WalletLogin: fields(['veyraUserId:string', 'walletAddress:address', 'chainId:uint256', 'nonce:bytes32',
          'issuedAt:uint256', 'expiresAt:uint256', 'appOrigin:string', 'purpose:string']) }
      : { IdentityClaim: fields(['handle:string', 'walletAddress:address', 'chainId:uint256',
          'nonce:bytes32', 'issuedAt:uint256', 'expiresAt:uint256']) },
    message: {
      walletAddress: address, chainId: ARC_TESTNET_CHAIN_ID, nonce: '0x'+'a'.repeat(64),
      issuedAt: now, expiresAt: now + (mode === 'login' ? 5 : 10)*60_000,
      ...(mode === 'login' ? {
        veyraUserId: 'usr_123456789ABCDEFGJ', appOrigin: origin,
        purpose: 'Sign in to Veyra Testnet. No payments or transfers.',
      } : { handle: 'testalice' }),
    },
  },
});
function mutate(mode: 'register'|'login', key: string, value: unknown) {
  const challenge = base(mode);
  const data = challenge.typedData;
  const message = data.message as Record<string,unknown>;
  if (key.startsWith('domain.')) (data.domain as Record<string,unknown>)[key.slice(7)] = value;
  else if (key === 'primaryType') data.primaryType = value;
  else message[key] = value;
  return challenge;
}
describe('isolated identity-only EIP-712 browser gate', () => {
  it('approves only reviewed registration and login typed data', () => {
    expect(verifiedTypedData(base('register'), 'register', address, origin).primaryType).toBe('IdentityClaim');
    expect(verifiedTypedData(base('login'), 'login', address, origin).primaryType).toBe('WalletLogin');
  });
  it.each([
    ['register','domain.name','WalletApproval'],
    ['register','domain.chainId',5042],
    ['register','domain.verifyingContract','0x1111111111111111111111111111111111111111'],
    ['register','primaryType','Transfer'],
    ['register','walletAddress','0x2222222222222222222222222222222222222222'],
    ['register','chainId',1],
    ['register','handle','Wrong Handle'],
    ['login','appOrigin','https://evil.example'],
    ['login','purpose','Approve unlimited funds'],
    ['login','chainId',1],
    ['login','walletAddress','0x2222222222222222222222222222222222222222'],
    ['login','expiresAt',now-100],
    ['login','veyraUserId','invalid'],
  ] as const)('refuses %s %s tampering', (mode, key, value) => {
    expect(() => verifiedTypedData(mutate(mode, key, value), mode, address, origin)).toThrow();
  });
  it('rejects extra message field type appended by attacker', () => {
    const challenge = base('login');
    const types = challenge.typedData.types as Record<string, unknown[]>;
    types.WalletLogin.push({name:'spender',type:'address'});
    expect(() => verifiedTypedData(challenge,'login',address,origin)).toThrow();
  });
  it('rejects a mismatched identity login attempt', () => {
    expect(() => verifiedTypedData(base('register'),'login',address,origin)).toThrow();
    expect(() => verifiedTypedData(base('login'),'register',address,origin)).toThrow();
  });
  it('requires manual Arc Testnet and valid wallet address', () => {
    expect(parseArcChainId('0x4cef52')).toBe(ARC_TESTNET_CHAIN_ID);
    expect(parseArcChainId('not-a-chain')).toBeNull();
    expect(requireArcWallet(address,ARC_TESTNET_CHAIN_ID)).toBe(address);
    expect(() => requireArcWallet(address,1)).toThrow();
    expect(() => requireArcWallet('bad',ARC_TESTNET_CHAIN_ID)).toThrow();
  });
  it('validates canonical Veyra handles before signing', () => {
    expect(normalizeBetaHandle('@Alice_2026')).toBe('alice_2026');
    for(const handle of ['a','bad-name','_alice','alice_','alice__two', 'a'.repeat(31),'аlice']) {
      expect(() => normalizeBetaHandle(handle)).toThrow();
    }
  });
});
