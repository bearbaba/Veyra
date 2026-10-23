import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRight, AtSign, CheckCircle2, Copy, ExternalLink, Fingerprint, Github, LockKeyhole,
  RefreshCcw, ShieldCheck, UserPlus, Users, Wallet, XCircle,
} from 'lucide-react';
import {
  ARC_TESTNET_CHAIN_ID, awaitWalletResponse, parseArcChainId, readProvider, requireArcWallet,
  requireMatchingAccount, normalizeBetaHandle, signReviewedIdentity, verifyXAuthorizationUrl,
  type BrowserProvider, type Friend, type IdentityProfile,
} from './protocol';
import { announcedIdentityWallet, discoveredIdentityWallets, quickConnectWallet, walletToConnect, type IdentityWallet } from './walletDiscovery';
import { displayVeyraId, normalizeFriendLookup, readKnownHandle, rememberKnownHandle, shortIdentityReference } from './identityPresentation';
import {
  VeyraSessionExpiredError, beginXAccountLink, changeBlock, loginChallenge, loginComplete, readFriends, readProfile,
  registerChallenge, registerComplete, respondRequest, sendRequest, resolveFriendIdentity, readIdentityCapabilities,
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
}: { children: ReactNode; onClick: () => void; disabled?: boolean; secondary?: boolean }) {
  return <button type="button" disabled={disabled} className={secondary ? 'vi-button vi-outline' : 'vi-button vi-primary'} onClick={onClick}>{children}</button>;
}

