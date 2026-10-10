import { and, desc, eq, ne } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { bridgeRecoveryCheckpoints } from '../schema/bridgeRecovery.js';

export type BridgeRecoveryStage =
  | 'SOURCE_BROADCAST'
  | 'SOURCE_CONFIRMED'
  | 'ATTESTATION_READY'
  | 'DESTINATION_BROADCAST'
  | 'VERIFIED';

const STAGE_ORDER: Record<BridgeRecoveryStage, number> = {
  SOURCE_BROADCAST: 0,
  SOURCE_CONFIRMED: 1,
  ATTESTATION_READY: 2,
  DESTINATION_BROADCAST: 3,
  VERIFIED: 4,
};

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HEX_RE = /^0x[0-9a-fA-F]+$/;
const UINT_RE = /^(0|[1-9][0-9]*)$/;

export interface BridgeRecoveryInput {
  planId: string;
  stage: BridgeRecoveryStage;
  burnTxHash: string;
  sourceChainId: number;
  destinationChainId: number;
  walletAddress: string;
  recipientAddress: string;
  amount: string;
  tokenAddress: string;
  balanceBefore: string;
  attestationMessage?: string;
  attestationSignature?: string;
  receiveTxHash?: string;
  createdAt: number;
  updatedAt: number;
}

export class BridgeRecoveryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BridgeRecoveryConflictError';
  }
}

