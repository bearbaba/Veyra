import { describe, expect, it } from 'vitest';
import { validateStableFxFundingPresign, type StableFxTradeStatus } from '../providers/stablefx/stableFxAdapter';
import { MANIFEST_CONSTANTS as M } from '../providers/registry/providerManifest';

// Synthetic contract schema fixture, NOT a Circle quote or successful swap.
const trade:StableFxTradeStatus={
  id:'c2558cd1-98b5-4ccd-90b8-96891512af20', contractTradeId:'24',status:'pending_settlement',
  from:{currency:'USDC',amount:'10.000000'},to:{currency:'EURC',amount:'9.100000'},
};
function funding() {
  return {
    ok:true,tradeId:trade.id,contractTradeId:trade.contractTradeId,fetchedAt:Date.now(),
    typedData:{
      domain:{
        name:'Permit2',chainId:M.ARC_TESTNET_CHAIN_ID as number,
        verifyingContract:'0x000000000022D473030F116dDEE9F6B43aC78BA3',
      },
      types:{PermitWitnessTransferFrom:[]},
      primaryType:'PermitWitnessTransferFrom',
      message:{
        permitted:{token:M.ARC_TESTNET_USDC as string,amount:'10000000'},
        spender:'0xa8f94168b4981840ba27d423f4ad6332bedee006',
        nonce:'42', deadline:Math.floor(Date.now()/1000)+600,
        witness:{id:'24'},
      },
    },
  };
}
describe('StableFX funding: second signature restricted to exact trade',()=>{
  it('accepts matching funding intent without submitting anything',()=>{
    const valid=validateStableFxFundingPresign(funding(),trade);
    expect(valid.typedData.primaryType).toBe('PermitWitnessTransferFrom');
    expect(valid.contractTradeId).toBe('24');
  });
  it('rejects wrong trade or a replay under a different trade ID',()=>{
    const f=funding();f.typedData.message.witness.id='25';
    expect(()=>validateStableFxFundingPresign(f,trade)).toThrow(/different trade/);
    const g=funding();g.tradeId='mismatched';
    expect(()=>validateStableFxFundingPresign(g,trade)).toThrow(/different trade/);
  });
  it('rejects altered token, amount or unlimited approval',()=>{
    const a=funding();a.typedData.message.permitted.token=M.ARC_TESTNET_EURC;
    expect(()=>validateStableFxFundingPresign(a,trade)).toThrow(/different token/);
    const b=funding();b.typedData.message.permitted.amount='10000001';
    expect(()=>validateStableFxFundingPresign(b,trade)).toThrow(/permission differs/);
    const c=funding();c.typedData.message.permitted.amount='115792089237316195423570985008687907853269984665640564039457584007913129639935';
    expect(()=>validateStableFxFundingPresign(c,trade)).toThrow(/permission differs/);
  });
  it('rejects malicious chains, verifier, spender, expiry and stale responses',()=>{
    const a=funding();a.typedData.domain.chainId=M.ETH_SEPOLIA_CHAIN_ID;
    expect(()=>validateStableFxFundingPresign(a,trade)).toThrow(/domain/);
    const b=funding();b.typedData.domain.verifyingContract=M.ARC_TESTNET_USDC;
    expect(()=>validateStableFxFundingPresign(b,trade)).toThrow(/domain/);
    const c=funding();c.typedData.message.spender='0x0000000000000000000000000000000000000000';
    expect(()=>validateStableFxFundingPresign(c,trade)).toThrow(/spender/);
    const d=funding();d.typedData.message.deadline=0;
    expect(()=>validateStableFxFundingPresign(d,trade)).toThrow(/expired/);
    const e=funding();e.fetchedAt=Date.now()-100000;
    expect(()=>validateStableFxFundingPresign(e,trade)).toThrow(/stale/);
  });
});
