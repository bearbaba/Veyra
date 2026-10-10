import { describe, expect, it } from 'vitest';
import type {
  BridgeAction,
  SupplyAction,
  WithdrawAction,
} from '../core/actions/actionSchema';
import {
  buildVerifiedAppKitBridgeReceipt,
  buildVerifiedAppKitEarnDepositReceipt,
  buildVerifiedAppKitEarnWithdrawalReceipt,
  buildVerifiedAppKitUnifiedSpendReceipt,
  collectAppKitResultTxHashes,
  verifyAppKitBridgeExecution,
  verifyAppKitEarnDepositExecution,
  verifyAppKitEarnWithdrawalExecution,
  verifyAppKitUnifiedSpendExecution,
} from '../core/execution/appKitFundMovementReceiptVerification';
import { MANIFEST_CONSTANTS } from '../providers/registry/providerManifest';

const WALLET = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const VAULT = '0x3333333333333333333333333333333333333333';
const SOURCE_TX =
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const DEST_TX =
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const EARN_TX =
  '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

function bridgeAction(providerId: string): BridgeAction {
  const now = Date.now();
  return {
    actionType: 'BRIDGE',
    actionId: `phase4e-${providerId}`,
    createdAt: now,
    chainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
    provenance: {
      source: 'PROVIDER_QUOTE',
      fetchedAt: now,
      providerId,
    },
    sourceChainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
    destinationChainId: MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
    tokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC.toLowerCase(),
    tokenDecimals: 6,
    amount: 1_000_000n,
    from: WALLET,
    to: RECIPIENT,
    providerId,
    quoteExpiresAt: now + 120_000,
  };
}

function crossChainEvidence() {
  return {
    sourceReceipt: {
      txHash: SOURCE_TX,
      status: 'success' as const,
      blockNumber: 100,
    },
    destinationReceipt: {
      txHash: DEST_TX,
      status: 'success' as const,
      blockNumber: 200,
    },
    destinationAccount: RECIPIENT,
    destinationTokenAddress:
      MANIFEST_CONSTANTS.ETH_SEPOLIA_USDC.toLowerCase(),
    destinationBalanceBefore: 10_000_000n,
    destinationBalanceAfter: 11_000_000n,
  };
}

function supplyAction(): SupplyAction {
  const now = Date.now();
  return {
    actionType: 'SUPPLY',
    actionId: 'phase4e-earn-supply-receipt',
    createdAt: now,
    chainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
    provenance: {
      source: 'PROVIDER_QUOTE',
      fetchedAt: now,
      providerId: 'circle-appkit-earn',
    },
    tokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC.toLowerCase(),
    tokenDecimals: 6,
    amount: 1_000_000n,
    from: WALLET,
    protocolAddress: VAULT,
    providerId: 'circle-appkit-earn',
  };
}

function withdrawAction(): WithdrawAction {
  const now = Date.now();
  return {
    actionType: 'WITHDRAW',
    actionId: 'phase4e-earn-withdraw-receipt',
    createdAt: now,
    chainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
    provenance: {
      source: 'PROVIDER_QUOTE',
      fetchedAt: now,
      providerId: 'circle-appkit-earn',
    },
    tokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC.toLowerCase(),
    tokenDecimals: 6,
    amount: 1_000_000n,
    to: WALLET,
    protocolAddress: VAULT,
    providerId: 'circle-appkit-earn',
  };
}

function earnEvidence(
  kind: 'deposit' | 'withdrawal',
  positionVerified = true,
) {
  return {
    receipt: {
      txHash: EARN_TX,
      status: 'success' as const,
      blockNumber: 321,
    },
    tokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC.toLowerCase(),
    vaultAddress: VAULT,
    accountAddress: WALLET,
    assetTransferFrom: kind === 'deposit' ? WALLET : VAULT,
    assetTransferTo: kind === 'deposit' ? VAULT : WALLET,
    assetTransferAmount: 1_000_000n,
    positionVerified,
  };
}

