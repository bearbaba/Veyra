import { and, eq, isNull } from 'drizzle-orm';
import type { DbClient } from '../db/client.js';

type ProfileReader = Pick<DbClient, 'select'>;
import { newLinkedId, newRevisionId } from '../db/ids.js';
import { linkedIdentities, veyraUsers } from '../db/schema/index.js';
import { identityRevisions } from '../db/schema/payments.js';

const MAX_DISPLAY_NAME = 80;
const MAX_BIO = 500;
const MAX_AVATAR_URL = 2048;
const X_HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const X_ACCOUNT_ID_RE = /^\d{1,30}$/;

export type ProfileVisibility = 'PUBLIC' | 'FOLLOWERS_ONLY' | 'PRIVATE';
export type ProfileSource = 'VEYRA' | 'X_IMPORT';

export interface ProfileView {
  veyraUserId: string;
  veyraHandle: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  profileVisibility: ProfileVisibility;
  avatarSource: ProfileSource;
  displayNameSource: ProfileSource;
  bioSource: ProfileSource;
  identityRevision: number;
  x: null | {
    xAccountId: string;
    xHandle: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    bio: string | null;
    lastRefreshedAt: string | null;
  };
}

export interface UpdateProfileInput {
  displayName?: string;
  avatarUrl?: string | null;
  bio?: string;
  profileVisibility?: ProfileVisibility;
  useX?: Partial<Record<'displayName' | 'avatarUrl' | 'bio', boolean>>;
}

export interface XIdentityImport {
  xAccountId: string;
  xHandle: string;
  xDisplayName?: string | null;
  xAvatarUrl?: string | null;
  xBio?: string | null;
  metadata?: Record<string, unknown> | null;
}

export class ProfileError extends Error {
  constructor(public readonly code: string, message: string, public readonly httpStatus = 400) {
    super(message);
    this.name = 'ProfileError';
  }
}

function cleanText(value: string, max: number, field: string): string {
  const normalized = value.trim();
  if (normalized.length > max) throw new ProfileError('INVALID_PROFILE_FIELD', `${field} is too long`);
  return normalized;
}

function cleanAvatarUrl(value: string | null): string | null {
  if (value === null || value.trim() === '') return null;
  const normalized = value.trim();
  if (normalized.length > MAX_AVATAR_URL) throw new ProfileError('INVALID_AVATAR_URL', 'Avatar URL is too long');
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new ProfileError('INVALID_AVATAR_URL', 'Avatar URL must be a valid URL');
  }
  if (parsed.protocol !== 'https:') throw new ProfileError('INVALID_AVATAR_URL', 'Avatar URL must use HTTPS');
  return parsed.toString();
}

export function validateXIdentityImport(input: XIdentityImport): XIdentityImport {
  if (!X_ACCOUNT_ID_RE.test(input.xAccountId)) {
    throw new ProfileError('INVALID_X_ACCOUNT_ID', 'X account id must be the immutable numeric account id');
  }
  if (!X_HANDLE_RE.test(input.xHandle)) {
    throw new ProfileError('INVALID_X_HANDLE', 'Invalid X handle');
  }
  return {
    xAccountId: input.xAccountId,
    xHandle: input.xHandle,
    xDisplayName: input.xDisplayName == null ? null : cleanText(input.xDisplayName, MAX_DISPLAY_NAME, 'X display name'),
    xAvatarUrl: input.xAvatarUrl == null ? null : cleanAvatarUrl(input.xAvatarUrl),
    xBio: input.xBio == null ? null : cleanText(input.xBio, MAX_BIO, 'X bio'),
    metadata: input.metadata ?? null,
  };
}

export async function getProfile(db: ProfileReader, veyraUserId: string): Promise<ProfileView> {
  const [user] = await db
    .select()
    .from(veyraUsers)
    .where(and(eq(veyraUsers.veyraUserId, veyraUserId), isNull(veyraUsers.deletedAt)))
    .limit(1);
  if (!user) throw new ProfileError('PROFILE_NOT_FOUND', 'Veyra profile not found', 404);

  const [x] = await db
    .select()
    .from(linkedIdentities)
    .where(and(
      eq(linkedIdentities.veyraUserId, veyraUserId),
      eq(linkedIdentities.provider, 'X'),
      eq(linkedIdentities.status, 'ACTIVE'),
      isNull(linkedIdentities.revokedAt),
    ))
    .limit(1);

  return {
    veyraUserId: user.veyraUserId,
    veyraHandle: user.veyraHandle,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    profileVisibility: user.profileVisibility,
    avatarSource: user.avatarSource,
    displayNameSource: user.displayNameSource,
    bioSource: user.bioSource,
    identityRevision: user.identityRevision,
    x: x ? {
      xAccountId: x.externalId,
      xHandle: x.externalHandle,
      displayName: x.externalDisplayName,
      avatarUrl: x.externalAvatarUrl,
      bio: x.externalBio,
      lastRefreshedAt: x.lastRefreshedAt?.toISOString() ?? null,
    } : null,
  };
}

