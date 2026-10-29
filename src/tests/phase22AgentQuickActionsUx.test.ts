import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildQuickPaymentRequest, QUICK_NETWORKS } from '../core/agent/quickStartPayment';
import { createFallbackAgentResponse } from '../core/agent/agentV2';
const recipient='0xEE8fB2f35EAAa614286e32b4813D42B5dBb76579';
const read=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');

describe('Phase 22 — human-first Agent quick actions',()=>{
  it('shows real available vs planned networks without pretending universal execution',()=>{
    expect(QUICK_NETWORKS.find(n=>n.id==='arc')?.availability).toBe('DIRECT');
    expect(QUICK_NETWORKS.find(n=>n.id==='ethereum-sepolia')?.availability).toBe('BRIDGE');
    expect(QUICK_NETWORKS.find(n=>n.id==='base-mainnet')?.availability).toBe('PLANNED');
  });
  it('composes an exact direct Arc wallet payment for review, never a signed transaction',()=>{
    const result=buildQuickPaymentRequest({
      mode:'SEND',network:'arc',amount:'2.25',recipient,recipientType:'WALLET',
    });
    expect(result).toEqual({ok:true,text:`Send 2.25 USDC to ${recipient} on Arc Testnet`,route:'Arc Testnet · direct USDC'});
    if(result.ok){
      const parsed=createFallbackAgentResponse(result.text);
      expect(parsed.intent?.candidates[0]?.actionType).toBe('TRANSFER');
      expect(parsed.intent?.candidates[0]?.amountRaw?.raw).toBe('2.25');
    }
  });
  it('composes only Arc-source verified CCTP target drafts',()=>{
    for(const [target,name] of [['ethereum-sepolia','Ethereum Sepolia'],['base-sepolia','Base Sepolia']] as const){
      const result=buildQuickPaymentRequest({mode:'BRIDGE',network:target,amount:'2',recipient,recipientType:'WALLET'});
      expect(result.ok).toBe(true);
      if(result.ok){
        expect(result.text).toBe(`Send 2 USDC from Arc Testnet to ${recipient} on ${name}`);
        expect(createFallbackAgentResponse(result.text).intent?.candidates[0]?.actionType).toBe('BRIDGE');
      }
    }
  });
  it('keeps connected Veyra friend handles on direct Arc only',()=>{
    const handle='@gau123.veyra';
    const send=buildQuickPaymentRequest({
      mode:'SEND',network:'arc',amount:'2',recipient:handle,recipientType:'FRIEND',trustedFriendHandles:[handle],
    });
    expect(send.ok).toBe(true);
    expect(buildQuickPaymentRequest({
      mode:'SEND',network:'arc',amount:'2',recipient:handle,recipientType:'FRIEND',trustedFriendHandles:[],
    }).ok).toBe(false);
    expect(buildQuickPaymentRequest({
      mode:'SEND',network:'base-sepolia',amount:'2',recipient:handle,recipientType:'FRIEND',trustedFriendHandles:[handle],
    }).ok).toBe(false);
  });
  it('fails closed for unsupported routes, invalid money and incomplete wallets',()=>{
    for(const network of ['base-mainnet','ethereum-mainnet'] as const){
      expect(buildQuickPaymentRequest({mode:'SEND',network,amount:'2',recipient,recipientType:'WALLET'}).ok).toBe(false);
    }
    for(const amount of ['0','-1','2,5','1e3','1.0000001','100000000000000000000']){
      expect(buildQuickPaymentRequest({mode:'SEND',network:'arc',amount,recipient,recipientType:'WALLET'}).ok).toBe(false);
    }
    expect(buildQuickPaymentRequest({mode:'SEND',network:'arc',amount:'2',recipient:'0xabc',recipientType:'WALLET'}).ok).toBe(false);
    expect(buildQuickPaymentRequest({mode:'BRIDGE',network:'arc',amount:'2',recipient,recipientType:'WALLET'}).ok).toBe(false);
    for(const reverse of ['ethereum-sepolia','base-sepolia'] as const){
      const result=buildQuickPaymentRequest({
        mode:'BRIDGE',sourceNetwork:reverse,network:'arc',amount:'2',recipient,recipientType:'WALLET',
      });
      expect(result.ok).toBe(false);
      if(!result.ok)expect(result.reason).toContain('Reverse Bridge execution is not enabled');
    }
  });
  it('UI selects signed friends, offers deliberate clipboard paste, keeps Swap and Unified honest',()=>{
    const ui=read('src/components/agent/AgentQuickStart.tsx');
    const agent=read('src/components/pages/AgentPage.tsx');
    expect(ui).toContain('Connected Veyra friends');
    expect(ui).toContain('navigator.clipboard.readText()');
    expect(ui).toContain("onNavigate('social')");
    expect(ui).toContain("onNavigate('convert')");
    expect(ui).toContain("onNavigate('unified')");
    expect(ui).not.toContain("onClick={() => chooseAction('BRIDGE')}");
    expect(ui).toContain('Balance view only. To transfer USDC, choose Send or Bridge separately.');
    expect(ui).toContain('provider is not yet enabled');
    expect(agent).toContain('AgentQuickStart friends={friends} signedIn={signedIn}');
    expect(agent).toContain('const connectedFriends = signedSession ?');
    expect(agent).toContain('setInput(text)');
    expect(agent).not.toContain('writeContract(');
  });
});
