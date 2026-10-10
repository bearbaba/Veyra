import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import {
  getAddress,
  hashTypedData,
  recoverTypedDataAddress,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';
import type { DbClient } from '../db/client.js';
import { normalizeHandle, HandleNormalizationError } from '../db/handleNormalizer.js';
import { newRevisionId, newUserId, newWalletId } from '../db/ids.js';
import { handleHistory, identityRevisions, veyraUsers, walletBindings } from '../db/schema/index.js';
import { issueSessionToken } from '../auth/session.js';

const CLAIM_TTL_MS = 10 * 60 * 1000;

export const VEYRA_IDENTITY_CLAIM_TYPES = {
  IdentityClaim: [
    { name: 'handle', type: 'string' },
    { name: 'walletAddress', type: 'address' },
    { name: 'chainId', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'issuedAt', type: 'uint256' },
    { name: 'expiresAt', type: 'uint256' },
  ],
} as const;

interface ClaimPayload {
  v: 1;
  handle: string;
  walletAddress: Address;
  chainId: number;
  nonce: Hex;
  issuedAt: number;
  expiresAt: number;
}

export class IdentityRegistrationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus = 400,
  ) {
    super(message);
    this.name = 'IdentityRegistrationError';
  }
}

function registrationSecret(): string {
  const secret = process.env.VEYRA_IDENTITY_CLAIM_SECRET ?? process.env.VEYRA_SESSION_SECRET ?? '';
  if (secret.length < 32) {
    throw new IdentityRegistrationError(
      'IDENTITY_REGISTRATION_NOT_CONFIGURED',
      'Identity registration requires a server-side claim secret of at least 32 characters.',
      503,
    );
  }
  return secret;
}

function sessionSecret(): string {
  const secret = process.env.VEYRA_SESSION_SECRET ?? '';
  if (secret.length < 32) {
    throw new IdentityRegistrationError(
      'SESSION_NOT_CONFIGURED',
      'Veyra sessions are not configured on this server.',
      503,
    );
  }
  return secret;
}

function encodePayload(payload: ClaimPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function signPayload(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

function createClaimToken(payload: ClaimPayload): string {
  const body = encodePayload(payload);
  return `${body}.${signPayload(body, registrationSecret())}`;
}

function parseClaimToken(token: string): ClaimPayload {
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) {
    throw new IdentityRegistrationError('INVALID_CLAIM_TOKEN', 'Malformed identity claim token', 401);
  }
  const expected = signPayload(body, registrationSecret());
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(signature);
  if (expectedBytes.length !== actualBytes.length || !timingSafeEqual(expectedBytes, actualBytes)) {
    throw new IdentityRegistrationError('INVALID_CLAIM_TOKEN', 'Invalid identity claim token signature', 401);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw new IdentityRegistrationError('INVALID_CLAIM_TOKEN', 'Invalid identity claim token payload', 401);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new IdentityRegistrationError('INVALID_CLAIM_TOKEN', 'Invalid identity claim token payload', 401);
  }
  const value = parsed as Partial<ClaimPayload>;
  if (
    value.v !== 1 ||
    typeof value.handle !== 'string' ||
    typeof value.walletAddress !== 'string' ||
    typeof value.chainId !== 'number' || !Number.isSafeInteger(value.chainId) || value.chainId <= 0 ||
    typeof value.nonce !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value.nonce) ||
    typeof value.issuedAt !== 'number' ||
    typeof value.expiresAt !== 'number'
  ) {
    throw new IdentityRegistrationError('INVALID_CLAIM_TOKEN', 'Invalid identity claim token claims', 401);
  }
  if (value.expiresAt <= Date.now() || value.expiresAt <= value.issuedAt) {
    throw new IdentityRegistrationError('CLAIM_EXPIRED', 'Identity claim has expired. Start again.', 410);
  }
  if (value.issuedAt > Date.now() + 60_000 || value.expiresAt - value.issuedAt > CLAIM_TTL_MS + 5_000) {
    throw new IdentityRegistrationError('INVALID_CLAIM_TOKEN', 'Identity claim timing is invalid', 401);
  }
  return {
    v: 1,
    handle: normalizeHandle(value.handle),
    walletAddress: getAddress(value.walletAddress),
    chainId: value.chainId,
    nonce: value.nonce as Hex,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
  };
}

