import { useRef, useState } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { formatUnits, isAddress, parseUnits } from 'viem';
import { MANIFEST_CONSTANTS } from '../../providers/registry/providerManifest';
import { inspectReverseCctpSource, type ReverseCctpReadiness } from '../../core/bridge/reverseCctpReadiness';
import { ArrowRight, ArrowLeftRight, Compass, Copy, Globe2, SendHorizontal, Users, Wallet, CheckCircle2, Info } from 'lucide-react';
import type { SocialFriend } from '../../features/social/UnifiedSocial';
import { friendLabel } from '../../features/social/UnifiedSocial';
import { buildQuickPaymentRequest, QUICK_NETWORKS, type QuickMode, type QuickNetwork, type QuickRecipient } from '../../core/agent/quickStartPayment';
import type { VeyraPage } from '../layout/AppShell';
import { AgentUnifiedBalances } from './AgentUnifiedBalances';

type QuickAction = QuickMode | 'SWAP' | 'UNIFIED';

interface AgentQuickStartProps {
  friends: readonly SocialFriend[];
  signedIn: boolean;
  onPrepare: (text: string) => void;
  onNavigate: (page: VeyraPage) => void;
  compact?: boolean;
}

const ACTIONS: ReadonlyArray<{ id: QuickAction; title: string; summary: string; tag: string }> = [
  { id: 'SEND', title: 'Send', summary: 'To a friend or wallet', tag: 'Arc USDC' },
  { id: 'SWAP', title: 'Swap', summary: 'Explore conversions', tag: 'Preview' },
  { id: 'BRIDGE', title: 'Bridge', summary: 'Move USDC across Testnets', tag: 'CCTP V2' },
  { id: 'UNIFIED', title: 'Unified', summary: 'USDC across three Testnets', tag: 'Read-only' },
];