function assertBaseInput(input: BridgeRecoveryInput): void {
  if (!input.planId || input.planId.length > 160) {
    throw new BridgeRecoveryConflictError('Invalid bridge recovery planId');
  }
  if (!(input.stage in STAGE_ORDER)) {
    throw new BridgeRecoveryConflictError('Invalid bridge recovery stage');
  }
  if (!TX_HASH_RE.test(input.burnTxHash)) {
    throw new BridgeRecoveryConflictError('Invalid bridge burn transaction hash');
  }
  if (!Number.isSafeInteger(input.sourceChainId) || input.sourceChainId <= 0) {
    throw new BridgeRecoveryConflictError('Invalid bridge source chain');
  }
  if (!Number.isSafeInteger(input.destinationChainId) || input.destinationChainId <= 0) {
    throw new BridgeRecoveryConflictError('Invalid bridge destination chain');
  }
  if (!ADDRESS_RE.test(input.walletAddress) || !ADDRESS_RE.test(input.recipientAddress)) {
    throw new BridgeRecoveryConflictError('Invalid bridge wallet address');
  }
  if (!ADDRESS_RE.test(input.tokenAddress)) {
    throw new BridgeRecoveryConflictError('Invalid bridge token address');
  }
  if (!UINT_RE.test(input.amount) || !UINT_RE.test(input.balanceBefore)) {
    throw new BridgeRecoveryConflictError('Bridge amounts must be unsigned integer strings');
  }
  if (!Number.isSafeInteger(input.createdAt) || !Number.isSafeInteger(input.updatedAt)) {
    throw new BridgeRecoveryConflictError('Invalid bridge checkpoint timestamps');
  }
  if (input.updatedAt < input.createdAt) {
    throw new BridgeRecoveryConflictError('Bridge checkpoint updatedAt precedes createdAt');
  }
  if (input.attestationMessage !== undefined && !HEX_RE.test(input.attestationMessage)) {
    throw new BridgeRecoveryConflictError('Invalid bridge attestation message');
  }
  if (input.attestationSignature !== undefined && !HEX_RE.test(input.attestationSignature)) {
    throw new BridgeRecoveryConflictError('Invalid bridge attestation signature');
  }
  if (input.receiveTxHash !== undefined && !TX_HASH_RE.test(input.receiveTxHash)) {
    throw new BridgeRecoveryConflictError('Invalid bridge receive transaction hash');
  }

  if (
    STAGE_ORDER[input.stage] >= STAGE_ORDER.ATTESTATION_READY &&
    (!input.attestationMessage || !input.attestationSignature)
  ) {
    throw new BridgeRecoveryConflictError(
      'Attestation data is required at ATTESTATION_READY and later',
    );
  }

  if (
    STAGE_ORDER[input.stage] >= STAGE_ORDER.DESTINATION_BROADCAST &&
    !input.receiveTxHash
  ) {
    throw new BridgeRecoveryConflictError(
      'receiveTxHash is required at DESTINATION_BROADCAST and later',
    );
  }
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function assertImmutableMatch(
  existing: BridgeRecoveryInput,
  incoming: BridgeRecoveryInput,
): void {
  const immutableChecks: Array<[boolean, string]> = [
    [existing.planId === incoming.planId, 'planId'],
    [existing.burnTxHash.toLowerCase() === incoming.burnTxHash.toLowerCase(), 'burnTxHash'],
    [existing.sourceChainId === incoming.sourceChainId, 'sourceChainId'],
    [existing.destinationChainId === incoming.destinationChainId, 'destinationChainId'],
    [sameAddress(existing.walletAddress, incoming.walletAddress), 'walletAddress'],
    [sameAddress(existing.recipientAddress, incoming.recipientAddress), 'recipientAddress'],
    [existing.amount === incoming.amount, 'amount'],
    [sameAddress(existing.tokenAddress, incoming.tokenAddress), 'tokenAddress'],
    [existing.balanceBefore === incoming.balanceBefore, 'balanceBefore'],
    [existing.createdAt === incoming.createdAt, 'createdAt'],
  ];

  for (const [ok, field] of immutableChecks) {
    if (!ok) {
      throw new BridgeRecoveryConflictError(
        `Bridge recovery immutable field changed: ${field}`,
      );
    }
  }

  if (STAGE_ORDER[incoming.stage] < STAGE_ORDER[existing.stage]) {
    throw new BridgeRecoveryConflictError(
      `Bridge recovery stage regression: ${existing.stage} -> ${incoming.stage}`,
    );
  }

  if (
    existing.attestationMessage &&
    incoming.attestationMessage &&
    existing.attestationMessage !== incoming.attestationMessage
  ) {
    throw new BridgeRecoveryConflictError('Bridge attestation message changed');
  }
  if (
    existing.attestationSignature &&
    incoming.attestationSignature &&
    existing.attestationSignature !== incoming.attestationSignature
  ) {
    throw new BridgeRecoveryConflictError('Bridge attestation signature changed');
  }
  if (
    existing.receiveTxHash &&
    incoming.receiveTxHash &&
    existing.receiveTxHash.toLowerCase() !== incoming.receiveTxHash.toLowerCase()
  ) {
    throw new BridgeRecoveryConflictError('Bridge receive transaction hash changed');
  }
}

/**
 * Advancement-only merge for authenticated server persistence.
 *
 * Immutable source execution data can never change and stages can never regress.
 * Missing optional recovery evidence is retained from the existing record.
 */
export function mergeBridgeRecoveryCheckpoint(
  existing: BridgeRecoveryInput | null,
  incoming: BridgeRecoveryInput,
): BridgeRecoveryInput {
  assertBaseInput(incoming);
  if (!existing) return incoming;

  assertBaseInput(existing);
  assertImmutableMatch(existing, incoming);

  const merged: BridgeRecoveryInput = {
    ...incoming,
    attestationMessage: incoming.attestationMessage ?? existing.attestationMessage,
    attestationSignature: incoming.attestationSignature ?? existing.attestationSignature,
    receiveTxHash: incoming.receiveTxHash ?? existing.receiveTxHash,
    updatedAt: Math.max(existing.updatedAt, incoming.updatedAt),
  };

  assertBaseInput(merged);
  return merged;
}

type BridgeRecoveryRow = typeof bridgeRecoveryCheckpoints.$inferSelect;

function rowToInput(row: BridgeRecoveryRow): BridgeRecoveryInput {
  return {
    planId: row.planId,
    stage: row.stage as BridgeRecoveryStage,
    burnTxHash: row.burnTxHash,
    sourceChainId: row.sourceChainId,
    destinationChainId: row.destinationChainId,
    walletAddress: row.walletAddress,
    recipientAddress: row.recipientAddress,
    amount: row.amountRaw,
    tokenAddress: row.tokenAddress,
    balanceBefore: row.balanceBeforeRaw,
    attestationMessage: row.attestationMessage ?? undefined,
    attestationSignature: row.attestationSignature ?? undefined,
    receiveTxHash: row.receiveTxHash ?? undefined,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

function toDbValues(ownerUserId: string, input: BridgeRecoveryInput) {
  return {
    planId: input.planId,
    ownerUserId,
    stage: input.stage,
    burnTxHash: input.burnTxHash.toLowerCase(),
    sourceChainId: input.sourceChainId,
    destinationChainId: input.destinationChainId,
    walletAddress: input.walletAddress.toLowerCase(),
    recipientAddress: input.recipientAddress.toLowerCase(),
    amountRaw: input.amount,
    tokenAddress: input.tokenAddress.toLowerCase(),
    balanceBeforeRaw: input.balanceBefore,
    attestationMessage: input.attestationMessage,
    attestationSignature: input.attestationSignature,
    receiveTxHash: input.receiveTxHash?.toLowerCase(),
    createdAt: new Date(input.createdAt),
    updatedAt: new Date(input.updatedAt),
  };
}

export async function persistBridgeRecoveryCheckpoint(
  db: DbClient,
  ownerUserId: string,
  incoming: BridgeRecoveryInput,
): Promise<BridgeRecoveryInput> {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(bridgeRecoveryCheckpoints)
        .where(eq(bridgeRecoveryCheckpoints.planId, incoming.planId))
        .for('update');

      if (row && row.ownerUserId !== ownerUserId) {
        throw new BridgeRecoveryConflictError(
          'Bridge recovery plan belongs to another Veyra user',
        );
      }

      const merged = mergeBridgeRecoveryCheckpoint(
        row ? rowToInput(row) : null,
        incoming,
      );

      if (!row) {
        await tx.insert(bridgeRecoveryCheckpoints).values(
          toDbValues(ownerUserId, merged),
        );
      } else {
        await tx
          .update(bridgeRecoveryCheckpoints)
          .set({
            stage: merged.stage,
            attestationMessage: merged.attestationMessage,
            attestationSignature: merged.attestationSignature,
            receiveTxHash: merged.receiveTxHash?.toLowerCase(),
            updatedAt: new Date(merged.updatedAt),
          })
          .where(
            and(
              eq(bridgeRecoveryCheckpoints.planId, merged.planId),
              eq(bridgeRecoveryCheckpoints.ownerUserId, ownerUserId),
            ),
          );
      }

      return merged;
    });
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === '23505'
    ) {
      throw new BridgeRecoveryConflictError(
        'A durable bridge recovery checkpoint already exists for this source burn',
      );
    }
    throw error;
  }
}

export async function loadPendingBridgeRecoveryCheckpoints(
  db: DbClient,
  ownerUserId: string,
): Promise<BridgeRecoveryInput[]> {
  const rows = await db
    .select()
    .from(bridgeRecoveryCheckpoints)
    .where(
      and(
        eq(bridgeRecoveryCheckpoints.ownerUserId, ownerUserId),
        ne(bridgeRecoveryCheckpoints.stage, 'VERIFIED'),
      ),
    )
    .orderBy(desc(bridgeRecoveryCheckpoints.updatedAt));

  return rows.map(rowToInput);
}
