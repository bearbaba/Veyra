import { and, eq, isNull } from 'drizzle-orm';
import type { DbClient } from '../db/client.js';
import { newPreferenceId } from '../db/ids.js';
import { receivePreferences, walletBindings } from '../db/schema/index.js';

export class ReceivePreferenceError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'ReceivePreferenceError'; }
}

export async function getReceivePreference(db: DbClient, veyraUserId: string) {
  const [row] = await db.select().from(receivePreferences).where(eq(receivePreferences.veyraUserId, veyraUserId)).limit(1);
  return row ?? null;
}

export async function setReceivePreference(db: DbClient, veyraUserId: string, input: {
  preferredTokenId: string; preferredChainId: number; primaryWalletId: string;
  visibility: 'PUBLIC' | 'FRIENDS_ONLY' | 'PRIVATE'; alternativeRoutes?: unknown[];
}) {
  if (!/^[a-z0-9_-]{2,32}$/i.test(input.preferredTokenId)) throw new ReceivePreferenceError('INVALID_TOKEN', 'Invalid preferred token');
  if (!Number.isSafeInteger(input.preferredChainId) || input.preferredChainId <= 0) throw new ReceivePreferenceError('INVALID_CHAIN', 'Invalid preferred chain');
  const [wallet] = await db.select({ walletId: walletBindings.walletId, chainId: walletBindings.chainId }).from(walletBindings)
    .where(and(eq(walletBindings.walletId, input.primaryWalletId), eq(walletBindings.veyraUserId, veyraUserId), eq(walletBindings.status, 'ACTIVE'), isNull(walletBindings.revokedAt))).limit(1);
  if (!wallet) throw new ReceivePreferenceError('INVALID_PRIMARY_WALLET', 'Primary wallet must be an active verified wallet owned by this Veyra identity');
  if (wallet.chainId !== input.preferredChainId) throw new ReceivePreferenceError('WALLET_CHAIN_MISMATCH', 'Primary wallet chain must match preferred chain');
  const values = { preferredTokenId: input.preferredTokenId.toLowerCase(), preferredChainId: input.preferredChainId, primaryWalletId: input.primaryWalletId, visibility: input.visibility, alternativeRoutes: input.alternativeRoutes ?? [] };
  const [row] = await db.insert(receivePreferences).values({ preferenceId: newPreferenceId(), veyraUserId, ...values })
    .onConflictDoUpdate({ target: receivePreferences.veyraUserId, set: { ...values, updatedAt: new Date() } }).returning();
  return row;
}