export function AgentQuickStart({ friends, signedIn, onPrepare, onNavigate, compact = false }: AgentQuickStartProps) {
  const [action, setAction] = useState<QuickAction>('SEND');
  const [amount, setAmount] = useState('');
  const [network, setNetwork] = useState<QuickNetwork>('arc');
  const [bridgeSource, setBridgeSource] = useState<QuickNetwork>('arc');
  const [reverseLookup, setReverseLookup] = useState<{key:string;result:ReverseCctpReadiness}|null>(null);
  const [reverseChecking, setReverseChecking] = useState(false);
  const checkId = useRef(0);
  const {address} = useAccount();
  const ethSepoliaClient = usePublicClient({chainId:MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID});
  const baseSepoliaClient = usePublicClient({chainId:MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID});
  const [recipientType, setRecipientType] = useState<QuickRecipient>('WALLET');
  const [wallet, setWallet] = useState('');
  const [selectedFriend, setSelectedFriend] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Friends are account-private records supplied ONLY from the active signed
  // Veyra session. The server will still resolve & verify payment recipients.
  const connected = signedIn ? friends
    .filter((item) => item.state === 'CONNECTED' && item.veyraHandle && friendLabel(item).startsWith('@'))
    .slice(0, 12) : [];
  const friendHandles = connected.map(friendLabel);
  const selectedNetwork = QUICK_NETWORKS.find((item) => item.id === network)!;
  const bridge = action === 'BRIDGE';
  const isCrossChain = bridge || selectedNetwork.availability === 'BRIDGE';
  const reverse = bridge && bridgeSource !== 'arc';
  const lookupKey = [bridgeSource,network,amount,wallet,address??''].join(':');
  const reverseResult = reverseLookup?.key === lookupKey ? reverseLookup.result : null;
  const sourceChoices = QUICK_NETWORKS.filter((n)=>
    n.id==='arc'||n.id==='ethereum-sepolia'||n.id==='base-sepolia');
  const destinationChoices = bridge
    ? reverse ? QUICK_NETWORKS.filter((n)=>n.id==='arc')
      : QUICK_NETWORKS.filter((n)=>n.availability==='BRIDGE')
    : QUICK_NETWORKS;

  function chooseAction(next: QuickAction) {
    setAction(next);
    setError(null);
    if (next === 'BRIDGE') {
      setBridgeSource('arc');setNetwork('ethereum-sepolia');setRecipientType('WALLET');
    }
    if (next === 'SEND') setNetwork('arc');
  }

  function chooseNetwork(next: QuickNetwork) {
    checkId.current++;
    setNetwork(next);
    setReverseChecking(false);
    setReverseLookup(null);
    setError(null);
    if (next !== 'arc') setRecipientType('WALLET');
  }
  function chooseBridgeSource(next: QuickNetwork) {
    checkId.current++;
    setBridgeSource(next);
    setReverseChecking(false);
    setNetwork(next==='arc'?'ethereum-sepolia':'arc');
    setRecipientType('WALLET');
    setReverseLookup(null);
    setError(null);
  }

  async function checkReverseRoute() {
    if (!reverse || reverseChecking) return;
    if (!address || !isAddress(wallet)) {
      setError(!address ? 'Connect a wallet to inspect its source USDC balance. No signing needed.'
        : 'Paste the complete Arc recipient address before checking.');
      return;
    }
    let amountRaw:bigint;
    try {
      if (!/^\d{1,18}(?:\.\d{1,6})?$/.test(amount.trim())) throw Error('invalid amount');
      amountRaw=parseUnits(amount.trim(),6);
      if(amountRaw<=0n)throw Error('invalid amount');
    } catch {
      setError('Enter a positive USDC amount with up to six decimal places.');
      return;
    }
    const sourceChainId=bridgeSource==='ethereum-sepolia'
      ? MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID
      : bridgeSource==='base-sepolia' ? MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID : null;
    const client=bridgeSource==='ethereum-sepolia'?ethSepoliaClient
      :bridgeSource==='base-sepolia'?baseSepoliaClient:undefined;
    if (!sourceChainId || !client) {
      setError('The selected source Testnet is unavailable for read-only checks.');
      return;
    }
    const key=lookupKey;
    const requestId=++checkId.current;
    let timeout:ReturnType<typeof setTimeout>|undefined;
    setError(null);setReverseChecking(true);setReverseLookup(null);
    try {
      const result=await Promise.race<ReverseCctpReadiness>([
        inspectReverseCctpSource(client,{sourceChainId,sender:address,recipient:wallet,amount:amountRaw}),
        new Promise<ReverseCctpReadiness>((resolve)=>{
          timeout=setTimeout(()=>resolve({status:'UNAVAILABLE',
            reason:'Source RPC timed out. No transaction was signed or submitted.'}),20_000);
        }),
      ]);
      if(checkId.current===requestId)setReverseLookup({key,result});
    } catch {
      if(checkId.current===requestId)setReverseLookup({key,
        result:{status:'UNAVAILABLE',reason:'Could not read the source chain. Nothing was signed.'}});
    } finally {
      if(timeout)clearTimeout(timeout);
      if(checkId.current===requestId)setReverseChecking(false);
    }
  }

  async function pasteWallet() {
    setError(null);
    try {
      if (!navigator.clipboard?.readText) throw Error('Clipboard access unavailable');
      const value = (await navigator.clipboard.readText()).trim();
      if (!value) throw Error('Clipboard is empty');
      checkId.current++;setReverseChecking(false);setReverseLookup(null);
      setWallet(value);
    } catch {
      setError('Clipboard unavailable. Click the wallet field and paste with Ctrl+V.');
    }
  }

  function prepare() {
    const chosenNetwork = network;
    const recipient = recipientType === 'FRIEND' && !isCrossChain ? selectedFriend : wallet;
    const result = buildQuickPaymentRequest({
      mode: bridge ? 'BRIDGE' : 'SEND',
      network: chosenNetwork, sourceNetwork:bridge?bridgeSource:'arc', amount, recipient,
      recipientType: isCrossChain ? 'WALLET' : recipientType,
      trustedFriendHandles: friendHandles,
    });
    if (!result.ok) { setError(result.reason); return; }
    setError(null);
    // Write a draft into Agent chat — this does NOT call Pay, sign, quote or burn.
    onPrepare(result.text);
  }

  const iconFor = (id: QuickAction) => id === 'SEND' ? <SendHorizontal className="size-4" />
    : id === 'SWAP' ? <ArrowLeftRight className="size-4" />
    : id === 'BRIDGE' ? <Globe2 className="size-4" />
    : <Compass className="size-4" />;

  return (
    <section aria-label="Veyra quick actions" className={compact ? 'mx-auto w-full max-w-3xl pb-5' : 'mx-auto w-full max-w-3xl pb-7 pt-3'}>
      {!compact && (
        <div className="mb-5 text-center">
          <h2 className="display text-2xl font-black" style={{ color: 'var(--ink)' }}>What would you like to do?</h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>Choose an action, or simply tell Veyra what you need.</p>
        </div>
      )}
      <div role="group" aria-label="Choose a Veyra action" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ACTIONS.map((item) => (
          <button key={item.id} type="button" onClick={() => chooseAction(item.id)}
            aria-pressed={action === item.id}
            className="min-w-0 rounded-2xl border p-3 text-left transition-colors"
            style={{ background: action === item.id ? 'var(--accent-muted)' : 'var(--surface)',
              borderColor: action === item.id ? 'var(--border-strong)' : 'var(--border)' }}>
            <span className="flex items-center justify-between gap-2">
              <span style={{ color: action === item.id ? 'var(--accent)' : 'var(--muted)' }}>{iconFor(item.id)}</span>
              <span className="truncate text-[9px] font-semibold uppercase" style={{ color: 'var(--subtle)' }}>{item.tag}</span>
            </span>
            <span className="mt-3 block text-sm font-bold" style={{ color: 'var(--ink)' }}>{item.title}</span>
            <span className="mt-1 block text-[11px] leading-4" style={{ color: 'var(--muted)' }}>{item.summary}</span>
          </button>
        ))}
      </div>

      <div className="mt-3 rounded-2xl border p-4 sm:p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        {(action === 'SEND' || action === 'BRIDGE') ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>{bridge ? 'Prepare a cross-chain payment' : 'Who would you like to pay?'}</p>
                <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
                  {bridge ? 'Choose both networks here. Only Arc-source transfers are enabled.' : 'Your destination determines the route.'}
                </p>
              </div>
              <span className="rounded-full border px-2.5 py-1 text-[10px] font-semibold"
                style={{ borderColor: 'var(--border-strong)', color: 'var(--accent)' }}>USDC · Testnet</span>
            </div>

            <div className={bridge?'grid gap-3 sm:grid-cols-3':'grid gap-3 sm:grid-cols-2'}>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--muted)' }}>Amount</span>
                <div className="flex items-center gap-2 rounded-xl border px-3" style={{ borderColor: 'var(--border-strong)' }}>
                  <input type="text" inputMode="decimal" autoComplete="off" value={amount}
                    onChange={(event) => {
                      checkId.current++;setReverseChecking(false);setReverseLookup(null);
                      setAmount(event.target.value);setError(null);
                    }}
                    placeholder="0.00" aria-label="USDC amount" maxLength={27}
                    className="min-w-0 flex-1 bg-transparent py-3 text-base outline-none"
                    style={{ color: 'var(--ink)' }} />
                  <span className="text-xs font-bold" style={{ color: 'var(--muted)' }}>USDC</span>
                </div>
              </label>
              {bridge && (
                <label className="block min-w-0">
                  <span className="mb-1.5 block text-xs font-semibold" style={{color:'var(--muted)'}}>From network</span>
                  <select aria-label="Bridge source network" value={bridgeSource}
                    onChange={(event)=>chooseBridgeSource(event.target.value as QuickNetwork)}
                    className="w-full min-w-0 rounded-xl border px-3 py-3 text-sm font-semibold outline-none"
                    style={{background:'var(--surface-muted)',color:'var(--ink)',borderColor:'var(--border-strong)'}}>
                    {sourceChoices.map((n)=><option value={n.id} key={n.id}>{n.label}</option>)}
                  </select>
                </label>
              )}
              <label className="block min-w-0">
                <span className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                  {bridge?'To network':'Destination network'}
                </span>
                <select aria-label={bridge?'Bridge destination network':'Destination network'} value={network}
                  onChange={(event) => chooseNetwork(event.target.value as QuickNetwork)}
                  className="w-full min-w-0 rounded-xl border px-3 py-3 text-sm font-semibold outline-none"
                  style={{ background: 'var(--surface-muted)', color: 'var(--ink)', borderColor: 'var(--border-strong)' }}>
                  {destinationChoices.map((n) => (
                    <option key={n.id} value={n.id}>{n.label}{n.availability === 'PLANNED' ? ' · Coming later' : ''}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="rounded-xl border px-3 py-2.5 text-xs leading-5"
              style={{ borderColor: 'var(--border)', color: selectedNetwork.availability === 'PLANNED' ? 'var(--warning)' : 'var(--muted)' }}>
              {reverse
                ? 'Sepolia / Base → Arc · Read-only preview. Check source funds here; reverse sending is not enabled yet.'
                : selectedNetwork.availability === 'PLANNED'
                  ? 'This route is not enabled for payments.'
                  : isCrossChain
                    ? 'Arc → Sepolia / Base · CCTP V2 available. Review and sign on the Bridge step.'
                    : 'Direct Arc USDC payment. Recipient will be independently verified.'}
            </div>

            {!isCrossChain && (
              <div role="tablist" aria-label="Recipient type" className="inline-flex gap-1 rounded-xl p-1"
                style={{ background: 'var(--surface-muted)' }}>
                {(['WALLET','FRIEND'] as const).map((kind)=>(
                  <button key={kind} type="button" role="tab" aria-selected={recipientType===kind}
                    onClick={() => { setRecipientType(kind); setError(null); }}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold"
                    style={{ background: recipientType===kind ? 'var(--accent-muted)' : 'transparent',
                      color: recipientType===kind ? 'var(--ink)' : 'var(--muted)' }}>
                    {kind==='FRIEND' ? <Users className="size-3.5"/> : <Wallet className="size-3.5"/>}
                    {kind==='FRIEND' ? 'Friends' : 'Wallet'}
                  </button>
                ))}
              </div>
            )}
            {recipientType === 'FRIEND' && !isCrossChain ? (
              connected.length > 0 ? (
                <div>
                  <p className="mb-2 text-xs" style={{ color: 'var(--muted)' }}>Connected Veyra friends</p>
                  <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
                    {connected.map(friend => {
                      const handle = friendLabel(friend);
                      return <button key={friend.veyraUserId} type="button"
                        aria-pressed={selectedFriend===handle}
                        onClick={() => { setSelectedFriend(handle); setError(null); }}
                        className="rounded-xl border px-3 py-2 text-xs font-semibold"
                        style={{ borderColor: selectedFriend===handle ? 'var(--border-strong)' : 'var(--border)',
                          background: selectedFriend===handle ? 'var(--accent-muted)' : 'var(--surface-muted)',
                          color: 'var(--ink-2)' }}>{handle}</button>;
                    })}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border p-3 text-xs leading-5"
                  style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                  {signedIn ? 'No connected friends yet.' : 'Sign in to Veyra ID to see your friends.'}
                  <button type="button" onClick={() => onNavigate('social')}
                    className="ml-2 font-bold underline" style={{ color: 'var(--accent)' }}>Open Friends</button>
                </div>
              )
            ) : (
              <div>
                <label htmlFor="agent-quick-wallet" className="mb-1.5 block text-xs font-semibold"
                  style={{ color: 'var(--muted)' }}>Recipient wallet</label>
                <div className="flex items-center gap-2 rounded-xl border px-3" style={{ borderColor: 'var(--border-strong)' }}>
                  <input id="agent-quick-wallet" type="text" value={wallet}
                    autoComplete="off" autoCapitalize="off" spellCheck={false}
                    onChange={(event) => {
                      checkId.current++;setReverseChecking(false);setReverseLookup(null);
                      setWallet(event.target.value);setError(null);
                    }}
                    placeholder="Paste 0x wallet address" aria-label="Recipient wallet address"
                    className="min-w-0 flex-1 bg-transparent py-3 font-mono text-xs outline-none"
                    style={{ color: 'var(--ink)' }}/>
                  <button type="button" onClick={() => void pasteWallet()}
                    className="flex shrink-0 items-center gap-1 rounded-lg border px-2 py-2 text-xs font-semibold"
                    style={{ borderColor: 'var(--border)', color: 'var(--accent)' }}>
                    <Copy className="size-3.5"/> Paste
                  </button>
                </div>
                {isCrossChain && <p className="mt-2 text-[11px] leading-5" style={{ color: 'var(--subtle)' }}>
                  Cross-chain payments currently require a destination wallet address, not a Veyra ID.
                </p>}
              </div>
            )}
            {error && <p role="alert" className="text-xs leading-5" style={{ color: 'var(--warning)' }}>{error}</p>}
            {reverse ? (
              <>
                <button type="button" onClick={()=>void checkReverseRoute()}
                  disabled={reverseChecking}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border py-3 text-sm font-semibold disabled:opacity-50"
                  style={{borderColor:'var(--border-strong)',color:'var(--ink)'}}>
                  {reverseChecking?'Checking source chain…':'Check route (no signing)'}
                </button>
                {reverseResult && (
                  <div role="status" className="rounded-xl border p-3 space-y-1 text-xs"
                    style={{borderColor:'var(--border)',background:'var(--surface-muted)'}}>
                    <p className="font-bold" style={{color:'var(--ink)'}}>
                      {reverseResult.status==='SIMULATED'?'Source contract simulation passed'
                        :reverseResult.status==='APPROVAL_REQUIRED'?'Reverse Bridge unavailable · Source allowance is 0 or insufficient'
                        :reverseResult.status==='INSUFFICIENT_BALANCE'?'Insufficient source USDC balance'
                        :'Route check unavailable'}
                    </p>
                    {reverseResult.status==='UNAVAILABLE'
                      ? <p style={{color:'var(--muted)'}}>{reverseResult.reason}</p>
                      : <p style={{color:'var(--muted)'}}>
                        Source USDC: {formatUnits(reverseResult.balance,6)}
                        {' · '}Allowance: {formatUnits(reverseResult.allowance,6)}
                      </p>}
                    <p style={{color:'var(--warning)'}}>
                      Reverse Bridge remains unavailable for signing, even if source simulation passes.
                    </p>
                  </div>
                )}
                <p className="text-center text-[11px]" style={{color:'var(--subtle)'}}>
                  Source-chain RPC check only · No quote, wallet approval or transfer
                </p>
              </>
            ) : (
              <>
                <button type="button" onClick={prepare} disabled={selectedNetwork.availability==='PLANNED'}
                  className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40"
                  style={{background:'linear-gradient(135deg,#c8ff65,#91e9b5)',color:'#0b1b25'}}>
                  Create draft <ArrowRight className="size-4"/>
                </button>
                <p className="text-center text-[11px]" style={{color:'var(--subtle)'}}>
                  Draft only · No automatic signature, quote, approval or transfer
                </p>
              </>
            )}
          </div>
        ) : action === 'SWAP' ? (
          <div className="space-y-3">
            <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>Swap & Convert</p>
            <p className="text-xs leading-5" style={{ color: 'var(--muted)' }}>
              Explore USDC / EURC conversion. The StableFX provider is not yet enabled for real execution.
            </p>
            <div className="flex items-center gap-2 rounded-xl border p-3 text-sm"
              style={{ borderColor: 'var(--border)', color: 'var(--ink-2)' }}>
              <span>USDC</span><ArrowLeftRight className="size-4" style={{ color: 'var(--accent)' }}/><span>EURC</span>
              <span className="ml-auto text-[10px] font-bold uppercase" style={{ color: 'var(--warning)' }}>Preview</span>
            </div>
            <button type="button" onClick={() => onNavigate('convert')}
              className="flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold"
              style={{ borderColor: 'var(--border-strong)', color: 'var(--ink)' }}>
              Explore Convert <ArrowRight className="size-4"/>
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>Unified · one place for your money</p>
            <p className="text-xs leading-5" style={{ color: 'var(--muted)' }}>
              Live wallet-bound USDC across Arc, Ethereum Sepolia and Base Sepolia. Read-only balances are not pooled funds or spendable on another network.
            </p>
            <AgentUnifiedBalances key={address?.toLowerCase() ?? 'disconnected'} />
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => onNavigate('home')}
                className="flex items-center justify-center gap-2 rounded-xl border p-3 text-xs font-semibold"
                style={{ borderColor: 'var(--border-strong)', color: 'var(--ink)' }}>
                <CheckCircle2 className="size-4" style={{ color: 'var(--success)' }}/> Arc details
              </button>
              <button type="button" onClick={() => chooseAction('BRIDGE')}
                className="flex items-center justify-center gap-2 rounded-xl border p-3 text-xs font-semibold"
                style={{ borderColor: 'var(--border-strong)', color: 'var(--ink)' }}>
                <Info className="size-4" style={{ color: 'var(--accent)' }}/> Explore routes
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