function claimDomain(chainId: number) {
  return {
    name: 'Veyra',
    version: '1',
    chainId,
    verifyingContract: zeroAddress,
  } as const;
}

async function assertHandleAndWalletAvailable(
  db: DbClient,
  handle: string,
  walletAddress: Address,
  chainId: number,
): Promise<void> {
  const [liveHandle] = await db
    .select({ id: veyraUsers.veyraUserId })
    .from(veyraUsers)
    .where(and(sql`lower(${veyraUsers.veyraHandle}) = lower(${handle})`, isNull(veyraUsers.deletedAt)))
    .limit(1);
  if (liveHandle) {
    throw new IdentityRegistrationError('HANDLE_TAKEN', `@${handle} is already claimed`, 409);
  }

  const now = new Date();
  const [reservedHandle] = await db
    .select({ reservedUntil: handleHistory.reservedUntil })
    .from(handleHistory)
    .where(and(eq(handleHistory.handle, handle), gt(handleHistory.reservedUntil, now)))
    .limit(1);
  if (reservedHandle) {
    throw new IdentityRegistrationError('HANDLE_RESERVED', `@${handle} is temporarily reserved`, 409);
  }

  const [boundWallet] = await db
    .select({ owner: walletBindings.veyraUserId })
    .from(walletBindings)
    .where(and(
      sql`lower(${walletBindings.walletAddress}) = lower(${walletAddress})`,
      eq(walletBindings.chainId, chainId),
      eq(walletBindings.status, 'ACTIVE'),
      isNull(walletBindings.revokedAt),
    ))
    .limit(1);
  if (boundWallet) {
    throw new IdentityRegistrationError('WALLET_ALREADY_BOUND', 'This wallet is already bound to a Veyra identity', 409);
  }
}

export async function beginIdentityRegistration(
  db: DbClient,
  input: { handle: string; walletAddress: string; chainId: number },
) {
  let handle: string;
  try {
    handle = normalizeHandle(input.handle);
  } catch (error) {
    if (error instanceof HandleNormalizationError) {
      throw new IdentityRegistrationError(`HANDLE_${error.code}`, error.message, 400);
    }
    throw error;
  }

  let walletAddress: Address;
  try {
    walletAddress = getAddress(input.walletAddress);
  } catch {
    throw new IdentityRegistrationError('INVALID_WALLET_ADDRESS', 'walletAddress is not a valid EVM address');
  }
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) {
    throw new IdentityRegistrationError('INVALID_CHAIN_ID', 'chainId must be a positive safe integer');
  }

  // Fail before asking the wallet to sign when the claim is already impossible.
  await assertHandleAndWalletAvailable(db, handle, walletAddress, input.chainId);

  const issuedAt = Date.now();
  const expiresAt = issuedAt + CLAIM_TTL_MS;
  const nonce = `0x${randomBytes(32).toString('hex')}` as Hex;
  const payload: ClaimPayload = {
    v: 1,
    handle,
    walletAddress,
    chainId: input.chainId,
    nonce,
    issuedAt,
    expiresAt,
  };
  const domain = claimDomain(input.chainId);
  const message = {
    handle,
    walletAddress,
    chainId: input.chainId,
    nonce,
    issuedAt,
    expiresAt,
  };

  return {
    claimToken: createClaimToken(payload),
    expiresAt: new Date(expiresAt).toISOString(),
    typedData: {
      domain,
      types: VEYRA_IDENTITY_CLAIM_TYPES,
      primaryType: 'IdentityClaim' as const,
      message,
    },
  };
}

