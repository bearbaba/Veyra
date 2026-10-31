/**
 * Testnet-only browser wallet Circle Unified Balance spend.
 *
 * Owner-reviewed source, destination, recipient and USDC amount are mandatory.
 * A pending checkpoint is persisted BEFORE invoking the SDK, because an SDK
 * timeout after signature does not prove that Circle did not accept a transfer.
 * No automatic replay. A response transferId is SUBMITTED, not settled.
 */
import { AppKit } from '@circle-fin/app-kit';
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2';
import { getAddress, isAddress, parseUnits, type EIP1193Provider } from 'viem';
import { GATEWAY_TESTNET_SOURCES } from './gatewayBalances';
import { activeSignedIdentityToken } from '../../lib/api/liveIdentitySession';

type TestnetChain = 'Arc_Testnet' | 'Ethereum_Sepolia' | 'Base_Sepolia';
const CHAINS: Readonly<Record<number,TestnetChain>> = {
  5042002:'Arc_Testnet',11155111:'Ethereum_Sepolia',84532:'Base_Sepolia',
};
export type GatewaySpendState='SUBMISSION_UNKNOWN'|'SUBMITTED_UNVERIFIED';
export interface GatewaySpendCheckpoint {
  version:1;owner:string;identity:string;recipient:string;amount:string;
  sourceChainId:number;destinationChainId:number;createdAt:number;
  state:GatewaySpendState;transferId?:string;txHash?:string;minReceive?:string;
}
const KEY_PREFIX='veyra:gateway:spend:v1:';
const USDC=/^\d{1,18}(?:\.\d{1,6})?$/;
const FEE_DECIMAL=/^(?:\d{1,18}(?:\.\d{1,6})?|\.\d{1,6})$/;
const FEE_TYPES=new Set(['provider','gasFee','kit','forwarder']);
export interface GatewaySdkFee {type:string;amount:string;token:'USDC'}
/** Parse untrusted SDK fee data. An estimate is NOT an execution authorization. */
export function parseGatewaySdkFees(raw:unknown):GatewaySdkFee[]{
 if(!Array.isArray(raw)||raw.length===0||raw.length>12)
  throw Error('Circle forwarding fee estimate is unavailable; no signature requested.');
 return raw.map((entry:unknown)=>{
  if(!entry||typeof entry!=='object'||Array.isArray(entry))
   throw Error('Circle returned a malformed fee.');
  const fee=entry as Record<string,unknown>;
  if(typeof fee.type!=='string'||!FEE_TYPES.has(fee.type)||
    fee.token!=='USDC'||typeof fee.amount!=='string'||!FEE_DECIMAL.test(fee.amount))
   throw Error('Circle returned an unverified fee amount or token.');
  return {type:fee.type,amount:fee.amount,token:'USDC' as const};
 });
}
/** Never silently raise or replace fees after the owner has reviewed them. */
export function assertGatewaySdkFeesUnchanged(reviewed:ReadonlyArray<GatewaySdkFee>,
 latest:ReadonlyArray<GatewaySdkFee>):void{
 const key=(fee:GatewaySdkFee)=>fee.type+':'+fee.token+':'+
  parseUnits(fee.amount.startsWith('.')?'0'+fee.amount:fee.amount,6).toString();
 if(reviewed.length===0||latest.length===0||
   JSON.stringify(reviewed.map(key).sort())!==JSON.stringify(latest.map(key).sort()))
  throw Error('Circle forwarding fees changed. Review the new fees before signing.');
}

