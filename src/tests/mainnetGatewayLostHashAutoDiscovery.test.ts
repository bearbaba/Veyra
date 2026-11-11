import {describe,expect,it,vi} from 'vitest';
import {encodeFunctionData,parseUnits} from 'viem';
import {getMainnetChain} from '../config/mainnetCatalog';
import {gatewayDepositAbi,GATEWAY_MAINNET_WALLET} from '../mainnet/gatewayMainnetReconcile';
import {discoverOriginalGatewayDeposit,type GatewayDepositSourceReader}
 from '../mainnet/discoverOriginalGatewayDeposit';
import {VIRTUAL_NETWORK_ICON_IDS} from '../components/brand/BrandLogo';
import {CIRCLE_USDC_BRIDGE_NETWORKS} from '../mainnet/circleBridgeNetworkDirectory';

const owner='0x1111111111111111111111111111111111111111';
const token=getMainnetChain(8453)?.usdc??'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const hashA=`0x${'ab'.repeat(32)}`,hashB=`0x${'cd'.repeat(32)}`;
const amount=parseUnits('0.1',6);
const input=encodeFunctionData({abi:gatewayDepositAbi,functionName:'deposit',args:[token,amount]});
const op={
 version:1 as const,id:'11111111-1111-4111-8111-111111111111',
 owner,kind:'deposit' as const,chainId:8453,recipient:owner,
 amount:'0.1',createdAt:2_000_000,status:'UNKNOWN' as const,
};
const log=(hash=hashA,value=amount)=>({transactionHash:hash,blockNumber:650n,value});
function reader(logs:ReturnType<typeof log>[]=[],changed:Partial<{
 from:string;to:string;input:string;chainId:number;
}>={}):GatewayDepositSourceReader{
 return {
  chainId:vi.fn(()=>Promise.resolve(changed.chainId??8453)),
  latestBlock:vi.fn(()=>Promise.resolve(1_000n)),
  blockTimestamp:vi.fn((b:bigint)=>Promise.resolve(1_000n+b*2n)),
  transferLogs:vi.fn(()=>Promise.resolve(logs)),
  getTransaction:vi.fn((hash:`0x${string}`)=>Promise.resolve({
   hash,from:changed.from??owner,to:changed.to??GATEWAY_MAINNET_WALLET,
   input:changed.input??input,
  })),
 };
}
describe('automatic original Gateway deposit recovery',()=>{
 it('returns only one real source tx matching owner, deposit method, amount and token',async()=>{
  const r=reader([log()]);
  expect(await discoverOriginalGatewayDeposit(r,op,3_000_000)).toBe(hashA);
  expect(r.transferLogs).toHaveBeenCalled();
  const calls=vi.mocked(r.transferLogs).mock.calls;
  expect(calls[0]?.[0]).toBeGreaterThanOrEqual(400n);
  expect(calls[calls.length-1]?.[1]).toBeLessThanOrEqual(1_000n);
  expect(calls[0]?.[2].toLowerCase()).toBe(owner);
  expect(calls[0]?.[3].toLowerCase()).toBe(token.toLowerCase());
 });
 it('rejects Gateway deposits with different sender, target, token, amount, method, or wrong RPC chain',async()=>{
  const wrongToken=getMainnetChain(1)?.usdc??'0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const scenarios=[
   {from:'0x2222222222222222222222222222222222222222'},
   {to:wrongToken},
   {input:'0x12345678'},
   {input:encodeFunctionData({abi:gatewayDepositAbi,functionName:'deposit',args:[wrongToken,amount]})},
   {input:encodeFunctionData({abi:gatewayDepositAbi,functionName:'deposit',args:[token,amount+1n]})},
   {chainId:1},
  ];
  for(const scenario of scenarios){
   expect(await discoverOriginalGatewayDeposit(reader([log()],scenario),op,3_000_000)).toBeNull();
  }
  expect(await discoverOriginalGatewayDeposit(reader([log(hashA,amount+1n)]),op,3_000_000)).toBeNull();
 });
 it('never chooses between two plausible source deposits',async()=>{
  expect(await discoverOriginalGatewayDeposit(reader([log(hashA),log(hashB)]),op,3_000_000)).toBeNull();
  expect(await discoverOriginalGatewayDeposit(reader([log('0x1234')]),op,3_000_000)).toBeNull();
 });
 it('does not browse a known, signed, future or too-old operation',async()=>{
  const cases=[
   {...op,sourceHash:hashA},
   {...op,kind:'spend' as const},
   {...op,createdAt:4_000_000},
   {...op,createdAt:3_000_000-31*86400_000},
  ];
  for(const candidate of cases){
   const r=reader([log()]);
   expect(await discoverOriginalGatewayDeposit(r,candidate,3_000_000)).toBeNull();
   expect(r.latestBlock).not.toHaveBeenCalled();
  }
 });
 it('uses the upstream Web3Icons identifiers for every dynamically rendered network',()=>{
  expect(VIRTUAL_NETWORK_ICON_IDS.world).toBe('world');
  expect(VIRTUAL_NETWORK_ICON_IDS.hyperevm).toBe('hyper-evm');
  expect(VIRTUAL_NETWORK_ICON_IDS.sei).toBe('sei-network');
  expect(CIRCLE_USDC_BRIDGE_NETWORKS).toHaveLength(19);
  for(const chain of CIRCLE_USDC_BRIDGE_NETWORKS){
   expect(chain.logo).toBeTruthy();
  }
 });
});
