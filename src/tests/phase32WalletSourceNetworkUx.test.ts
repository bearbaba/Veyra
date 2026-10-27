import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ensureWalletNetworkForSigning } from '../core/wallet/ensureWalletNetworkForSigning';
import { MANIFEST_CONSTANTS } from '../providers/registry/providerManifest';
const ARC=MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID;
const SEPOLIA=MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID;
const read=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');

describe('Phase 32 — request supported source network only at wallet signing boundary',()=>{
  it('does not show an unnecessary switch prompt if wallet is already on Arc, even if UI is stale',async()=>{
    const change=vi.fn((_id:number)=>Promise.reject(new Error('should never switch')));
    await expect(ensureWalletNetworkForSigning(()=>Promise.resolve(ARC),change,ARC,'Arc Testnet'))
      .resolves.toBe('ALREADY_SELECTED');
    expect(change).not.toHaveBeenCalled();
  });
  it('offers a single switch when on Ethereum Sepolia and independently confirms the resulting network',async()=>{
    let current: number=SEPOLIA;
    const change=vi.fn((id:number)=>{current=id;return Promise.resolve();});
    await expect(ensureWalletNetworkForSigning(()=>Promise.resolve(current),change,ARC,'Arc Testnet'))
      .resolves.toBe('SWITCHED');
    expect(change).toHaveBeenCalledOnce();
    expect(change).toHaveBeenCalledWith(ARC);
  });
  it('preserves route and refuses signing when network selection is rejected or the provider lies',async()=>{
    const rejected=vi.fn(()=>Promise.reject(Object.assign(new Error('User rejected'),{code:4001})));
    await expect(ensureWalletNetworkForSigning(()=>Promise.resolve(SEPOLIA),rejected,ARC,'Arc Testnet'))
      .rejects.toThrow('Network switch cancelled');
    await expect(ensureWalletNetworkForSigning(()=>Promise.resolve(SEPOLIA),()=>Promise.resolve(),ARC,'Arc Testnet'))
      .rejects.toThrow('has not confirmed');
  });
  it('bounds a stuck wallet network request and never starts a wallet transaction',async()=>{
    vi.useFakeTimers();
    try{
      const result=ensureWalletNetworkForSigning(()=>Promise.resolve(SEPOLIA),
        ()=>new Promise<never>(()=>{}),ARC,'Arc Testnet',40);
      const assertion=expect(result).rejects.toThrow('Network selection timed out');
      await vi.advanceTimersByTimeAsync(41);
      await assertion;
    }finally{vi.useRealTimers();}
  });
  it('bridges with read-only review and network request only after Approve/Confirm clicks',()=>{
    const page=read('src/components/pages/BridgePage.tsx');
    expect(page).toContain("const { switchChainAsync } = useSwitchChain()");
    expect(page).toContain("await ensureWalletNetworkForSigning(");
    expect(page).toContain("() => walletClient.getChainId()");
    expect(page).toContain("await assertNoUnresolvedSourceBurn()");
    expect(page).toContain("await selectArcForSourceSignature(action.from)");
    expect(page).toContain("await selectArcForSourceSignature(executionAction.from)");
    expect(page).not.toContain("reason: 'Switch your wallet to Arc Testnet before approving USDC.");
    expect(page).toContain('Verify recorded receive (no signing)');
    expect(page).toContain("simulateCctpSourceBurn(sourcePublicClient, executionAction)");
    expect(page).toContain("simulateExactCctpApproval(sourcePublicClient,action)");
    expect(page).not.toContain('simulationCompleted: true');
  });
  it('registers both CCTP destinations with the wallet, without claiming universal network support',()=>{
    const config=read('src/config.ts');
    expect(config).toContain('chains: [arcTestnet, sepolia, baseSepolia, mainnet]');
    expect(config).toContain("[baseSepolia.id]: http('https://sepolia.base.org'");
    const page=read('src/components/pages/BridgePage.tsx');
    expect(page).toContain('MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID');
    expect(page).toContain('MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID');
    expect(page).toContain('sourceNetworkChangeNeeded');
  });
});
