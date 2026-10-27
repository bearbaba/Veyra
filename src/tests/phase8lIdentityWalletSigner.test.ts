import { describe, expect, it } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  ARC_TESTNET_CHAIN_ID, EIP712_DOMAIN_FIELDS, assertBrowserSignedIdentityOwner, signReviewedIdentity, walletV4TypedData,
  type BrowserProvider, type SignedChallenge,
} from '../identity-beta/protocol';

const ORIGIN = 'https://veyra-identity-friends-beta.vercel.app';
const now = Date.now();

const fields = (arr: string[]) => arr.map(entry => {
  const [name, type] = entry.split(':');
  return { name, type };
});

function challenge(address: string, mode: 'register'|'login'): SignedChallenge {
  const shared = {
    walletAddress: address,
    chainId: ARC_TESTNET_CHAIN_ID,
    nonce: '0x' + 'ab'.repeat(32),
    issuedAt: now,
    expiresAt: now + (mode === 'register' ? 600_000 : 300_000),
  };
  return {
    ...(mode === 'register' ? { claimToken: 'x'.repeat(60) } :
      { challengeId: 'lgn_' + 'b'.repeat(32) }),
    typedData: {
      domain: {
        name: mode === 'register' ? 'Veyra' : 'Veyra Login',
        version: '1',
        chainId: ARC_TESTNET_CHAIN_ID,
        verifyingContract: '0x0000000000000000000000000000000000000000',
      },
      types: mode === 'register'
        ? { IdentityClaim: fields([
            'handle:string', 'walletAddress:address', 'chainId:uint256', 'nonce:bytes32',
            'issuedAt:uint256', 'expiresAt:uint256',
          ]) }
        : { WalletLogin: fields([
            'veyraUserId:string', 'walletAddress:address', 'chainId:uint256', 'nonce:bytes32',
            'issuedAt:uint256', 'expiresAt:uint256', 'appOrigin:string', 'purpose:string',
          ]) },
      primaryType: mode === 'register' ? 'IdentityClaim' : 'WalletLogin',
      message: mode === 'register' ? { handle: 'accepttest168', ...shared } : {
        veyraUserId: 'usr_123456789ABCDEFGJ',
        ...shared,
        appOrigin: ORIGIN,
        purpose: 'Sign in to Veyra Testnet. No payments or transfers.',
      },
    },
  };
}

function mockProvider(connected: ReturnType<typeof privateKeyToAccount>,
  signer: ReturnType<typeof privateKeyToAccount>): BrowserProvider {
  return {
    async request({method, params}) {
      if (method === 'eth_accounts') return [connected.address];
      if (method === 'eth_chainId') return '0x4cef52';
      if (method !== 'eth_signTypedData_v4') throw new Error('Unexpected wallet RPC');
      expect(params?.[0]).toBe(connected.address);
      const data = JSON.parse(String(params?.[1])) as {
        domain: Record<string, unknown>;
        types: Record<string, Array<{ name: string; type: string }>>;
        primaryType: string;
        message: Record<string, unknown>;
      };
      // Regression: MetaMask eth_signTypedData_v4 requires this explicit
      // type, even though viem's recoverTypedDataAddress builds it internally.
      expect(data.types.EIP712Domain).toEqual(EIP712_DOMAIN_FIELDS);
      expect(Object.keys(data.types).sort()).toEqual(['EIP712Domain', data.primaryType].sort());
      const parsed = {
        ...data.message,
        chainId: BigInt(Number(data.message.chainId)),
        issuedAt: BigInt(Number(data.message.issuedAt)),
        expiresAt: BigInt(Number(data.message.expiresAt)),
      };
      if (data.primaryType === 'IdentityClaim') {
        return signer.signTypedData({
          domain: data.domain,
          types: { IdentityClaim: data.types.IdentityClaim },
          primaryType: 'IdentityClaim',
          message: parsed,
        });
      }
      return signer.signTypedData({
        domain: data.domain,
        types: { WalletLogin: data.types.WalletLogin },
        primaryType: 'WalletLogin',
        message: parsed,
      });
    },
  };
}

describe('Phase 8L browser-side EIP-712 signature ownership gate', () => {
  const alice = privateKeyToAccount(generatePrivateKey());
  const bob = privateKeyToAccount(generatePrivateKey());

  it.each(['register', 'login'] as const)(
    '%s: accepts the identical provider/signer without changing the reviewed payload', async mode => {
      const data = challenge(alice.address, mode);
      const signature = await signReviewedIdentity(
        mockProvider(alice, alice), data, mode, alice.address, ORIGIN,
      );
      expect(signature).toMatch(/^0x[0-9a-f]{130}$/i);
      await expect(assertBrowserSignedIdentityOwner(
        data, mode, alice.address, ORIGIN, signature,
      )).resolves.toBeUndefined();
    },
  );

  it.each(['register', 'login'] as const)(
    '%s: denies a second injected provider that returns another account signature', async mode => {
      const data = challenge(alice.address, mode);
      await expect(signReviewedIdentity(
        mockProvider(alice, bob), data, mode, alice.address, ORIGIN,
      )).rejects.toThrow('different account');
    },
  );

  it('explicitly defines canonical MetaMask EIP712Domain without rewriting a server challenge', () => {
    const source = challenge(alice.address, 'register').typedData;
    const wallet = walletV4TypedData(source);
    expect(wallet.types).toEqual({
      EIP712Domain: EIP712_DOMAIN_FIELDS,
      ...(source.types as Record<string, unknown>),
    });
    expect((source.types as Record<string, unknown>).EIP712Domain).toBeUndefined();
  });

  it('blocks an unreviewed EIP712Domain override or arbitrary second struct', () => {
    const source = challenge(alice.address, 'register').typedData;
    expect(() => walletV4TypedData({
      ...source,
      types: {...(source.types as Record<string, unknown>), EIP712Domain: []},
    })).toThrow('Unexpected wallet signing types');
    expect(() => walletV4TypedData({
      ...source,
      types: {...(source.types as Record<string, unknown>), ApproveToken: []},
    })).toThrow('Unexpected wallet signing types');
  });

  it('rejects malformed EIP-712 signatures before an HTTP registration attempt', async () => {
    const data = challenge(alice.address, 'register');
    await expect(assertBrowserSignedIdentityOwner(
      data, 'register', alice.address, ORIGIN, ('0x' + '00'.repeat(65)) as `0x${string}`,
    )).rejects.toThrow();
  });
});
