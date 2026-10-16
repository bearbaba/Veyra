/**
 * Short-lived, sender-bound payment review proof.
 * Never signs or authorizes an onchain transaction; wallet confirmation
 * remains a completely separate required step.
 *
 * Why: an identity snapshot can include several verified wallet addresses.
 * A client must not replace the exact recipient the sender reviewed by
 * selecting another wallet from the same snapshot during verification.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getAddress, type Address } from 'viem';

const MAX_REVIEW_MS = 30_000;

export interface PaymentReviewClaim {
  v: 1;
  senderUserId: string;
  snapshotId: string;
  walletId: string;
  walletAddress: Address;
  chainId: number;
  expiresAt: number;
}

export class PaymentReviewError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'PaymentReviewError';
  }
}

function secretForPaymentReview(): string {
  const secret = process.env.VEYRA_SESSION_SECRET ?? '';
  if (secret.length < 32) throw new PaymentReviewError('PAYMENT_REVIEW_NOT_CONFIGURED',
    'Signed payment review is not available on this server.');
  return secret;
}

function makeSignature(body: string, secret: string) {
  return createHmac('sha256', secret).update('Veyra-Pay-By-ID-Review:v1:' + body).digest('base64url');
}

function assertSafeClaim(value: PaymentReviewClaim, now: number): void {
  if (value.v !== 1 ||
    typeof value.senderUserId !== 'string' || !/^usr_[1-9A-HJ-NP-Za-km-z]{10,}$/.test(value.senderUserId) ||
    typeof value.snapshotId !== 'string' || !/^snp_[1-9A-HJ-NP-Za-km-z]{10,}$/.test(value.snapshotId) ||
    typeof value.walletId !== 'string' || !/^wlt_[1-9A-HJ-NP-Za-km-z]{10,}$/.test(value.walletId) ||
    typeof value.walletAddress !== 'string' ||
    typeof value.chainId !== 'number' || !Number.isSafeInteger(value.chainId) || value.chainId <= 0 ||
    typeof value.expiresAt !== 'number' || !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt <= now || value.expiresAt > now + MAX_REVIEW_MS) {
    throw new PaymentReviewError('INVALID_PAYMENT_REVIEW', 'Payment review is invalid or expired. Review recipient again.');
  }
  try {
    if (getAddress(value.walletAddress) !== value.walletAddress) throw new Error('Noncanonical address');
  } catch {
    throw new PaymentReviewError('INVALID_PAYMENT_REVIEW', 'Invalid reviewed wallet address.');
  }
}

/** Called exclusively after a verified recipient wallet has been selected. */
export function issuePaymentReviewToken(
  claim: Omit<PaymentReviewClaim, 'v'>,
  options?: { secret?: string; now?: number },
): string {
  const now = options?.now ?? Date.now();
  const canonical: PaymentReviewClaim = {
    ...claim, v: 1, walletAddress: getAddress(claim.walletAddress),
  };
  assertSafeClaim(canonical, now);
  const secret = options?.secret ?? secretForPaymentReview();
  if (secret.length < 32) throw new PaymentReviewError('PAYMENT_REVIEW_NOT_CONFIGURED', 'Payment review secret is unavailable.');
  const body = Buffer.from(JSON.stringify(canonical)).toString('base64url');
  return body + '.' + makeSignature(body, secret);
}

/** Check HMAC, age and *every* reviewed field against the authenticated sender. */
export function verifyPaymentReviewToken(
  token: string,
  expected: Pick<PaymentReviewClaim, 'senderUserId' | 'snapshotId' | 'walletId' | 'walletAddress' | 'chainId'>,
  options?: { secret?: string; now?: number },
): PaymentReviewClaim {
  if (typeof token !== 'string' || token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    throw new PaymentReviewError('INVALID_PAYMENT_REVIEW', 'Invalid payment review token.');
  }
  const [body, signature] = token.split('.');
  const secret = options?.secret ?? secretForPaymentReview();
  if (secret.length < 32) throw new PaymentReviewError('PAYMENT_REVIEW_NOT_CONFIGURED', 'Payment review secret is unavailable.');
  const expectedSignature = Buffer.from(makeSignature(body, secret));
  const actualSignature = Buffer.from(signature);
  if (actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(actualSignature, expectedSignature)) {
    throw new PaymentReviewError('INVALID_PAYMENT_REVIEW', 'Payment review could not be authenticated.');
  }
  let claim: PaymentReviewClaim;
  try {
    claim = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as PaymentReviewClaim;
  } catch {
    throw new PaymentReviewError('INVALID_PAYMENT_REVIEW', 'Invalid payment review payload.');
  }
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) {
    throw new PaymentReviewError('INVALID_PAYMENT_REVIEW', 'Invalid payment review payload.');
  }
  assertSafeClaim(claim, options?.now ?? Date.now());
  if (claim.senderUserId !== expected.senderUserId ||
    claim.snapshotId !== expected.snapshotId ||
    claim.walletId !== expected.walletId ||
    claim.chainId !== expected.chainId ||
    claim.walletAddress.toLowerCase() !== expected.walletAddress.toLowerCase()) {
    throw new PaymentReviewError('PAYMENT_REVIEW_MISMATCH',
      'Recipient address or chain changed after review. Restart payment review.');
  }
  return claim;
}