export async function updateProfile(db: DbClient, veyraUserId: string, input: UpdateProfileInput): Promise<ProfileView> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(veyraUsers)
      .where(and(eq(veyraUsers.veyraUserId, veyraUserId), eq(veyraUsers.status, 'ACTIVE'), isNull(veyraUsers.deletedAt)))
      .limit(1);
    if (!user) throw new ProfileError('PROFILE_NOT_FOUND', 'Active Veyra profile not found', 404);

    const wantsX = Object.values(input.useX ?? {}).some(Boolean);
    const [x] = wantsX
      ? await tx.select().from(linkedIdentities).where(and(
          eq(linkedIdentities.veyraUserId, veyraUserId),
          eq(linkedIdentities.provider, 'X'),
          eq(linkedIdentities.status, 'ACTIVE'),
          isNull(linkedIdentities.revokedAt),
        )).limit(1)
      : [undefined];
    if (wantsX && !x) throw new ProfileError('X_NOT_LINKED', 'Link an X account before using X profile fields', 409);

    const changes: Partial<typeof veyraUsers.$inferInsert> = {};
    if (input.displayName !== undefined) {
      changes.displayName = cleanText(input.displayName, MAX_DISPLAY_NAME, 'Display name');
      changes.displayNameSource = 'VEYRA';
    }
    if (input.avatarUrl !== undefined) {
      changes.avatarUrl = cleanAvatarUrl(input.avatarUrl);
      changes.avatarSource = 'VEYRA';
    }
    if (input.bio !== undefined) {
      changes.bio = cleanText(input.bio, MAX_BIO, 'Bio');
      changes.bioSource = 'VEYRA';
    }
    if (input.profileVisibility !== undefined) {
      if (!['PUBLIC', 'FOLLOWERS_ONLY', 'PRIVATE'].includes(input.profileVisibility)) {
        throw new ProfileError('INVALID_PROFILE_VISIBILITY', 'Invalid profile visibility');
      }
      changes.profileVisibility = input.profileVisibility;
    }

    if (input.useX?.displayName) {
      changes.displayName = x?.externalDisplayName ?? '';
      changes.displayNameSource = 'X_IMPORT';
    }
    if (input.useX?.avatarUrl) {
      changes.avatarUrl = x?.externalAvatarUrl ?? null;
      changes.avatarSource = 'X_IMPORT';
    }
    if (input.useX?.bio) {
      changes.bio = x?.externalBio ?? '';
      changes.bioSource = 'X_IMPORT';
    }

    if (Object.keys(changes).length === 0) return getProfile(tx, veyraUserId);

    await tx.update(veyraUsers).set(changes).where(eq(veyraUsers.veyraUserId, veyraUserId));
    const [updated] = await tx.select({ revision: veyraUsers.identityRevision }).from(veyraUsers)
      .where(eq(veyraUsers.veyraUserId, veyraUserId)).limit(1);
    if (updated) {
      await tx.insert(identityRevisions).values({
        revisionId: newRevisionId(),
        veyraUserId,
        revisionNumber: updated.revision,
        trigger: 'PROFILE_UPDATED',
        detail: { fields: Object.keys(changes) },
      });
    }

    return getProfile(tx, veyraUserId);
  });
}

/**
 * Server-internal X import. The caller must have already completed OAuth and
 * fetched this profile from X. Never accept these fields as proof of X ownership.
 */
