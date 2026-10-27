import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginAgentBridgeHandoff, bindAgentBridgeReceipt,
  readAgentBridgeReceiptLinks, agentBridgeReceiptState,
} from '../core/agent/agentBridgeReceiptLink';
import type { ActivityReceiptRemoteRecord } from '../lib/api/activityReceiptApi';
import { readFileSync } from 'node:fs';

const read=(p:string)=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const scope='wallet:connector:veyra-owner-A', other='wallet:connector:veyra-owner-B';
const route={amountRaw:'2000000',destinationChainId:11155111,
  recipientAddress:'0xD6b8A3A5eB329410D9504784812b8569afA8C2aF'};
const stubReceipt=(status:ActivityReceiptRemoteRecord['status'], providerId='cctp-v2-bridge')=>
  ({status,providerId} as ActivityReceiptRemoteRecord);

describe('Phase 34 — Agent Bridge status comes from exact durable receipt',()=>{
  const store=new Map<string,string>();
  beforeEach(()=>{
    store.clear();
    vi.stubGlobal('sessionStorage',{
      getItem:(key:string)=>store.get(key)??null,
      setItem:(key:string,value:string)=>{store.set(key,value);},
      removeItem:(key:string)=>{store.delete(key);},
    });
  });
  afterEach(()=>{vi.unstubAllGlobals();});
  it('links only the exact owner-scoped Agent request after the real BFF receipt is created',()=>{
    beginAgentBridgeHandoff(scope,'agent-msg-1',route);
    expect(bindAgentBridgeReceipt(other,'receipt-1',route)).toBe(false);
    expect(bindAgentBridgeReceipt(scope,'receipt-1',{...route,amountRaw:'20000000'})).toBe(false);
    expect(bindAgentBridgeReceipt(scope,'receipt-1',{...route,destinationChainId:84532})).toBe(false);
    expect(bindAgentBridgeReceipt(scope,'receipt-1',{...route,recipientAddress:'0x0000000000000000000000000000000000000001'})).toBe(false);
    expect(bindAgentBridgeReceipt(scope,'receipt-1',route)).toBe(true);
    expect(readAgentBridgeReceiptLinks(scope).map(x=>x.receiptId)).toEqual(['receipt-1']);
    expect(readAgentBridgeReceiptLinks(other)).toEqual([]);
    expect(bindAgentBridgeReceipt(scope,'receipt-2',route)).toBe(false);
  });
  it('cannot report success from a draft, source burn, attestation, receive broadcast or unknown receipt',()=>{
    expect(agentBridgeReceiptState(undefined)).toBe('CHECKING');
    for(const status of ['PREFLIGHT_PASSED','SIGNED','BROADCAST','SOURCE_CONFIRMED',
      'ATTESTATION_PENDING','RECEIVE_PENDING','RECEIVE_FAILED_RETRYABLE','CONFIRMED'] as const){
      expect(agentBridgeReceiptState(stubReceipt(status))).toBe('PENDING');
    }
    expect(agentBridgeReceiptState(stubReceipt('COMPLETE'))).toBe('SUCCESS');
    expect(agentBridgeReceiptState(stubReceipt('COMPLETE','fake-provider'))).toBe('CHECKING');
    expect(agentBridgeReceiptState(stubReceipt('FAILED'))).toBe('FAILED');
  });
  it('does not invent wallet state on failed backend fetch or cross-wallet return',()=>{
    const page=read('src/components/pages/AgentPage.tsx');
    expect(page).toContain('readAgentBridgeReceiptLinks(historyScope)');
    expect(page).toContain('loadActivityReceiptsRemote(100)');
    expect(page).toContain('receipt.senderAddress.toLowerCase() === currentWallet');
    expect(page).toContain("receipt.providerId === 'cctp-v2-bridge'");
    expect(page).toContain("setReceiptLookupFailed(true)");
    expect(page).toContain("receipt.receiptId === link.receiptId");
    expect(page).toContain('window.addEventListener(\'focus\', refresh)');
    expect(page).toContain('Your previous Agent request has a verified destination receipt');
  });
  it('never repeats an already submitted Agent proposal as a fresh ready-to-review action',()=>{
    const card=read('src/components/transfer/ActionCard.tsx');
    const bridge=read('src/components/pages/BridgePage.tsx');
    expect(card).toContain('isActionable && !linkedBridge');
    expect(card).toContain('View completed receipt');
    expect(card).toContain("beginAgentBridgeHandoff(bridgeHandoffScope ?? null, messageId");
    expect(bridge).toContain('bindAgentBridgeReceipt(agentHandoffScope, activityReceipt.receiptId');
    expect(bridge).toContain('await bridgeExecution.executeProviderRoute(');
  });
  it('does not advertise unsupported reverse Bridge execution as working',()=>{
    const provider=read('src/providers/cctp/cctpBridgeProvider.ts');
    const bridge=read('src/components/pages/BridgePage.tsx');
    expect(provider).toContain('sourceChainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID');
    expect(bridge).toContain('Sepolia / Base → Arc · Coming soon');
    expect(bridge).toContain('Arc → Sepolia / Base · Available');
  });
});
