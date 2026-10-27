import { useState } from 'react';
import { ArrowRight, ArrowLeftRight, Compass, Copy, Globe2, SendHorizontal, Users, Wallet, CheckCircle2, Info } from 'lucide-react';
import type { SocialFriend } from '../../features/social/UnifiedSocial';
import { friendLabel } from '../../features/social/UnifiedSocial';
import { buildQuickPaymentRequest, QUICK_NETWORKS, type QuickMode, type QuickNetwork, type QuickRecipient } from '../../core/agent/quickStartPayment';
import type { VeyraPage } from '../layout/AppShell';

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
  { id: 'UNIFIED', title: 'Unified', summary: 'Balances & routes in one place', tag: 'Expanding' },
];

export function AgentQuickStart({ friends, signedIn, onPrepare, onNavigate, compact = false }: AgentQuickStartProps) {
  const [action, setAction] = useState<QuickAction>('SEND');
  const [amount, setAmount] = useState('');
  const [network, setNetwork] = useState<QuickNetwork>('arc');
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
  const actualNetwork = bridge && network === 'arc' ? 'ethereum-sepolia' : network;

  function chooseAction(next: QuickAction) {
    setAction(next);
    setError(null);
    if (next === 'BRIDGE') { setNetwork('ethereum-sepolia'); setRecipientType('WALLET'); }
    if (next === 'SEND') setNetwork('arc');
  }

  function chooseNetwork(next: QuickNetwork) {
    setNetwork(next);
    setError(null);
    if (next !== 'arc') setRecipientType('WALLET');
  }

  async function pasteWallet() {
    setError(null);
    try {
      if (!navigator.clipboard?.readText) throw Error('Clipboard access unavailable');
      const value = (await navigator.clipboard.readText()).trim();
      if (!value) throw Error('Clipboard is empty');
      setWallet(value);
    } catch {
      setError('Clipboard unavailable. Click the wallet field and paste with Ctrl+V.');
    }
  }

  function prepare() {
    const chosenNetwork = bridge ? actualNetwork : network;
    const recipient = recipientType === 'FRIEND' && !isCrossChain ? selectedFriend : wallet;
    const result = buildQuickPaymentRequest({
      mode: bridge ? 'BRIDGE' : 'SEND',
      network: chosenNetwork, amount, recipient,
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
                  {bridge ? 'From Arc Testnet via CCTP V2' : 'Your destination determines the route.'}
                </p>
              </div>
              <span className="rounded-full border px-2.5 py-1 text-[10px] font-semibold"
                style={{ borderColor: 'var(--border-strong)', color: 'var(--accent)' }}>USDC · Testnet</span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--muted)' }}>Amount</span>
                <div className="flex items-center gap-2 rounded-xl border px-3" style={{ borderColor: 'var(--border-strong)' }}>
                  <input type="text" inputMode="decimal" autoComplete="off" value={amount}
                    onChange={(event) => { setAmount(event.target.value); setError(null); }}
                    placeholder="0.00" aria-label="USDC amount" maxLength={27}
                    className="min-w-0 flex-1 bg-transparent py-3 text-base outline-none"
                    style={{ color: 'var(--ink)' }} />
                  <span className="text-xs font-bold" style={{ color: 'var(--muted)' }}>USDC</span>
                </div>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--muted)' }}>Destination network</span>
                <select aria-label="Destination network" value={bridge ? actualNetwork : network}
                  onChange={(event) => chooseNetwork(event.target.value as QuickNetwork)}
                  className="w-full rounded-xl border px-3 py-3 text-sm font-semibold outline-none"
                  style={{ background: 'var(--surface-muted)', color: 'var(--ink)', borderColor: 'var(--border-strong)' }}>
                  {QUICK_NETWORKS.filter((n) => !bridge || n.availability === 'BRIDGE').map((n) => (
                    <option key={n.id} value={n.id}>{n.label}{n.availability === 'PLANNED' ? ' · Coming later' : ''}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="rounded-xl border px-3 py-2.5 text-xs leading-5"
              style={{ borderColor: 'var(--border)', color: selectedNetwork.availability === 'PLANNED' ? 'var(--warning)' : 'var(--muted)' }}>
              {selectedNetwork.availability === 'PLANNED'
                ? 'This route is not enabled. You can explore Veyra, but payment review is unavailable.'
                : isCrossChain
                  ? 'Route: Arc Testnet → destination via CCTP V2. Wallet review and on-chain checks are required.'
                  : 'Route: direct Arc Testnet USDC payment. Recipient will be independently verified.'}
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
                    onChange={(event) => { setWallet(event.target.value); setError(null); }}
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
            <button type="button" onClick={prepare} disabled={selectedNetwork.availability==='PLANNED'}
              className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg,#c8ff65,#91e9b5)', color: '#0b1b25' }}>
              Prepare request <ArrowRight className="size-4"/>
            </button>
            <p className="text-center text-[11px]" style={{ color: 'var(--subtle)' }}>Draft only · No automatic signature, quote, approval or transfer</p>
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
              View your Arc Testnet USDC balance and explore verified routes. Aggregated multi-chain balances and universal spend are in development.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => onNavigate('home')}
                className="flex items-center justify-center gap-2 rounded-xl border p-3 text-xs font-semibold"
                style={{ borderColor: 'var(--border-strong)', color: 'var(--ink)' }}>
                <CheckCircle2 className="size-4" style={{ color: 'var(--success)' }}/> View balance
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
