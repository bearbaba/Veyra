/**
 * Permissionless Circle App Kit Swap for the existing connected Veyra wallet.
 * Arc TESTNET only. The browser always asks its wallet to sign.
 * Provider success is NOT on-chain receipt verification.
 */
import {
 getAddress,isAddress,parseUnits,formatUnits,keccak256,pad,stringToHex,
 type EIP1193Provider,
} from 'viem';
import {MANIFEST_CONSTANTS as M} from '../../providers/registry/providerManifest';
import {activeSignedIdentityToken} from '../../lib/api/liveIdentitySession';

export type ArcSwapAsset='USDC'|'EURC';
export type ArcSwapState='SUBMISSION_UNKNOWN'|'SUBMITTED_UNVERIFIED';
export interface ArcSwapCheckpoint{
 version:1;owner:string;identity:string;from:ArcSwapAsset;to:ArcSwapAsset;
 amount:string;minReceive:string;createdAt:number;
 state:ArcSwapState;txHash?:string;
}
const AMOUNT=/^\d{1,18}(?:\.\d{1,6})?$/;
const TRANSFER=keccak256(stringToHex('Transfer(address,address,uint256)'));
export const ARC_SWAP_CHAIN_ID=M.ARC_TESTNET_CHAIN_ID;
export const ARC_SWAP_TOKENS={
 USDC:getAddress(M.ARC_TESTNET_USDC),
 EURC:getAddress(M.ARC_TESTNET_EURC),
} as const;
export function arcSwapKey(owner:string,identity:string):string{
 if(!isAddress(owner)||!identity||identity.length>256)throw Error('Verified Veyra wallet and ID required.');
 return 'veyra:swap:arc-testnet:v1:'+getAddress(owner).toLowerCase()+':'+identity;
}
export function arcSwapAmount(raw:string):bigint{
 if(!AMOUNT.test(raw))throw Error('Enter an exact USDC/EURC amount with at most six decimals.');
 const n=parseUnits(raw,6);
 if(n<=0n)throw Error('Swap amount must be positive.');
 return n;
}
export function prepareArcSwapCheckpoint(input:{
 owner:string;identity:string;from:ArcSwapAsset;to:ArcSwapAsset;
 amount:string;minReceive:string;
},createdAt=Date.now()):ArcSwapCheckpoint{
 if(!isAddress(input.owner)||!input.identity||input.from===input.to||
  !ARC_SWAP_TOKENS[input.from]||!ARC_SWAP_TOKENS[input.to])
  throw Error('Swap owner or token pair is invalid.');
 arcSwapAmount(input.amount);
 arcSwapAmount(input.minReceive);
 return {version:1,owner:getAddress(input.owner).toLowerCase(),
  identity:input.identity,from:input.from,to:input.to,amount:input.amount,
  minReceive:input.minReceive,createdAt,state:'SUBMISSION_UNKNOWN'};
}
export function readArcSwapCheckpoint(
 store:Pick<Storage,'getItem'>,owner:string,identity:string,
):ArcSwapCheckpoint|null{
 try{
  const raw=store.getItem(arcSwapKey(owner,identity));
  if(!raw)return null;
  const x:unknown=JSON.parse(raw);
  if(!x||typeof x!=='object'||Array.isArray(x))return null;
  const p=x as ArcSwapCheckpoint;
  if(p.version!==1||p.owner!==getAddress(owner).toLowerCase()||
   p.identity!==identity||p.from===p.to||
   !ARC_SWAP_TOKENS[p.from]||!ARC_SWAP_TOKENS[p.to]||
   !Number.isFinite(p.createdAt)||p.createdAt<=0||
   (p.state!=='SUBMISSION_UNKNOWN'&&p.state!=='SUBMITTED_UNVERIFIED')||
   (p.txHash!==undefined&&!/^0x[0-9a-fA-F]{64}$/.test(p.txHash)))
   return null;
  arcSwapAmount(p.amount);arcSwapAmount(p.minReceive);
  return p;
 }catch{return null;}
}
export async function assertArcSwapWallet(provider:EIP1193Provider,owner:string):Promise<void>{
 const [accounts,chain]=await Promise.all([
  provider.request({method:'eth_accounts'}),
  provider.request({method:'eth_chainId'}),
 ]);
 if(!Array.isArray(accounts)||!accounts.length||
    typeof accounts[0]!=='string'||!isAddress(accounts[0])||
    getAddress(accounts[0]).toLowerCase()!==getAddress(owner).toLowerCase()||
    typeof chain!=='string'||!/^0x[0-9a-fA-F]+$/.test(chain)||
    Number.parseInt(chain,16)!==ARC_SWAP_CHAIN_ID)
  throw Error('Connected wallet or Arc Testnet network changed. Review Swap again.');
}
export function assertArcSwapSession(session:string):void{
 if(!session||activeSignedIdentityToken()!==session)
  throw Error('Signed Veyra identity changed. Review Swap again.');
}
export interface ArcSwapReceipt{
 chainId:number;txHash:string;received:string;token:string;
}
export function verifyArcSwapReceipt(raw:{
 status:string;transactionHash:string;
 logs:ReadonlyArray<{address:string;topics:ReadonlyArray<string>;data:string}>;
},checkpoint:ArcSwapCheckpoint):ArcSwapReceipt{
 const expected=checkpoint.txHash;
 if(!expected||!/^0x[0-9a-fA-F]{64}$/.test(expected)||
  raw.transactionHash.toLowerCase()!==expected.toLowerCase()||
  raw.status!=='success')throw Error('Swap transaction has not confirmed successfully.');
 const recipient=pad(getAddress(checkpoint.owner),{size:32}).toLowerCase();
 let received=0n,debited=0n;
 for(const entry of raw.logs){
  if(!isAddress(entry.address)||entry.topics.length!==3||
    entry.topics[0]?.toLowerCase()!==TRANSFER.toLowerCase())continue;
  if(!/^0x[0-9a-fA-F]{64}$/.test(entry.data))
   throw Error('Malformed swap token Transfer amount.');
  const value=BigInt(entry.data);
  const address=getAddress(entry.address);
  if(address===ARC_SWAP_TOKENS[checkpoint.to]&&
     entry.topics[2]?.toLowerCase()===recipient)received+=value;
  if(address===ARC_SWAP_TOKENS[checkpoint.from]&&
     entry.topics[1]?.toLowerCase()===recipient)debited+=value;
 }
 if(debited!==arcSwapAmount(checkpoint.amount))
  throw Error('Swap source token debit does not match the reviewed exact input.');
 if(received<arcSwapAmount(checkpoint.minReceive))
  throw Error('Swap output token receipt is below the reviewed guaranteed minimum.');
 return {chainId:ARC_SWAP_CHAIN_ID,txHash:expected,received:formatUnits(received,6),
   token:checkpoint.to};
}
