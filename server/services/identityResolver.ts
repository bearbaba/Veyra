import { and, eq, isNull, sql } from 'drizzle-orm';
import {lookupCurrentXAccountId} from './xHandleAuthority.js';
import type { DbClient } from '../db/client.js';
import { newSnapshotId } from '../db/ids.js';
import { isBlockedEither } from '../db/repositories/socialRepository.js';
import { resolveContactAlias } from './contactService.js';
import { parseRecipientHandle, VeyraIdLookupError } from './veyraIdNamespace.js';
import {
  identitySnapshots,
  linkedIdentities,
  receivePreferences,
  veyraUsers,
  walletBindings,
} from '../db/schema/index.js';

const SNAPSHOT_TTL_MS = 30_000;

export type ResolvedRecipient =
  | { kind: 'VEYRA_IDENTITY'; veyraUserId: string }
  | { kind: 'WALLET'; walletAddress: string };

export class IdentityResolutionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'IdentityResolutionError';
  }
}

export async function resolveRecipient(db: DbClient, rawInput: string, senderUserId?: string): Promise<ResolvedRecipient> {
  const input = rawInput.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(input)) return { kind: 'WALLET', walletAddress: input };
  // Explicit X namespace: never resolve @handle by guessing a wallet or
  // allowing an unrelated Veyra ID to hijack the X handle.
  const xQuery=/^x:([a-z0-9_]{1,15})$/i.exec(input);
  if(xQuery){
    const handle=xQuery[1]!;
    const [bound]=await db.select({veyraUserId:linkedIdentities.veyraUserId,
      externalId:linkedIdentities.externalId})
      .from(linkedIdentities)
      .innerJoin(veyraUsers,eq(veyraUsers.veyraUserId,linkedIdentities.veyraUserId))
      .where(and(eq(linkedIdentities.provider,'X'),
        sql`lower(${linkedIdentities.externalHandle})=lower(${handle})`,
        eq(linkedIdentities.status,'ACTIVE'),isNull(linkedIdentities.revokedAt),
        eq(veyraUsers.status,'ACTIVE'),isNull(veyraUsers.deletedAt))).limit(1);
    if(!bound)throw new IdentityResolutionError('X_NOT_LINKED',
      'This X handle is not linked to a verified Veyra ID. Invite them to link their account.');
    const liveId=await lookupCurrentXAccountId(handle);
    if(liveId===null)throw new IdentityResolutionError('X_LOOKUP_NOT_VERIFIED',
      'Current X username ownership could not be verified. Use the verified Veyra ID instead.');
    if(liveId!==bound.externalId)throw new IdentityResolutionError('X_HANDLE_CHANGED',
      'This X handle no longer belongs to its former linked X account. Ask them to reconnect X.');
    if(senderUserId&&senderUserId!==bound.veyraUserId&&
      await isBlockedEither(db,senderUserId,bound.veyraUserId))
      throw new IdentityResolutionError('RECIPIENT_BLOCKED',
       'Payment cannot be initiated because a block relationship exists');
    return {kind:'VEYRA_IDENTITY',veyraUserId:bound.veyraUserId};
  }


  let lookup: ReturnType<typeof parseRecipientHandle>;
  try {
    lookup = parseRecipientHandle(input);
  } catch (error) {
    if (error instanceof VeyraIdLookupError) {
      throw new IdentityResolutionError('INVALID_RECIPIENT', error.message);
    }
    throw error;
  }
  const { handle, explicitVeyraId } = lookup;

  // Explicit @handle.veyra always resolves the canonical Veyra identity.
  // Contact nicknames and X handles can never hijack this namespace.
  if (senderUserId && !explicitVeyraId) {
    const contactUserId = await resolveContactAlias(db, senderUserId, handle);
    if (contactUserId) {
      if (await isBlockedEither(db, senderUserId, contactUserId)) {
        throw new IdentityResolutionError('RECIPIENT_BLOCKED', 'Payment cannot be initiated because a block relationship exists');
      }
      return { kind: 'VEYRA_IDENTITY', veyraUserId: contactUserId };
    }
  }

  const [veyra] = await db
    .select({ veyraUserId: veyraUsers.veyraUserId })
    .from(veyraUsers)
    .where(and(sql`lower(${veyraUsers.veyraHandle}) = lower(${handle})`, eq(veyraUsers.status, 'ACTIVE'), isNull(veyraUsers.deletedAt)))
    .limit(1);
  if (veyra) {
    if (senderUserId && senderUserId !== veyra.veyraUserId && await isBlockedEither(db, senderUserId, veyra.veyraUserId)) {
      throw new IdentityResolutionError('RECIPIENT_BLOCKED', 'Payment cannot be initiated because a block relationship exists');
    }
    return { kind: 'VEYRA_IDENTITY', veyraUserId: veyra.veyraUserId };
  }

  if (explicitVeyraId) {
    throw new IdentityResolutionError('RECIPIENT_NOT_FOUND', 'No verified Veyra ID matched this recipient.');
  }

  // Never use a cached X handle as an implicit alias. X requires the explicit
  // x: namespace and fresh provider-owner verification above.
  throw new IdentityResolutionError('RECIPIENT_NOT_FOUND', 'No Veyra or linked X identity matched this recipient');
}

