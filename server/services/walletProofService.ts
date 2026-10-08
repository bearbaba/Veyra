import { randomBytes } from 'crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import {
  getAddress,
  hashMessage,
  hashTypedData,
  recoverMessageAddress,
  recoverTypedDataAddress,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';
import type { DbClient } from '../db/client.js';
import { newChallengeId, newRevisionId, newWalletId } from '../db/ids.js';
import {
  identityRevisions,
  proofChallenges,
  veyraUsers,
  walletBindings,
} from '../db/schema/index.js';

const DEFAULT_CHALLENGE_TTL_MS = 10 * 60 * 1000;
const MAX_CHALLENGE_TTL_MS = 15 * 60 * 1000;

export type ProofScheme = 'EIP_712' | 'PERSONAL_SIGN';

export interface CreateWalletChallengeInput {
  veyraUserId: string;
  walletAddress: string;
  chainId: number;
  proofScheme?: ProofScheme;
}

export interface VerifyWalletChallengeInput {
  veyraUserId: string;
  challengeId: string;
  walletAddress: string;
  signature: Hex;
}

interface WalletProofMessage {
  veyraUserId: string;
  walletAddress: Address;
  chainId: bigint;
  nonce: Hex;
  issuedAt: bigint;
  expiresAt: bigint;
}

export const VEYRA_PROOF_TYPES = {
  WalletProof: [
    { name: 'veyraUserId', type: 'string' },
    { name: 'walletAddress', type: 'address' },
    { name: 'chainId', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'issuedAt', type: 'uint256' },
    { name: 'expiresAt', type: 'uint256' },
  ],
} as const;

export function buildWalletProofDomain(chainId: number) {
  return {
    name: 'Veyra',
    version: '1',
    chainId,
    verifyingContract: zeroAddress,
  } as const;
}

export function buildPlainWalletProofMessage(message: WalletProofMessage): string {
  return [
    'Veyra Wallet Proof',
    'Version: 1',
    `Veyra User: ${message.veyraUserId}`,
    `Wallet: ${message.walletAddress}`,
    `Chain ID: ${message.chainId.toString()}`,
    `Nonce: ${message.nonce}`,
    `Issued At: ${message.issuedAt.toString()}`,
    `Expires At: ${message.expiresAt.toString()}`,
    'Purpose: Bind this wallet to your Veyra identity.',
  ].join('\n');
}

function challengeTtlMs(): number {
  const configured = Number(process.env.VEYRA_PROOF_CHALLENGE_TTL_MS ?? DEFAULT_CHALLENGE_TTL_MS);
  if (!Number.isFinite(configured) || configured < 60_000) return DEFAULT_CHALLENGE_TTL_MS;
  return Math.min(configured, MAX_CHALLENGE_TTL_MS);
}

function assertChainId(chainId: number): void {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new WalletProofError('INVALID_CHAIN_ID', 'chainId must be a positive safe integer');
  }
}

export class WalletProofError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus = 400,
  ) {
    super(message);
    this.name = 'WalletProofError';
  }
}

