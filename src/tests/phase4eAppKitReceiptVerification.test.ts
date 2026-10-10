import { describe, expect, it } from 'vitest';
import type { ConvertAction } from '../core/actions/actionSchema';
import {
  buildVerifiedAppKitSwapReceipt,
  verifyAppKitSwapExecution,
} from '../core/execution/appKitReceiptVerification';
import { MANIFEST_CONSTANTS } from '../providers/registry/providerManifest';

const WALLET = '0x1111111111111111111111111111111111111111';
const TX_HASH = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function reviewedAction(): ConvertAction {
  const now = Date.now();
  return {
    actionType: 'CONVERT',
    actionId: 'phase4e-swap-receipt',
    createdAt: now,
    chainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
    provenance: {
      source: 'PROVIDER_QUOTE',
      fetchedAt: now,
      providerId: 'circle-appkit-swap',
    },
    fromTokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC.toLowerCase(),
    toTokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_EURC.toLowerCase(),
    fromTokenDecimals: 6,
    toTokenDecimals: 6,
    amountIn: 1_000_000n,
    minAmountOut: 990_000n,
    slippageBps: 100,
    quoteExpiresAt: now + 120_000,
    providerId: 'circle-appkit-swap',
  };
}

function sdkResult(amountOut = '0.995') {
  return {
    amountIn: '1.0',
    amountOut,
    chainIn: 'Arc_Testnet',
    chainOut: 'Arc_Testnet',
    progress: { status: 'DONE', substatus: 'COMPLETED' },
    txHash: TX_HASH,
    tokenIn: 'USDC',
    tokenOut: 'EURC',
    fromAddress: WALLET,
    toAddress: WALLET,
  };
}

describe('Phase 4E App Kit receipt verification', () => {
  it('verifies only when SDK output and authoritative chain evidence agree', () => {
    const result = verifyAppKitSwapExecution({
      result: sdkResult(),
      action: reviewedAction(),
      expectedRecipientAddress: WALLET,
      receipt: {
        txHash: TX_HASH,
        status: 'success',
        blockNumber: 123,
        outputAmount: 995_000n,
      },
    });

    expect(result.verified).toBe(true);
    expect(result.authoritativeOutputAmount).toBe(995_000n);
  });

  it('rejects provider output that disagrees with decoded chain output', () => {
    const result = verifyAppKitSwapExecution({
      result: sdkResult(),
      action: reviewedAction(),
      expectedRecipientAddress: WALLET,
      receipt: {
        txHash: TX_HASH,
        status: 'success',
        blockNumber: 123,
        outputAmount: 994_999n,
      },
    });

    expect(result.verified).toBe(false);
    expect(result.detail).toMatch(/authoritative output amount/i);
  });

  it('rejects output below the reviewed minimum', () => {
    const result = verifyAppKitSwapExecution({
      result: sdkResult('0.98'),
      action: reviewedAction(),
      expectedRecipientAddress: WALLET,
      receipt: {
        txHash: TX_HASH,
        status: 'success',
        blockNumber: 123,
        outputAmount: 980_000n,
      },
    });

    expect(result.verified).toBe(false);
    expect(result.detail).toMatch(/below reviewed minimum/i);
  });

  it('rejects a ConvertAction outside the verified Arc USDC/EURC pair', () => {
    const action = reviewedAction();
    action.toTokenAddress = '0x4444444444444444444444444444444444444444';

    const result = verifyAppKitSwapExecution({
      result: sdkResult(),
      action,
      expectedRecipientAddress: WALLET,
      receipt: {
        txHash: TX_HASH,
        status: 'success',
        blockNumber: 123,
        outputAmount: 995_000n,
      },
    });

    expect(result.verified).toBe(false);
    expect(result.detail).toMatch(/verified Arc Testnet USDC\/EURC/i);
  });

  it('builds VERIFIED receipt only from successful authoritative evidence', () => {
    const receipt = buildVerifiedAppKitSwapReceipt({
      result: sdkResult(),
      action: reviewedAction(),
      expectedRecipientAddress: WALLET,
      receipt: {
        txHash: TX_HASH,
        status: 'success',
        blockNumber: 123,
        outputAmount: 995_000n,
      },
    });

    expect(receipt.status).toBe('VERIFIED');
    expect(receipt.executionTxHash).toBe(TX_HASH);
    expect(receipt.actualAmountDelta).toBe(995_000n);
    expect(receipt.policyDecision).toBeNull();
  });
});