export function IdentityBetaApp() {
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [wallets, setWallets] = useState<IdentityWallet[]>([]);
  const [showWalletChoices, setShowWalletChoices] = useState(false);
  const [connectedWalletName, setConnectedWalletName] = useState('');
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [handle, setHandle] = useState('');
  const [knownHandle, setKnownHandle] = useState<string | null>(null);
  const [showRegistration, setShowRegistration] = useState(false);
  const [xLinkAvailable, setXLinkAvailable] = useState(false);
  const [showUnblock, setShowUnblock] = useState(false);
  const [friendId, setFriendId] = useState('');
  const [xAuthorization, setXAuthorization] = useState<{ url: string; owner: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const activeOperation = useRef(0);
  const busyRef = useRef(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const generation = useRef(0);

  const clearAuth = useCallback(() => {
    generation.current += 1;
    setSession(null);
    setShowRegistration(false);
    setXAuthorization(null);
    setFriends([]);
    setOffset(0);
    setHasMore(false);
    setMessage('');
  }, []);

  useEffect(() => {
    // Request EIP-6963 announcements after subscribing; do not trust the
    // shared window.ethereum to pick MetaMask when other wallets are installed.
    const announced = (event: Event) => {
      const wallet = announcedIdentityWallet(event);
      if (wallet) setWallets(current => discoveredIdentityWallets(current, wallet));
    };
    window.addEventListener('eip6963:announceProvider', announced);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    // Backward-compatible fallback only, shown explicitly as a legacy provider.
    const legacy = readProvider();
    if (legacy) setWallets(current => discoveredIdentityWallets(current, {
      id: 'legacy-injected', name: 'Legacy injected wallet (unidentified)',
      provider: legacy, source: 'legacy',
    }));
    return () => window.removeEventListener('eip6963:announceProvider', announced);
  }, []);

  useEffect(() => {
    // Anonymous visits and wallet-connect clicks never trigger identity API calls.
    // Only a verified, signed-in session may discover whether X linking is ready.
    if (!session) { setXLinkAvailable(false); return; }
    let active = true;
    void readIdentityCapabilities().then(result => { if (active) setXLinkAvailable(result.xLinkAvailable); })
      .catch(() => { if (active) setXLinkAvailable(false); });
    return () => { active = false; };
  }, [session?.profile.veyraUserId]);

  useEffect(() => {
    if (!provider) return;
    const onAccounts = (...values: unknown[]) => {
      clearAuth();
      const accounts = Array.isArray(values[0]) ? values[0] : [];
      const next = typeof accounts[0] === 'string' ? accounts[0] : null;
      const valid = next && /^0x[0-9a-fA-F]{40}$/.test(next) ? next : null;
      setAddress(valid);
      setShowRegistration(false);
      setKnownHandle(valid ? readKnownHandle(valid) : null);
    };
    const onChain = (...values: unknown[]) => {
      clearAuth();
      setChainId(parseArcChainId(values[0]));
    };
    const onDisconnect = () => {
      clearAuth();
      setAddress(null);
      setKnownHandle(null);
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

  async function connect(walletId?: string) {
    if (busyRef.current) return;
    if (wallets.length === 0) {
      setError('No browser wallet found. Enable MetaMask or another wallet, then refresh.');
      return;
    }
    const chosen = walletId ? walletToConnect(wallets, walletId) : quickConnectWallet(wallets);
    if (!chosen) { setShowWalletChoices(true); return; }
    setShowWalletChoices(false);
    busyRef.current = true;
    const operationId = ++activeOperation.current;
    const rev = generation.current;
    setBusy(true); setError(''); setMessage('');
    setPhase('Waiting for your selected wallet to connect. Check the wallet extension window.');
    try {
      const candidate = chosen.provider;
      const accounts = await awaitWalletResponse(candidate.request({ method: 'eth_requestAccounts' }));
      const next: unknown = Array.isArray(accounts) ? accounts[0] : undefined;
      const network = parseArcChainId(await awaitWalletResponse(candidate.request({ method: 'eth_chainId' })));
      if (operationId !== activeOperation.current || rev !== generation.current) return;
      if (typeof next !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(next)) {
        throw new Error('Your browser wallet did not provide an EVM account.');
      }
      clearAuth();
      setProvider(candidate);
      setConnectedWalletName(chosen.name);
      setAddress(next);
      setShowRegistration(false);
      setKnownHandle(readKnownHandle(next));
      setChainId(network);
      if (network !== ARC_TESTNET_CHAIN_ID) setMessage('Wallet connected. Switch to Arc Testnet manually before signing.');
    } catch (cause) {
      if (operationId === activeOperation.current) setError(humanError(cause));
    } finally {
      if (operationId === activeOperation.current) {
        busyRef.current = false; setBusy(false); setPhase('');
      }
    }
  }

  function disconnect() {
    clearAuth();
    setProvider(null); setAddress(null); setChainId(null); setKnownHandle(null); setShowRegistration(false);
    setConnectedWalletName('');
    setShowWalletChoices(false);
    setError(''); setMessage('Wallet hidden in Veyra. To revoke its website permission, use your wallet settings.');
  }

  /**
   * A cancelled flow is not an aborted provider RPC or a rolled-back database
   * mutation. Invalidate any later client response; never auto-replay a signed
   * registration or submission when the status may be uncertain.
   */
  function stopWaiting() {
    generation.current += 1;
    activeOperation.current += 1;
    busyRef.current = false;
    setBusy(false);
    setPhase('');
    setMessage('');
    setError('Stopped waiting in Veyra. If MetaMask still shows a pending request, reject it there. If registration may have been submitted, try Sign in before registering again.');
  }

  async function runAction(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    const operationId = ++activeOperation.current;
    setBusy(true); setError(''); setMessage(''); setPhase('Preparing identity request…');
    try { await action(); }
    catch (cause) {
      if (operationId !== activeOperation.current) return;
      const text = humanError(cause);
      if (text.startsWith('This wallet already belongs to a Veyra ID.')) {
        // A returning wallet must never be trapped in another registration.
        // This changes UI state only: no automatic wallet signature or replay.
        setShowRegistration(false);
        setError('');
        setMessage('This wallet already has a Veyra ID. Continue with wallet to sign in.');
      } else if (text === 'This wallet has no Veyra ID. Register first.') {
        // The server confirmed the wallet is unregistered; show creation now.
        setShowRegistration(true);
        setError('');
        setMessage('No Veyra ID found for this wallet. Choose a name to create one.');
      } else {
        setError(text);
      }
      if (cause instanceof VeyraSessionExpiredError) clearAuth();
    } finally {
      if (operationId === activeOperation.current) {
        busyRef.current = false; setBusy(false); setPhase('');
      }
    }
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
      setPhase('Contacting Testnet backend for a fresh registration challenge…');
      const challenge = await registerChallenge(requestedHandle, connected);
      if (rev !== generation.current) return;
      const payload = challenge.typedData as { message?: { handle?: string } };
      if (payload.message?.handle !== requestedHandle) throw new Error('Registration handle changed before signing.');
      setPhase('Waiting for MetaMask approval. Open the wallet extension to review the identity-only signature.');
      const signature = await signReviewedIdentity(selected, challenge, 'register', connected, window.location.origin);
      if (rev !== generation.current) return;
      setPhase('Validating the current wallet account…');
      await requireMatchingAccount(selected, connected);
      if (rev !== generation.current) return;
      setPhase('Submitting the signed identity claim. Do not repeat registration while this is pending…');
      const result = await registerComplete(challenge.claimToken ?? '', signature);
      if (rev !== generation.current) return;
      if (!result.profile || typeof result.profile.veyraUserId !== 'string') {
        throw new Error('Registration was submitted, but the server returned an incomplete profile. Try Sign in before submitting another registration.');
      }
      const current = { token: result.sessionToken, profile: result.profile, address: connected };
      setSession(current);
      rememberKnownHandle(connected, current.profile.veyraHandle);
      setKnownHandle(current.profile.veyraHandle);
      setHandle('');
      setMessage('Veyra ID created and signed in. No second signature needed.');
      setPhase('Loading Friends for your new Veyra ID…');
      try { await refreshFriends(current); }
      catch { if (rev === generation.current) setMessage('Veyra ID registered successfully; Friends could not refresh yet. Try Refresh friends after signing in.'); }
    });
  }

  function signIn() {
    void runAction(async () => {
      const { selected, connected } = mustWallet();
      const rev = generation.current;
      setPhase('Contacting Testnet backend for a fresh sign-in challenge…');
      const challenge = await loginChallenge(connected);
      if (rev !== generation.current) return;
      setPhase('Waiting for MetaMask approval. Open the wallet extension to review the identity-only signature.');
      const signature = await signReviewedIdentity(selected, challenge, 'login', connected, window.location.origin);
      if (rev !== generation.current) return;
      setPhase('Validating the current wallet account…');
      await requireMatchingAccount(selected, connected);
      if (rev !== generation.current) return;
      setPhase('Verifying your signed sign-in with the Testnet backend…');
      const result = await loginComplete(challenge.challengeId ?? '', signature);
      if (rev !== generation.current) return;
      setPhase('Loading your verified Veyra profile…');
      const profile = await readProfile(result.sessionToken);
      if (rev !== generation.current || result.veyraUserId !== profile.veyraUserId) return;
      const current = { token: result.sessionToken, profile, address: connected };
      setSession(current);
      rememberKnownHandle(connected, current.profile.veyraHandle);
      setKnownHandle(current.profile.veyraHandle);
      setMessage('Signed in successfully. No financial permissions were granted.');
      setPhase('Loading Friends…');
      try { await refreshFriends(current); }
      catch { if (rev === generation.current) setMessage('Signed in successfully; Friends could not refresh yet.'); }
    });
  }

  function beginXLink() {
    void runAction(async () => {
      const current = mustSession();
      await requireMatchingAccount(mustWallet().selected, current.address);
      if (current.profile.x) {
        throw new Error('An X account is already linked to this Veyra ID.');
      }
      const created = await beginXAccountLink(current.token);
      // Authorization is a separate, explicit step. Do not navigate or open
      // popups after a network callback. Keep the active Veyra session in memory.
      const url = verifyXAuthorizationUrl(created.authorizeUrl);
      const expiresAt = Date.parse(created.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        throw new Error('X authorization expired. Generate a fresh link.');
      }
      setXAuthorization({ url, owner: current.profile.veyraUserId, expiresAt });
      setMessage('X authorization is ready. Continue with X in a new tab, then refresh your linked profile here.');
    });
  }

  function refreshLinkedProfile() {
    void runAction(async () => {
      const current = mustSession();
      await requireMatchingAccount(mustWallet().selected, current.address);
      const rev = generation.current;
      const profile = await readProfile(current.token);
      if (generation.current !== rev || profile.veyraUserId !== current.profile.veyraUserId) return;
      setSession({ ...current, profile });
      if (profile.x) setXAuthorization(null);
      setMessage(profile.x
        ? 'Verified X account is linked to your existing Veyra ID.'
        : 'No linked X account yet. Complete authorization in the X tab first.');
    });
  }

  function friendAction(action: 'request' | 'accept' | 'reject' | 'block' | 'unblock', target: string) {
    void runAction(async () => {
      const current = mustSession();
      await requireMatchingAccount(mustWallet().selected, current.address);
      let targetId = target;
      if (action === 'request') {
        const lookup = normalizeFriendLookup(target);
        if (lookup.startsWith('usr_')) targetId = lookup;
        else {
          const resolved = await resolveFriendIdentity(current.token, lookup);
          if (resolved.kind !== 'VEYRA_IDENTITY' || !/^usr_[1-9A-HJ-NP-Za-km-z]{10,}$/.test(resolved.veyraUserId)) {
            throw new Error('This is not a verified Veyra ID.');
          }
          targetId = resolved.veyraUserId;
        }
      }
      if (!/^usr_[1-9A-HJ-NP-Za-km-z]{10,}$/.test(targetId) || targetId === current.profile.veyraUserId) {
        throw new Error('Choose a different verified Veyra ID.');
      }
      if (action === 'request') await sendRequest(current.token, targetId);
      else if (action === 'accept' || action === 'reject') {
        await respondRequest(current.token, targetId, action === 'accept' ? 'ACCEPT' : 'REJECT');
      } else await changeBlock(current.token, targetId, action === 'block');
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
        <div className="vi-eyebrow">VEYRA ID · ARC TESTNET</div>
        <h1>One identity. <span>Every connection.</span></h1>
        <p>Your wallet, your people, your Veyra ID.</p>
      </div>



      {error && <div role="alert" className="vi-alert vi-error"><XCircle size={18}/><span>{error}</span></div>}
      {message && <div role="status" className="vi-alert vi-info"><CheckCircle2 size={18}/><span>{message}</span></div>}
      {busy && <div className="vi-wait-panel" role="status" aria-live="polite">
        <div className="vi-wait-copy">
          <strong>Identity request in progress</strong>
          <span>{phase || 'Processing securely…'}</span>
          <small>Wallet popups may appear behind Chrome. No payment or token approval is requested.</small>
        </div>
        <button type="button" className="vi-wait-stop" onClick={stopWaiting}>Stop waiting</button>
      </div>}

      <div className="vi-grid">
        <section className="vi-card">
          <div className="vi-card-heading"><div className="vi-icon"><Wallet size={19}/></div><div><h2>Wallet</h2><p>Arc Testnet</p></div></div>
          <div className="vi-network">
            <span>{connectedWalletName || 'SELF-CUSTODIAL WALLET'}</span>
            <strong>{connected ? shortAddress(address!) : 'Not connected'}</strong>
            <small>{connected ? (correctChain ? 'Correct network · Ready for identity signing' : 'Wrong network · Switch manually in wallet') : 'Connect to get started.'}</small>
          </div>
          {!connected
            ? <ActionButton disabled={busy} onClick={()=>void connect()}><Wallet size={16}/> Connect Wallet <ArrowRight size={16}/></ActionButton>
            : <ActionButton secondary disabled={busy} onClick={disconnect}>Disconnect</ActionButton>}
          {!connected && wallets.length > 1 && !showWalletChoices && <button type="button" className="vi-text-link" onClick={()=>setShowWalletChoices(true)}>Other wallets</button>}
          {!connected && showWalletChoices && <div className="vi-wallet-choices" role="group" aria-label="Available wallet extensions">
            <div className="vi-wallet-choices-top"><span>Choose a wallet</span><button type="button" aria-label="Close wallet choices" onClick={()=>setShowWalletChoices(false)}>Close</button></div>
            {wallets.map(wallet => <button type="button" key={wallet.id} onClick={()=>void connect(wallet.id)} disabled={busy}>{wallet.name} <ArrowRight size={15}/></button>)}
          </div>}
          <p className="vi-footnote"><LockKeyhole size={14}/> Wallet connection never authorizes payments.</p>
        </section>

        <section className="vi-card">
          <div className="vi-card-heading"><div className="vi-icon"><Fingerprint size={19}/></div><div><h2>Veyra ID</h2><p>One account. Your identity.</p></div></div>
          {session ? <>
            <div className="vi-profile"><div className="vi-avatar">@</div><div><strong>{displayVeyraId(session.profile.veyraHandle)}</strong>
              {session.profile.displayName && session.profile.displayName.toLowerCase() !== session.profile.veyraHandle.toLowerCase() && <span>{session.profile.displayName}</span>}</div><CheckCircle2 size={19}/></div>
            <div className="vi-id-row"><span>YOUR VEYRA ID · SHARE WITH FRIENDS</span><strong>{displayVeyraId(session.profile.veyraHandle)}</strong>
              <button type="button" aria-label="Copy Veyra ID" onClick={()=>void navigator.clipboard.writeText(displayVeyraId(session.profile.veyraHandle))}><Copy size={15}/></button>
            </div>
            <details className="vi-advanced"><summary>Technical account reference</summary><code>{session.profile.veyraUserId}</code></details>
            <div className="vi-x-inline"><AtSign size={17}/><span>X account</span>
              <strong>{session.profile.x ? '@' + (session.profile.x.xHandle ?? 'Verified') : 'Not linked'}</strong>
              {!session.profile.x && <button type="button" onClick={beginXLink} disabled={busy || !xLinkAvailable}
                title={xLinkAvailable ? 'Link X to this Veyra ID' : 'X OAuth requires server setup'}>Link X</button>}
              {session.profile.x && <button type="button" onClick={refreshLinkedProfile} disabled={busy}>Refresh</button>}
            </div>
            {!session.profile.x && !xLinkAvailable && <p className="vi-quiet">X connection needs server-side OAuth setup. Your Veyra ID remains unchanged.</p>}
            {xAuthorization?.owner === session.profile.veyraUserId && <a className="vi-x-authorize" href={xAuthorization.url} rel="noopener noreferrer" target="_blank">Continue securely with X <ExternalLink size={14}/></a>}
            {xAuthorization?.owner === session.profile.veyraUserId && <button type="button" className="vi-text-link" disabled={busy} onClick={refreshLinkedProfile}>I finished connecting X · Refresh</button>}
            <ActionButton secondary disabled={busy} onClick={clearAuth}>Sign out</ActionButton>
          </> : !connected ? <p className="vi-quiet">Connect your wallet to continue.</p>
          : !showRegistration ? <>
            {knownHandle && <div className="vi-known"><span>Welcome back</span><strong>{displayVeyraId(knownHandle)}</strong></div>}
            <ActionButton disabled={!readyToSign} onClick={signIn}><ShieldCheck size={16}/> Continue with wallet</ActionButton>
            <p className="vi-quiet">One secure identity signature signs you in. No payments or transfers.</p>
            <button type="button" className="vi-text-link" disabled={busy}
              onClick={()=>{setShowRegistration(true);setError('');setMessage('');}}>New to Veyra? Create an ID</button>
          </> : <>
            <label className="vi-field"><span>CREATE YOUR VEYRA ID</span><input autoComplete="off" value={handle}
              onChange={e=>setHandle(e.target.value)} placeholder="yourname" maxLength={30}/></label>
            <p className="vi-preview-id">Your ID: {handle.trim() ? '@' + handle.trim().replace(/^@/,'').toLowerCase() + '.veyra' : '@yourname.veyra'}</p>
            <ActionButton disabled={!readyToSign || !handle.trim()} onClick={register}><Fingerprint size={16}/> Create Veyra ID</ActionButton>
            <button type="button" className="vi-text-link" disabled={busy}
              onClick={()=>{setShowRegistration(false);setError('');setMessage('');}}>Already registered? Continue with wallet</button>
          </>}
          <p className="vi-footnote"><ShieldCheck size={14}/> Identity signatures only. No transfers.</p>
        </section>
      </div>

      <section className="vi-card vi-friends">
        <div className="vi-card-heading"><div className="vi-icon"><Users size={20}/></div><div><h2>Friends</h2><p>People connected to your Veyra ID</p></div>
          <button type="button" className="vi-icon-btn" aria-label="Refresh friends" disabled={!session || busy} onClick={()=>void runAction(async()=>{ await refreshFriends(mustSession());setMessage('Friends refreshed.'); })}><RefreshCcw size={18}/></button>
        </div>
        {!session ? <div className="vi-friends-locked">Sign in to manage your friends.</div> : <>
          <div className="vi-friends-meta">{connectedCount} connected · {incoming} requests</div>
          <label className="vi-field"><span>ADD FRIEND BY VEYRA ID</span><div className="vi-inline"><input value={friendId} onChange={e=>setFriendId(e.target.value.trim())} placeholder="@friend.veyra" autoComplete="off"/><ActionButton disabled={busy || !friendId} onClick={()=>friendAction('request',friendId)}><UserPlus size={16}/> Invite</ActionButton></div></label>
           
          {friends.length===0 ? <div className="vi-friends-locked">No connections yet.</div> :
            <div className="vi-list">{friends.map(item=><div key={item.veyraUserId} className="vi-friend">
              <div className="vi-friend-avatar">{item.state==='CONNECTED'?'✓':'@'}</div>
              <div className="vi-friend-body"><strong>{item.veyraHandle ? displayVeyraId(item.veyraHandle) : shortIdentityReference(item.veyraUserId)}</strong><span>{item.state==='CONNECTED'?'Connected':item.state==='INCOMING_PENDING'?'Incoming request':'Invite sent'}</span></div>
              <div className="vi-friend-actions">
                {item.state==='INCOMING_PENDING' && <>
                  <button type="button" disabled={busy} onClick={()=>friendAction('accept',item.veyraUserId)}>Accept</button>
                  <button type="button" disabled={busy} onClick={()=>friendAction('reject',item.veyraUserId)}>Decline</button>
                </>}
                {item.state==='CONNECTED' && <button type="button" disabled={busy} onClick={()=>friendAction('block',item.veyraUserId)}>Block</button>}
              </div>
            </div>)}</div>}
          {hasMore && <ActionButton secondary disabled={busy} onClick={()=>void runAction(async()=>{await refreshFriends(mustSession(),offset);})}>Load more</ActionButton>}
           
          <button type="button" className="vi-text-link vi-unblock-toggle" onClick={()=>setShowUnblock(value=>!value)} aria-expanded={showUnblock}>{showUnblock ? 'Hide blocked account tools' : 'Manage blocked accounts'}</button>
          {showUnblock && <label className="vi-field vi-unblock"><span>UNBLOCK BY TECHNICAL USER ID</span><div className="vi-inline"><input value={friendId} onChange={e=>setFriendId(e.target.value.trim())} placeholder="usr_..." autoComplete="off"/><ActionButton secondary disabled={busy || !friendId} onClick={()=>friendAction('unblock',friendId)}>Unblock</ActionButton></div></label>}
        </>}
      </section>
      <footer className="vi-footer"><span>Veyra Identity Beta · Experimental · Testnet only</span><a href="https://github.com/bearbaba/Veyra" target="_blank" rel="noreferrer"><Github size={15}/> Open source</a></footer>
    </main>
  </div>;
}
