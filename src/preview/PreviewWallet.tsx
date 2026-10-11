/**
 * Browser wallet *connection* for the isolated Vercel Preview.
 *
 * This deliberately uses only EIP-1193 eth_accounts, eth_requestAccounts
 * and eth_chainId. No signing, chain switching, transaction submission,
 * wallet session authentication, financial permissions or BFF.
 *
 * Public Arc Testnet USDC balance uses eth_chainId + eth_call against the
 * authoritative generated onchain-facts registry, never a user-supplied RPC.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getUsdc, requireChain } from '../onchain-facts';

const ARC_ID = 5042002;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export interface InjectedPreviewProvider {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: InjectedPreviewProvider;
  }
}

type DiscoveredWallet = { id: string; name: string; provider: InjectedPreviewProvider };
type Eip6963Event = Event & {
  detail?: { info?: { uuid?: string; name?: string }; provider?: InjectedPreviewProvider };
};

interface PreviewWalletState {
  address: string | null;
  chainId: number | null;
  wallets: DiscoveredWallet[];
  busy: boolean;
  error: string | null;
  activeWalletName: string | null;
  connect: (walletId?: string) => Promise<void>;
  disconnect: () => void;
}

const PreviewWalletContext = createContext<PreviewWalletState | null>(null);

function parseAddress(raw: unknown): string | null {
  if (!Array.isArray(raw) || typeof raw[0] !== 'string' || !ADDRESS_RE.test(raw[0])) return null;
  return raw[0];
}
function parseChain(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^0x[0-9a-fA-F]+$/.test(raw)) return null;
  const chain = Number.parseInt(raw, 16);
  return Number.isSafeInteger(chain) ? chain : null;
}

export function PreviewWalletProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function announced(event: Event) {
      const detail = (event as Eip6963Event).detail;
      if (!detail?.provider || typeof detail.provider.request !== 'function') return;
      const id = detail.info?.uuid || detail.info?.name || 'discovered-wallet';
      const name = detail.info?.name || 'Browser wallet';
      setWallets((current) => current.some((w) => w.id === id)
        ? current
        : [...current, { id, name, provider: detail.provider! }]);
    }
    window.addEventListener('eip6963:announceProvider', announced);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    if (window.ethereum) {
      setWallets((current) => current.some((w) => w.provider === window.ethereum)
        ? current : [...current, { id: 'injected', name: 'Injected wallet', provider: window.ethereum! }]);
    }
    return () => window.removeEventListener('eip6963:announceProvider', announced);
  }, []);

  const active = wallets.find((w) => w.id === selectedId) ?? null;

  useEffect(() => {
    const provider = active?.provider;
    if (!provider) return;
    let disposed = false;
    const onAccounts = (...args: unknown[]) => {
      if (!disposed) setAddress(parseAddress(args[0]));
    };
    const onChain = (...args: unknown[]) => {
      if (!disposed) setChainId(parseChain(args[0]));
    };
    const onDisconnect = () => {
      if (!disposed) { setAddress(null); setChainId(null); }
    };
    provider.on?.('accountsChanged', onAccounts);
    provider.on?.('chainChanged', onChain);
    provider.on?.('disconnect', onDisconnect);
    // Read existing permissions only; never silently prompts a wallet.
    void Promise.all([
      provider.request({ method: 'eth_accounts' }),
      provider.request({ method: 'eth_chainId' }),
    ]).then(([accounts, chain]) => {
      if (!disposed) { setAddress(parseAddress(accounts)); setChainId(parseChain(chain)); }
    }).catch(() => {
      if (!disposed) { setAddress(null); setChainId(null); }
    });
    return () => {
      disposed = true;
      provider.removeListener?.('accountsChanged', onAccounts);
      provider.removeListener?.('chainChanged', onChain);
      provider.removeListener?.('disconnect', onDisconnect);
    };
  }, [active]);

  const connect = useCallback(async (walletId?: string) => {
    const selected = wallets.find((w) => w.id === walletId) ?? wallets[0];
    if (!selected) {
      setError('No injected wallet detected. Install MetaMask, Rabby, or Coinbase Wallet on this browser.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const accounts = await selected.provider.request({ method: 'eth_requestAccounts' });
      const permitted = parseAddress(accounts);
      if (!permitted) throw new Error('The wallet returned no permitted account.');
      const chain = parseChain(await selected.provider.request({ method: 'eth_chainId' }));
      setSelectedId(selected.id);
      setAddress(permitted);
      setChainId(chain);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Wallet connection declined.');
    } finally {
      setBusy(false);
    }
  }, [wallets]);

  const disconnect = useCallback(() => {
    setSelectedId(null);
    setAddress(null);
    setChainId(null);
    setError(null);
  }, []);

  const value = useMemo<PreviewWalletState>(() => ({
    address, chainId, wallets, busy, error,
    activeWalletName: active?.name ?? null,
    connect, disconnect,
  }), [address, chainId, wallets, busy, error, active?.name, connect, disconnect]);

  return <PreviewWalletContext.Provider value={value}>{children}</PreviewWalletContext.Provider>;
}

export function usePreviewWallet(): PreviewWalletState {
  const value = useContext(PreviewWalletContext);
  if (!value) throw new Error('PreviewWalletProvider is missing.');
  return value;
}

export function shortPreviewAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export interface PreviewBalanceState {
  formatted: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function usePreviewArcBalance(address: string | null): PreviewBalanceState {
  const [formatted, setFormatted] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!address || !ADDRESS_RE.test(address)) {
      setFormatted(null);
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const chain = requireChain(ARC_ID);
    const usdc = getUsdc(ARC_ID);
    if (!usdc) {
      setError('Arc Testnet USDC contract not in reviewed registry.');
      return;
    }
    const rpc = chain.rpcUrls[0];
    setLoading(true);
    setError(null);
    async function readRpc(method: string, params: unknown[]): Promise<string> {
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error('Arc RPC is temporarily unavailable.');
      const json = await res.json() as { result?: unknown; error?: { message?: string } };
      if (json.error || typeof json.result !== 'string') {
        throw new Error(json.error?.message || 'Invalid Arc RPC response.');
      }
      return json.result;
    }
    void (async () => {
      try {
        const actualChain = parseChain(await readRpc('eth_chainId', []));
        if (actualChain !== ARC_ID) throw new Error('Arc RPC returned an unexpected chain ID.');
        const calldata = `0x70a08231${address.slice(2).toLowerCase().padStart(64, '0')}`;
        const raw = await readRpc('eth_call', [{
          to: usdc.address, data: calldata,
        }, 'latest']);
        if (!/^0x[0-9a-fA-F]+$/.test(raw)) throw new Error('Invalid USDC balance returned.');
        const units = BigInt(raw);
        const divisor = 10n ** BigInt(usdc.decimals);
        const whole = (units / divisor).toLocaleString('en-US');
        const fraction = (units % divisor).toString().padStart(usdc.decimals, '0').slice(0, 2);
        if (!controller.signal.aborted) setFormatted(`${whole}.${fraction}`);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setFormatted(null);
          setError(cause instanceof Error ? cause.message : 'Arc balance unavailable.');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [address, revision]);

  return {
    formatted, loading, error,
    refresh: () => setRevision((revision) => revision + 1),
  };
}
