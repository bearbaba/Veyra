import {useState} from 'react';
import {ConnectKitButton} from 'connectkit';
import {useAccount,useDisconnect} from 'wagmi';
import {LogOut,Wallet} from 'lucide-react';
import {useUnifiedSocial} from '../../features/social/UnifiedSocial';

/** Account controls share the exact signed identity session across every page. */
export function WalletAccountControls({compact=false}:{compact?:boolean}){
  const {address,isConnected}=useAccount();
  const {disconnectAsync}=useDisconnect();
  const social=useUnifiedSocial();
  const [working,setWorking]=useState(false);
  const [warning,setWarning]=useState<string|null>(null);

  async function leaveWallet(){
    if(working)return;
    setWorking(true);
    setWarning(null);
    const serverLogout=await social.signOut();
    try { await disconnectAsync(); }
    catch { setWarning('Wallet extension did not disconnect. Please disconnect it in the wallet and retry.'); }
    if(!serverLogout){
      setWarning('Wallet disconnected locally. The server could not confirm cookie logout; reconnecting this wallet might restore its previous session.');
    }
    setWorking(false);
  }

  if(!isConnected||!address)return <ConnectKitButton/>;

  return <div className="flex items-center gap-2">
    {!compact&&<span className="flex items-center gap-1.5 text-xs" style={{color:'var(--muted)'}}><Wallet size={15}/>{address.slice(0,6)}…{address.slice(-4)}</span>}
    <button type="button" disabled={working} onClick={()=>void leaveWallet()} aria-label="Disconnect wallet"
      className="flex items-center gap-1 rounded-xl border px-2.5 py-2 text-xs font-semibold disabled:opacity-50"
      style={{color:'var(--ink)',borderColor:'var(--border)'}}>
      <LogOut size={14}/>{!compact&&<span>{working?'Disconnecting…':'Disconnect'}</span>}
    </button>
    {warning&&<span role="alert" className="max-w-48 text-[10px]" style={{color:'var(--warning)'}}>{warning}</span>}
  </div>;
}
