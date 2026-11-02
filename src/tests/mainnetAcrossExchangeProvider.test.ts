import {describe,expect,it,vi} from 'vitest';
import {isMainnetIdentityOnlyRouteAllowed} from '../../server/services/mainnetIdentityOnlyRoutes';
import {AcrossQuoteError,isAcrossConfigured,normalizeAcrossQuote,quoteAcrossBaseWethToArcUsdc,
 validateAcrossQuoteRequest,validateAcrossTrackingResponse,
 ACROSS_BASE_WETH,ACROSS_ARC_USDC} from '../../server/services/acrossExchangeQuoteService';
import {EXCHANGE_ASSETS,resolveExchangeRoute,exchangeAssetSupport,
 hasAvailableExchangeDestination} from '../mainnet/exchangeCatalog';
import {normalizeAcrossExchangeQuote} from '../mainnet/exchangeProviderQuote';
const owner='0x1111111111111111111111111111111111111111';
const amount='1000000000000000'; // 0.001 WETH, 18 decimals
const selection={sourceChainId:8453,destinationChainId:5042,inputToken:ACROSS_BASE_WETH,
 outputToken:ACROSS_ARC_USDC,owner,amount};
const env={ACROSS_API_KEY:'not-a-real-key',ACROSS_INTEGRATOR_ID:'0x1234'};
const now=1783000000000;
const payload={
 inputToken:{address:ACROSS_BASE_WETH,chainId:8453,decimals:18,symbol:'WETH'},
 outputToken:{address:ACROSS_ARC_USDC,chainId:5042,decimals:6,symbol:'USDC'},
 inputAmount:amount,expectedOutputAmount:'1999000',minOutputAmount:'1985000',
 quoteExpiryTimestamp:Math.floor(now/1000)+65,expectedFillTime:4,
 steps:{originSwap:{},bridge:{}},approvalTxns:[{chainId:8453,to:ACROSS_BASE_WETH,data:'0x'}],
 swapTx:{simulationSuccess:true,chainId:8453,to:'0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64',
  data:'0x1234'},fees:{total:'3000'},
};
describe('Across candidate: server-only live quote without token impersonation or arbitrary signing',()=>{
 it('keeps unaccepted routes separate from existing Circle Swap/Bridge',()=>{
  const from=EXCHANGE_ASSETS.find(v=>v.chainId===8453&&v.symbol==='WETH')!;
  const to=EXCHANGE_ASSETS.find(v=>v.chainId===5042&&v.symbol==='USDC')!;
  expect(resolveExchangeRoute(from,to).kind).toBe('quote-only');
  expect(exchangeAssetSupport(from,to)).toBe('quote-only');
  expect(hasAvailableExchangeDestination(from)).toBe(true);
  expect(resolveExchangeRoute(to,from).kind).toBe('unavailable');
  expect(exchangeAssetSupport(to,to)).toBe('unsupported');
 });
 it('accepts exact wallet, Base WETH and Arc USDC only',()=>{
  expect(validateAcrossQuoteRequest(selection)).toMatchObject(selection);
  for(const change of [{sourceChainId:5042},{destinationChainId:8453},
   {inputToken:'0x2222222222222222222222222222222222222222'},
   {outputToken:'0x3333333333333333333333333333333333333333'},
   {owner:'wrong'},{amount:'50000000000000000000'}]){
   expect(()=>validateAcrossQuoteRequest({...selection,...change})).toThrow(AcrossQuoteError);
  }
 });
 it('does not contact the provider without a server API key and registered ID',async()=>{
  const fetcher=vi.fn();
  expect(isAcrossConfigured({})).toBe(false);
  await expect(quoteAcrossBaseWethToArcUsdc(selection,{},fetcher)).rejects.toMatchObject({
   code:'ACROSS_NOT_CONFIGURED',httpStatus:503});
  expect(fetcher).not.toHaveBeenCalled();
 });
 it('requests an actual provider quote with server-only credentials and no calldata returned',async()=>{
  const fetcher=vi.fn((_url:RequestInfo|URL)=>Promise.resolve(new Response(JSON.stringify(payload),{
   status:200,headers:{'content-type':'application/json'}})));
  const quote=await quoteAcrossBaseWethToArcUsdc(selection,env,fetcher,now);
  expect(quote).toMatchObject({provider:'Across',executionReady:false,
   inputAmountRaw:amount,minimumOutputRaw:'1985000',approvalCount:1});
  expect(JSON.stringify(quote)).not.toContain('not-a-real-key');
  expect(JSON.stringify(quote)).not.toContain('swapTx');
  const url=String(fetcher.mock.calls[0]?.[0]);
  expect(url).toContain('tradeType=exactInput');
  expect(url).toContain('originChainId=8453');
  expect(url).toContain('destinationChainId=5042');
  expect(url).toContain('recipient='+owner);
  const common=normalizeAcrossExchangeQuote(quote);
  expect(common).toMatchObject({signing:'not-accepted',
   expectedOutputRaw:'1999000',minimumOutputRaw:'1985000',walletConfirmations:2});
 });
 it('fails closed on expired, wrong-chain, reverted simulation or impossible output',()=>{
  const requested=validateAcrossQuoteRequest(selection);
  for(const mutate of [
   {minOutputAmount:'2999000'}, {quoteExpiryTimestamp:Math.floor(now/1000)-1},
   {swapTx:{...payload.swapTx,chainId:5042}},
   {swapTx:{...payload.swapTx,simulationSuccess:false}},
   {inputToken:{...payload.inputToken,chainId:5042}},
   {outputToken:{...payload.outputToken,address:ACROSS_BASE_WETH}},
   {swapTx:{...payload.swapTx,to:'0x2222222222222222222222222222222222222222'}},
   {steps:{originSwap:{}}},{inputAmount:'900000000000000'},
  ])expect(()=>normalizeAcrossQuote({...payload,...mutate},requested,now)).toThrow(AcrossQuoteError);
 });
 it('isolates the read-only quote and status behind exact Mainnet route permissions',()=>{
  expect(isMainnetIdentityOnlyRouteAllowed('POST','/api/mainnet/exchange/across/quote')).toBe(true);
  expect(isMainnetIdentityOnlyRouteAllowed('GET','/api/mainnet/exchange/across/status')).toBe(true);
  expect(isMainnetIdentityOnlyRouteAllowed('GET','/api/mainnet/exchange/across/capability')).toBe(true);
  expect(isMainnetIdentityOnlyRouteAllowed('POST','/api/mainnet/exchange/across/execute')).toBe(false);
 });
 it('provider reported fill is not independent destination proof, expire/refund are distinct',()=>{
  expect(validateAcrossTrackingResponse({status:'filled'})).toEqual({status:'filled',terminal:true});
  expect(validateAcrossTrackingResponse({status:'expired'})).toEqual({status:'expired',terminal:true});
  expect(validateAcrossTrackingResponse({status:'refunded'})).toEqual({status:'refunded',terminal:true});
  expect(validateAcrossTrackingResponse({status:'pending'})).toEqual({status:'pending',terminal:false});
  expect(validateAcrossTrackingResponse({status:'BAD'})).toEqual({status:'unknown',terminal:false});
 });
});
