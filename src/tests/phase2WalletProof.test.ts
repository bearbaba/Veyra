import { describe, expect, it } from 'vitest';
import { hashMessage, hashTypedData } from 'viem';
import {
  buildPlainWalletProofMessage,
  buildWalletProofDomain,
  VEYRA_PROOF_TYPES,
} from '../../server/services/walletProofService.js';

describe('Phase 2A wallet proof payloads', () => {
  const walletAddress = '0x0000000000000000000000000000000000000001' as const;
  const message: {
    veyraUserId: string;
    walletAddress: `0x${string}`;
    chainId: bigint;
    nonce: `0x${string}`;
    issuedAt: bigint;
    expiresAt: bigint;
  } = {
    veyraUserId: 'usr_123456789ABCDEFGHJKLMNPQ',
    walletAddress,
    chainId: 5042002n,
    nonce: `0x${'11'.repeat(32)}`,
    issuedAt: 1791450000000n,
    expiresAt: 1791450600000n,
  };

  it('EIP-712 domain is chain-bound and protocol-bound', () => {
    const domain = buildWalletProofDomain(5042002);
    expect(domain).toEqual({
      name: 'Veyra',
      version: '1',
      chainId: 5042002,
      verifyingContract: '0x0000000000000000000000000000000000000000',
    });
  });

  it('plain-sign fallback binds user, wallet, chain, nonce, issue and expiry', () => {
    const plain = buildPlainWalletProofMessage(message);
    expect(plain).toContain(`Veyra User: ${message.veyraUserId}`);
    expect(plain).toContain(`Wallet: ${walletAddress}`);
    expect(plain).toContain('Chain ID: 5042002');
    expect(plain).toContain(`Nonce: ${message.nonce}`);
    expect(plain).toContain(`Issued At: ${message.issuedAt}`);
    expect(plain).toContain(`Expires At: ${message.expiresAt}`);
    expect(hashMessage(plain)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('EIP-712 hash changes when chain changes', () => {
    const hashA = hashTypedData({
      domain: buildWalletProofDomain(5042002),
      types: VEYRA_PROOF_TYPES,
      primaryType: 'WalletProof',
      message,
    });
    const hashB = hashTypedData({
      domain: buildWalletProofDomain(11155111),
      types: VEYRA_PROOF_TYPES,
      primaryType: 'WalletProof',
      message: { ...message, chainId: 11155111n },
    });
    expect(hashA).not.toBe(hashB);
  });
});