export async function completeIdentityRegistration(
  db: DbClient,
  input: { claimToken: string; signature: Hex },
) {
  const payload = parseClaimToken(input.claimToken);
  const typedData = {
    domain: claimDomain(payload.chainId),
    types: VEYRA_IDENTITY_CLAIM_TYPES,
    primaryType: 'IdentityClaim' as const,
    message: {
      handle: payload.handle,
      walletAddress: payload.walletAddress,
      // viem models uint256 values as bigint for typed-data hashing/recovery.
      // Keep the HTTP challenge JSON-safe (numbers) and normalize back to
      // bigint here before cryptographic verification.
      chainId: BigInt(payload.chainId),
      nonce: payload.nonce,
      issuedAt: BigInt(payload.issuedAt),
      expiresAt: BigInt(payload.expiresAt),
    },
  };
  let recovered: Address;
  try {
    recovered = await recoverTypedDataAddress({ ...typedData, signature: input.signature });
  } catch {
    throw new IdentityRegistrationError('INVALID_SIGNATURE', 'Identity claim signature could not be recovered', 401);
  }
  if (getAddress(recovered) !== payload.walletAddress) {
    throw new IdentityRegistrationError('INVALID_SIGNATURE', 'Identity claim was not signed by the connected wallet', 401);
  }

  await assertHandleAndWalletAvailable(db, payload.handle, payload.walletAddress, payload.chainId);
  const messageHash = hashTypedData(typedData);
  const created = await db.transaction(async (tx) => {
    // Re-check inside the transaction to narrow the race window. Unique database
    // constraints remain the final authority if two claims compete concurrently.
    const [handleRace] = await tx.select({ id: veyraUsers.veyraUserId }).from(veyraUsers)
      .where(sql`lower(${veyraUsers.veyraHandle}) = lower(${payload.handle})`).limit(1);
    if (handleRace) throw new IdentityRegistrationError('HANDLE_TAKEN', `@${payload.handle} is already claimed`, 409);
    const [walletRace] = await tx.select({ id: walletBindings.walletId }).from(walletBindings)
      .where(and(
        sql`lower(${walletBindings.walletAddress}) = lower(${payload.walletAddress})`,
        eq(walletBindings.chainId, payload.chainId),
        eq(walletBindings.status, 'ACTIVE'),
        isNull(walletBindings.revokedAt),
      )).limit(1);
    if (walletRace) throw new IdentityRegistrationError('WALLET_ALREADY_BOUND', 'This wallet is already bound to a Veyra identity', 409);

    const veyraUserId = newUserId();
    const walletId = newWalletId();
    const now = new Date();
    await tx.insert(veyraUsers).values({
      veyraUserId,
      veyraHandle: payload.handle,
      displayName: payload.handle,
      identityRevision: 1,
      status: 'ACTIVE',
    });
    await tx.insert(identityRevisions).values({
      revisionId: newRevisionId(),
      veyraUserId,
      revisionNumber: 1,
      trigger: 'WALLET_ADDED',
      detail: { event: 'account_created', handle: payload.handle },
    });
    await tx.insert(walletBindings).values({
      walletId,
      veyraUserId,
      walletAddress: payload.walletAddress,
      chainId: payload.chainId,
      walletType: 'EOA',
      proofScheme: 'EIP_712',
      proofVersion: 'registration-v1',
      proofChallengeId: `registration:${payload.nonce}`,
      proofNonce: payload.nonce,
      proofSignature: input.signature,
      proofMessageHash: messageHash,
      issuedAt: new Date(payload.issuedAt),
      verifiedAt: now,
      status: 'ACTIVE',
    });
    const [userAfterWallet] = await tx.select({ revision: veyraUsers.identityRevision }).from(veyraUsers)
      .where(eq(veyraUsers.veyraUserId, veyraUserId)).limit(1);
    await tx.insert(identityRevisions).values({
      revisionId: newRevisionId(),
      veyraUserId,
      revisionNumber: userAfterWallet?.revision ?? 2,
      trigger: 'WALLET_ADDED',
      detail: { event: 'registration_wallet_verified', walletId, chainId: payload.chainId, address: payload.walletAddress },
    });
    return { veyraUserId, veyraHandle: payload.handle, walletId };
  });

  return {
    ...created,
    walletAddress: payload.walletAddress,
    chainId: payload.chainId,
    sessionToken: issueSessionToken(created.veyraUserId, sessionSecret()),
  };
}