describe('Phase 4E App Kit bridge receipt verification', () => {
  it('verifies bridge only after authoritative destination delta is exact', () => {
    const result = {
      state: 'success',
      steps: [
        { name: 'burn', state: 'success', txHash: SOURCE_TX },
        { name: 'mint', state: 'success', txHash: DEST_TX },
      ],
    };

    const verification = verifyAppKitBridgeExecution({
      result,
      action: bridgeAction('circle-appkit-bridge'),
      evidence: crossChainEvidence(),
    });

    expect(verification.verified).toBe(true);
    expect(verification.actualAmount).toBe(1_000_000n);
    expect(verification.destinationTxHash).toBe(DEST_TX);
  });

  it('rejects successful-looking SDK result when destination balance delta is wrong', () => {
    const evidence = crossChainEvidence();
    evidence.destinationBalanceAfter = 10_999_999n;

    const verification = verifyAppKitBridgeExecution({
      result: {
        state: 'success',
        steps: [
          { name: 'burn', state: 'success', txHash: SOURCE_TX },
          { name: 'mint', state: 'success', txHash: DEST_TX },
        ],
      },
      action: bridgeAction('circle-appkit-bridge'),
      evidence,
    });

    expect(verification.verified).toBe(false);
    expect(verification.detail).toMatch(/delta mismatch/i);
  });

  it('rejects a bridge receipt when the reviewed source asset is not source-chain USDC', () => {
    const action = bridgeAction('circle-appkit-bridge');
    action.tokenAddress = MANIFEST_CONSTANTS.ETH_SEPOLIA_USDC.toLowerCase();

    const verification = verifyAppKitBridgeExecution({
      result: {
        state: 'success',
        steps: [
          { name: 'burn', state: 'success', txHash: SOURCE_TX },
          { name: 'mint', state: 'success', txHash: DEST_TX },
        ],
      },
      action,
      evidence: crossChainEvidence(),
    });

    expect(verification.verified).toBe(false);
    expect(verification.detail).toMatch(/source-chain USDC/i);
  });

  it('builds a VERIFIED bridge receipt with source and destination trace', () => {
    const receipt = buildVerifiedAppKitBridgeReceipt({
      result: {
        state: 'success',
        steps: [
          { name: 'burn', state: 'success', txHash: SOURCE_TX },
          { name: 'mint', state: 'success', txHash: DEST_TX },
        ],
      },
      action: bridgeAction('circle-appkit-bridge'),
      evidence: crossChainEvidence(),
    });

    expect(receipt.status).toBe('VERIFIED');
    expect(receipt.bridgeTrace?.sourceTxHash).toBe(SOURCE_TX);
    expect(receipt.bridgeTrace?.destinationTxHash).toBe(DEST_TX);
    expect(receipt.bridgeTrace?.sourceTimestamp).toBeUndefined();
    expect(receipt.bridgeTrace?.destinationTimestamp).toBeUndefined();
    expect(receipt.policyDecision).toBeNull();
  });
});

describe('Phase 4E App Kit Unified receipt verification', () => {
  it('verifies forwarded Unified spend from opaque SDK tx hashes plus chain evidence', () => {
    const verification = verifyAppKitUnifiedSpendExecution({
      result: {
        operation: {
          source: { txHash: SOURCE_TX },
          destination: { transactionHash: DEST_TX },
        },
      },
      action: bridgeAction('circle-appkit-unified-balance'),
      evidence: crossChainEvidence(),
    });

    expect(verification.verified).toBe(true);
  });

  it('refuses Unified VERIFIED receipt when provider result lacks source tx hash', () => {
    expect(() =>
      buildVerifiedAppKitUnifiedSpendReceipt({
        result: { destination: { txHash: DEST_TX } },
        action: bridgeAction('circle-appkit-unified-balance'),
        evidence: crossChainEvidence(),
      }),
    ).toThrow(/cannot produce VERIFIED receipt/i);
  });
});

describe('Phase 4E App Kit Earn receipt verification', () => {
  it('verifies Earn deposit only with exact decoded transfer and position confirmation', () => {
    const verification = verifyAppKitEarnDepositExecution({
      result: { txHash: EARN_TX },
      action: supplyAction(),
      evidence: earnEvidence('deposit'),
    });

    expect(verification.verified).toBe(true);

    const receipt = buildVerifiedAppKitEarnDepositReceipt({
      result: { txHash: EARN_TX },
      action: supplyAction(),
      evidence: earnEvidence('deposit'),
    });
    expect(receipt.status).toBe('VERIFIED');
    expect(receipt.actionType).toBe('SUPPLY');
    expect(receipt.policyDecision).toBeNull();
  });

  it('rejects Earn deposit evidence with the wrong transfer direction', () => {
    const evidence = earnEvidence('deposit');
    evidence.assetTransferFrom = VAULT;
    evidence.assetTransferTo = WALLET;

    const verification = verifyAppKitEarnDepositExecution({
      result: { txHash: EARN_TX },
      action: supplyAction(),
      evidence,
    });

    expect(verification.verified).toBe(false);
    expect(verification.detail).toMatch(/transfer direction/i);
  });

  it('blocks Earn deposit receipt when post-transaction position is unverified', () => {
    const verification = verifyAppKitEarnDepositExecution({
      result: { txHash: EARN_TX },
      action: supplyAction(),
      evidence: earnEvidence('deposit', false),
    });

    expect(verification.verified).toBe(false);
    expect(verification.detail).toMatch(/position verification/i);
  });

  it('verifies Earn withdrawal from authoritative transfer and position evidence', () => {
    const verification = verifyAppKitEarnWithdrawalExecution({
      result: { execution: { hash: EARN_TX } },
      action: withdrawAction(),
      evidence: earnEvidence('withdrawal'),
    });

    expect(verification.verified).toBe(true);

    const receipt = buildVerifiedAppKitEarnWithdrawalReceipt({
      result: { execution: { hash: EARN_TX } },
      action: withdrawAction(),
      evidence: earnEvidence('withdrawal'),
    });
    expect(receipt.status).toBe('VERIFIED');
    expect(receipt.actionType).toBe('WITHDRAW');
  });
});

describe('Phase 4E opaque App Kit result scanning', () => {
  it('collects nested tx hashes without trusting provider result schema', () => {
    const cyclic: Record<string, unknown> = {
      first: { txHash: SOURCE_TX },
      second: [{ hash: DEST_TX }],
    };
    cyclic.self = cyclic;

    expect(collectAppKitResultTxHashes(cyclic)).toEqual(
      [SOURCE_TX.toLowerCase(), DEST_TX.toLowerCase()].sort(),
    );
  });
});
