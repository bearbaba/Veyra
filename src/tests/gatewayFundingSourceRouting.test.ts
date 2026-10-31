import { describe,expect,it } from 'vitest';
import { createFallbackAgentResponse, validateAgentChatResponse } from '../core/agent/agentV2';

describe('Unified means Gateway source, not Bridge or wallet ERC20',()=>{
  it('blocks Gateway-to-Base Send rather than creating a wallet-funded CCTP Bridge',()=>{
    const result=createFallbackAgentResponse(
      'Gửi 10 USDC từ Unified Balance đến 0x1111111111111111111111111111111111111111 trên Base Sepolia',
    );
    expect(result.intent?.status).toBe('UNSUPPORTED');
    expect(result.intent?.candidates[0].actionType).toBe('TRANSFER');
    expect(result.reply).toMatch(/Gateway/);
    expect(result.reply).toMatch(/không tự đổi thành Bridge/);
  });
  it('blocks Gateway-funded swap separately without wallet-sourcing a trade',()=>{
    const response=createFallbackAgentResponse('Swap 10 USDC to EURC from Unified Balance');
    expect(response.intent?.status).toBe('UNSUPPORTED');
    expect(response.intent?.candidates[0].actionType).toBe('CONVERT');
    expect(response.reply).toMatch(/will not switch your funding source/);
  });
  it('does not allow untrusted LLM to relabel Gateway Send as Arc wallet transfer',()=>{
    const intent={
      displaySummary:'wallet transfer',status:'RESOLVED',
      candidates:[{
        actionType:'TRANSFER',recipient:'0x1111111111111111111111111111111111111111',
        fromAmount:'10',fromCurrency:'USDC',sourceChain:'Arc Testnet',confidence:0.99,
      }],parsedAt:Date.now(),
    };
    const result=validateAgentChatResponse({
      ok:true,reply:'Ready to pay using Arc wallet',locale:'en',mode:'ACTION',
      intent,capabilities:{conversation:'ONLINE',planning:'ONLINE',execution:'AVAILABLE'},
    },'Send 10 USDC from Circle Gateway Unified Balance to Base Sepolia');
    expect(result.intent?.status).toBe('UNSUPPORTED');
    expect(result.reply).toMatch(/Gateway funds/);
  });
  it('still recognizes explicit wallet Bridge without triggering Gateway rule',()=>{
    const r=createFallbackAgentResponse('Bridge 5 USDC from Arc Testnet to Base Sepolia to 0x1111111111111111111111111111111111111111');
    expect(r.intent?.candidates[0].actionType).toBe('BRIDGE');
  });
});