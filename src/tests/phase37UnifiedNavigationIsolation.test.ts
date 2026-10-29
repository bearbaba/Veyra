import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const read=(p:string)=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
describe('Phase 37 — Unified stays inside Agent; Bridge review does not navigate',()=>{
  it('does not create a competing Unified primary tab',()=>{
    const shell=read('src/components/layout/AppShell.tsx');
    const app=read('src/App.tsx');
    const cmd=read('src/components/command/CommandBar.tsx');
    expect(shell).not.toContain("'unified' |");
    expect(shell).not.toContain("{ id: 'unified',");
    expect(app).not.toContain("case 'unified':");
    expect(cmd).not.toContain("page: 'unified' as VeyraPage");
  });
  it('keeps read-only portfolio in Agent without auto Bridge handoff',()=>{
    const quick=read('src/components/agent/AgentQuickStart.tsx');
    expect(quick).not.toContain('<AgentUnifiedBalances');
    const agent=read('src/components/pages/AgentPage.tsx');
    expect(agent).toContain('<AgentUnifiedBalances />');
    expect(quick).not.toContain("onNavigate('unified')");
    expect(quick).not.toContain("id: 'UNIFIED'");
    const portfolio=read('src/components/agent/AgentUnifiedBalances.tsx');
    expect(portfolio).toContain('Total USDC across 3 Testnets');
    expect(portfolio).not.toContain('writeContract(');
  });
  it('reviews vetted Bridge inside Agent using existing source controls',()=>{
    const agent=read('src/components/pages/AgentPage.tsx');
    const card=read('src/components/transfer/ActionCard.tsx');
    const bridge=read('src/components/pages/BridgePage.tsx');
    expect(agent).toContain('onReviewBridgeInline={() => setInlineBridgeMessageId(activeTaskMessage.id)}');
    expect(agent).toContain('<BridgePage embedded />');
    expect(agent).not.toContain('<BridgePage />');
    expect(agent).toContain('aria-label="Active task"');
    expect(card).toContain('if (onReviewBridgeInline) onReviewBridgeInline();');
    expect(card).toContain('beginAgentBridgeHandoff(');
    expect(bridge).toContain("sessionStorage.getItem('veyra:agent-intent')");
    expect(bridge).toContain('validateAgentBridgeDraft(candidate)');
    expect(bridge).toContain('assertNoUnresolvedSourceBurn()');
    expect(bridge).toContain('embedded = false');
  });
});
