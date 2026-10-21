/**
 * Phase 8G: wallet-owned re-login, separate from wallet-binding proof.
 * Every EIP-712 login challenge is persisted, short-lived and consumed once
 * by an atomic PostgreSQL update. No wallet/private key is held by the BFF.
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getAddress, recoverTypedDataAddress, zeroAddress, type Address, type Hex } from 'viem';
import type { DbClient } from '../db/client.js';
import { issueSessionToken } from '../auth/session.js';

export const ARC_TESTNET_LOGIN_CHAIN = 5042002;
const LOGIN_TTL_MS = 5 * 60 * 1000;
const PURPOSE = 'Sign in to Veyra Testnet. No payments or transfers.';
export const WALLET_LOGIN_TYPES = {
  WalletLogin: [
    { name: 'veyraUserId', type: 'string' },
    { name: 'walletAddress', type: 'address' },
    { name: 'chainId', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'issuedAt', type: 'uint256' },
    { name: 'expiresAt', type: 'uint256' },
    { name: 'appOrigin', type: 'string' },
    { name: 'purpose', type: 'string' },
  ],
} as const;

export class WalletLoginError extends Error {
  constructor(public readonly code: string, public readonly httpStatus: number) {
    super(code);
    this.name = 'WalletLoginError';
  }
}

function appOrigin() {
  if (process.env.VEYRA_ENV !== 'testnet') {
    throw new WalletLoginError('TESTNET_ONLY', 403);
  }
  const origin = process.env.VEYRA_APP_ORIGIN;
  if (!origin || !origin.startsWith('https://') || new URL(origin).origin !== origin) {
    throw new WalletLoginError('LOGIN_NOT_CONFIGURED', 503);
  }
  return origin;
}

function validateAddress(input: string): Address {
  try { return getAddress(input); }
  catch { throw new WalletLoginError('INVALID_WALLET_ADDRESS', 400); }
}

function loginTypedData(input: {
  userId: string; walletAddress: Address; chainId: number;
  nonce: Hex; issuedAt: number; expiresAt: number; origin: string;
}) {
  return {
    domain: {
      name: 'Veyra Login',
      version: '1',
      chainId: input.chainId,
      verifyingContract: zeroAddress,
    },
    types: WALLET_LOGIN_TYPES,
    primaryType: 'WalletLogin' as const,
    message: {
      veyraUserId: input.userId,
      walletAddress: input.walletAddress,
      chainId: BigInt(input.chainId),
      nonce: input.nonce,
      issuedAt: BigInt(input.issuedAt),
      expiresAt: BigInt(input.expiresAt),
      appOrigin: input.origin,
      purpose: PURPOSE,
    },
  };
}

export async function beginWalletLogin(db: DbClient, walletAddressInput: string, chainId: number) {
  const origin = appOrigin();
  if (chainId !== ARC_TESTNET_LOGIN_CHAIN) {
    throw new WalletLoginError('UNSUPPORTED_TESTNET_CHAIN', 400);
  }
  const walletAddress = validateAddress(walletAddressInput);
  const known = await db.execute(sql`
    SELECT wb.veyr_user_id AS "userId"
    FROM wallet_bindings wb
    JOIN veyra_users u ON u.veyr_user_id = wb.veyr_user_id
    WHERE lower(wb.wallet_address) = lower(${walletAddress})
      AND wb.chain_id = ${chainId}
      AND wb.status = 'ACTIVE' AND wb.revoked_at IS NULL
      AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
    LIMIT 1
  `);
  const user = known.rows[0] as { userId: string } | undefined;
  if (!user) throw new WalletLoginError('WALLET_NOT_REGISTERED', 404);

  const challengeId = 'lgn_' + randomBytes(16).toString('hex');
  const nonce = ('0x' + randomBytes(32).toString('hex')) as Hex;
  const issuedAt = Date.now();
  const expiresAt = issuedAt + LOGIN_TTL_MS;
  await db.transaction(async tx => {
    // One active login prompt per bound wallet; a new prompt invalidates
    // older challenges without granting any authentication permission.
    await tx.execute(sql`
      UPDATE wallet_login_challenges SET status = 'EXPIRED'
      WHERE veyr_user_id = ${user.userId}
        AND lower(wallet_address) = lower(${walletAddress})
        AND chain_id = ${chainId} AND status = 'ISSUED'
    `);
    await tx.execute(sql`
      INSERT INTO wallet_login_challenges
        (challenge_id, veyr_user_id, wallet_address, chain_id, nonce,
         app_origin, issued_at, expires_at)
      VALUES (${challengeId}, ${user.userId}, ${walletAddress}, ${chainId},
        ${nonce}, ${origin}, ${new Date(issuedAt)}, ${new Date(expiresAt)})
    `);
  });
  const typedData = loginTypedData({
    userId: user.userId, walletAddress, chainId,
    nonce, issuedAt, expiresAt, origin,
  });
  return {
    challengeId,
    expiresAt: new Date(expiresAt).toISOString(),
    typedData: {
      ...typedData,
      message: {
        ...typedData.message,
        chainId,
        issuedAt,
        expiresAt,
      },
    },
  };
}

export async function completeWalletLogin(
  db: DbClient,
  challengeId: string,
  signature: string,
): Promise<{ sessionToken: string; veyraUserId: string }> {
  const origin = appOrigin();
  if (!/^lgn_[0-9a-f]{32}$/.test(challengeId) || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    throw new WalletLoginError('INVALID_LOGIN_PROOF', 400);
  }
  const rows = await db.execute(sql`
    SELECT challenge_id AS "challengeId", veyr_user_id AS "userId",
      wallet_address AS "walletAddress", chain_id AS "chainId",
      nonce, app_origin AS "appOrigin", issued_at AS "issuedAt",
      expires_at AS "expiresAt", status
    FROM wallet_login_challenges WHERE challenge_id = ${challengeId}
  `);
  const record = rows.rows[0] as {
    challengeId: string; userId: string; walletAddress: string; chainId: string | number;
    nonce: Hex; appOrigin: string; issuedAt: Date; expiresAt: Date; status: string;
  } | undefined;
  if (!record || record.status !== 'ISSUED') {
    throw new WalletLoginError('LOGIN_CHALLENGE_INVALID_OR_USED', 409);
  }
  const issuedAt = new Date(record.issuedAt).getTime();
  const expiresAt = new Date(record.expiresAt).getTime();
  if (expiresAt <= Date.now() || issuedAt > Date.now() + 60_000 ||
      expiresAt - issuedAt !== LOGIN_TTL_MS ||
      Number(record.chainId) !== ARC_TESTNET_LOGIN_CHAIN || record.appOrigin !== origin) {
    throw new WalletLoginError('LOGIN_CHALLENGE_EXPIRED_OR_MISMATCHED', 410);
  }
  const walletAddress = validateAddress(record.walletAddress);
  const typedData = loginTypedData({
    userId: record.userId, walletAddress,
    chainId: ARC_TESTNET_LOGIN_CHAIN, nonce: record.nonce,
    issuedAt, expiresAt, origin,
  });
  let recovered: Address;
  try {
    recovered = await recoverTypedDataAddress({
      ...typedData,
      signature: signature as Hex,
    });
  } catch {
    throw new WalletLoginError('INVALID_LOGIN_SIGNATURE', 401);
  }
  if (getAddress(recovered) !== walletAddress) {
    throw new WalletLoginError('INVALID_LOGIN_SIGNATURE', 401);
  }

  // Verify wallet/identity have not been revoked since issuance and atomically
  // consume once. Concurrent submissions can never receive two sessions.
  const result = await db.execute(sql`
    UPDATE wallet_login_challenges c
    SET status = 'CONSUMED', consumed_at = now()
    WHERE c.challenge_id = ${challengeId}
      AND c.status = 'ISSUED' AND c.expires_at > now()
      AND EXISTS (
        SELECT 1 FROM wallet_bindings wb JOIN veyra_users u
          ON u.veyr_user_id = wb.veyr_user_id
        WHERE wb.veyr_user_id = c.veyr_user_id
          AND lower(wb.wallet_address) = lower(c.wallet_address)
          AND wb.chain_id = c.chain_id
          AND wb.status = 'ACTIVE' AND wb.revoked_at IS NULL
          AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
      )
    RETURNING c.veyr_user_id AS "userId"
  `);
  const user = result.rows[0] as { userId: string } | undefined;
  if (!user) throw new WalletLoginError('LOGIN_CHALLENGE_INVALID_OR_USED', 409);
  const secret = process.env.VEYRA_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new WalletLoginError('LOGIN_NOT_CONFIGURED', 503);
  }
  return {
    sessionToken: issueSessionToken(user.userId, secret, { ttlSeconds: 900 }),
    veyraUserId: user.userId,
  };
}