export async function freezeSnapshot(db: DbClient, veyraUserId: string) {
  const [user] = await db
    .select()
    .from(veyraUsers)
    .where(and(eq(veyraUsers.veyraUserId, veyraUserId), eq(veyraUsers.status, 'ACTIVE'), isNull(veyraUsers.deletedAt)))
    .limit(1);
  if (!user) throw new IdentityResolutionError('IDENTITY_NOT_ACTIVE', 'Recipient identity is not active');

  const wallets = await db
    .select({ walletId: walletBindings.walletId, walletAddress: walletBindings.walletAddress, chainId: walletBindings.chainId })
    .from(walletBindings)
    .where(and(
      eq(walletBindings.veyraUserId, veyraUserId),
      eq(walletBindings.status, 'ACTIVE'),
      isNull(walletBindings.revokedAt),
    ));
  if (wallets.length === 0) throw new IdentityResolutionError('NO_ACTIVE_WALLET', 'Recipient has no active verified wallet');

  const [preference] = await db
    .select()
    .from(receivePreferences)
    .where(eq(receivePreferences.veyraUserId, veyraUserId))
    .limit(1);

  const frozenAt = new Date();
  const expiresAt = new Date(frozenAt.getTime() + SNAPSHOT_TTL_MS);
  const snapshotId = newSnapshotId();
  const receivePreference = preference ?? {};

  await db.insert(identitySnapshots).values({
    snapshotId,
    veyraUserId,
    veyraHandle: user.veyraHandle,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    identityRevision: user.identityRevision,
    resolvedWallets: wallets,
    receivePreference,
    frozenAt,
    expiresAt,
  });

  return {
    snapshotId,
    veyraUserId,
    veyraHandle: user.veyraHandle,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    identityRevision: user.identityRevision,
    resolvedWallets: wallets,
    receivePreference,
    frozenAt: frozenAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

export async function verifySnapshot(db: DbClient, snapshotId: string) {
  const [snapshot] = await db
    .select()
    .from(identitySnapshots)
    .where(eq(identitySnapshots.snapshotId, snapshotId))
    .limit(1);
  if (!snapshot) return { ok: false as const, reason: 'SNAPSHOT_NOT_FOUND' as const };
  if (snapshot.invalidatedAt) return { ok: false as const, reason: 'IDENTITY_CHANGED_SINCE_REVIEW' as const };

  const now = new Date();
  if (snapshot.expiresAt.getTime() <= now.getTime()) {
    await db.update(identitySnapshots)
      .set({ invalidatedAt: now, invalidationReason: 'REVIEW_EXPIRED' })
      .where(and(eq(identitySnapshots.snapshotId, snapshotId), isNull(identitySnapshots.invalidatedAt)));
    return { ok: false as const, reason: 'REVIEW_EXPIRED' as const };
  }

  const [user] = await db
    .select({ identityRevision: veyraUsers.identityRevision, status: veyraUsers.status })
    .from(veyraUsers)
    .where(and(eq(veyraUsers.veyraUserId, snapshot.veyraUserId), isNull(veyraUsers.deletedAt)))
    .limit(1);

  if (!user || user.status !== 'ACTIVE' || user.identityRevision !== snapshot.identityRevision) {
    await db.update(identitySnapshots)
      .set({ invalidatedAt: now, invalidationReason: 'IDENTITY_CHANGED_SINCE_REVIEW' })
      .where(and(eq(identitySnapshots.snapshotId, snapshotId), isNull(identitySnapshots.invalidatedAt)));
    return { ok: false as const, reason: 'IDENTITY_CHANGED_SINCE_REVIEW' as const };
  }

  const liveWallets = await db
    .select({ walletId: walletBindings.walletId, walletAddress: walletBindings.walletAddress, chainId: walletBindings.chainId })
    .from(walletBindings)
    .where(and(
      eq(walletBindings.veyraUserId, snapshot.veyraUserId),
      eq(walletBindings.status, 'ACTIVE'),
      isNull(walletBindings.revokedAt),
    ));

  const frozenWallets = snapshot.resolvedWallets as Array<{ walletId: string; walletAddress: string; chainId: number }>;
  const liveSet = new Set(liveWallets.map((w) => `${w.walletId}:${w.walletAddress.toLowerCase()}:${w.chainId}`));
  const walletMismatch = frozenWallets.some((w) => !liveSet.has(`${w.walletId}:${w.walletAddress.toLowerCase()}:${w.chainId}`));
  if (walletMismatch) {
    await db.update(identitySnapshots)
      .set({ invalidatedAt: now, invalidationReason: 'IDENTITY_CHANGED_SINCE_REVIEW' })
      .where(and(eq(identitySnapshots.snapshotId, snapshotId), isNull(identitySnapshots.invalidatedAt)));
    return { ok: false as const, reason: 'IDENTITY_CHANGED_SINCE_REVIEW' as const };
  }

  await db.update(identitySnapshots)
    .set({ verifiedAt: now })
    .where(eq(identitySnapshots.snapshotId, snapshotId));
  return { ok: true as const, snapshotId, verifiedAt: now.toISOString() };
}