export async function assertGatewayProviderWallet(
 provider:EIP1193Provider,owner:string,chainId:number,
):Promise<void>{
 if(!isAddress(owner)||!CHAINS[chainId])
  throw Error('Unsupported Gateway signer or Testnet source.');
 const [accounts,chain]=await Promise.all([
  provider.request({method:'eth_accounts'}),
  provider.request({method:'eth_chainId'}),
 ]);
 if(!Array.isArray(accounts)||accounts.length===0||
    typeof accounts[0]!=='string'||!isAddress(accounts[0])||
    getAddress(accounts[0]).toLowerCase()!==getAddress(owner).toLowerCase()||
    typeof chain!=='string'||!/^0x[0-9a-fA-F]+$/.test(chain)||
    Number.parseInt(chain,16)!==chainId)
  throw Error('Gateway signing wallet or source chain changed. Review again.');
}
function sdkSpendParams(adapter:Awaited<ReturnType<typeof createViemAdapterFromProvider>>,
 p:GatewaySpendCheckpoint){
 return {
  from:{adapter,allocations:{chain:CHAINS[p.sourceChainId],amount:p.amount}},
  to:{chain:CHAINS[p.destinationChainId],recipientAddress:p.recipient,useForwarder:true},
  amount:p.amount,token:'USDC' as const,
 };
}
export async function estimateGatewaySdkFees(input:{
 checkpoint:GatewaySpendCheckpoint;provider:EIP1193Provider;
 walletAddress:string;expectedSession:string;
}):Promise<GatewaySdkFee[]>{
 const p=input.checkpoint;
 if(getAddress(input.walletAddress).toLowerCase()!==p.owner||
   activeSignedIdentityToken()!==input.expectedSession)
  throw Error('Veyra identity or wallet changed before fee review.');
 await assertGatewayProviderWallet(input.provider,p.owner,p.sourceChainId);
 const adapter=await createViemAdapterFromProvider({provider:input.provider});
 await assertGatewayProviderWallet(input.provider,p.owner,p.sourceChainId);
 if(activeSignedIdentityToken()!==input.expectedSession)
  throw Error('Signed Veyra identity changed before fee review.');
 const kit=new AppKit();
 const estimate=await kit.unifiedBalance.estimateSpend(sdkSpendParams(adapter,p));
 return parseGatewaySdkFees(estimate.fees);
}
export function gatewaySpendKey(owner:string,identity:string):string {
 if(!isAddress(owner)||!identity||identity.length>256)
  throw Error('A connected owner wallet and signed identity are required.');
 return KEY_PREFIX+getAddress(owner).toLowerCase()+':'+identity;
}
export function readGatewaySpendCheckpoint(
 store:Pick<Storage,'getItem'>,owner:string,identity:string,
):GatewaySpendCheckpoint|null {
 const raw=store.getItem(gatewaySpendKey(owner,identity));
 if(!raw)return null;
 try {
  const x:unknown=JSON.parse(raw);
  if(!x||typeof x!=='object'||Array.isArray(x))return null;
  const p=x as GatewaySpendCheckpoint;
  if(p.version!==1||p.owner!==getAddress(owner).toLowerCase()||
    p.identity!==identity||!isAddress(p.recipient)||
    !USDC.test(p.amount)||parseUnits(p.amount,6)<=0n||
    (p.minReceive!==undefined&&(!USDC.test(p.minReceive)||
     parseUnits(p.minReceive,6)<=0n||parseUnits(p.minReceive,6)>parseUnits(p.amount,6)))||
    !Number.isFinite(p.createdAt)||p.createdAt<=0||
    !GATEWAY_TESTNET_SOURCES.some(x=>x.chainId===p.sourceChainId)||
    !GATEWAY_TESTNET_SOURCES.some(x=>x.chainId===p.destinationChainId)||
    (p.state!=='SUBMISSION_UNKNOWN'&&p.state!=='SUBMITTED_UNVERIFIED'))
   return null;
  return p;
 }catch{return null;}
}
export function prepareGatewaySpendCheckpoint(input:{
 owner:string;identity:string;recipient:string;amount:string;
 sourceChainId:number;destinationChainId:number;minReceive?:string;
},now=Date.now()):GatewaySpendCheckpoint {
 if(!isAddress(input.owner)||!isAddress(input.recipient)||
   !input.identity||!USDC.test(input.amount)||
   (input.minReceive!==undefined&&(!USDC.test(input.minReceive)||
     parseUnits(input.minReceive,6)<=0n||
     parseUnits(input.minReceive,6)>parseUnits(input.amount,6)))||
   parseUnits(input.amount,6)<=0n||
   !GATEWAY_TESTNET_SOURCES.some(s=>s.chainId===input.sourceChainId)||
   !GATEWAY_TESTNET_SOURCES.some(s=>s.chainId===input.destinationChainId))
  throw Error('Unsupported Testnet Unified Send. Review source, recipient and amount.');
 return {version:1,owner:getAddress(input.owner).toLowerCase(),identity:input.identity,
  recipient:getAddress(input.recipient),amount:input.amount,
  sourceChainId:input.sourceChainId,destinationChainId:input.destinationChainId,
  ...(input.minReceive?{minReceive:input.minReceive}:{}),
  createdAt:now,state:'SUBMISSION_UNKNOWN'};
}

