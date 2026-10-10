import { describe, expect, it, vi } from 'vitest';
import type { PublicClient, WalletClient, Hash } from 'viem';
import type { BridgeAction } from '../core/actions/actionSchema';
import {
  broadcastDepositForBurn,
  broadcastReceiveMessage,
  depositForBurn,
  receiveMessage,
  verifyDestinationBalance,
} from '../providers/cctp/cctpV2Adapter';
import { MANIFEST_CONSTANTS } from '../providers/registry/providerManifest';

const BURN_HASH =
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Hash;
const RECEIVE_HASH =
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hash;
const WALLET = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';

function action(): BridgeAction {
  const now = Date.now();
  return {
    actionType: 'BRIDGE',
    actionId: 'phase4f-cctp-broadcast',
    createdAt: now,
    chainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
    provenance: {
      source: 'PROVIDER_QUOTE',
      fetchedAt: now,
      providerId: 'cctp-v2-bridge',
    },
    sourceChainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
    destinationChainId: MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
    tokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC.toLowerCase(),
    tokenDecimals: 6,
    amount: 1_000_000n,
    from: WALLET,
    to: RECIPIENT,
    providerId: 'cctp-v2-bridge',
    quoteExpiresAt: now + 120_000,
  };
}

describe('Phase 4F CCTP broadcast safety', () => {
  it('returns the source burn hash immediately from the wallet broadcast boundary', async () => {
    const writeContract = vi.fn().mockResolvedValue(BURN_HASH);
    const walletClient = { writeContract } as unknown as WalletClient;

    await expect(
      broadcastDepositForBurn(walletClient, action()),
    ).resolves.toBe(BURN_HASH);

    expect(writeContract).toHaveBeenCalledTimes(1);
  });

  it('keeps the legacy confirmed helper layered on top of broadcast', async () => {
    const order: string[] = [];
    const walletClient = {
      writeContract: vi.fn().mockImplementation(() => {
        order.push('broadcast');
        return Promise.resolve(BURN_HASH);
      }),
    } as unknown as WalletClient;
    const publicClient = {
      waitForTransactionReceipt: vi.fn().mockImplementation(() => {
        order.push('confirm');
        return Promise.resolve({ status: 'success' });
      }),
    } as unknown as PublicClient;

    await expect(
      depositForBurn(walletClient, publicClient, action()),
    ).resolves.toBe(BURN_HASH);

    expect(order).toEqual(['broadcast', 'confirm']);
  });

  it('returns destination receive hash before any receipt wait is required', async () => {
    const writeContract = vi.fn().mockResolvedValue(RECEIVE_HASH);
    const walletClient = { writeContract } as unknown as WalletClient;

    await expect(
      broadcastReceiveMessage(
        walletClient,
        MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
        RECIPIENT,
        '0x1234',
        '0xabcd',
      ),
    ).resolves.toBe(RECEIVE_HASH);

    expect(writeContract).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown destination chains before broadcasting receiveMessage', async () => {
    const writeContract = vi.fn().mockResolvedValue(RECEIVE_HASH);
    const walletClient = { writeContract } as unknown as WalletClient;

    await expect(
      broadcastReceiveMessage(
        walletClient,
        999999,
        RECIPIENT,
        '0x1234',
        '0xabcd',
      ),
    ).rejects.toThrow(/No CCTP domain/i);

    expect(writeContract).not.toHaveBeenCalled();
  });

  it('requires the destination balance delta to equal the reviewed CCTP amount exactly', async () => {
    const exactClient = {
      readContract: vi.fn().mockResolvedValue(11_000_000n),
    } as unknown as PublicClient;

    await expect(
      verifyDestinationBalance(
        exactClient,
        RECIPIENT,
        MANIFEST_CONSTANTS.ETH_SEPOLIA_USDC,
        1_000_000n,
        10_000_000n,
      ),
    ).resolves.toMatchObject({
      verified: true,
      actualDelta: 1_000_000n,
    });

    const unrelatedExtraTransfer = {
      readContract: vi.fn().mockResolvedValue(11_000_001n),
    } as unknown as PublicClient;

    await expect(
      verifyDestinationBalance(
        unrelatedExtraTransfer,
        RECIPIENT,
        MANIFEST_CONSTANTS.ETH_SEPOLIA_USDC,
        1_000_000n,
        10_000_000n,
      ),
    ).resolves.toMatchObject({
      verified: false,
      actualDelta: 1_000_001n,
    });
  });

  it('keeps the legacy receive helper broadcast-then-confirm ordered', async () => {
    const order: string[] = [];
    const walletClient = {
      writeContract: vi.fn().mockImplementation(() => {
        order.push('broadcast');
        return Promise.resolve(RECEIVE_HASH);
      }),
    } as unknown as WalletClient;
    const publicClient = {
      waitForTransactionReceipt: vi.fn().mockImplementation(() => {
        order.push('confirm');
        return Promise.resolve({ status: 'success' });
      }),
    } as unknown as PublicClient;

    await expect(
      receiveMessage(
        walletClient,
        publicClient,
        MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
        RECIPIENT,
        '0x1234',
        '0xabcd',
      ),
    ).resolves.toBe(RECEIVE_HASH);

    expect(order).toEqual(['broadcast', 'confirm']);
  });
});