export async function createWalletChallenge(
  db: DbClient,
  input: CreateWalletChallengeInput,
) {
  assertChainId(input.chainId);

  let walletAddress: Address;
  try {
    walletAddress = getAddress(input.walletAddress);
  } catch {
    throw new WalletProofError('INVALID_WALLET_ADDRESS', 'walletAddress is not a valid EVM address');
  }

  const [user] = await db
    .select({ status: veyraUsers.status })
    .from(veyraUsers)
    .where(and(eq(veyraUsers.veyraUserId, input.veyraUserId), isNull(veyraUsers.deletedAt)))
    .limit(1);

  if (!user || user.status !== 'ACTIVE') {
    throw new WalletProofError('IDENTITY_NOT_ACTIVE', 'Veyra identity is not active', 403);
  }

  const scheme: ProofScheme = input.proofScheme ?? 'EIP_712';
  const proofVersion = scheme === 'EIP_712' ? '1' : '0';
  const challengeId = newChallengeId();
  const nonce = `0x${randomBytes(32).toString('hex')}` as Hex;
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + challengeTtlMs());
  const message: WalletProofMessage = {
    veyraUserId: input.veyraUserId,
    walletAddress,
    chainId: BigInt(input.chainId),
    nonce,
    issuedAt: BigInt(issuedAt.getTime()),
    expiresAt: BigInt(expiresAt.getTime()),
  };
  const plainMessage = buildPlainWalletProofMessage(message);
  const domain = buildWalletProofDomain(input.chainId);
  const typedData = {
    domain,
    types: VEYRA_PROOF_TYPES,
    primaryType: 'WalletProof' as const,
    message,
  };
  // JSONB / HTTP payloads cannot carry bigint values. Keep a decimal-string
  // representation for persistence and transport while hashing/signature
  // verification always uses the bigint-typed representation above.
  const serializableTypedData = {
    domain,
    types: VEYRA_PROOF_TYPES,
    primaryType: 'WalletProof' as const,
    message: {
      ...message,
      chainId: message.chainId.toString(),
      issuedAt: message.issuedAt.toString(),
      expiresAt: message.expiresAt.toString(),
    },
  };
  const messageHash = scheme === 'EIP_712'
    ? hashTypedData(typedData)
    : hashMessage(plainMessage);

  await db.transaction(async (tx) => {
    // A newly issued challenge supersedes any older unconsumed challenge for the
    // same identity + wallet + chain. This keeps the active-challenge invariant
    // deterministic and prevents stale signing prompts from remaining valid.
    await tx.update(proofChallenges)
      .set({ status: 'REVOKED' })
      .where(and(
        eq(proofChallenges.veyraUserId, input.veyraUserId),
        sql`lower(${proofChallenges.walletAddress}) = lower(${walletAddress})`,
        eq(proofChallenges.chainId, input.chainId),
        eq(proofChallenges.status, 'ISSUED'),
        isNull(proofChallenges.consumedAt),
      ));

    await tx.insert(proofChallenges).values({
      challengeId,
      veyraUserId: input.veyraUserId,
      walletAddress,
      chainId: input.chainId,
      proofScheme: scheme,
      proofVersion,
      nonce,
      typedData: scheme === 'EIP_712' ? serializableTypedData : null,
      plainMessage,
      messageHash,
      issuedAt,
      expiresAt,
      status: 'ISSUED',
    });
  });

  return {
    challengeId,
    proofScheme: scheme,
    proofVersion,
    walletAddress,
    chainId: input.chainId,
    expiresAt: expiresAt.toISOString(),
    ...(scheme === 'EIP_712'
      ? {
          ...serializableTypedData,
        }
      : { plainMessage }),
  };
}

