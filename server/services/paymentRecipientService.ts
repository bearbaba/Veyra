import type { DbClient } from '../db/client.js';
import { identitySnapshots } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { freezeSnapshot, resolveRecipient, verifySnapshot, IdentityResolutionError } from './identityResolver.js';
import { issuePaymentReviewToken, verifyPaymentReviewToken } from './paymentReviewProof.js';

export interface FrozenWallet {
  walletId: string;
  walletAddress: string;
  chainId: number;
}

export function chooseRecipientWallet(
  wallets: FrozenWallet[],
  desiredChainId: number,
  receivePreference: Record<string, unknown>,
): FrozenWallet | null {
  const primaryWalletId = typeof receivePreference.primaryWalletId === 'string'
    ? receivePreference.primaryWalletId
    : null;
  const candidates = wallets.filter(wallet => wallet.chainId === desiredChainId);
  const preferred = primaryWalletId
    ? candidates.find(wallet => wallet.walletId === primaryWalletId)
    : undefined;
  // Never silently choose the first of multiple verified same-chain wallets:
  // the receiver must set a primary wallet or the sender must re-review.
  if (preferred) return preferred;
  return candidates.length === 1 ? candidates[0] : null;
}

/** Deterministic final check of the exact reviewed destination. */
export function matchesReviewedRecipient(
  wallets: FrozenWallet[],
  receivePreference: Record<string, unknown>,
  expected: { walletId: string; walletAddress: string; chainId: number },
): boolean {
  const selected = chooseRecipientWallet(wallets, expected.chainId, receivePreference);
  return Boolean(selected &&
    selected.walletId === expected.walletId &&
    selected.chainId === expected.chainId &&
    selected.walletAddress.toLowerCase() === expected.walletAddress.toLowerCase());
}

export async function preparePaymentRecipient(
  db: DbClient,
  senderUserId: string,
  rawRecipient: string,
  desiredChainId: number,
) {
  if (!Number.isSafeInteger(desiredChainId) || desiredChainId <= 0) {
    throw new IdentityResolutionError('INVALID_CHAIN', 'Invalid destination chain');
  }
  const resolved = await resolveRecipient(db, rawRecipient, senderUserId);
  if (resolved.kind === 'WALLET') {
    return {
      kind: 'WALLET' as const,
      resolvedAddress: resolved.walletAddress,
      chainId: desiredChainId,
      snapshot: null,
    };
  }

  const snapshot = await freezeSnapshot(db, resolved.veyraUserId);
  const wallet = chooseRecipientWallet(
    snapshot.resolvedWallets,
    desiredChainId,
    snapshot.receivePreference as Record<string, unknown>,
  );
  if (!wallet) {
    const sameChain = snapshot.resolvedWallets.filter((candidate) => candidate.chainId === desiredChainId);
    if (sameChain.length > 1) {
      throw new IdentityResolutionError('RECIPIENT_WALLET_AMBIGUOUS',
        'Recipient has multiple verified wallets on this chain without an active primary. Ask the recipient to select one.');
    }
    throw new IdentityResolutionError('RECIPIENT_CHAIN_UNSUPPORTED', 'Recipient has no verified wallet on the selected chain');
  }
  return {
    kind: 'VEYRA_IDENTITY' as const,
    resolvedAddress: wallet.walletAddress,
    chainId: wallet.chainId,
    snapshot: {
      snapshotId: snapshot.snapshotId,
      veyraUserId: snapshot.veyraUserId,
      veyraHandle: snapshot.veyraHandle,
      displayName: snapshot.displayName,
      avatarUrl: snapshot.avatarUrl,
      expiresAt: snapshot.expiresAt,
      walletId: wallet.walletId,
      reviewToken: issuePaymentReviewToken({
        senderUserId,
        snapshotId: snapshot.snapshotId,
        walletId: wallet.walletId,
        walletAddress: wallet.walletAddress as `0x${string}`,
        chainId: wallet.chainId,
        expiresAt: Date.parse(snapshot.expiresAt),
      }),
    },
  };
}

export async function verifyPaymentRecipient(
  db: DbClient,
  input: {
    senderUserId: string;
    snapshotId: string;
    expectedWalletId: string;
    expectedWalletAddress: string;
    expectedChainId: number;
    reviewToken: string;
  },
) {
  // Verify cryptographic binding before touching the snapshot or initiating
  // another action. A user cannot verify a different sender's payment review.
  verifyPaymentReviewToken(input.reviewToken, {
    senderUserId: input.senderUserId,
    snapshotId: input.snapshotId,
    walletId: input.expectedWalletId,
    walletAddress: input.expectedWalletAddress as `0x${string}`,
    chainId: input.expectedChainId,
  });
  const verified = await verifySnapshot(db, input.snapshotId);
  if (!verified.ok) return verified;

  const [snapshot] = await db.select({
    resolvedWallets: identitySnapshots.resolvedWallets,
    receivePreference: identitySnapshots.receivePreference,
  }).from(identitySnapshots)
    .where(eq(identitySnapshots.snapshotId, input.snapshotId))
    .limit(1);
  if (!snapshot) return { ok: false as const, reason: 'SNAPSHOT_NOT_FOUND' as const };

  // Do not accept *any* wallet from the frozen list. It must be the exact
  // primary or uniquely selected destination returned by prepare-payment.
  if (!matchesReviewedRecipient(snapshot.resolvedWallets as FrozenWallet[],
    snapshot.receivePreference as Record<string, unknown>, {
      walletId: input.expectedWalletId,
      walletAddress: input.expectedWalletAddress,
      chainId: input.expectedChainId,
    })) {
    return { ok: false as const, reason: 'RECIPIENT_MISMATCH' as const };
  }
  return { ok: true as const, snapshotId: input.snapshotId, verifiedAt: verified.verifiedAt };
}
