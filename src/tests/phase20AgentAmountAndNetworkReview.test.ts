import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createFallbackAgentResponse, validateAgentChatResponse } from '../core/agent/agentV2';
import { validateIntentResponse, type IntentCandidate } from '../core/intent/intentSchema';
import { validateAgentTransferDraft } from '../core/agent/transferDraftGate';

const WALLET = '0xEE8fB2f35EAAa614286e32b4813D42B5dBb76579';
const rawCandidate=(amount:string,sourceChain='Arc'):IntentCandidate=>
  validateIntentResponse({status:'RESOLVED',candidates:[{
    actionType:'TRANSFER',recipient:WALLET,fromAmount:amount,fromCurrency:'USDC',
    sourceChain,destinationChain:sourceChain,confidence:0.9,
  }]}).candidates[0];
const read=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');

describe('Phase 20 — Agent money and chain must never be misrepresented',()=>{
  it('does not read the 0 from a recipient address as an amount',()=>{
    const input=`gửi cho ${WALLET} 2 usdc mạng base`;
    const response=createFallbackAgentResponse(input);
    expect(response.intent?.candidates[0]?.amountRaw?.raw).toBe('2');
    expect(response.intent?.candidates[0]?.recipientRaw?.raw).toBe(WALLET);
    // "Base" does not specify Mainnet vs Base Sepolia. The safe response is
    // a clarification, not a directly executable Base transfer.
    expect(response.intent?.candidates[0]?.sourceChainRaw?.raw).toBe('Arc Testnet');
    expect(response.intent?.candidates[0]?.destinationChainRaw?.raw).toBe('Base');
    expect(response.intent?.candidates[0]?.actionType).toBe('BRIDGE');
    expect(response.intent?.status).toBe('NEEDS_CLARIFICATION');
    expect(response.mode).toBe('CLARIFICATION');
    expect(response.reply).toMatch(/Arc Testnet/);
    expect(response.reply).toMatch(/Base Sepolia/);
    expect(validateAgentTransferDraft(response.intent!.candidates[0]).ok).toBe(false);
  });
  it('allows exactly 2 USDC on the supported Arc Testnet route',()=>{
    const response=createFallbackAgentResponse(`gửi cho ${WALLET} 2 USDC mạng Arc`);
    expect(response.intent?.status).toBe('RESOLVED');
    expect(response.intent?.candidates[0]?.amountRaw?.raw).toBe('2');
    expect(validateAgentTransferDraft(response.intent!.candidates[0])).toEqual({ok:true,amount:'2'});
  });
  it('requires a real amount when the request contains only an address',()=>{
    const response=createFallbackAgentResponse(`gửi cho ${WALLET} USDC`);
    expect(response.intent?.status).toBe('NEEDS_CLARIFICATION');
    expect(response.intent?.candidates[0]?.amountRaw).toBeUndefined();
  });
  it('fails closed for zero, negative and imprecise LLM amounts',()=>{
    for(const amount of ['0','0.0','0.000000','-1','2,5','1e3','2.0000001','2 USDC extra']){
      expect(validateAgentTransferDraft(rawCandidate(amount)).ok).toBe(false);
      const result=validateIntentResponse({status:'RESOLVED',candidates:[{
        actionType:'TRANSFER',recipient:WALLET,amountRaw:amount,tokenRaw:'USDC',
      }]});
      if(['0','0.0','0.000000','-1','2,5','1e3','2 USDC extra'].includes(amount)){
        expect(result.status).toBe('NEEDS_CLARIFICATION');
      }
    }
  });
  it('blocks fabricated LLM Base route and incorrect token regardless of confidence',()=>{
    for(const network of ['Base','Ethereum','8453','Base Sepolia']){
      expect(validateAgentTransferDraft(rawCandidate('2',network)).ok).toBe(false);
    }
    const wrong=rawCandidate('2','Arc');
    wrong.tokenRaw={kind:'UNTRUSTED_STRING',raw:'EURC'};
    expect(validateAgentTransferDraft(wrong).ok).toBe(false);
  });
  it('does not pass invalid wallet prefixes or truncated hex strings',()=>{
    const wrong=rawCandidate('2');
    wrong.recipientRaw={kind:'UNTRUSTED_STRING',raw:'0xabc'};
    expect(validateAgentTransferDraft(wrong).ok).toBe(false);
  });
  it('checks both Agent card and Pay session handoff before presenting a review',()=>{
    const card=read('src/components/transfer/ActionCard.tsx');
    const pay=read('src/components/pages/PayPage.tsx');
    expect(card).toContain('validateAgentTransferDraft(best)');
    expect(card).toContain("intent.status === 'RESOLVED'");
    expect(card).toContain('transferGate?.ok');
    expect(pay).toContain('validateAgentTransferDraft(candidate)');
    expect(pay).toContain('setAmount(gate.amount)');
    expect(pay).not.toContain("candidate.amountRaw.raw.match(/\\d+");
    const model=validateAgentChatResponse({
      reply:'Review this payment',mode:'ACTION',intent:{status:'RESOLVED',candidates:[{
        actionType:'TRANSFER',recipient:WALLET,fromAmount:'0',fromCurrency:'USDC',confidence:1,
      }]},
    },'send 2 USDC');
    expect(model.intent?.status).toBe('NEEDS_CLARIFICATION');
  });
});
