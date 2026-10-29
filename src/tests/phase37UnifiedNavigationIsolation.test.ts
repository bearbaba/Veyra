import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const read=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');

describe('Phase 37 — Unified is separate from Bridge and financial drafts',()=>{
  it('exposes Unified as an independent primary navigation surface',()=>{
    const shell=read('src/components/layout/AppShell.tsx');
    const app=read('src/App.tsx');
    const commands=read('src/components/command/CommandBar.tsx');
    expect(shell).toContain("'bridge' | 'unified' | 'activity'");
    expect(shell).toContain("{ id: 'unified', label: 'Unified'");
    expect(shell).toContain('PRIMARY_NAV.map((item)');
    expect(app).toContain("case 'unified':");
    expect(app).toContain('return <UnifiedBalancePage />');
    expect(commands).toContain("page: 'unified' as VeyraPage");
    expect(app).toContain("case 'bridge':");
  });
  it('renders the same read-only USDC reader and never a financial executor',()=>{
    const unified=read('src/components/pages/UnifiedBalancePage.tsx');
    expect(unified).toContain('<AgentUnifiedBalances />');
    expect(unified).toContain('Unified Balance');
    expect(unified).toContain('No transfer is initiated from this page.');
    for(const forbidden of ['BridgePage', 'beginAgentBridgeHandoff',
      'writeContract(', 'signTypedData', "onNavigate('bridge')",
      'sessionStorage', 'window.location', "onNavigate('convert')"])
      expect(unified).not.toContain(forbidden);
  });
  it('prevents Unified quick action from swapping to a Bridge draft in-place',()=>{
    const quick=read('src/components/agent/AgentQuickStart.tsx');
    const section=quick.split(") : action === 'SWAP' ? (")[1]?.split(") : (")[1] ?? '';
    expect(section).toContain('<AgentUnifiedBalances key=');
    expect(section).toContain("onNavigate('unified')");
    expect(section).toContain('Balance view only.');
    expect(section).not.toContain("chooseAction('BRIDGE')");
    expect(section).not.toContain("onNavigate('bridge')");
    expect(section).not.toContain('Create draft');
    expect(quick).toContain('onPrepare(result.text)');
  });
});
