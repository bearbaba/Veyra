import {afterEach,describe,expect,it,vi} from 'vitest';
import {paymentRequestRef} from '../mainnet/paymentRequestRef';
import {samePaymentAttempt} from '../../server/services/paymentRequestsService';
import {readSettlementIntent,resumablePaymentAttempt,writeSettlementIntent,
 type SettlementIntent} from '../mainnet/settlementJournal';
import {claimPeerRequest,explicitlyRejectedWallet,
 readPeerRequestAttempt,type VeyraPaymentRequest} from '../lib/api/paymentRequests';

const owner='0x5555555555555555555555555555555555555555';
const recipient='0x6666666666666666666666666666666666666666';
const id='prq_123456789ABCDEFGHJK',ref=paymentRequestRef(id);
const a='11111111-1111-4111-8111-111111111111';
const b='22222222-2222-4222-8222-222222222222';
const payer='usr_123456789ABCDEFGJ',requester='usr_23456789ABCDEFGJK';
const created=new Date('2026-11-06T00:00:00Z').toISOString();
const expires=new Date('2026-11-13T00:00:00Z').toISOString();
const data=(inProgress=false,status:VeyraPaymentRequest['status']='PENDING'):VeyraPaymentRequest=>({
 requestId:id,requesterUserId:requester,payerUserId:payer,
 recipientWallet:recipient,paymentRef:ref,amountRaw:'10000',chainId:5042,
 status,paymentInProgress:inProgress,txHash:status==='PAID'?'0x'+'a'.repeat(64):null,
 createdAt:created,updatedAt:created,expiresAt:expires,
});
const requestPath=(v:RequestInfo|URL)=>typeof v==='string'?v:
 v instanceof URL?v.href:v.url;
const requestAttempt=(opts?:RequestInit):{attemptId:string;walletAddress?:string}=>{
 if(typeof opts?.body!=='string')throw Error('Request body was not JSON');
 return JSON.parse(opts.body) as {attemptId:string;walletAddress?:string};
};
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{
 status,headers:{'Content-Type':'application/json'},
});
const checkpoint=(attemptId=a):SettlementIntent=>({
 owner,phase:'PAYMENT',stage:'AWAITING_WALLET',recipient,amount:'0.01',
 ref,hash:null,createdAt:Date.now(),fromBlock:'200',requestId:id,attemptId,
});
function memoryStore(){
 const values=new Map<string,string>();
 return {getItem:(k:string)=>values.get(k)??null,
  setItem:(k:string,v:string)=>{values.set(k,v);},
  removeItem:(k:string)=>{values.delete(k);}};
}
const expected={owner,requestId:id,recipient,amount:'0.01',ref};
afterEach(()=>vi.unstubAllGlobals());

