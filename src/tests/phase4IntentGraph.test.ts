import { describe, expect, it } from 'vitest';
import { buildCapabilityIntentGraph } from '../core/agent/intentGraph';

describe('Phase 4A Agent intent graph', () => {
  it('splits a multi-step money goal into ordered capability nodes', () => {
    const graph = buildCapabilityIntentGraph('Keep 300 USDC on Arc, send @bearcrypto2021 50 USDC, bridge 200 USDC to Arbitrum, then earn the rest');
    expect(graph.nodes.map((node) => node.capability)).toEqual(['RESERVE', 'PAY', 'BRIDGE', 'EARN']);
    expect(graph.nodes[1]?.recipientRaw).toBe('@bearcrypto2021');
    expect(graph.nodes[2]?.destinationNetworkRaw).toBe('Arbitrum');
    expect(graph.nodes[3]?.amountRaw).toBe('rest');
    expect(graph.nodes[3]?.dependsOn).toEqual(['node-3']);
  });

  it('does not create an executable-looking node for unrelated chat', () => {
    expect(buildCapabilityIntentGraph('hello, tell me what Veyra is').nodes).toEqual([]);
  });
});
