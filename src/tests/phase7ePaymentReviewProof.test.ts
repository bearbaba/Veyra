import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import {
  PaymentReviewError, issuePaymentReviewToken, verifyPaymentReviewToken,
  type PaymentReviewClaim,
} from '../../server/services/paymentReviewProof';
import {
  chooseRecipientWallet, matchesReviewedRecipient,
} from '../../server/services/paymentRecipientService';

const SECRET = 'review-secret-from-a-locked-server-which-is-long-enough-2026';
const now = 1_814_000_000_000;
const senderUserId = 'usr_123456789ABCDEFGH';
const otherSender = 'usr_123456789ABCDEFGJ';
const snapshotId = 'snp_123456789ABCDEFGH';
const walletId = 'wlt_123456789ABCDEFGH';
const otherWalletId = 'wlt_123456789ABCDEFGJ';
const walletAddress = '0x1111111111111111111111111111111111111111';
const otherAddress = '0x2222222222222222222222222222222222222222';

const reviewed = {
  senderUserId,
  snapshotId,
  walletId,
  walletAddress,
  chainId: 5_042_002,
} as const;

function token(expiry = now + 30_000) {
  return issuePaymentReviewToken({ ...reviewed, expiresAt: expiry },
    { now, secret: SECRET });
}

describe('Phase 7E — sender-bound exact Pay by Veyra ID review', () => {
  it('issues 30-second HMAC review proof bound to exact sender, wallet, chain and snapshot', () => {
    const claim = verifyPaymentReviewToken(token(), reviewed, { now: now + 100, secret: SECRET });
    expect(claim).toMatchObject({ ...reviewed, expiresAt: now + 30_000, v: 1 });
  });

  it('cannot verify a valid token from someone else or a changed wallet, address or chain', () => {
    const t = token();
    const mismatches: Array<Pick<PaymentReviewClaim, 'senderUserId' | 'snapshotId' | 'walletId' | 'walletAddress' | 'chainId'>> = [
      { ...reviewed, senderUserId: otherSender },
      { ...reviewed, snapshotId: 'snp_123456789ABCDEFGJ' },
      { ...reviewed, walletId: otherWalletId },
      { ...reviewed, walletAddress: otherAddress },
      { ...reviewed, chainId: 8453 },
    ];
    for (const expected of mismatches) {
      expect(() => verifyPaymentReviewToken(t, expected, { now: now + 100, secret: SECRET }))
        .toThrow(PaymentReviewError);
      expect(() => verifyPaymentReviewToken(t, expected, { now: now + 100, secret: SECRET }))
        .toThrow('changed after review');
    }
  });

  it('refuses tampering, signing by unknown secret, malformed and long tokens', () => {
    const t = token();
    const parts = t.split('.');
    const replaced = parts[0] + '.' + parts[1]!.replace(/./, 'A');
    expect(() => verifyPaymentReviewToken(replaced, reviewed, { now, secret: SECRET }))
      .toThrow(PaymentReviewError);
    expect(() => verifyPaymentReviewToken(t, reviewed, { now, secret: 'x'.repeat(64) }))
      .toThrow(PaymentReviewError);
    for (const bad of ['', 'aaa', 'a.b.c', 'a'.repeat(5000)]) {
      expect(() => verifyPaymentReviewToken(bad, reviewed, { now, secret: SECRET }))
        .toThrow(PaymentReviewError);
    }
  });

  it('refuses an expired review, overly long expiry and malformed signed claim', () => {
    expect(() => verifyPaymentReviewToken(token(), reviewed, { now: now + 30_000, secret: SECRET }))
      .toThrow('expired');
    expect(() => issuePaymentReviewToken({ ...reviewed, expiresAt: now + 30_001 },
      { now, secret: SECRET })).toThrow('invalid or expired');
    const body = Buffer.from(JSON.stringify({ ...reviewed, v: 1, walletId: 123,
      expiresAt: now + 30_000 })).toString('base64url');
    const signature = createHmac('sha256', SECRET)
      .update('Veyra-Pay-By-ID-Review:v1:' + body).digest('base64url');
    expect(() => verifyPaymentReviewToken(body + '.' + signature, reviewed,
      { now, secret: SECRET })).toThrow(PaymentReviewError);
  });

  it('rejects selection of another verified wallet in the SAME snapshot', () => {
    const wallets = [
      { walletId, walletAddress, chainId: 5_042_002 },
      { walletId: otherWalletId, walletAddress: otherAddress, chainId: 5_042_002 },
    ];
    const pref = { primaryWalletId: walletId };
    expect(chooseRecipientWallet(wallets, 5_042_002, pref)?.walletId).toBe(walletId);
    expect(matchesReviewedRecipient(wallets, pref, {
      walletId, walletAddress, chainId: 5_042_002,
    })).toBe(true);
    expect(matchesReviewedRecipient(wallets, pref, {
      walletId: otherWalletId, walletAddress: otherAddress, chainId: 5_042_002,
    })).toBe(false);
    expect(matchesReviewedRecipient(wallets, pref, {
      walletId, walletAddress: otherAddress, chainId: 5_042_002,
    })).toBe(false);
    expect(matchesReviewedRecipient(wallets, pref, {
      walletId, walletAddress, chainId: 8453,
    })).toBe(false);
    expect(matchesReviewedRecipient(wallets, {}, {
      walletId, walletAddress, chainId: 5_042_002,
    })).toBe(false);
  });

  it('requires BFF authenticated sender and the review proof before snapshot verification', () => {
    const bff = readFileSync(new URL('../../server/bff.ts', import.meta.url), 'utf8');
    const service = readFileSync(new URL('../../server/services/paymentRecipientService.ts', import.meta.url), 'utf8');
    const client = readFileSync(new URL('../lib/api/identityApi.ts', import.meta.url), 'utf8');
    expect(bff).toContain('senderUserId: veyraUserId');
    expect(bff).toContain('expectedWalletId, expectedWalletAddress, expectedChainId, reviewToken');
    expect(service.indexOf('verifyPaymentReviewToken(input.reviewToken')).toBeLessThan(
      service.indexOf('const verified = await verifySnapshot'));
    expect(service).toContain('matchesReviewedRecipient');
    expect(client).toContain('reviewToken: string');
    expect(service).not.toMatch(/eth_sendTransaction|eth_signTypedData|personal_sign/);
  });
});
