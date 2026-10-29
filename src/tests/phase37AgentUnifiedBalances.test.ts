import { describe, expect, it, vi } from 'vitest';
import type { PublicClient } from 'viem';
import { readFileSync } from 'node:fs';
import { UNIFIED_TESTNET_USDC,exactDisplayTotal,readPinnedTestnetUsdc } from '../core/balance/unifiedTestnetUsdc';
import { formatArcUsdcBalance } from '../features/balance/arcUsdcBalance';
const wallet='0x4C7cb73aC8F8999af21cfc9fF4cF2333a9508Dcb';
const read=(p:string)=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const client=(chainId:number,opts?:{balance?:bigint;code?:string;badRead?:boolean})=>{
  const spy={
    getChainId:vi.fn().mockResolvedValue(chainId),
    getCode:vi.fn().mockResolvedValue(opts?.code??'0x1234'),
    readContract:vi.fn().mockImplementation(()=>opts?.badRead?Promise.reject(Error('offline'))
      :Promise.resolve(opts?.balance??0n)),
    writeContract:vi.fn(),
    signMessage:vi.fn(),
  };
  return {spy,value:spy as unknown as PublicClient};
};
describe('Phase 37 — Agent Unified USDC read-only balances',()=>{
  it('pins the exact three network/token pairs, displaying zero and six decimals truthfully',async()=>{
    expect(UNIFIED_TESTNET_USDC.map(x=>x.name)).toEqual(['Arc Testnet','Ethereum Sepolia','Base Sepolia']);
    for(const source of UNIFIED_TESTNET_USDC){
      const c=client(source.chainId,{balance:source.chainId===UNIFIED_TESTNET_USDC[1].chainId?119_270_433n:0n});
      const r=await readPinnedTestnetUsdc(c.value,source,wallet,100);
      expect(r.status).toBe('AVAILABLE');
      if(r.status==='AVAILABLE')
        expect(formatArcUsdcBalance(r.balance)).toBe(
          source.chainId===UNIFIED_TESTNET_USDC[1].chainId?'119.270433':'0.00');
      expect(c.spy.getCode).toHaveBeenCalledWith({address:source.token});
      expect(c.spy.readContract).toHaveBeenCalledWith(expect.objectContaining({
        address:source.token,functionName:'balanceOf',args:[wallet],
      }));
      expect(c.spy.writeContract).not.toHaveBeenCalled();
      expect(c.spy.signMessage).not.toHaveBeenCalled();
    }
  });
  it('fails closed on wrong-chain, missing token bytecode, bad address and RPC failure',async()=>{
    const src=UNIFIED_TESTNET_USDC[1];
    for(const c of [client(1),client(src.chainId,{code:'0x'}),client(src.chainId,{badRead:true})]){
      const r=await readPinnedTestnetUsdc(c.value,src,wallet,100);
      expect(r.status).toBe('UNAVAILABLE');
      expect(c.spy.writeContract).not.toHaveBeenCalled();
    }
    expect((await readPinnedTestnetUsdc(undefined,src,wallet)).status).toBe('UNAVAILABLE');
    expect((await readPinnedTestnetUsdc(client(src.chainId).value,src,'0x123')).status).toBe('UNAVAILABLE');
  });
  it('never invents aggregate when any chain is unknown, duplicated or absent',()=>{
    const ids=UNIFIED_TESTNET_USDC.map(x=>x.chainId);
    const a=ids.map(chainId=>({chainId,status:'AVAILABLE' as const,balance:119_270_433n,readAt:1}));
    expect(exactDisplayTotal(a)).toBe(357_811_299n);
    expect(exactDisplayTotal(a.slice(0,2))).toBeNull();
    expect(exactDisplayTotal([a[0],a[1],a[1]])).toBeNull();
    expect(exactDisplayTotal([a[0],a[1],{chainId:ids[2],status:'UNAVAILABLE',reason:'timeout'}])).toBeNull();
    expect(formatArcUsdcBalance(9_007_199_254_740_993_123_456_789n)).toContain('9,007,199');
  });
  it('reads only when wallet connected, preserves exact status, and stays in Agent',()=>{
    const ui=read('src/components/agent/AgentUnifiedBalances.tsx');
    const quick=read('src/components/agent/AgentQuickStart.tsx');
    expect(ui).toContain('usePublicClient({chainId:M.ARC_TESTNET_CHAIN_ID})');
    expect(ui).toContain('usePublicClient({chainId:M.ETH_SEPOLIA_CHAIN_ID})');
    expect(ui).toContain('usePublicClient({chainId:M.BASE_SEPOLIA_CHAIN_ID})');
    expect(ui).toContain('owner=address.toLowerCase()');
    expect(ui).toContain('if(id===latest.current)');
    expect(ui).toContain('Unavailable');
    expect(ui).toContain('Total USDC across 3 Testnets');
    expect(ui).toContain("'Display-only total · Funds remain on separate networks · Not spendable as one balance'");
    expect(ui).toContain('Combined display hidden until all networks are readable');
    expect(ui.indexOf('Total USDC across 3 Testnets')).toBeLessThan(ui.indexOf('UNIFIED_TESTNET_USDC.map(source=>'));
    expect(ui).not.toContain('writeContract');
    expect(ui).not.toContain('signMessage');
    expect(quick).toContain('<AgentUnifiedBalances key={address?.toLowerCase()');
    expect(quick).not.toContain("onNavigate('unified')");
    expect(quick).toContain('Reverse Bridge unavailable · Source allowance is 0 or insufficient');
    expect(quick).toContain("useState<QuickAction>('UNIFIED')");
    expect(quick).toContain('Swap · Preview only');
    const card=read('src/components/transfer/ActionCard.tsx');
    expect(card).toContain('Use Base Sepolia (Testnet) · Prepare draft');
    expect(card).toContain('Base Mainnet · not enabled');
    expect(card).toContain("onClarifyDestination('Base Sepolia')");
    expect(card).toContain('No network is chosen or signed automatically.');
  });
});
