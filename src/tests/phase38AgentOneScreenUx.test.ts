import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const read=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
describe('Agent one-screen contract — no extra tabs, no old Bridge inside chat',()=>{
  const agent=read('src/components/pages/AgentPage.tsx');
  const quick=read('src/components/agent/AgentQuickStart.tsx');
  const bridge=read('src/components/pages/BridgePage.tsx');
  it('always shows the wallet-scoped, read-only total above conversation',()=>{
    expect(agent).toContain('aria-label="Your USDC balances"');
    expect(agent.indexOf('<AgentUnifiedBalances />')).toBeLessThan(agent.indexOf('aria-label="Active task"'));
    expect(quick).not.toContain("id: 'UNIFIED'");
    expect(agent).toContain('historyScope={historyScope}');
  });
  it('keeps chat messages short and uses only one Active task',()=>{
    expect(agent).toContain('activeTaskMessageId');
    expect(agent).toContain('setActiveTaskMessageId(null);');
    expect(agent).toContain('aria-label="Active task"');
    expect(agent).toContain('View active task');
    expect(agent).toContain('lg:grid-cols-');
    expect(agent).toContain('<BridgePage embedded />');
    expect(agent).not.toContain('<BridgePage />');
  });
  it('does not duplicate bridge signer or bypass existing review gates',()=>{
    expect(bridge).toContain('validateAgentBridgeDraft(candidate)');
    expect(bridge).toContain('assertNoUnresolvedSourceBurn()');
    expect(bridge).toContain('bridgeIdentityReady');
    expect(bridge).toContain('bindAgentBridgeReceipt(agentHandoffScope');
    expect(bridge).toContain('embedded = false');
    expect(agent).not.toContain('writeContract(');
    expect(agent).not.toContain('sendTransaction(');
  });
});
