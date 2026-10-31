/**
 * Circle CCTP/App Kit bridge recovery on approved Testnet chains.
 * An SDK "success" is only a candidate until the destination mint receipt
 * is independently verified against the exact reviewed address/token/amount.
 */
import {getAddress,isAddress,parseUnits} from 'viem';
import {GATEWAY_TESTNET_SOURCES} from '../gateway/gatewayBalances';
import {verifyGatewayDestinationMint,type GatewayDestinationProof} from '../gateway/gatewayDestinationMint';

export type VeyraBridgeChain='Arc_Testnet'|'Ethereum_Sepolia'|'Base_Sepolia';
export type BridgeAttemptState='SUBMISSION_UNKNOWN'|'SUBMITTED_UNVERIFIED';
export interface BridgeAttempt{
 version:1;owner:string;identity:string;sourceChainId:number;
 destinationChainId:number;recipient:string;amount:string;minReceive:string;
 createdAt:number;state:BridgeAttemptState;burnHash?:string;mintHash?:string;
 providerState?:string;
}
export interface BridgeMintEvidence{proof:GatewayDestinationProof;burnHash:string}
const USDC=/^\d{1,18}(?:\.\d{1,6})?$/;
export const BRIDGE_TESTNET_ROUTES=[
 {chain:'Arc_Testnet',chainId:5042002,domain:26},
 {chain:'Ethereum_Sepolia',chainId:11155111,domain:0},
 {chain:'Base_Sepolia',chainId:84532,domain:6},
] as const;
export function bridgeChain(chainId:number):VeyraBridgeChain{
 const value=BRIDGE_TESTNET_ROUTES.find(r=>r.chainId===chainId);
 if(!value)throw Error('Unsupported Testnet CCTP network.');
 return value.chain;
}
export function bridgeKey(owner:string,identity:string):string{
 if(!isAddress(owner)||!identity||identity.length>256)throw Error('Veyra wallet and ID required.');
 return 'veyra:cctp:appkit:v1:'+getAddress(owner).toLowerCase()+':'+identity;
}
export function makeBridgeAttempt(input:Omit<BridgeAttempt,'version'|'createdAt'|'state'>,
 now=Date.now()):BridgeAttempt{
 if(!isAddress(input.owner)||!isAddress(input.recipient)||
   !input.identity||input.sourceChainId===input.destinationChainId)
  throw Error('Bridge recipient/source/destination identity is invalid.');
 bridgeChain(input.sourceChainId);bridgeChain(input.destinationChainId);
 if(!USDC.test(input.amount)||!USDC.test(input.minReceive)||
   parseUnits(input.minReceive,6)<=0n||
   parseUnits(input.minReceive,6)>parseUnits(input.amount,6))
  throw Error('Enter a positive USDC amount and an exact minimum receive.');
 return {...input,version:1,createdAt:now,state:'SUBMISSION_UNKNOWN',
  owner:getAddress(input.owner).toLowerCase(),recipient:getAddress(input.recipient)};
}
export function readBridgeAttempt(
 store:Pick<Storage,'getItem'>,owner:string,identity:string,
):BridgeAttempt|null{
 try{
  const raw=store.getItem(bridgeKey(owner,identity));
  if(!raw)return null;
  const value:unknown=JSON.parse(raw);
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const x=value as BridgeAttempt;
  if(x.version!==1||x.owner!==getAddress(owner).toLowerCase()||
     x.identity!==identity||!isAddress(x.recipient)||
     !Number.isFinite(x.createdAt)||x.createdAt<=0||
     (x.state!=='SUBMISSION_UNKNOWN'&&x.state!=='SUBMITTED_UNVERIFIED')||
     (x.burnHash!==undefined&&!/^0x[0-9a-fA-F]{64}$/.test(x.burnHash))||
     (x.mintHash!==undefined&&!/^0x[0-9a-fA-F]{64}$/.test(x.mintHash)))
   return null;
  makeBridgeAttempt(x);
  return x;
 }catch{return null;}
}
export function getAppKitBridgeSteps(raw:unknown):{
 providerState:string;burnHash?:string;mintHash?:string;
}{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))
  throw Error('Circle Bridge returned an invalid result.');
 const data=raw as Record<string,unknown>;
 if(typeof data.state!=='string'||!['success','pending','error'].includes(data.state)||
    !Array.isArray(data.steps))throw Error('Circle Bridge status is unknown.');
 const steps=data.steps as unknown[];
 const recognized=(name:string)=>{
  const matches=steps.filter(s=>s&&typeof s==='object'&&!Array.isArray(s)&&
   (s as Record<string,unknown>).name===name);
  if(matches.length!==1)return undefined;
  const s=matches[0] as Record<string,unknown>;
  return s.state==='success'&&typeof s.txHash==='string'&&
    /^0x[0-9a-fA-F]{64}$/.test(s.txHash)?s.txHash:undefined;
 };
 return {providerState:data.state,
  ...(recognized('burn')?{burnHash:recognized('burn')}:{}),
  ...(recognized('mint')?{mintHash:recognized('mint')}:{}),
 };
}
export function verifyCompletedAppKitBridge(raw:{
 status:string;transactionHash:string;
 logs:ReadonlyArray<{address:string;topics:ReadonlyArray<string>;data:string}>;
},attempt:BridgeAttempt):BridgeMintEvidence{
 if(attempt.providerState!=='success'||!attempt.burnHash||!attempt.mintHash)
  throw Error('Circle has not proven both source burn and destination mint steps.');
 const destination=GATEWAY_TESTNET_SOURCES.find(s=>s.chainId===attempt.destinationChainId);
 if(!destination)throw Error('Unsupported CCTP destination chain.');
 const proof=verifyGatewayDestinationMint(raw,{
  expectedHash:attempt.mintHash,chainId:destination.chainId,
  token:destination.token,recipient:attempt.recipient,
  amount:attempt.amount,minReceive:attempt.minReceive,
 });
 return {proof,burnHash:attempt.burnHash};
}
