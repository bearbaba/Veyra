/**
 * WalletRepository — wallet_bindings operations.
 *
 * Invariants (amendments 7):
 * - Wallet "removal" is always a revocation: status → REVOKED, revoked_at = now().
 * - No DELETE is ever called on wallet_bindings.
 * - A revocation triggers identity_revision increment via Postgres trigger.
 * - The application layer writes the corresponding identity_revisions audit row.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { walletBindings } from '../schema/index.js';
import { identityRevisions } from '../schema/payments.js';
import { newRevisionId, newWalletId } from '../ids.js';
import type { walletProofSchemeEnum, walletTypeEnum } from '../schema/enums.js';

export interface AddWalletParams {
  veyraUserId:      string;
  walletAddress:    string;          // will be stored as-is; lower-case index handles lookup
  chainId:          bigint;
  walletType?:      typeof walletTypeEnum.enumValues[number];
  proofScheme:      typeof walletProofSchemeEnum.enumValues[number];
  proofVersion:     string;
  proofChallengeId: string;
  proofNonce:       string;
  proofSignature:   string;
  proofMessageHash: string;
  issuedAt:         Date;
  verifiedAt:       Date;
}

/** Adds a new verified wallet binding. Triggers identity_revision increment via DB trigger. */
export async function addWallet(
  db: DbClient,
  params: AddWalletParams,
): Promise<string> {
  return db.transaction(async (tx) => {
    const walletId = newWalletId();

    await tx.insert(walletBindings).values({
      walletId,
      veyraUserId:      params.veyraUserId,
      walletAddress:    params.walletAddress,
      chainId:          params.chainId,
      walletType:       params.walletType ?? 'EOA',
      proofScheme:      params.proofScheme,
      proofVersion:     params.proofVersion,
      proofChallengeId: params.proofChallengeId,
      proofNonce:       params.proofNonce,
      proofSignature:   params.proofSignature,
      proofMessageHash: params.proofMessageHash,
      issuedAt:         params.issuedAt,
      verifiedAt:       params.verifiedAt,
      status:           'ACTIVE',
    });

    // The Postgres trigger increments identity_revision on wallet_bindings INSERT.
    // We write the audit row here (application layer responsibility, amendment 8 context).
    // Revision number: read after insert (trigger already ran).
    const [user] = await tx
      .select({ identityRevision: (await import('../schema/identity.js')).veyraUsers.identityRevision })
      .from((await import('../schema/identity.js')).veyraUsers)
      .where(eq((await import('../schema/identity.js')).veyraUsers.veyraUserId, params.veyraUserId));

    if (user) {
      await tx.insert(identityRevisions).values({
        revisionId:     newRevisionId(),
        veyraUserId:    params.veyraUserId,
        revisionNumber: user.identityRevision,
        trigger:        'WALLET_ADDED',
        detail:         { walletId, chainId: params.chainId.toString(), address: params.walletAddress },
      });
    }

    return walletId;
  });
}

/**
 * Revokes a wallet binding (amendment 7: revocation, not deletion).
 * Triggers identity_revision increment via DB trigger.
 */
export async function revokeWallet(
  db: DbClient,
  walletId: string,
  veyraUserId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const now = new Date();

    await tx.update(walletBindings)
      .set({ status: 'REVOKED', revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(walletBindings.walletId, walletId),
          eq(walletBindings.veyraUserId, veyraUserId),
          isNull(walletBindings.revokedAt),
        ),
      );

    // Postgres trigger fires on status UPDATE → REVOKED.
    // Write audit row.
    const [user] = await tx
      .select({ identityRevision: (await import('../schema/identity.js')).veyraUsers.identityRevision })
      .from((await import('../schema/identity.js')).veyraUsers)
      .where(eq((await import('../schema/identity.js')).veyraUsers.veyraUserId, veyraUserId));

    if (user) {
      await tx.insert(identityRevisions).values({
        revisionId:     newRevisionId(),
        veyraUserId,
        revisionNumber: user.identityRevision,
        trigger:        'WALLET_REVOKED',
        detail:         { walletId },
      });
    }
  });
}

/** Returns all active wallets for a user (for IdentitySnapshot resolution). */
export async function getActiveWallets(db: DbClient, veyraUserId: string) {
  const { veyraUsers } = await import('../schema/identity.js');
  return db
    .select()
    .from(walletBindings)
    .where(
      and(
        eq(walletBindings.veyraUserId, veyraUserId),
        eq(walletBindings.status, 'ACTIVE'),
        isNull(walletBindings.revokedAt),
      ),
    );
}
