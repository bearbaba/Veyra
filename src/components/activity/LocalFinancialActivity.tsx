/**
 * Private, owner-scoped Activity for Circle Browser Kit operations.
 * These are read-only local checkpoints/proofs, NOT synced server receipts.
 * Never infer a completed transaction from a provider status alone.
 */
import {useEffect,useState} from 'react';
import {isAddress} from 'viem';
type LocalItem={key:string;kind:string;status:'PENDING'|'LOCAL_PROOF';
 amount?:string;token?:string;hash?:string;timestamp:number};
function ownLocalActivity(owner:string,identity:string):LocalItem[]{
 if(!isAddress(owner)||!identity)return [];
 const address=owner.toLowerCase();
 const starts=[
  {prefix:'veyra:swap:arc-testnet:v1:'+address+':'+identity,kind:'Swap'},
  {prefix:'veyra:cctp:appkit:v1:'+address+':'+identity,kind:'Bridge'},
  {prefix:'veyra:gateway:spend:v1:'+address+':'+identity,kind:'Unified Send'},
  {prefix:'veyra:gateway:deposit:'+address,kind:'Unified Deposit'},
 ];
 const rows:LocalItem[]=[];
 try{
  for(let i=0;i<Math.min(localStorage.length,1000);i++){
   const key=localStorage.key(i);
   if(!key)continue;
   const match=starts.find(x=>key===x.prefix||key.startsWith(x.prefix+':verified:'));
   if(!match)continue;
   const raw=localStorage.getItem(key);
   if(!raw)continue;
   const value:unknown=JSON.parse(raw);
   if(!value||typeof value!=='object'||Array.isArray(value))continue;
   const v=value as Record<string,unknown>;
   if(typeof v.owner!=='string'||v.owner.toLowerCase()!==address)continue;
   if(match.kind!=='Unified Deposit'&&v.identity!==identity)continue;
   const proof=v.proof&&typeof v.proof==='object'&&!Array.isArray(v.proof)
    ?v.proof as Record<string,unknown>:null;
   const status:'PENDING'|'LOCAL_PROOF'=key.includes(':verified:')?'LOCAL_PROOF':'PENDING';
   const hashValue=proof?.txHash??v.txHash;
   const hash=typeof hashValue==='string'&&/^0x[0-9a-fA-F]{64}$/.test(hashValue)
    ?hashValue:undefined;
   const amountValue=proof?.mintedUsdc??v.received??v.amount;
   const amount=typeof amountValue==='string'&&/^\d{1,18}(?:\.\d{1,6})?$/.test(amountValue)
    ?amountValue:undefined;
   const timestamp=typeof v.verifiedAt==='number'?v.verifiedAt:
    typeof v.createdAt==='number'?v.createdAt:
    typeof v.sentAt==='number'?v.sentAt:0;
   if(!Number.isFinite(timestamp)||timestamp<0)continue;
   rows.push({key,kind:match.kind,status,timestamp,
    ...(amount?{amount}:{}),...(hash?{hash}:{}),
    token:match.kind==='Swap'&&v.to==='EURC'?'EURC':'USDC'});
  }
 }catch{return rows;}
 return rows.sort((a,b)=>b.timestamp-a.timestamp).slice(0,20);
}
export function LocalFinancialActivity({owner,identity}:{
 owner:string;identity:string;
}){
 const [items,setItems]=useState<LocalItem[]>([]);
 const [scope,setScope]=useState('');
 const active=owner.toLowerCase()+':'+identity;
 function refresh(){setItems(ownLocalActivity(owner,identity));setScope(active);}
 useEffect(()=>{
  if(!owner||!identity){setItems([]);setScope('');return;}
  setItems(ownLocalActivity(owner,identity));setScope(active);
 },[active,owner,identity]);
 // Never display entries from the previous session while new effects load.
 if(!owner||!identity||scope!==active)return null;
 return <section className="mb-6 space-y-3" aria-label="Owner-scoped Circle financial activity">
  <div className="flex items-center justify-between gap-3">
   <div>
    <p className="text-xs font-bold uppercase tracking-[0.16em]"
     style={{color:'var(--muted)'}}>Wallet-linked Circle operations</p>
    <p className="mt-1 text-xs" style={{color:'var(--subtle)'}}>
     Local recovery records · not yet synced to your Veyra account
    </p>
   </div>
   <button type="button" onClick={refresh} className="rounded-xl border px-3 py-2 text-xs"
    style={{borderColor:'var(--border)'}}>Refresh</button>
  </div>
  {items.length===0?<p className="text-xs" style={{color:'var(--muted)'}}>
   No local Swap, Bridge or Unified operations for the signed wallet.
  </p>:items.map(x=><div key={x.key} className="rounded-xl border p-3 text-xs space-y-1"
   style={{borderColor:'var(--border)',background:'var(--surface)'}}>
    <div className="flex items-center justify-between gap-2">
     <strong style={{color:'var(--ink)'}}>{x.kind}</strong>
     <span style={{color:x.status==='PENDING'?'var(--warning)':'var(--success)'}}>
      {x.status==='PENDING'?'Unresolved · do not resend':'On-chain proof recorded locally'}
     </span>
    </div>
    {x.amount&&<p>{x.amount} {x.token}</p>}
    {x.hash&&<p className="break-all font-mono">{x.hash}</p>}
   </div>)}
 </section>;
}
