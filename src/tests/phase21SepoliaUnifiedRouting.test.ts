import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createFallbackAgentResponse, validateAgentChatResponse } from '../core/agent/agentV2';
import { validateAgentBridgeDraft } from '../core/agent/bridgeDraftGate';
import { validateAgentTransferDraft } from '../core/agent/transferDraftGate';
import { validateIntentResponse } from '../core/intent/intentSchema';
const RECIPIENT='0xEE8fB2f35EAAa614286e32b4813D42B5dBb76579';
const read=(p:string)=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');

describe('Phase 21 — Unified testnet payment destination fidelity',()=>{
  it('keeps Sepolia ambiguous and asks which Testnet destination, without offering review',()=>{
    const result=createFallbackAgentResponse(`gửi cho ${RECIPIENT} 2 usdc qua sepolia giúp tôi`);
    expect(result.intent?.status).toBe('NEEDS_CLARIFICATION');
    expect(result.intent?.candidates[0]?.actionType).toBe('BRIDGE');
    expect(result.intent?.candidates[0]?.amountRaw?.raw).toBe('2');
    expect(result.intent?.candidates[0]?.recipientRaw?.raw).toBe(RECIPIENT);
    expect(result.intent?.candidates[0]?.destinationChainRaw?.raw).toBe('Sepolia');
    expect(result.reply).toMatch(/Ethereum Sepolia.*Base Sepolia/);
    expect(validateAgentBridgeDraft(result.intent!.candidates[0]).ok).toBe(false);
  });
  for (const [destination,chainId] of [['Ethereum Sepolia',11155111],['Base Sepolia',84532]] as const){
    it(`routes explicit ${destination} through Arc CCTP preflight, not direct Arc Pay`,()=>{
      const text=`gửi cho ${RECIPIENT} 2 usdc qua ${destination}`;
      const result=createFallbackAgentResponse(text);
      expect(result.intent?.status).toBe('RESOLVED');
      expect(result.intent?.candidates[0]?.actionType).toBe('BRIDGE');
      const bridge=validateAgentBridgeDraft(result.intent!.candidates[0]);
      expect(bridge).toEqual({ok:true,amount:'2',destinationChainId:chainId,recipientAddress:RECIPIENT});
      expect(validateAgentTransferDraft(result.intent!.candidates[0]).ok).toBe(false);
    });
  }
  it('never invents a route if source chain is Base or Ethereum Sepolia',()=>{
    for (const source of ['Base','Ethereum Sepolia']){
      const result=createFallbackAgentResponse(`Send 2 USDC from ${source} to ${RECIPIENT} on Base Sepolia`);
      expect(result.intent?.status).toBe('UNSUPPORTED');
      expect(validateAgentBridgeDraft(result.intent!.candidates[0]).ok).toBe(false);
    }
  });
  it('does not override user network with untrusted LLM transfer',()=>{
    const command=`gửi cho ${RECIPIENT} 2 usdc qua sepolia giúp tôi`;
    const result=validateAgentChatResponse({
      reply:'Ready to pay on Arc',mode:'ACTION',
      intent:{status:'RESOLVED',candidates:[{
        actionType:'TRANSFER',amountRaw:'2',tokenRaw:'USDC',recipientRaw:RECIPIENT,confidence:1,
      }]},
    },command);
    expect(result.intent?.status).toBe('NEEDS_CLARIFICATION');
    expect(result.intent?.candidates[0]?.actionType).toBe('BRIDGE');
    expect(result.reply).toMatch(/Sepolia/);
  });
  it('rejects arbitrary model-invented routing, amount or destination',()=>{
    const candidate=validateIntentResponse({status:'RESOLVED',candidates:[{
      actionType:'BRIDGE',fromAmount:'2',fromCurrency:'USDC',
      recipient:RECIPIENT,sourceChain:'Arc Testnet',destinationChain:'Base Mainnet',
    }]}).candidates[0];
    expect(validateAgentBridgeDraft(candidate).ok).toBe(false);
    candidate.destinationChainRaw={kind:'UNTRUSTED_STRING',raw:'Ethereum Sepolia'};
    candidate.amountRaw={kind:'UNTRUSTED_STRING',raw:'0'};
    expect(validateAgentBridgeDraft(candidate).ok).toBe(false);
    candidate.amountRaw={kind:'UNTRUSTED_STRING',raw:'2'};
    candidate.recipientRaw={kind:'UNTRUSTED_STRING',raw:'@friend.veyra'};
    expect(validateAgentBridgeDraft(candidate).ok).toBe(false);
  });
  it('requires a validated bridge draft at Agent CTA and at Bridge mount',()=>{
    const action=read('src/components/transfer/ActionCard.tsx');
    const bridge=read('src/components/pages/BridgePage.tsx');
    expect(action).toContain('validateAgentBridgeDraft(best)');
    expect(action).toContain('onClarifyDestination');
    expect(bridge).toContain('validateAgentBridgeDraft(candidate)');
    expect(bridge).toContain('setDestChainId(gate.destinationChainId)');
    expect(bridge).toContain('selectBridgeRoutes');
    expect(bridge).toContain('freshPreflight');
    expect(bridge).not.toContain('window.ethereum.request({method:\'eth_sendTransaction\'');
  });
});
