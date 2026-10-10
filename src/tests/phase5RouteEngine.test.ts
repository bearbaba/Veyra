import { describe, expect, it } from 'vitest';
import { MANIFEST_CONSTANTS } from '../providers/registry/providerManifest';
import { cctpV2BridgeProvider } from '../providers/cctp/cctpBridgeProvider';
import {
  buildRouteId,
  selectBridgeRoutes,
} from '../core/router/routeEngine';
import type {
  BridgeProviderAdapter,
  BridgeProviderExecutionRuntime,
  RouteQuoteParams,
} from '../providers/bridge/bridgeProviderTypes';

const SENDER = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';

function params(
  clientIntentId = '11111111-1111-4111-8111-111111111111',
): RouteQuoteParams {
  return {
    clientIntentId,
    senderAddress: SENDER,
    recipientSnapshotId: `direct:${RECIPIENT.toLowerCase()}`,
    destinationAddress: RECIPIENT,
    sourceChainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
    destinationChainId: MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
    sourceTokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
    amountIn: 1_000_000n,
  };
}

describe('Phase 5 bridge RouteEngine', () => {
  it('returns the enabled CCTP direct route with deterministic execution context', async () => {
    const result = await selectBridgeRoutes({
      params: params(),
      adapters: [cctpV2BridgeProvider],
      runtimeEnvironment: 'testnet',
    });

    expect(result.routes).toHaveLength(1);
    const route = result.routes[0];
    expect(route.provider).toBe('cctp-v2-bridge');
    expect(route.amountIn).toBe(1_000_000n);
    expect(route.amountOut).toBe(1_000_000n);
    expect(route.hops).toHaveLength(1);
    expect(route.multiHopEnabled).toBe(false);
    expect(route.destinationTokenAddress.toLowerCase()).toBe(
      MANIFEST_CONSTANTS.ETH_SEPOLIA_USDC.toLowerCase(),
    );
  });

  it('builds a different routeId for a different client intent even when money fields match', () => {
    const common = {
      senderAddress: SENDER,
      recipientSnapshotId: `direct:${RECIPIENT.toLowerCase()}`,
      amountIn: 1_000_000n,
      sourceTokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
      sourceChainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
      destinationTokenAddress: MANIFEST_CONSTANTS.ETH_SEPOLIA_USDC,
      destinationChainId: MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
      provider: 'cctp-v2-bridge',
      providerVersion: 'cctp-v2-api',
    };

    expect(
      buildRouteId({
        ...common,
        clientIntentId: '11111111-1111-4111-8111-111111111111',
      }),
    ).not.toBe(
      buildRouteId({
        ...common,
        clientIntentId: '22222222-2222-4222-8222-222222222222',
      }),
    );
  });

  it('excludes an adapter that is not lifecycle ENABLED', async () => {
    const disabled: BridgeProviderAdapter = {
      ...cctpV2BridgeProvider,
      capabilities: {
        ...cctpV2BridgeProvider.capabilities,
        lifecycleStage: 'IMPLEMENTED',
      },
    };

    const result = await selectBridgeRoutes({
      params: params(),
      adapters: [disabled],
      runtimeEnvironment: 'testnet',
    });

    expect(result.routes).toEqual([]);
    expect(result.excludedProviders[0]?.reason).toBe(
      'CAPABILITY_OR_LIFECYCLE_NOT_ELIGIBLE',
    );
  });

  it('drops an expired provider route even when the provider is enabled', async () => {
    const expired: BridgeProviderAdapter = {
      ...cctpV2BridgeProvider,
      quoteRoute: async (input) => {
        const route = await cctpV2BridgeProvider.quoteRoute(input);
        if (!route) return null;
        return {
          ...route,
          quotedAt: 1,
          expiresAt: 2,
          ttlMs: 1,
        };
      },
    };

    const result = await selectBridgeRoutes({
      params: params(),
      adapters: [expired],
      runtimeEnvironment: 'testnet',
      now: 10,
    });

    expect(result.routes).toEqual([]);
    expect(result.excludedProviders[0]?.reason).toBe(
      'UNSAFE_OR_EXPIRED_ROUTE',
    );
  });

  it('executes a reviewed route only through a matching provider runtime', async () => {
    const route = await cctpV2BridgeProvider.quoteRoute(params());
    expect(route).not.toBeNull();
    if (!route) throw new Error('expected CCTP route');

    let executedRouteId: string | null = null;
    const runtime: BridgeProviderExecutionRuntime = {
      providerId: 'cctp-v2-bridge',
      execute: (runtimeRoute) => {
        executedRouteId = runtimeRoute.routeId;
        return Promise.resolve();
      },
      resume: () => Promise.resolve(),
    };

    await cctpV2BridgeProvider.execute(route, runtime, () => undefined);
    expect(executedRouteId).toBe(route.routeId);

    await expect(
      cctpV2BridgeProvider.execute(
        route,
        { ...runtime, providerId: 'wrong-provider' },
        () => undefined,
      ),
    ).rejects.toThrow(/not bound/i);
  });

  it('resumes only a CCTP-bound resume payload/runtime', async () => {
    let resumedPlanId: unknown;
    const runtime: BridgeProviderExecutionRuntime = {
      providerId: 'cctp-v2-bridge',
      execute: () => Promise.resolve(),
      resume: (payload) => {
        resumedPlanId = payload.payload.planId;
        return Promise.resolve();
      },
    };

    await cctpV2BridgeProvider.resume(
      {
        provider: 'cctp-v2-bridge',
        version: 1,
        payload: { planId: 'route-123' },
      },
      runtime,
      () => undefined,
    );
    expect(resumedPlanId).toBe('route-123');

    await expect(
      cctpV2BridgeProvider.resume(
        {
          provider: 'circle-gateway',
          version: 1,
          payload: { planId: 'route-123' },
        },
        runtime,
        () => undefined,
      ),
    ).rejects.toThrow(/not bound/i);
  });

  it('drops multi-hop output from a provider that has not enabled multi-hop', async () => {
    const multiHop: BridgeProviderAdapter = {
      ...cctpV2BridgeProvider,
      quoteRoute: async (input) => {
        const route = await cctpV2BridgeProvider.quoteRoute(input);
        if (!route) return null;
        return {
          ...route,
          multiHopEnabled: false,
          hops: [
            ...route.hops,
            {
              ...route.hops[0],
              hopIndex: 1,
            },
          ],
        };
      },
    };

    const result = await selectBridgeRoutes({
      params: params(),
      adapters: [multiHop],
      runtimeEnvironment: 'testnet',
    });

    expect(result.routes).toEqual([]);
  });
});
