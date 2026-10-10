import { and, eq, isNull, sql } from 'drizzle-orm';
import { getAddress, isAddress } from 'viem';
import type { DbClient } from '../db/client.js';
import { walletBindings } from '../db/schema/wallets.js';
import {
  createReceipt,
  type CreateReceiptParams,
} from '../db/repositories/receiptRepository.js';
import { verifyPaymentRecipient } from './paymentRecipientService.js';
import { MANIFEST_CONSTANTS } from '../../src/providers/registry/providerManifest.js';
import { buildRouteId } from '../../src/core/router/routeEngine.js';
import {
  CCTP_V2_PROVIDER_ID,
  CCTP_V2_PROVIDER_VERSION,
} from '../../src/providers/cctp/cctpBridgeProvider.js';

export class ActivityReceiptInputError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus = 400,
  ) {
    super(message);
    this.name = 'ActivityReceiptInputError';
  }
}

export interface CreateBridgeActivityReceiptInput {
  clientIntentId: string;
  routeId: string;
  senderAddress: string;
  sourceChainId: number;
  destinationAddress: string;
  destinationChainId: number;
  amountRaw: string;
  tokenAddress: string;
  recipientSnapshotId?: string | null;
  policyResult?: Record<string, unknown>;
  preflightResults?: unknown[];
}

function destinationUsdc(chainId: number): string | null {
  if (chainId === MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID) {
    return MANIFEST_CONSTANTS.ETH_SEPOLIA_USDC;
  }
  if (chainId === MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID) {
    return MANIFEST_CONSTANTS.BASE_SEPOLIA_USDC;
  }
  return null;
}

function parsePositiveAmount(value: string): bigint {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new ActivityReceiptInputError(
      'INVALID_AMOUNT',
      'amountRaw must be a positive integer string',
    );
  }
  return BigInt(value);
}

async function findOwnedSenderWallet(
  db: DbClient,
  userId: string,
  senderAddress: string,
  sourceChainId: number,
): Promise<string> {
  const [wallet] = await db
    .select({ walletId: walletBindings.walletId })
    .from(walletBindings)
    .where(
      and(
        eq(walletBindings.veyraUserId, userId),
        eq(walletBindings.chainId, sourceChainId),
        eq(walletBindings.status, 'ACTIVE'),
        isNull(walletBindings.revokedAt),
        sql`lower(${walletBindings.walletAddress}) = lower(${senderAddress})`,
      ),
    )
    .limit(1);

  if (!wallet) {
    throw new ActivityReceiptInputError(
      'SENDER_WALLET_NOT_VERIFIED',
      'Sender is not an active verified wallet for this Veyra user',
      403,
    );
  }

  return wallet.walletId;
}

/**
 * Create the production system-of-record receipt for a reviewed direct CCTP
 * bridge. All money-moving route fields are reconstructed server-side.
 */
export async function createBridgeActivityReceipt(
  db: DbClient,
  userId: string,
  input: CreateBridgeActivityReceiptInput,
): Promise<string> {
  if (
    input.sourceChainId !== MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID ||
    input.tokenAddress.toLowerCase() !==
      MANIFEST_CONSTANTS.ARC_TESTNET_USDC.toLowerCase()
  ) {
    throw new ActivityReceiptInputError(
      'UNSUPPORTED_SOURCE',
      'Phase 5 bridge receipts support only Arc Testnet USDC as source',
    );
  }

  const destUsdc = destinationUsdc(input.destinationChainId);
  if (!destUsdc) {
    throw new ActivityReceiptInputError(
      'UNSUPPORTED_DESTINATION',
      'Unsupported CCTP destination chain',
    );
  }

  if (!isAddress(input.senderAddress) || !isAddress(input.destinationAddress)) {
    throw new ActivityReceiptInputError(
      'INVALID_ADDRESS',
      'Bridge sender and destination must be valid EVM addresses',
    );
  }

  const amount = parsePositiveAmount(input.amountRaw);
  const senderAddress = getAddress(input.senderAddress);
  const destinationAddress = getAddress(input.destinationAddress);

  const senderWalletId = await findOwnedSenderWallet(
    db,
    userId,
    senderAddress,
    input.sourceChainId,
  );

  if (input.recipientSnapshotId) {
    const snapshot = await verifyPaymentRecipient(db, {
      snapshotId: input.recipientSnapshotId,
      expectedWalletAddress: destinationAddress,
      expectedChainId: input.destinationChainId,
    });
    if (!snapshot.ok) {
      throw new ActivityReceiptInputError(
        'RECIPIENT_SNAPSHOT_INVALID',
        snapshot.reason,
        409,
      );
    }
  }

  const recipientKey =
    input.recipientSnapshotId ??
    `direct:${destinationAddress.toLowerCase()}`;

  const expectedRouteId = buildRouteId({
    clientIntentId: input.clientIntentId,
    senderAddress,
    recipientSnapshotId: recipientKey,
    amountIn: amount,
    sourceTokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
    sourceChainId: input.sourceChainId,
    destinationTokenAddress: destUsdc,
    destinationChainId: input.destinationChainId,
    provider: CCTP_V2_PROVIDER_ID,
    providerVersion: CCTP_V2_PROVIDER_VERSION,
  });

  if (expectedRouteId.toLowerCase() !== input.routeId.toLowerCase()) {
    throw new ActivityReceiptInputError(
      'ROUTE_BINDING_MISMATCH',
      'routeId does not match the reviewed execution context',
      409,
    );
  }

  const now = Date.now();
  const createParams: CreateReceiptParams = {
    clientIntentId: input.clientIntentId,
    senderUserId: userId,
    senderWalletId,
    senderAddress,
    senderChainId: input.sourceChainId,
    recipientSnapshotId: input.recipientSnapshotId ?? null,
    recipientAddress: destinationAddress,
    recipientChainId: input.destinationChainId,
    amountRaw: amount.toString(),
    amountDecimals: 6,
    assetId: 'usdc',
    tokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
    providerId: CCTP_V2_PROVIDER_ID,
    providerVersion: CCTP_V2_PROVIDER_VERSION,
    routeId: expectedRouteId,
    quoteId: expectedRouteId,
    environment: 'testnet',
    surface: 'BRIDGE',
    action: 'BRIDGE',
    routeOption: {
      routeId: expectedRouteId,
      provider: CCTP_V2_PROVIDER_ID,
      providerVersion: CCTP_V2_PROVIDER_VERSION,
      sourceChainId: input.sourceChainId,
      sourceTokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
      destinationChainId: input.destinationChainId,
      destinationTokenAddress: destUsdc,
      destinationAddress,
      amountIn: amount.toString(),
      amountOut: amount.toString(),
      quotedAt: now,
    },
    policyResult: input.policyResult ?? {},
    preflightResults: input.preflightResults ?? [],
    resumable: false,
    dedupParams: {
      environment: 'testnet',
      senderAddress: senderAddress.toLowerCase(),
      recipientSnapshotId: recipientKey,
      amountRaw: amount.toString(),
      assetId: 'usdc',
      sourceChainId: input.sourceChainId,
      destinationChainId: input.destinationChainId,
      providerId: CCTP_V2_PROVIDER_ID,
    },
  };

  return createReceipt(db, createParams);
}
