import type { DbClient } from '../db/client.js';
import { identitySnapshots } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { freezeSnapshot, resolveRecipient, verifySnapshot, IdentityResolutionError } from './identityResolver.js';

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
  const preferred = primaryWalletId
    ? wallets.find((wallet) => wallet.walletId === primaryWalletId && wallet.chainId === desiredChainId)
    : undefined;
  return preferred ?? wallets.find((wallet) => wallet.chainId === desiredChainId) ?? null;
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
    },
  };
}

export async function verifyPaymentRecipient(
  db: DbClient,
  input: { snapshotId: string; expectedWalletAddress: string; expectedChainId: number },
) {
  const verified = await verifySnapshot(db, input.snapshotId);
  if (!verified.ok) return verified;

  const [snapshot] = await db.select({ resolvedWallets: identitySnapshots.resolvedWallets })
    .from(identitySnapshots)
    .where(eq(identitySnapshots.snapshotId, input.snapshotId))
    .limit(1);
  if (!snapshot) return { ok: false as const, reason: 'SNAPSHOT_NOT_FOUND' as const };

  const wallets = snapshot.resolvedWallets as FrozenWallet[];
  const match = wallets.some((wallet) =>
    wallet.chainId === input.expectedChainId
    && wallet.walletAddress.toLowerCase() === input.expectedWalletAddress.toLowerCase());
  if (!match) return { ok: false as const, reason: 'RECIPIENT_MISMATCH' as const };
  return { ok: true as const, snapshotId: input.snapshotId, verifiedAt: verified.verifiedAt };
}
