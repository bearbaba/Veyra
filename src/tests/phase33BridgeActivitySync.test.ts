import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  bridgeReceiptHasUnresolvedSource, bridgeReceiptDisplayStatus,
} from '../core/bridge/bridgeActivityStatus';
import type { ActivityReceiptRemoteRecord } from '../lib/api/activityReceiptApi';

const make=(patch:Partial<ActivityReceiptRemoteRecord>={}):ActivityReceiptRemoteRecord=>({
  receiptId:'r1', clientIntentId:'intent', senderAddress:'0x4C7cb73aC8F8999af21cfc9fF4cF2333a9508Dcb',
  senderChainId:5042002, recipientAddress:'0xD6b8A3A5eB329410D9504784812b8569afA8C2aF',
  recipientChainId:11155111, amountRaw:'10000000', amountDecimals:6,
  assetId:'USDC', tokenAddress:'0x3600000000000000000000000000000000000000',
  providerId:'cctp-v2-bridge', providerVersion:'2', routeId:'route',
  surface:'BRIDGE', action:'BRIDGE', status:'RECEIVE_PENDING', revision:5,
  burnTxHash:'0x'+'a'.repeat(64),burnChainId:5042002,burnBlockNumber:1,
  receiveTxHash:'0x'+'b'.repeat(64),receiveChainId:11155111,receiveBlockNumber:null,
  settlementReceiveTxHash:null,settlementReceiveBlockNumber:null,settlementAttemptNumber:null,
  resumable:true,resumePayload:null,failureReason:null,
  createdAt:'2026-10-27T10:00:00Z', updatedAt:'2026-10-27T10:10:00Z',
  confirmedAt:null,completedAt:null,failedAt:null,cancelledAt:null,
  ...patch,
});

const page=readFileSync(new URL('../components/pages/BridgePage.tsx',import.meta.url),'utf8');

describe('Phase 33 — Bridge must show authenticated receipts, not call a draft success',()=>{
  it('distinguishes previous completed Bridge from pending destination and source-only confirmation',()=>{
    expect(bridgeReceiptDisplayStatus('COMPLETE')).toEqual({
      label:'Destination verified',terminal:true,success:true,
    });
    for(const status of ['SIGNED','BROADCAST','SOURCE_CONFIRMED','ATTESTATION_PENDING',
      'RECEIVE_PENDING','RECEIVE_FAILED_RETRYABLE','CONFIRMED'] as const){
      expect(bridgeReceiptDisplayStatus(status).success).toBe(false);
    }
  });
  it('locks fresh burn when any previous CCTP source submission has not been resolved',()=>{
    for(const status of ['SIGNED','BROADCAST','SOURCE_CONFIRMED',
      'ATTESTATION_PENDING','RECEIVE_PENDING','RECEIVE_FAILED_RETRYABLE','CONFIRMED'] as const){
      expect(bridgeReceiptHasUnresolvedSource(make({status}))).toBe(true);
    }
    expect(bridgeReceiptHasUnresolvedSource(make({status:'FAILED'}))).toBe(true);
    expect(bridgeReceiptHasUnresolvedSource(make({status:'FAILED',
      failureReason:'SOURCE_TRANSACTION_REVERTED_VERIFIED'}))).toBe(false);
    expect(bridgeReceiptHasUnresolvedSource(make({status:'COMPLETE'}))).toBe(false);
    expect(bridgeReceiptHasUnresolvedSource(make({providerId:'arc-erc20-transfer'}))).toBe(false);
    expect(bridgeReceiptHasUnresolvedSource(make({status:'PREFLIGHT_PASSED',burnTxHash:null}))).toBe(false);
  });
  it('shows a wallet-scoped older receipt separately from the new preview, never fabricates status',()=>{
    expect(page).toContain('Recent Bridge · not this draft');
    expect(page).toContain("r.providerId === 'cctp-v2-bridge'");
    expect(page).toContain("r.senderAddress.toLowerCase() === owner");
    expect(page).toContain('formatRemoteActivityAmount(recentBridge)');
    expect(page).toContain('buildTxExplorerUrl(recentBridge.receiveChainId ?? recentBridge.recipientChainId');
    expect(page).toContain('recentBridge.status===\'COMPLETE\'');
    expect(page).toContain('Source confirmation alone is not proof that USDC arrived.');
  });
  it('loads authenticated BFF history, blocks fresh signing on unavailable history, and rechecks immediately before money actions',()=>{
    expect(page).toContain('loadActivityReceiptsRemote(100)');
    expect(page).toContain("historyLoading || historyError");
    expect(page).toContain('!bridgeIdentityReady || newBridgeLocked');
    expect(page).toContain('const receipts = await loadActivityReceiptsRemote(100)');
    expect(page).toContain('bridgeReceiptHasUnresolvedSource(r)');
    expect(page).toContain('await assertNoUnresolvedSourceBurn()');
    expect(page).toContain("disabled={disabled}");
    expect(page).toContain('Check Bridge history first');
  });
});
