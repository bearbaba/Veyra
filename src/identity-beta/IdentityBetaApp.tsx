import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight, CheckCircle2, CircleHelp, Copy, Fingerprint, Github, LockKeyhole,
  LogOut, RefreshCcw, ShieldCheck, UserPlus, Users, Wallet, XCircle,
} from 'lucide-react';
import {
  ARC_TESTNET_CHAIN_ID, parseArcChainId, readProvider, requireArcWallet,
  requireMatchingAccount, normalizeBetaHandle, signReviewedIdentity,
  type BrowserProvider, type Friend, type IdentityProfile,
} from './protocol';
import {
  changeBlock, loginChallenge, loginComplete, readFriends, readProfile,
  registerChallenge, registerComplete, respondRequest, sendRequest,
} from './api';

interface Session { token: string; profile: IdentityProfile; address: string; }

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
function humanError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  // Provider errors can contain long untrusted messages; never render stack/traces.
  return message.slice(0, 280);
}
function ActionButton({
  children, onClick, disabled = false, secondary = false,
}: { children: React.ReactNode; onClick: () => void; disabled?: boolean; secondary?: boolean }) {
  return <button type="button" disabled={disabled} className={secondary ? 'vi-button vi-outline' : 'vi-button vi-primary'} onClick={onClick}>{children}</button>;
}

