import { describe, expect, it } from 'vitest';
import { buildCapabilityIntentGraph } from '../core/agent/intentGraph';
import { buildAgentPlanReview } from '../core/agent/agentPlanReview';

const arcTestnet = {
  networkId: 'arc-testnet',
  displayName: 'Arc Testnet',
  family: 'EVM' as const,
  chainId: 5042002,
};

const ethSepolia = {
  networkId: 'ethereum-sepolia',
  displayName: 'Ethereum Sepolia',
  family: 'EVM' as const,
  chainId: 11155111,
};

describe('Phase 4B Agent plan review', () => {
  it('blocks financial nodes when deterministic context is missing', () => {
    const graph = buildCapabilityIntentGraph('Bridge 10 USDC to Ethereum');
    const review = buildAgentPlanReview(graph, { routeRequests: {} });
    expect(review.readyForReview).toBe(false);
    expect(review.nodes[0]?.status).toBe('NEEDS_CONTEXT');
    expect(review.totalWalletSignatures).toBe(0);
    expect(review.veyraAddedSignatures).toBe(0);
  });

  it('routes a bridge node through enabled registry providers only', () => {
    const graph = buildCapabilityIntentGraph('Bridge 10 USDC to Ethereum');
    const review = buildAgentPlanReview(graph, {
      routeRequests: {
        'node-1': {
          capability: 'BRIDGE',
          source: arcTestnet,
          destination: ethSepolia,
          assetAddress: '0x3600000000000000000000000000000000000000',
          providerFacts: {
            'cctp-v2-bridge': {
              allowance: 'SUFFICIENT',
              destinationRelayAvailable: true,
              sourceSwitchAutomated: true,
              cost: { feeUsd: 0.2, etaSeconds: 60 },
            },
            'circle-appkit-bridge': {
              allowance: 'SUFFICIENT',
              destinationRelayAvailable: true,
              sourceSwitchAutomated: true,
              cost: { feeUsd: 0.01, etaSeconds: 10 },
            },
          },
        },
      },
    });

    expect(review.readyForReview).toBe(true);
    expect(review.nodes[0]?.status).toBe('ROUTED');
    expect(review.nodes[0]?.selectedRoute?.providerId).toBe('cctp-v2-bridge');
    expect(review.totalWalletSignatures).toBe(1);
    expect(review.veyraAddedSignatures).toBe(0);
    expect(review.totalManualNetworkSwitches).toBe(0);
  });

  it('keeps reserve internal and propagates dependency failure', () => {
    const graph = buildCapabilityIntentGraph(
      'Keep 300 USDC on Arc, bridge 200 USDC to Ethereum, then earn the rest',
    );
    const review = buildAgentPlanReview(graph, {
      routeRequests: {
        // node-2 intentionally omitted so it becomes NEEDS_CONTEXT
        'node-3': {
          capability: 'EARN',
          operation: 'EARN_DEPOSIT',
          source: arcTestnet,
          assetAddress: '0x3600000000000000000000000000000000000000',
        },
      },
    });

    expect(review.nodes[0]?.status).toBe('INTERNAL');
    expect(review.nodes[1]?.status).toBe('NEEDS_CONTEXT');
    expect(review.nodes[2]?.status).toBe('BLOCKED_DEPENDENCY');
    expect(review.readyForReview).toBe(false);
  });

  it('rejects mismatched resolved capability instead of trusting caller input', () => {
    const graph = buildCapabilityIntentGraph('Bridge 10 USDC to Ethereum');
    const review = buildAgentPlanReview(graph, {
      routeRequests: {
        'node-1': {
          capability: 'SWAP',
          source: arcTestnet,
          assetAddress: '0x3600000000000000000000000000000000000000',
        },
      },
    });
    expect(review.readyForReview).toBe(false);
    expect(review.nodes[0]?.status).toBe('NEEDS_CONTEXT');
    expect(review.nodes[0]?.explanation).toMatch(/does not match/i);
  });
});
