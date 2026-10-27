import { describe, expect, it, vi } from 'vitest';
import type { PublicClient } from 'viem';
import { readFileSync } from 'node:fs';
import {
  inspectReverseCctpSource, reverseCctpSourceToken, REVERSE_CCTP_SOURCES,
} from '../core/bridge/reverseCctpReadiness';
import { MANIFEST_CONSTANTS as M } from '../providers/registry/providerManifest';

const sender='0x4C7cb73aC8F8999af21cfc9fF4cF2333a9508Dcb';
const recipient='0xD6b8A3A5eB329410D9504784812b8569afA8C2aF';
const params=(sourceChainId:number, amount=2_000_000n)=>({sourceChainId, sender,recipient,amount});
const stub=(chainId:number,opts?:{balance?:bigint;allowance?:bigint;messengerCode?:string;failSimulation?:boolean})=>{
  const c={
    getChainId:vi.fn(()=>Promise.resolve(chainId)),
    getCode:vi.fn((q:{address:string})=>Promise.resolve(
      q.address.toLowerCase()===M.CCTP_V2_TOKEN_MESSENGER.toLowerCase()
        ? opts?.messengerCode??'0x1234' : '0x1234')),
    readContract:vi.fn((q:{functionName:string})=>
      Promise.resolve(q.functionName==='balanceOf' ? opts?.balance??8_000_000n : opts?.allowance??4_000_000n)),
    simulateContract:vi.fn((q:unknown)=>opts?.failSimulation
      ?Promise.reject(new Error('contract reverted')):Promise.resolve({request:q})),
    writeContract:vi.fn(()=>Promise.reject(new Error('must never be called'))),
  };
  return {client:c as unknown as PublicClient,spy:c};
};
const page=readFileSync(new URL('../components/pages/BridgePage.tsx',import.meta.url),'utf8');
const agent=readFileSync(new URL('../components/agent/AgentQuickStart.tsx',import.meta.url),'utf8');
const server=readFileSync(new URL('../../server/services/activityReceiptService.ts',import.meta.url),'utf8');

describe('Phase 35 — reverse CCTP Testnet readiness is strictly read-only',()=>{
  it('pins both source token addresses and Arc CCTP as destination without pretending to execute',()=>{
    expect(REVERSE_CCTP_SOURCES.map(x=>x.chainId)).toEqual([M.ETH_SEPOLIA_CHAIN_ID,M.BASE_SEPOLIA_CHAIN_ID]);
    expect(reverseCctpSourceToken(M.ETH_SEPOLIA_CHAIN_ID)).toBe(M.ETH_SEPOLIA_USDC);
    expect(reverseCctpSourceToken(M.BASE_SEPOLIA_CHAIN_ID)).toBe(M.BASE_SEPOLIA_USDC);
    expect(reverseCctpSourceToken(M.ARC_TESTNET_CHAIN_ID)).toBeNull();
    expect(reverseCctpSourceToken(1)).toBeNull();
    expect(server).toContain('input.sourceChainId !== MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID');
  });

  it.each([M.ETH_SEPOLIA_CHAIN_ID,M.BASE_SEPOLIA_CHAIN_ID])(
    'performs an exact read-only source burn eth_call on chain %s',async(chainId)=>{
      const {client,spy}=stub(chainId);
      const result=await inspectReverseCctpSource(client,params(chainId));
      expect(result.status).toBe('SIMULATED');
      expect(spy.simulateContract).toHaveBeenCalledOnce();
      const call=spy.simulateContract.mock.calls[0][0] as {args:readonly unknown[]; account:string;address:string};
      expect(call.address.toLowerCase()).toBe(M.CCTP_V2_TOKEN_MESSENGER.toLowerCase());
      expect(call.account.toLowerCase()).toBe(sender.toLowerCase());
      expect(call.args[0]).toBe(2_000_000n);
      expect(call.args[1]).toBe(M.ARC_TESTNET_CCTP_DOMAIN);
      expect(String(call.args[3]).toLowerCase()).toBe(reverseCctpSourceToken(chainId)?.toLowerCase());
      expect(spy.writeContract).not.toHaveBeenCalled();
    });

  it('holds on missing source USDC and allowance without creating an approval request',async()=>{
    const a=stub(M.ETH_SEPOLIA_CHAIN_ID,{balance:500n,allowance:4_000_000n});
    expect((await inspectReverseCctpSource(a.client,params(M.ETH_SEPOLIA_CHAIN_ID))).status)
      .toBe('INSUFFICIENT_BALANCE');
    expect(a.spy.simulateContract).not.toHaveBeenCalled();

    const b=stub(M.BASE_SEPOLIA_CHAIN_ID,{allowance:0n});
    expect((await inspectReverseCctpSource(b.client,params(M.BASE_SEPOLIA_CHAIN_ID))).status)
      .toBe('APPROVAL_REQUIRED');
    expect(b.spy.writeContract).not.toHaveBeenCalled();
    expect(b.spy.simulateContract).not.toHaveBeenCalled();
  });

  it('fails closed on unexpected RPC chain, missing contract, contract revert and malformed receiver',async()=>{
    const wrong=stub(M.ARC_TESTNET_CHAIN_ID);
    expect((await inspectReverseCctpSource(wrong.client,params(M.BASE_SEPOLIA_CHAIN_ID))).status)
      .toBe('UNAVAILABLE');
    expect(wrong.spy.readContract).not.toHaveBeenCalled();

    const absent=stub(M.BASE_SEPOLIA_CHAIN_ID,{messengerCode:'0x'});
    expect((await inspectReverseCctpSource(absent.client,params(M.BASE_SEPOLIA_CHAIN_ID))).status)
      .toBe('UNAVAILABLE');

    const revert=stub(M.ETH_SEPOLIA_CHAIN_ID,{failSimulation:true});
    expect((await inspectReverseCctpSource(revert.client,params(M.ETH_SEPOLIA_CHAIN_ID))).status)
      .toBe('UNAVAILABLE');

    expect((await inspectReverseCctpSource(revert.client,
      {...params(M.ETH_SEPOLIA_CHAIN_ID),recipient:'0x0'})).status).toBe('UNAVAILABLE');
    expect((await inspectReverseCctpSource(revert.client,
      {...params(M.ETH_SEPOLIA_CHAIN_ID),amount:0n})).status).toBe('UNAVAILABLE');
  });

  it('preserves the approved Arc-outbound flow and does not expose a reverse signing button',()=>{
    expect(agent).toContain('Bridge source network');
    expect(agent).toContain('Bridge destination network');
    expect(agent).toContain('Check route (no signing)');
    expect(agent).toContain('inspectReverseCctpSource(client');
    expect(agent).toContain('Reverse Bridge remains unavailable for signing');
    expect(page).not.toContain('Explore reverse Bridge · read-only checks');
    expect(page).toContain('Arc → Sepolia / Base · Available');
    expect(page).toContain('Sepolia / Base → Arc · Coming soon');
    expect(page).toContain('newBridgeLocked');
    expect(page).toContain('await assertNoUnresolvedSourceBurn()');
    expect(page).not.toContain('Approve reverse USDC');
  });
});