/**
 * Only call directly after user clicks Confirm and their wallet is on the
 * reviewed source chain. This function does not manage the application's UI.
 * Pending unresolved attempts block any new spend for the same identity/wallet.
 */
export async function submitGatewaySdkSpend(input:{
 checkpoint:GatewaySpendCheckpoint;
 store:Pick<Storage,'getItem'|'setItem'>;
 provider:EIP1193Provider;
 walletAddress:string;
 expectedSession:string;
 expectedChainId:number;
 reviewedFees:ReadonlyArray<GatewaySdkFee>;
}):Promise<GatewaySpendCheckpoint> {
 const p=input.checkpoint;
 const key=gatewaySpendKey(p.owner,p.identity);
 if(input.store.getItem(key))throw Error('An existing Unified Send needs manual settlement verification before another transfer.');
 if(getAddress(input.walletAddress).toLowerCase()!==p.owner||
   input.expectedChainId!==p.sourceChainId||!CHAINS[p.sourceChainId]||
   !CHAINS[p.destinationChainId]||
   activeSignedIdentityToken()!==input.expectedSession)
  throw Error('Wallet, source chain or signed identity changed. Review again.');
 // The SDK must sign using exactly the owner wallet on the reviewed source.
 // Recheck at this boundary: a wallet may change after UI network switching.
 await assertGatewayProviderWallet(input.provider,p.owner,p.sourceChainId);
 if(activeSignedIdentityToken()!==input.expectedSession)
  throw Error('Veyra identity session changed before Gateway submission.');
 // Requote the SAME SDK spend intent immediately before signing. A provider
 // fee or route change requires a new visible user confirmation; never silently
 // accept newer fees after the checkbox was checked.
 const adapter=await createViemAdapterFromProvider({provider:input.provider});
 await assertGatewayProviderWallet(input.provider,p.owner,p.sourceChainId);
 if(activeSignedIdentityToken()!==input.expectedSession)
  throw Error('Veyra session changed before fee preflight.');
 const kit=new AppKit();
 const params=sdkSpendParams(adapter,p);
 const estimate=await kit.unifiedBalance.estimateSpend(params);
 assertGatewaySdkFeesUnchanged(input.reviewedFees,parseGatewaySdkFees(estimate.fees));
 await assertGatewayProviderWallet(input.provider,p.owner,p.sourceChainId);
 if(activeSignedIdentityToken()!==input.expectedSession)
  throw Error('Veyra session changed. Review again.');
 // The local checkpoint is written immediately before the potentially
 // signing SDK call so any ambiguous submission cannot be blindly replayed.
 input.store.setItem(key,JSON.stringify(p));
 try {
  const result=await kit.unifiedBalance.spend(params);
  const transferId=typeof result.transferId==='string'?result.transferId:undefined;
  const txHash=typeof result.txHash==='string'?result.txHash:undefined;
  // An SDK return does NOT independently prove destination mint/finality.
  const next:GatewaySpendCheckpoint={...p,state:'SUBMITTED_UNVERIFIED',
    ...(transferId?{transferId}:{}),...(txHash?{txHash}:{})};
  input.store.setItem(key,JSON.stringify(next));
  return next;
 }catch {
  // If the wallet rejected BEFORE any signing, this conservative checkpoint
  // may still need inspection. Never automatically resend or mark FAILED.
  throw Error('Unified Send outcome is unverified. Inspect the pending transfer before any retry.');
 }
}
