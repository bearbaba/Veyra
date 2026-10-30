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
  state:GatewaySpendState;transferId?:string;txHash?:string;
}
const KEY_PREFIX='veyra:gateway:spend:v1:';
const USDC=/^\d{1,18}(?:\.\d{1,6})?$/;
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
 sourceChainId:number;destinationChainId:number;
},now=Date.now()):GatewaySpendCheckpoint {
 if(!isAddress(input.owner)||!isAddress(input.recipient)||
   !input.identity||!USDC.test(input.amount)||
   parseUnits(input.amount,6)<=0n||
   !GATEWAY_TESTNET_SOURCES.some(s=>s.chainId===input.sourceChainId)||
   !GATEWAY_TESTNET_SOURCES.some(s=>s.chainId===input.destinationChainId))
  throw Error('Unsupported Testnet Unified Send. Review source, recipient and amount.');
 return {version:1,owner:getAddress(input.owner).toLowerCase(),identity:input.identity,
  recipient:getAddress(input.recipient),amount:input.amount,
  sourceChainId:input.sourceChainId,destinationChainId:input.destinationChainId,
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
}):Promise<GatewaySpendCheckpoint> {
 const p=input.checkpoint;
 const key=gatewaySpendKey(p.owner,p.identity);
 if(input.store.getItem(key))throw Error('An existing Unified Send needs manual settlement verification before another transfer.');
 if(getAddress(input.walletAddress).toLowerCase()!==p.owner||
   input.expectedChainId!==p.sourceChainId||!CHAINS[p.sourceChainId]||
   !CHAINS[p.destinationChainId]||
   activeSignedIdentityToken()!==input.expectedSession)
  throw Error('Wallet, source chain or signed identity changed. Review again.');
 // The local checkpoint prevents blind resubmission if the provider accepts a
 // signed intent but the browser closes before returning an acknowledgment.
 input.store.setItem(key,JSON.stringify(p));
 try {
  const adapter=await createViemAdapterFromProvider({provider:input.provider});
  const kit=new AppKit();
  const result=await kit.unifiedBalance.spend({
   from:{adapter,allocations:{chain:CHAINS[p.sourceChainId],amount:p.amount}},
   to:{chain:CHAINS[p.destinationChainId],recipientAddress:p.recipient,useForwarder:true},
   amount:p.amount,
  });
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
