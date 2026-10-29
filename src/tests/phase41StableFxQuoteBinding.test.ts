import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  validateStableFxQuoteResponse,
  type StableFxQuoteRequest,
} from '../providers/stablefx/stableFxAdapter';
import { MANIFEST_CONSTANTS as M } from '../providers/registry/providerManifest';

// Synthetic security fixture only: NOT a provider quote or an executable offer.
const recipient='0x4C7cb73aC8F8999af21cfc9fF4cF2333a9508Dcb' as const;
const req:StableFxQuoteRequest={
  fromCurrency:'USDC',toCurrency:'EURC',fromAmount:'10.00',recipientAddress:recipient,
};
const quote=()=>{
  const deadline=Math.floor((Date.now()+10*60_000)/1000);
  return {
    id:'quote-for-regression-testing-001',
    from:{currency:'USDC',amount:'10.00'},
    to:{currency:'EURC',amount:'9.15'},
    rate:'0.9150',
    fee:{currency:'USDC',amount:'0.01'},
    expiresAt:new Date(Date.now()+5*60_000).toISOString(),
    typedData:{
      domain:{name:'Permit2',chainId:M.ARC_TESTNET_CHAIN_ID,verifyingContract:'0x000000000022D473030F116dDEE9F6B43aC78BA3'},
      types:{PermitWitnessTransferFrom:[]},
      primaryType:'PermitWitnessTransferFrom',
      message:{
        permitted:{token:M.ARC_TESTNET_USDC,amount:'10000000'},
        spender:'0xa8f94168b4981840ba27d423f4ad6332bedee006',
        deadline,
        witness:{recipient:recipient as string},
      },
    },
  };
};
const check=(v:unknown,overrides?:Partial<StableFxQuoteRequest>,fetchedAt=Date.now())=>
  validateStableFxQuoteResponse(v,{...req,...overrides},fetchedAt);

describe('StableFX signed quote is not trusted merely because API returned 200',()=>{
  it('accepts precisely bound Arc Testnet USDC/EURC shape without executing it',()=>{
    const q=check(quote());
    expect(q.from.amount).toBe('10.00');
    expect(q.to.amount).toBe('9.15');
    expect(q.fee.amount).toBe('0.01');
    expect(q.typedData.domain.chainId).toBe(M.ARC_TESTNET_CHAIN_ID);
  });
  it('fails closed for incorrect chain, token and Permit2 contract',()=>{
    const wrongChain=quote();wrongChain.typedData.domain.chainId=11155111;
    expect(()=>check(wrongChain)).toThrow(/chain/);
    const wrongToken=quote();wrongToken.typedData.message.permitted.token=M.ARC_TESTNET_EURC;
    expect(()=>check(wrongToken)).toThrow(/different token/);
    const wrongVerifier=quote();wrongVerifier.typedData.domain.verifyingContract=M.ARC_TESTNET_USDC;
    expect(()=>check(wrongVerifier)).toThrow(/Permit2 verifier/);
  });
  it('rejects mismatched wallet, trade amount and unlimited permission',()=>{
    const wrongWallet=quote();wrongWallet.typedData.message.witness.recipient='0x000000000000000000000000000000000000dEaD';
    expect(()=>check(wrongWallet)).toThrow(/different wallet/);
    const changedInput=quote();changedInput.from.amount='11.00';
    expect(()=>check(changedInput)).toThrow(/differ/);
    const changedPermit=quote();changedPermit.typedData.message.permitted.amount='115792089237316195423570985008687907853269984665640564039457584007913129639935';
    expect(()=>check(changedPermit)).toThrow(/permission/);
    const overflow=quote();(overflow.typedData.message.permitted as Record<string,unknown>).amount=Number.MAX_SAFE_INTEGER+10;
    expect(()=>check(overflow)).toThrow(/unsafe/);
  });
  it('rejects expired, stale, malformed fee and malformed requested input',()=>{
    const expired=quote();expired.expiresAt=new Date(Date.now()-1000).toISOString();
    expect(()=>check(expired)).toThrow(/expired/);
    const deadline=quote();deadline.typedData.message.deadline=0;
    expect(()=>check(deadline)).toThrow(/expired/);
    expect(()=>check(quote(),undefined,Date.now()-90_000)).toThrow(/stale/);
    const badFee=quote();badFee.fee.currency='EURC';
    expect(()=>check(badFee)).toThrow(/fee/);
    expect(()=>check(quote(),{fromAmount:'10garbage'})).toThrow(/six-decimal/);
  });
  it('keeps BFF exact input validation and all financial write gates intact',()=>{
    const bff=readFileSync(new URL('../../server/bff.ts',import.meta.url),'utf8');
    expect(bff).toContain('parseUnits(fromAmount,6)<=0n');
    expect(bff).toContain('isAddress(recipientAddress)');
    const hook=readFileSync(new URL('../hooks/useConvertExecution.ts',import.meta.url),'utf8');
    expect(hook).toContain("status: 'SETTLEMENT_PENDING'");
    expect(hook).toContain("status: 'PENDING'");
    expect(hook).not.toContain('actualAmountDelta: verification.actualAmount,\n        expectedAmountDelta: action.minAmountOut,\n        riskScore: null,\n        policyDecision: \'PASS\'');
  });
});
