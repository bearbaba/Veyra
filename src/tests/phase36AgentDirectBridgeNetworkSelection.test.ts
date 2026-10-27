import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildQuickPaymentRequest } from '../core/agent/quickStartPayment';

const read=(p:string)=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const recipient='0xEE8fB2f35EAAa614286e32b4813D42B5dBb76579';

describe('Phase 36 — select supported Bridge networks directly in Agent',()=>{
  it('preserves the verified Arc → Sepolia/Base draft and never silently rewrites source',()=>{
    for(const target of ['ethereum-sepolia','base-sepolia'] as const){
      const result=buildQuickPaymentRequest({
        mode:'BRIDGE',sourceNetwork:'arc',network:target,
        amount:'2',recipient,recipientType:'WALLET',
      });
      expect(result.ok).toBe(true);
      if(result.ok){
        expect(result.text).toContain('from Arc Testnet');
        expect(result.route).toContain('CCTP V2');
      }
    }
    for(const source of ['ethereum-sepolia','base-sepolia'] as const){
      const result=buildQuickPaymentRequest({
        mode:'BRIDGE',sourceNetwork:source,network:'arc',
        amount:'2',recipient,recipientType:'WALLET',
      });
      expect(result.ok).toBe(false);
      if(!result.ok)expect(result.reason).toContain('Reverse Bridge execution is not enabled');
    }
  });
  it('makes source and destination independently selectable in Agent, not buried in Bridge',()=>{
    const ui=read('src/components/agent/AgentQuickStart.tsx');
    const bridge=read('src/components/pages/BridgePage.tsx');
    expect(ui).toContain('Bridge source network');
    expect(ui).toContain('Bridge destination network');
    expect(ui).toContain("next==='arc'?'ethereum-sepolia':'arc'");
    expect(ui).toContain("reverse ? QUICK_NETWORKS.filter((n)=>n.id==='arc')");
    expect(ui).toContain('Check route (no signing)');
    expect(ui).toContain('inspectReverseCctpSource(client');
    expect(bridge).not.toContain('Explore reverse Bridge · read-only checks');
    expect(bridge).toContain('Arc → Sepolia / Base · Available');
  });
  it('invalidates old balance/allowance when the wallet, amount, recipient or network changes',()=>{
    const ui=read('src/components/agent/AgentQuickStart.tsx');
    expect(ui).toContain("const lookupKey = [bridgeSource,network,amount,wallet,address??''].join(':')");
    expect(ui).toContain('reverseLookup?.key === lookupKey');
    expect(ui).toContain('checkId.current++');
    expect(ui).toContain('checkId.current===requestId');
    expect(ui).toContain('setReverseLookup(null)');
    expect(ui).toContain('setReverseChecking(false)');
    expect(ui).toContain("setTimeout(()=>resolve({status:'UNAVAILABLE'");
  });
  it('reverse route stays read-only even when RPC simulation passes',()=>{
    const ui=read('src/components/agent/AgentQuickStart.tsx');
    expect(ui).toContain('Reverse Bridge remains unavailable for signing');
    expect(ui).toContain('Source-chain RPC check only');
    expect(ui).toContain("reverse ? (");
    expect(ui).toContain('onClick={()=>void checkReverseRoute()}');
    expect(ui).not.toContain('approveTokenMessenger(');
    expect(ui).not.toContain('broadcastDepositForBurn(');
    expect(ui).not.toContain('writeContract(');
  });
});
