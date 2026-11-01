import {useEffect,useState} from 'react';
import {useAccount} from 'wagmi';
import {ConnectKitButton} from 'connectkit';
import {CheckCircle2,AlertTriangle,ExternalLink} from 'lucide-react';
import {readMainnetJournal,storageForMainnet} from '@/mainnet/arcMainnetJournal';
import {inspectArcTransfer,type Inspection} from '@/mainnet/verifyArcTransfer';
import {mainnetExplorerTx} from '@/mainnet/arcMainnetPay';
import {readLocalOperations,type LocalOperation} from '@/mainnet/localOperations';
import {inspectRecordedSettlement} from '@/mainnet/verifyRecordedSettlement';
import type {VeyraPage} from '../layout/AppShell';
const HASH=/^0x[0-9a-fA-F]{64}$/;
export function MainnetActivityPage({onPay,onNavigate}:{onPay:()=>void;onNavigate:(page:VeyraPage)=>void}){
const {address}=useAccount();
const [hash,setHash]=useState('');
const [result,setResult]=useState<Inspection|null>(null);
const [error,setError]=useState<string|null>(null);
const [busy,setBusy]=useState(false);
const [saved,setSaved]=useState('No local payment record.');
const [operations,setOperations]=useState<LocalOperation[]>([]);
const [settlementCheck,setSettlementCheck]=useState<{hash:string;result:Inspection}|null>(null);
const [settlementError,setSettlementError]=useState<string|null>(null);
const [settlementBusy,setSettlementBusy]=useState(false);
const [filter,setFilter]=useState<'All'|'Pay'|'Settlement'|'Swap'|'Bridge'>('All');
useEffect(()=>{
setResult(null);setError(null);setSettlementCheck(null);setSettlementError(null);
if(!address){setHash('');setOperations([]);return;}
setOperations(readLocalOperations(address));
const r=readMainnetJournal(address,storageForMainnet());
setHash(r.kind==='active'?(r.value.hash??''):'');
setSaved(r.kind==='active'?'Latest payment from this browser. Check onchain status.':
r.kind==='blocked'?'Unrecoverable local state. Check your wallet first.':
'Paste a transaction hash to verify an outgoing USDC payment.');
},[address]);
async function verify(){
if(!address||!HASH.test(hash)||busy)return;
setBusy(true);setError(null);setResult(null);
try{setResult(await inspectArcTransfer(hash,address));}
catch(e){setError(e instanceof Error?e.message:'RPC unavailable. Status remains unknown.');}
finally{setBusy(false);}
}
async function verifySettlement(v:LocalOperation){
  if(!address||v.type!=='Settlement'||settlementBusy)return;
  setSettlementBusy(true);setSettlementCheck(null);setSettlementError(null);
  try{
    const checked=await inspectRecordedSettlement(v.hash,address,v.amount,v.destination);
    setSettlementCheck({hash:v.hash,result:checked});
  }catch(e){
    setSettlementError(e instanceof Error?e.message:'Arc RPC unavailable. The status is unknown.');
  }finally{setSettlementBusy(false);}
}
return <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-7 md:px-7 md:py-9">
<div><span className="text-xs font-bold uppercase" style={{color:'var(--accent)'}}>Arc Mainnet · 5042</span>
<h1 className="display mt-2 text-3xl font-bold" style={{color:'var(--ink)'}}>Activity</h1>
<p className="mt-2 text-sm" style={{color:'var(--muted)'}}>Verify outgoing Arc USDC payments with real blockchain evidence. No wallet signature needed.</p></div>
<div className="space-y-4 rounded-2xl border p-5 sm:p-7" style={{borderColor:'var(--border)',background:'var(--surface)'}}>
{!address?<ConnectKitButton/>:<>
<p className="text-xs" style={{color:'var(--muted)'}}>{saved}</p>
<label htmlFor="mainnet-tx" className="block text-sm font-semibold" style={{color:'var(--ink)'}}>Transaction hash</label>
<input id="mainnet-tx" value={hash} placeholder="0x…"
onChange={e=>{setHash(e.target.value);setResult(null);setError(null);}}
className="w-full rounded-xl border p-3 font-mono text-xs"
style={{borderColor:'var(--border)',background:'var(--surface-raised)',color:'var(--ink)'}}/>
<div className="flex flex-wrap gap-2">
<button type="button" onClick={()=>void verify()} disabled={!HASH.test(hash)||busy}
className="rounded-xl px-5 py-3 text-sm font-bold disabled:opacity-40"
style={{background:'var(--accent)',color:'#0d1b2f'}}>{busy?'Verifying…':'Verify USDC receipt'}</button>
<button type="button" onClick={onPay} className="rounded-xl border px-5 py-3 text-sm"
style={{borderColor:'var(--border)',color:'var(--ink)'}}>Pay again</button></div>
</>}
{error&&<p role="alert" className="flex items-center gap-2 text-sm" style={{color:'var(--warning)'}}>
<AlertTriangle className="size-4"/>{error}</p>}
{result&&<div role="status" className="space-y-2 rounded-xl border p-4"
style={{borderColor:'var(--border)',color:'var(--ink)'}}>
<div className="flex items-center gap-2 font-bold">
{result.status==='VERIFIED'?<CheckCircle2 className="size-5" style={{color:'var(--success)'}}/>:
<AlertTriangle className="size-5" style={{color:'var(--warning)'}}/>}
{result.status==='VERIFIED'?'Verified Arc USDC Transfer':result.status}</div>
<p className="break-all text-xs leading-5">{result.detail}</p>
<a href={mainnetExplorerTx(result.hash)} target="_blank" rel="noreferrer"
className="flex items-center gap-2 text-xs" style={{color:'var(--accent)'}}>Arc Explorer <ExternalLink className="size-4"/></a>
</div>}
</div>
<section className="space-y-3 rounded-2xl border p-5 sm:p-6" style={{borderColor:'var(--border)',background:'var(--surface)'}}>
<div className="flex flex-wrap items-center justify-between gap-2">
<h2 className="text-base font-bold" style={{color:'var(--ink)'}}>Your Mainnet operations</h2>
<button onClick={()=>address&&setOperations(readLocalOperations(address))} className="text-xs font-semibold" style={{color:'var(--accent)'}}>Refresh local index</button></div>
<div className="flex flex-wrap gap-2" aria-label="Filter transactions">
{(['All','Pay','Settlement','Swap','Bridge'] as const).map(v=><button key={v} type="button"
onClick={()=>setFilter(v)} aria-pressed={filter===v}
className="rounded-lg border px-3 py-2 text-xs font-semibold"
style={{borderColor:'var(--border)',background:filter===v?'var(--accent-muted)':'transparent',color:filter===v?'var(--accent)':'var(--muted)'}}>{v}</button>)}
</div>
{!address?<p className="text-sm" style={{color:'var(--muted)'}}>Connect wallet to view your private local operation index.</p>:
operations.filter(v=>filter==='All'||v.type===filter).length===0?
<p className="text-sm" style={{color:'var(--muted)'}}>No locally recorded {filter==='All'?'operations':filter+' operations'} in this browser yet.</p>:
<div className="divide-y" style={{borderColor:'var(--border)'}}>
{operations.filter(v=>filter==='All'||v.type===filter).map(v=><div key={v.type+v.hash} className="flex flex-wrap items-center gap-3 py-3 text-sm">
<div className="min-w-0 flex-1">
<p className="font-semibold" style={{color:'var(--ink)'}}>{v.type} · {v.amount} {v.asset}</p>
<p className="mt-1 text-xs" style={{color:'var(--muted)'}}>Arc {v.chainId===8453?'Base':'Mainnet'} · {v.status==='SUBMITTED'?'Tracking required':'Locally recorded · reverify onchain'}</p>
<p className="mt-1 break-all font-mono text-xs" style={{color:'var(--subtle)'}}>{v.hash.slice(0,15)}…{v.hash.slice(-9)}</p>
</div>
<div className="flex gap-2">
<a target="_blank" rel="noreferrer" href={(v.chainId===8453?'https://basescan.org/tx/':'https://explorer.arc.io/tx/')+v.hash}
className="rounded-lg border px-3 py-2 text-xs" style={{borderColor:'var(--border)',color:'var(--accent)'}}>Explorer</a>
<button type="button" className="rounded-lg border px-3 py-2 text-xs font-semibold"
disabled={v.type==='Settlement'&&settlementBusy}
onClick={()=>{if(v.type==='Settlement'){void verifySettlement(v);}
else if(v.type==='Pay'){setHash(v.hash);setResult(null);window.scrollTo({top:0,behavior:'smooth'});}
else onNavigate(v.type==='Swap'?'convert':'bridge');}}
style={{borderColor:'var(--border)',color:'var(--ink)'}}>{v.type==='Settlement'?'Verify receipt':v.type==='Pay'?'Reverify':'Continue'}</button>
</div>
</div>)}
</div>}
{settlementError&&<p role="alert" className="mt-3 text-sm" style={{color:'var(--warning)'}}>{settlementError}</p>}
{settlementCheck&&<div role="status" className="mt-3 rounded-xl border p-4 text-sm"
 style={{borderColor:'var(--border)',background:'var(--surface-raised)'}}>
 <strong style={{color:settlementCheck.result.status==='VERIFIED'?'var(--success)':'var(--warning)'}}>
 Settlement · {settlementCheck.result.status==='VERIFIED'?'Onchain verified':settlementCheck.result.status}
 </strong>
 <p className="mt-2 break-words text-xs leading-5" style={{color:'var(--muted)'}}>{settlementCheck.result.detail}</p>
 <a href={mainnetExplorerTx(settlementCheck.hash)} target="_blank" rel="noreferrer"
 className="mt-2 inline-flex items-center gap-2 text-xs" style={{color:'var(--accent)'}}>Arc Explorer <ExternalLink className="size-4"/></a>
 </div>}
<p className="text-xs leading-5" style={{color:'var(--muted)'}}>These entries are wallet-scoped browser pointers, not a complete cross-device history or proof of success. Recheck the original chain/provider receipt before trusting the status.</p>
</section>
<p className="text-xs leading-5" style={{color:'var(--muted)'}}>Activity verifies outgoing USDC transfers from this wallet. Browser-local history is not a complete cross-device ledger. Transaction submission is not proof of settlement.</p>
</div>;
}