export async function linkXIdentityFromOAuth(
  db: DbClient,
  veyraUserId: string,
  rawInput: XIdentityImport,
): Promise<ProfileView> {
  const input = validateXIdentityImport(rawInput);
  return db.transaction(async (tx) => {
    const [user] = await tx.select({ id: veyraUsers.veyraUserId }).from(veyraUsers)
      .where(and(eq(veyraUsers.veyraUserId, veyraUserId), eq(veyraUsers.status, 'ACTIVE'), isNull(veyraUsers.deletedAt))).limit(1);
    if (!user) throw new ProfileError('PROFILE_NOT_FOUND', 'Active Veyra profile not found', 404);

    const [externalOwner] = await tx.select({ userId: linkedIdentities.veyraUserId, status: linkedIdentities.status })
      .from(linkedIdentities)
      .where(and(eq(linkedIdentities.provider, 'X'), eq(linkedIdentities.externalId, input.xAccountId)))
      .limit(1);
    if (externalOwner && externalOwner.userId !== veyraUserId && externalOwner.status === 'ACTIVE') {
      throw new ProfileError('X_ACCOUNT_ALREADY_LINKED', 'This X account is already linked to another Veyra identity', 409);
    }

    const [existing] = await tx.select().from(linkedIdentities)
      .where(and(eq(linkedIdentities.veyraUserId, veyraUserId), eq(linkedIdentities.provider, 'X')))
      .limit(1);

    const now = new Date();
    if (existing && existing.externalId !== input.xAccountId && existing.status === 'ACTIVE') {
      throw new ProfileError('X_RELINK_REQUIRES_REVOKE', 'Revoke the current X link before linking a different X account', 409);
    }

    if (existing) {
      await tx.update(linkedIdentities).set({
        externalId: input.xAccountId,
        externalHandle: input.xHandle,
        externalDisplayName: input.xDisplayName,
        externalAvatarUrl: input.xAvatarUrl,
        externalBio: input.xBio,
        externalMetadata: input.metadata,
        status: 'ACTIVE',
        revokedAt: null,
        lastRefreshedAt: now,
      }).where(eq(linkedIdentities.linkedIdentityId, existing.linkedIdentityId));
    } else {
      await tx.insert(linkedIdentities).values({
        linkedIdentityId: newLinkedId(),
        veyraUserId,
        provider: 'X',
        externalId: input.xAccountId,
        externalHandle: input.xHandle,
        externalDisplayName: input.xDisplayName,
        externalAvatarUrl: input.xAvatarUrl,
        externalBio: input.xBio,
        externalMetadata: input.metadata,
        status: 'ACTIVE',
        linkedAt: now,
        lastRefreshedAt: now,
      });
    }

    // Refresh only fields explicitly sourced from X. Veyra overrides are preserved.
    const refresh: Partial<typeof veyraUsers.$inferInsert> = {};
    if (existing || user) {
      const [profile] = await tx.select().from(veyraUsers).where(eq(veyraUsers.veyraUserId, veyraUserId)).limit(1);
      if (profile?.displayNameSource === 'X_IMPORT') refresh.displayName = input.xDisplayName ?? '';
      if (profile?.avatarSource === 'X_IMPORT') refresh.avatarUrl = input.xAvatarUrl ?? null;
      if (profile?.bioSource === 'X_IMPORT') refresh.bio = input.xBio ?? '';
    }
    if (Object.keys(refresh).length > 0) {
      await tx.update(veyraUsers).set(refresh).where(eq(veyraUsers.veyraUserId, veyraUserId));
    }

    const [revision] = await tx.select({ value: veyraUsers.identityRevision }).from(veyraUsers)
      .where(eq(veyraUsers.veyraUserId, veyraUserId)).limit(1);
    if (revision) {
      await tx.insert(identityRevisions).values({
        revisionId: newRevisionId(),
        veyraUserId,
        revisionNumber: revision.value,
        trigger: 'LINKED_IDENTITY_ADDED',
        detail: { provider: 'X', externalId: input.xAccountId, event: existing ? 'refreshed' : 'linked' },
      });
    }

    return getProfile(tx, veyraUserId);
  });
}

export async function revokeXIdentity(db: DbClient, veyraUserId: string): Promise<ProfileView> {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(linkedIdentities)
      .where(and(
        eq(linkedIdentities.veyraUserId, veyraUserId),
        eq(linkedIdentities.provider, 'X'),
        eq(linkedIdentities.status, 'ACTIVE'),
        isNull(linkedIdentities.revokedAt),
      )).limit(1);
    if (!existing) throw new ProfileError('X_NOT_LINKED', 'No active X account is linked', 404);

    const now = new Date();
    await tx.update(linkedIdentities).set({ status: 'REVOKED', revokedAt: now })
      .where(eq(linkedIdentities.linkedIdentityId, existing.linkedIdentityId));

    const [profile] = await tx.select().from(veyraUsers).where(eq(veyraUsers.veyraUserId, veyraUserId)).limit(1);
    if (profile) {
      const reset: Partial<typeof veyraUsers.$inferInsert> = {};
      if (profile.displayNameSource === 'X_IMPORT') { reset.displayName = ''; reset.displayNameSource = 'VEYRA'; }
      if (profile.avatarSource === 'X_IMPORT') { reset.avatarUrl = null; reset.avatarSource = 'VEYRA'; }
      if (profile.bioSource === 'X_IMPORT') { reset.bio = ''; reset.bioSource = 'VEYRA'; }
      if (Object.keys(reset).length > 0) {
        await tx.update(veyraUsers).set(reset).where(eq(veyraUsers.veyraUserId, veyraUserId));
      }
    }

    const [revision] = await tx.select({ value: veyraUsers.identityRevision }).from(veyraUsers)
      .where(eq(veyraUsers.veyraUserId, veyraUserId)).limit(1);
    if (revision) {
      await tx.insert(identityRevisions).values({
        revisionId: newRevisionId(),
        veyraUserId,
        revisionNumber: revision.value,
        trigger: 'LINKED_IDENTITY_REVOKED',
        detail: { provider: 'X', externalId: existing.externalId },
      });
    }

    return getProfile(tx, veyraUserId);
  });
}