export function IdentityBetaApp() {
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [handle, setHandle] = useState('');
  const [friendId, setFriendId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const generation = useRef(0);

  const clearAuth = useCallback(() => {
    generation.current += 1;
    setSession(null);
    setFriends([]);
    setOffset(0);
    setHasMore(false);
    setMessage('');
  }, []);

  useEffect(() => {
    if (!provider) return;
    const onAccounts = (...values: unknown[]) => {
      clearAuth();
      const accounts = Array.isArray(values[0]) ? values[0] : [];
      const next = typeof accounts[0] === 'string' ? accounts[0] : null;
      setAddress(next && /^0x[0-9a-fA-F]{40}$/.test(next) ? next : null);
    };
    const onChain = (...values: unknown[]) => {
      clearAuth();
      setChainId(parseArcChainId(values[0]));
    };
    const onDisconnect = () => {
      clearAuth();
      setAddress(null);
      setChainId(null);
    };
    provider.on?.('accountsChanged', onAccounts);
    provider.on?.('chainChanged', onChain);
    provider.on?.('disconnect', onDisconnect);
    return () => {
      provider.removeListener?.('accountsChanged', onAccounts);
      provider.removeListener?.('chainChanged', onChain);
      provider.removeListener?.('disconnect', onDisconnect);
    };
  }, [provider, clearAuth]);

  async function connect() {
    setBusy(true); setError(''); setMessage('');
    try {
      const candidate = readProvider();
      if (!candidate) throw new Error('Install or enable MetaMask/Rabby in this browser, then reload.');
      const accounts = await candidate.request({ method: 'eth_requestAccounts' });
      const next = Array.isArray(accounts) ? accounts[0] : undefined;
      const network = parseArcChainId(await candidate.request({ method: 'eth_chainId' }));
      if (typeof next !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(next)) {
        throw new Error('Your browser wallet did not provide an EVM account.');
      }
      clearAuth();
      setProvider(candidate);
      setAddress(next);
      setChainId(network);
      if (network !== ARC_TESTNET_CHAIN_ID) setMessage('Wallet connected. Switch to Arc Testnet manually before signing.');
    } catch (cause) { setError(humanError(cause)); }
    finally { setBusy(false); }
  }

  function disconnect() {
    clearAuth();
    setProvider(null); setAddress(null); setChainId(null);
    setError(''); setMessage('Wallet hidden in Veyra. To revoke its website permission, use your wallet settings.');
  }

  async function runAction(action: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await action(); }
    catch (cause) {
      const text = humanError(cause);
      setError(text);
      if (/session expired|unauthorized/i.test(text)) clearAuth();
    } finally { setBusy(false); }
  }

  function mustWallet() {
    if (!provider) throw new Error('Connect your browser wallet first.');
    const connected = requireArcWallet(address, chainId);
    return { selected: provider, connected };
  }
  function mustSession() {
    if (!session) throw new Error('Sign in to Veyra ID first.');
    if (!address || session.address.toLowerCase() !== address.toLowerCase()) {
      clearAuth();
      throw new Error('Wallet changed. Please sign in again.');
    }
    return session;
  }
  async function refreshFriends(current = session, nextOffset = 0) {
    if (!current) return;
    const rev = generation.current;
    const data = await readFriends(current.token, nextOffset);
    if (generation.current !== rev) return;
    setFriends(previous => nextOffset === 0 ? data.items : [...previous, ...data.items]);
    setOffset(data.nextOffset ?? 0);
    setHasMore(data.hasMore);
  }

  function register() {
    void runAction(async () => {
      const { selected, connected } = mustWallet();
      const requestedHandle = normalizeBetaHandle(handle);
      const rev = generation.current;
      const challenge = await registerChallenge(requestedHandle, connected);
      if (rev !== generation.current) return;
      const payload = challenge.typedData as { message?: { handle?: string } };
      if (payload.message?.handle !== requestedHandle) throw new Error('Registration handle changed before signing.');
      const signature = await signReviewedIdentity(selected, challenge, 'register', connected, window.location.origin);
      if (rev !== generation.current) return;
      await requireMatchingAccount(selected, connected);
      const result = await registerComplete(challenge.claimToken ?? '', signature);
      if (rev !== generation.current) return;
      setSession({ token: result.sessionToken, profile: result.profile, address: connected });
      setMessage('Your Veyra ID is registered. Sign in again after refreshing the page.');
      await refreshFriends({ token: result.sessionToken, profile: result.profile, address: connected });
    });
  }

  function signIn() {
    void runAction(async () => {
      const { selected, connected } = mustWallet();
      const rev = generation.current;
      const challenge = await loginChallenge(connected);
      if (rev !== generation.current) return;
      const signature = await signReviewedIdentity(selected, challenge, 'login', connected, window.location.origin);
      if (rev !== generation.current) return;
      await requireMatchingAccount(selected, connected);
      const result = await loginComplete(challenge.challengeId ?? '', signature);
      if (rev !== generation.current) return;
      const profile = await readProfile(result.sessionToken);
      if (rev !== generation.current || result.veyraUserId !== profile.veyraUserId) return;
      const current = { token: result.sessionToken, profile, address: connected };
      setSession(current);
      setMessage('Signed in successfully. No financial permissions were granted.');
      await refreshFriends(current);
    });
  }

  function friendAction(action: 'request' | 'accept' | 'reject' | 'block' | 'unblock', target: string) {
    void runAction(async () => {
      const current = mustSession();
      await requireMatchingAccount(mustWallet().selected, current.address);
      if (!/^usr_[1-9A-HJ-NP-Za-km-z]{10,}$/.test(target) || target === current.profile.veyraUserId) {
        throw new Error('Enter another valid Veyra User ID.');
      }
      if (action === 'request') await sendRequest(current.token, target);
      else if (action === 'accept' || action === 'reject') {
        await respondRequest(current.token, target, action === 'accept' ? 'ACCEPT' : 'REJECT');
      } else await changeBlock(current.token, target, action === 'block');
      setMessage(action === 'request' ? 'Friend request sent.' : 'Friendship state updated.');
      setFriendId('');
      await refreshFriends(current);
    });
  }

  const connected = Boolean(address && provider);
  const correctChain = chainId === ARC_TESTNET_CHAIN_ID;
  const readyToSign = connected && correctChain && !busy;
  const incoming = friends.filter(item => item.state === 'INCOMING_PENDING').length;
  const connectedCount = friends.filter(item => item.state === 'CONNECTED').length;

  return <div className="vi-root">
    <header className="vi-header">
      <a className="vi-logo" href="https://github.com/bearbaba/Veyra" target="_blank" rel="noreferrer">
        <span className="vi-mark">V</span><span>veyra<span className="vi-dot">.</span></span>
      </a>
      <span className="vi-header-pill"><span className="vi-led" /> ARC TESTNET · IDENTITY BETA</span>
      <span className="vi-header-right"><ShieldCheck size={16} /> No payments or transfers</span>
    </header>
    <main className="vi-container">
      <div className="vi-intro">
        <div className="vi-eyebrow"><Fingerprint size={16}/> IDENTITY · FRIENDS · TRUST</div>
        <h1>Your identity.<br/><span>Your connections.</span></h1>
        <p>Build your Veyra ID, reconnect securely, and manage friends through the live Testnet backend. No token approvals, payments or transaction signatures are available here.</p>
      </div>

      <div className="vi-steps">
        <div><span>01</span> Connect wallet</div><ArrowRight size={16}/>
        <div><span>02</span> Register / Sign in</div><ArrowRight size={16}/>
        <div><span>03</span> Friends</div>
      </div>

      {error && <div role="alert" className="vi-alert vi-error"><XCircle size={18}/><span>{error}</span></div>}
      {message && <div role="status" className="vi-alert vi-info"><CheckCircle2 size={18}/><span>{message}</span></div>}

      <div className="vi-grid">
        <section className="vi-card">
          <div className="vi-card-heading"><div className="vi-icon"><Wallet size={20}/></div><div><h2>Wallet connection</h2><p>Arc Testnet · Chain ID 5042002</p></div></div>
          <div className="vi-network">
            <span>WALLET STATUS</span>
            <strong>{connected ? shortAddress(address!) : 'Not connected'}</strong>
            <small>{connected ? (correctChain ? 'Correct network · Ready for identity signing' : 'Wrong network · Switch manually in wallet') : 'Choose your browser wallet to get started.'}</small>
          </div>
          {!connected
            ? <ActionButton disabled={busy} onClick={()=>void connect()}><Wallet size={16}/> Connect Wallet <ArrowRight size={16}/></ActionButton>
            : <ActionButton secondary disabled={busy} onClick={disconnect}><LogOut size={16}/> Disconnect</ActionButton>}
          <p className="vi-footnote"><LockKeyhole size={15}/> Connecting is read-only. Identity signatures are requested only after you explicitly click Register or Sign In.</p>
        </section>

        <section className="vi-card">
          <div className="vi-card-heading"><div className="vi-icon"><Fingerprint size={20}/></div><div><h2>Veyra ID</h2><p>One verified identity per wallet on Arc Testnet</p></div></div>
          {session ? <>
            <div className="vi-profile"><div className="vi-avatar">@</div><div><strong>@{session.profile.veyraHandle}</strong><span>{session.profile.displayName}</span></div><CheckCircle2 size={19}/></div>
            <div className="vi-id-row"><span>VEYRA USER ID</span><code>{session.profile.veyraUserId}</code>
              <button type="button" aria-label="Copy Veyra User ID" onClick={()=>void navigator.clipboard.writeText(session.profile.veyraUserId)}><Copy size={15}/></button>
            </div>
            <ActionButton secondary disabled={busy} onClick={clearAuth}><LogOut size={16}/> Sign out</ActionButton>
          </> : <>
            <label className="vi-field"><span>NEW ID HANDLE</span><input autoComplete="off" value={handle} onChange={e=>setHandle(e.target.value)} placeholder="e.g. alex_web3" maxLength={31}/></label>
            <ActionButton disabled={!readyToSign} onClick={register}><Fingerprint size={16}/> Register Veyra ID</ActionButton>
            <div className="vi-or">ALREADY REGISTERED?</div>
            <ActionButton disabled={!readyToSign} onClick={signIn} secondary><ShieldCheck size={16}/> Sign in with wallet</ActionButton>
          </>}
          <p className="vi-footnote"><CircleHelp size={15}/> A signature only proves wallet ownership. Sessions remain in memory and are cleared when you reload or change wallets.</p>
        </section>
      </div>

      <section className="vi-card vi-friends">
        <div className="vi-card-heading"><div className="vi-icon"><Users size={20}/></div><div><h2>Friends</h2><p>Real signed-session data from PostgreSQL</p></div>
          <button type="button" className="vi-icon-btn" aria-label="Refresh friends" disabled={!session || busy} onClick={()=>void runAction(async()=>{ await refreshFriends(mustSession());setMessage('Friends refreshed.'); })}><RefreshCcw size={18}/></button>
        </div>
        {!session ? <div className="vi-empty"><Users size={31}/><strong>Sign in to unlock Friends</strong><p>Your connections stay private until your wallet proves ownership.</p></div> : <>
          <div className="vi-stats"><div><strong>{connectedCount}</strong><span>Connected</span></div><div><strong>{incoming}</strong><span>Requests received</span></div><div><strong>{friends.length}</strong><span>Loaded records</span></div></div>
          <label className="vi-field"><span>ADD A FRIEND BY VEYRA USER ID</span><div className="vi-inline"><input value={friendId} onChange={e=>setFriendId(e.target.value.trim())} placeholder="usr_..." autoComplete="off"/><ActionButton disabled={busy || !friendId} onClick={()=>friendAction('request',friendId)}><UserPlus size={16}/> Invite</ActionButton></div></label>
          <p className="vi-caption">Invite using the Veyra User ID shared by your friend. A friend request grants no financial access.</p>
          {friends.length===0 ? <div className="vi-empty vi-small-empty"><Users size={26}/><p>No connections yet. Ask a friend to share their Veyra User ID.</p></div> :
            <div className="vi-list">{friends.map(item=><div key={item.veyraUserId} className="vi-friend">
              <div className="vi-friend-avatar">{item.state==='CONNECTED'?'✓':'@'}</div>
              <div className="vi-friend-body"><strong>{item.veyraUserId}</strong><span>{item.state==='CONNECTED'?'Connected':item.state==='INCOMING_PENDING'?'Incoming request':'Invite sent'}</span></div>
              <div className="vi-friend-actions">
                {item.state==='INCOMING_PENDING' && <>
                  <button type="button" disabled={busy} onClick={()=>friendAction('accept',item.veyraUserId)}>Accept</button>
                  <button type="button" disabled={busy} onClick={()=>friendAction('reject',item.veyraUserId)}>Decline</button>
                </>}
                {item.state==='CONNECTED' && <button type="button" disabled={busy} onClick={()=>friendAction('block',item.veyraUserId)}>Block</button>}
              </div>
            </div>)}</div>}
          {hasMore && <ActionButton secondary disabled={busy} onClick={()=>void runAction(async()=>{await refreshFriends(mustSession(),offset);})}>Load more</ActionButton>}
          <p className="vi-caption">Block or unblock removes previous friendship status; after unblocking, a new friend request is required. For safety, blocked people are not included in this list.</p>
          <label className="vi-field vi-unblock"><span>UNBLOCK BY USER ID</span><div className="vi-inline"><input value={friendId} onChange={e=>setFriendId(e.target.value.trim())} placeholder="usr_..." autoComplete="off"/><ActionButton secondary disabled={busy || !friendId} onClick={()=>friendAction('unblock',friendId)}>Unblock</ActionButton></div></label>
        </>}
      </section>
      <footer className="vi-footer"><span>Veyra Identity Beta · Experimental · Testnet only</span><a href="https://github.com/bearbaba/Veyra" target="_blank" rel="noreferrer"><Github size={15}/> Open source</a></footer>
    </main>
  </div>;
}