export async function verifyWalletChallenge(
  db: DbClient,
  input: VerifyWalletChallengeInput,
): Promise<{ walletId: string; walletAddress: Address; chainId: number }> {
  let walletAddress: Address;
  try {
    walletAddress = getAddress(input.walletAddress);
  } catch {
    throw new WalletProofError('INVALID_WALLET_ADDRESS', 'walletAddress is not a valid EVM address');
  }

  const [challenge] = await db
    .select()
    .from(proofChallenges)
    .where(eq(proofChallenges.challengeId, input.challengeId))
    .limit(1);

  if (!challenge) throw new WalletProofError('CHALLENGE_NOT_FOUND', 'Challenge not found', 404);
  if (challenge.veyraUserId !== input.veyraUserId) {
    throw new WalletProofError('CHALLENGE_OWNER_MISMATCH', 'Challenge does not belong to the authenticated Veyra user', 403);
  }
  if (challenge.status !== 'ISSUED' || challenge.consumedAt) {
    throw new WalletProofError('CHALLENGE_ALREADY_USED', 'Challenge has already been consumed', 409);
  }
  if (challenge.expiresAt.getTime() <= Date.now()) {
    await db.update(proofChallenges)
      .set({ status: 'EXPIRED' })
      .where(and(eq(proofChallenges.challengeId, challenge.challengeId), eq(proofChallenges.status, 'ISSUED')));
    throw new WalletProofError('CHALLENGE_EXPIRED', 'Challenge has expired', 410);
  }
  if (getAddress(challenge.walletAddress) !== walletAddress) {
    throw new WalletProofError('WALLET_MISMATCH', 'walletAddress does not match the issued challenge', 400);
  }

  const nonce = challenge.nonce as Hex;
  const proofMessage: WalletProofMessage = {
    veyraUserId: challenge.veyraUserId,
    walletAddress,
    chainId: BigInt(challenge.chainId),
    nonce,
    issuedAt: BigInt(challenge.issuedAt.getTime()),
    expiresAt: BigInt(challenge.expiresAt.getTime()),
  };
  const domain = buildWalletProofDomain(challenge.chainId);
  const plainMessage = buildPlainWalletProofMessage(proofMessage);
  const typedData = { domain, types: VEYRA_PROOF_TYPES, primaryType: 'WalletProof' as const, message: proofMessage };
  const expectedHash = challenge.proofScheme === 'EIP_712' ? hashTypedData(typedData) : hashMessage(plainMessage);

  if (expectedHash.toLowerCase() !== challenge.messageHash.toLowerCase()) {
    throw new WalletProofError('CHALLENGE_INTEGRITY_FAILURE', 'Stored challenge payload failed integrity verification', 409);
  }

  let recovered: Address;
  try {
    recovered = challenge.proofScheme === 'EIP_712'
      ? await recoverTypedDataAddress({ ...typedData, signature: input.signature })
      : await recoverMessageAddress({ message: plainMessage, signature: input.signature });
  } catch {
    throw new WalletProofError('INVALID_SIGNATURE', 'Signature could not be recovered', 401);
  }

  if (getAddress(recovered) !== walletAddress) {
    throw new WalletProofError('INVALID_SIGNATURE', 'Signature was not produced by the challenged wallet', 401);
  }

  return db.transaction(async (tx) => {
    const now = new Date();

    const existing = await tx
      .select({ walletId: walletBindings.walletId, veyraUserId: walletBindings.veyraUserId })
      .from(walletBindings)
      .where(and(
        sql`lower(${walletBindings.walletAddress}) = lower(${walletAddress})`,
        eq(walletBindings.chainId, challenge.chainId),
        eq(walletBindings.status, 'ACTIVE'),
        isNull(walletBindings.revokedAt),
      ))
      .limit(1);

    if (existing.length > 0) {
      const sameOwner = existing[0]?.veyraUserId === input.veyraUserId;
      throw new WalletProofError(
        'WALLET_ALREADY_BOUND',
        sameOwner ? 'Wallet is already bound to this Veyra identity' : 'Wallet is already bound to another Veyra identity',
        409,
      );
    }

    const consumed = await tx
      .update(proofChallenges)
      .set({ status: 'CONSUMED', consumedAt: now })
      .where(and(
        eq(proofChallenges.challengeId, challenge.challengeId),
        eq(proofChallenges.status, 'ISSUED'),
        isNull(proofChallenges.consumedAt),
        gt(proofChallenges.expiresAt, now),
      ))
      .returning({ challengeId: proofChallenges.challengeId });

    if (consumed.length !== 1) {
      throw new WalletProofError('CHALLENGE_ALREADY_USED', 'Challenge was consumed or expired during verification', 409);
    }

    const walletId = newWalletId();
    await tx.insert(walletBindings).values({
      walletId,
      veyraUserId: input.veyraUserId,
      walletAddress,
      chainId: challenge.chainId,
      walletType: 'EOA',
      proofScheme: challenge.proofScheme,
      proofVersion: challenge.proofVersion,
      proofChallengeId: challenge.challengeId,
      proofNonce: challenge.nonce,
      proofSignature: input.signature,
      proofMessageHash: challenge.messageHash,
      issuedAt: challenge.issuedAt,
      verifiedAt: now,
      status: 'ACTIVE',
    });

    const [user] = await tx
      .select({ identityRevision: veyraUsers.identityRevision })
      .from(veyraUsers)
      .where(eq(veyraUsers.veyraUserId, input.veyraUserId))
      .limit(1);

    if (!user) throw new WalletProofError('IDENTITY_NOT_FOUND', 'Veyra identity disappeared during verification', 409);

    await tx.insert(identityRevisions).values({
      revisionId: newRevisionId(),
      veyraUserId: input.veyraUserId,
      revisionNumber: user.identityRevision,
      trigger: 'WALLET_ADDED',
      detail: {
        walletId,
        chainId: challenge.chainId,
        address: walletAddress,
        proofChallengeId: challenge.challengeId,
        proofScheme: challenge.proofScheme,
      },
    });

    return { walletId, walletAddress, chainId: challenge.chainId };
  });
}
