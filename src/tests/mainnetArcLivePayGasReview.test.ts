import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {ARC_PRE_FUND_GAS_LIMIT,arcReviewedPayGasBudget,
 assertArcLivePayFunds} from '../mainnet/arcSharedUsdcFunding';

const gwei=1_000_000_000n;
const funds={grossMicro:10_000n,nativeBalanceWei:1_089_057n*1_000_000_000_000n,
 erc20BalanceMicro:1_089_057n,gasEstimateUnits:150_000n,
 gasPriceWei:gwei,reviewedGasWei:ARC_PRE_FUND_GAS_LIMIT*gwei};

describe('Arc Mainnet Settlement: allowance-before-gas pre-review regression',()=>{
 it('uses a real RPC-priced provisional budget if pay() estimate is unavailable before approval',()=>{
  expect(arcReviewedPayGasBudget({estimatedGasNative:0n,gasPriceWei:gwei}))
   .toEqual({wei:ARC_PRE_FUND_GAS_LIMIT*gwei,provisional:true});
  expect(arcReviewedPayGasBudget({estimatedGasNative:123_456n,gasPriceWei:gwei}))
   .toEqual({wei:123_456n,provisional:false});
  expect(()=>assertArcLivePayFunds(funds)).not.toThrow();
  // This was the original false blocker: zero review gas despite later
  // independently successful gas estimation and sufficient funds.
  expect(()=>assertArcLivePayFunds({...funds,reviewedGasWei:0n}))
   .toThrow('gas review are unavailable');
 });
 it('never invents a gas price or a successful pay() simulation when RPC failed',()=>{
  expect(arcReviewedPayGasBudget({estimatedGasNative:0n,gasPriceWei:null})).toBeNull();
  expect(arcReviewedPayGasBudget({estimatedGasNative:0n,gasPriceWei:0n})).toBeNull();
  expect(()=>assertArcLivePayFunds({...funds,gasPriceWei:0n})).toThrow('unavailable');
  expect(()=>assertArcLivePayFunds({...funds,gasEstimateUnits:0n})).toThrow('unavailable');
 });
 it('keeps exact native+ERC20 views and buffered gas funding safety',()=>{
  expect(()=>assertArcLivePayFunds({...funds,erc20BalanceMicro:funds.erc20BalanceMicro-2n}))
   .toThrow('balance views disagree');
  expect(()=>assertArcLivePayFunds({...funds,grossMicro:1_089_057n}))
   .toThrow('cannot cover payment and network gas');
  expect(()=>assertArcLivePayFunds({...funds,gasEstimateUnits:400_000n}))
   .toThrow('gas changed since Review');
 });
 it('still requires live estimate and exact contract simulation before any wallet signature',()=>{
  const source=readFileSync(new URL('../components/pages/SettlementPage.tsx',import.meta.url),'utf8');
  const index=source.indexOf('const [native,tokenBalance,gasPrice,gasUnits]=await Promise.all([');
  const fundsCall=source.indexOf('assertArcLivePayFunds({grossMicro:snapshot.amountParsed',index);
  const simulation=source.indexOf('await publicClient.simulateContract({',fundsCall);
  const checkpoint=source.indexOf('let claimAttemptId:string|null=null;',simulation);
  expect(index).toBeGreaterThan(0);
  expect(fundsCall).toBeGreaterThan(index);
  expect(simulation).toBeGreaterThan(fundsCall);
  expect(checkpoint).toBeGreaterThan(simulation);
  expect(source).toContain('Provisional budget from the current Arc gas price');
 });
});
