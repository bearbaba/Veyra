/**
 * Wallet-scoped local Mainnet contacts. No false Veyra ID ownership claims.
 * Contacts are labels only; Pay always reviews a complete EVM address.
 */
import {useEffect,useState} from 'react';
import {useAccount} from 'wagmi';
import {ConnectKitButton} from 'connectkit';
import {isAddress,getAddress} from 'viem';
import {BookUser,Plus,ShieldAlert,Trash2,Send} from 'lucide-react';
type Contact={name:string;address:string};
const key=(owner:string)=>'veyra:contacts:mainnet:v1:'+owner.toLowerCase();
function read(owner:string):Contact[]{
 try{
  const raw=localStorage.getItem(key(owner));
  const parsed:unknown=raw?JSON.parse(raw):[];
  if(!Array.isArray(parsed))return [];
  return (parsed as unknown[]).filter((raw:unknown):raw is Contact=>{
   if(!raw||typeof raw!=='object'||Array.isArray(raw))return false;
   const v=raw as Record<string,unknown>;
   return typeof v.name==='string'&&typeof v.address==='string'&&isAddress(v.address);
  }).slice(0,75);
 }catch{return [];}
}
export function MainnetContactsPage({onPay}:{onPay:(address:string)=>void}){
 const {address}=useAccount();
 const [contacts,setContacts]=useState<Contact[]>([]);
 const [label,setLabel]=useState('');
 const [recipient,setRecipient]=useState('');
 const [error,setError]=useState('');
 useEffect(()=>{setContacts(address?read(address):[]);setError('');setLabel('');setRecipient('');},[address]);
 function add(){
  if(!address||!isAddress(recipient)||!label.trim()||label.length>48){setError('Enter a name and a complete EVM wallet address.');return;}
  const exact=getAddress(recipient);
  if(exact.toLowerCase()===address.toLowerCase()){setError('Cannot add the connected wallet as a recipient.');return;}
  const next=[...contacts.filter(v=>v.address.toLowerCase()!==exact.toLowerCase()),{name:label.trim(),address:exact}].slice(-75);
  try{localStorage.setItem(key(address),JSON.stringify(next));setContacts(next);setLabel('');setRecipient('');setError('');}
  catch{setError('Browser storage unavailable. Contact could not be saved.');}
 }
 function remove(target:string){
  if(!address)return;
  const next=contacts.filter(v=>v.address!==target);
  try{localStorage.setItem(key(address),JSON.stringify(next));setContacts(next);}
  catch{setError('Could not update browser contacts.');}
 }
 return <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-7 md:px-7 md:py-9">
  <div><p className="text-xs font-bold uppercase" style={{color:'var(--accent)'}}>Arc Mainnet · Contacts</p>
   <h1 className="display mt-2 text-3xl font-bold" style={{color:'var(--ink)'}}>Your people</h1>
   <p className="mt-2 text-sm" style={{color:'var(--muted)'}}>Keep wallet addresses handy and send USDC with a full recipient review.</p>
  </div>
  <div className="rounded-2xl border p-5 sm:p-6" style={{background:'var(--surface)',borderColor:'var(--border)'}}>
   <p className="flex items-start gap-2 text-xs leading-5" style={{color:'var(--muted)'}}>
    <ShieldAlert className="size-4 shrink-0"/>Local contacts are saved only in this browser for the current wallet. They are NOT verified Veyra IDs, X accounts or authenticated friends. Always verify the destination address before signing.
   </p>
   {!address?<div className="mt-4"><ConnectKitButton/></div>:<>
    <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_2fr_auto]">
     <input value={label} onChange={e=>setLabel(e.target.value)} maxLength={48}
      placeholder="Contact label" aria-label="Contact label" className="rounded-xl border px-3 py-3 text-sm"
      style={{background:'var(--surface-raised)',borderColor:'var(--border)',color:'var(--ink)'}}/>
     <input value={recipient} onChange={e=>setRecipient(e.target.value)} maxLength={42}
      placeholder="0x… wallet address" aria-label="Contact wallet address" className="rounded-xl border px-3 py-3 text-sm"
      style={{background:'var(--surface-raised)',borderColor:'var(--border)',color:'var(--ink)'}}/>
     <button type="button" onClick={add} className="flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold"
      style={{background:'var(--accent)',color:'#0d1b2f'}}><Plus className="size-4"/>Add</button>
    </div>
    {error&&<p role="alert" className="mt-3 text-sm" style={{color:'var(--warning)'}}>{error}</p>}
    <div className="mt-5 space-y-3">
     {contacts.length===0?<p className="text-sm" style={{color:'var(--muted)'}}>No contacts saved yet.</p>:
      contacts.map(c=><div key={c.address} className="flex flex-wrap items-center gap-3 rounded-xl border p-4"
       style={{borderColor:'var(--border)'}}>
       <BookUser className="size-5" style={{color:'var(--accent)'}}/>
       <div className="min-w-0 flex-1">
        <p className="font-semibold" style={{color:'var(--ink)'}}>{c.name}</p>
        <p className="break-all font-mono text-xs" style={{color:'var(--muted)'}}>{c.address}</p>
       </div>
       <button type="button" onClick={()=>onPay(c.address)} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold"
        style={{background:'var(--accent)',color:'#0d1b2f'}}><Send className="size-4"/>Pay</button>
       <button type="button" onClick={()=>remove(c.address)} aria-label={'Remove '+c.name}
        className="rounded-xl border p-2" style={{borderColor:'var(--border)',color:'var(--muted)'}}><Trash2 className="size-4"/></button>
      </div>)}
    </div>
   </>}
  </div>
 </div>;
}