describe('Payment Request: crash-safe ORIGINAL attempt behavior',()=>{
 it('server claim ownership is determined by the exact ID AND wallet',()=>{
  const original={claimId:a,claimWallet:owner};
  expect(samePaymentAttempt(original,a,owner)).toBe(true);
  expect(samePaymentAttempt(original,b,owner)).toBe(false);
  expect(samePaymentAttempt(original,a,recipient)).toBe(false);
  expect(samePaymentAttempt({claimId:null,claimWallet:null},a,owner)).toBe(false);
 });
 it('a failed checkpoint write does not invoke either the server or wallet',async()=>{
  const store={getItem:(_k:string)=>null,setItem:()=>{throw Error('quota full');},
   removeItem:()=>{throw Error('quota full');}};
  const claim=vi.fn(),wallet=vi.fn();
  const prepareAndSign=async()=>{
   if(!writeSettlementIntent(checkpoint(),store))throw Error('checkpoint unavailable');
   await claim();await wallet();
  };
  await expect(prepareAndSign()).rejects.toThrow('checkpoint unavailable');
  expect(claim).not.toHaveBeenCalled();
  expect(wallet).not.toHaveBeenCalled();
 });
 it('recovers lost claim response using the same attemptId, not a new claim',async()=>{
  let serverAttempt:string|null=null;
  const recorded:string[]=[];
  const fetchMock=vi.fn(async (url:RequestInfo|URL,opts?:RequestInit)=>{
   await Promise.resolve();
   const body=requestAttempt(opts) as {attemptId:string;walletAddress:string};
   recorded.push(body.attemptId);
   if(requestPath(url).endsWith('/claim')){
    serverAttempt??=body.attemptId;throw new TypeError('response lost');
   }
   return json({ok:true,matches:body.attemptId===serverAttempt,request:data(true)});
  });
  vi.stubGlobal('fetch',fetchMock);
  const result=await claimPeerRequest('signed-token',id,owner,a);
  expect(result.recovered).toBe(true);
  expect(recorded).toEqual([a,a]);
  expect(serverAttempt).toBe(a);
  expect(fetchMock).toHaveBeenCalledTimes(2);
 });
 it('explicit wallet rejection reuses local attempt without releasing its server claim',async()=>{
  const store=memoryStore();
  expect(writeSettlementIntent(checkpoint(),store)).toBe(true);
  expect(explicitlyRejectedWallet({code:4001})).toBe(true);
  expect(explicitlyRejectedWallet({cause:{code:4001}})).toBe(true);
  expect(explicitlyRejectedWallet({code:-32000})).toBe(false);
  expect(writeSettlementIntent({...checkpoint(),stage:'REJECTED'},store)).toBe(true);
  const saved=readSettlementIntent(owner,store);
  expect(resumablePaymentAttempt(saved,expected)).toBe(a);
  expect(resumablePaymentAttempt(saved,{...expected,recipient:owner})).toBeNull();
  // Once the wallet outcome is unknown, NO attempt (even the same one)
  // can sign automatically. Absence of a receipt is not a negative proof.
  expect(writeSettlementIntent({...checkpoint(),stage:'UNKNOWN'},store)).toBe(true);
  expect(resumablePaymentAttempt(readSettlementIntent(owner,store),expected)).toBeNull();
 });
 it('unknown wallet outcome is never classified as a safe refusal',()=>{
  expect(explicitlyRejectedWallet(new Error('RPC timeout'))).toBe(false);
  expect(explicitlyRejectedWallet({code:-32000,message:'Nonce too low'})).toBe(false);
  expect(explicitlyRejectedWallet({cause:{code:'ACTION_REJECTED'}})).toBe(true);
  const store=memoryStore();
  expect(writeSettlementIntent(checkpoint(),store)).toBe(true);
  expect(writeSettlementIntent({...checkpoint(),stage:'UNKNOWN'},store)).toBe(true);
  expect(resumablePaymentAttempt(readSettlementIntent(owner,store),expected)).toBeNull();
 });
 it('concurrent devices cannot take over an existing server attempt',async()=>{
  let serverAttempt:string|null=null;
  vi.stubGlobal('fetch',vi.fn(async (url:RequestInfo|URL,opts?:RequestInit)=>{
   await Promise.resolve();
   const {attemptId}=requestAttempt(opts);
   if(requestPath(url).endsWith('/attempt'))
    return json({ok:true,matches:serverAttempt===attemptId,request:data(true)});
   if(serverAttempt===null){
    serverAttempt=attemptId;return json({ok:true,created:true,request:data(true)});
   }
   if(serverAttempt===attemptId)
    return json({ok:true,created:false,request:data(true)});
   return json({ok:false,error:'REQUEST_PAYMENT_IN_PROGRESS',message:'Reserved'},409);
  }));
  const first=await claimPeerRequest('signed-token',id,owner,a);
  expect(first.recovered).toBe(false);
  await expect(claimPeerRequest('signed-token',id,owner,b))
   .rejects.toMatchObject({code:'REQUEST_PAYMENT_IN_PROGRESS'});
  const repeated=await claimPeerRequest('signed-token',id,owner,a);
  expect(repeated.recovered).toBe(true);
  expect(serverAttempt).toBe(a);
 });
 it('a verified PAID request after receipt-sync loss never authorizes a second signature',async()=>{
  vi.stubGlobal('fetch',vi.fn(async (url:RequestInfo|URL,opts?:RequestInit)=>{
   await Promise.resolve();
   if(requestPath(url).endsWith('/claim'))throw new TypeError('response lost');
   const body=requestAttempt(opts);
   return json({ok:true,matches:body.attemptId===a,request:data(true,'PAID')});
  }));
  const view=await readPeerRequestAttempt('signed-token',id,owner,a);
  expect(view.matches).toBe(true);
  expect(view.request.status).toBe('PAID');
  expect(view.request.txHash).toMatch(/^0x[a-f0-9]{64}$/);
  await expect(claimPeerRequest('signed-token',id,owner,a))
   .rejects.toThrow('Claim outcome unknown or request already settled');
 });
});
