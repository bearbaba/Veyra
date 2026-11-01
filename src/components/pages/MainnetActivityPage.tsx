import {useEffect,useState} from 'react';
import {useAccount} from 'wagmi';
import {ConnectKitButton} from 'connectkit';
import {CheckCircle2,AlertTriangle,ExternalLink} from 'lucide-react';
import {readMainnetJournal,storageForMainnet} from '@/mainnet/arcMainnetJournal';
import {inspectArcTransfer,type Inspection} from '@/mainnet/verifyArcTransfer';
import {mainnetExplorerTx} from '@/mainnet/arcMainnetPay';
const HASH=/^0x[0-9a-fA-F]{64}$/;
export function MainnetActivityPage({onPay}:{onPay:()=>void}){
const {address}=useAccount();
const [hash,setHash]=useState('');
const [result,setResult]=useState<Inspection|null>(null);
const [error,setError]=useState<string|null>(null);
const [busy,setBusy]=useState(false);
const [saved,setSaved]=useState('No local payment record.');
useEffect(()=>{
setResult(null);setError(null);
if(!address){setHash('');return;}
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
<p className="text-xs leading-5" style={{color:'var(--muted)'}}>Activity verifies outgoing USDC transfers from this wallet. Browser-local history is not a complete cross-device ledger. Transaction submission is not proof of settlement.</p>
</div>;
}