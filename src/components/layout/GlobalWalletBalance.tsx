/** Network-pinned USDC balance shared across every Veyra tab. */
import { useAccount, useReadContract } from 'wagmi';
import { erc20Abi, formatUnits, type Address } from 'viem';
import { RefreshCw, Wallet, AlertTriangle } from 'lucide-react';
import { VEYRA_ENV } from '@/lib/env';
import { getUsdc } from '@/onchain-facts';

export function GlobalWalletBalance() {
  const {address, isConnected, chainId} = useAccount();
  const chain = VEYRA_ENV === 'mainnet' ? 5042 : 5042002;
  const token = getUsdc(chain);
  const {data, isError, isFetching, refetch} = useReadContract({
    address: token?.address as Address | undefined,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: chain,
    query: { enabled: isConnected && !!address && !!token, refetchInterval: 15000, staleTime: 8000 },
  });
  const network = chain === 5042 ? 'Arc Mainnet' : 'Arc Testnet';
  const wrong = isConnected && chainId !== chain;
  return <div className="border-b px-4 py-2" role="region" aria-label="Wallet USDC balance"
    style={{background:'rgba(68,178,255,.05)',borderColor:'var(--border)'}}>
    <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 text-xs sm:text-sm">
      <Wallet className="size-4 shrink-0" style={{color:'var(--accent)'}}/>
      <span className="font-semibold" style={{color:'var(--ink)'}}>{network} · USDC</span>
      <strong className="font-mono tabular-nums" style={{color:'var(--ink)'}}>
        {!isConnected?'Connect wallet':isError?'Balance unavailable':
          data!==undefined?formatUnits(data,6)+' USDC':'Loading balance…'}
      </strong>
      {isConnected && <button type="button" aria-label="Refresh wallet USDC" onClick={()=>void refetch()}
        disabled={isFetching} className="rounded-md p-1" style={{color:'var(--muted)'}}>
        <RefreshCw className={'size-3.5 '+(isFetching?'animate-spin':'')}/>
      </button>}
      {wrong && <span role="status" className="ml-auto flex items-center gap-1"
        style={{color:'var(--warning)'}}><AlertTriangle className="size-3.5"/>
        Wallet on another network · switch to {network} to sign
      </span>}
      {!wrong && <span className="ml-auto" style={{color:'var(--subtle)'}}>Wallet balance · not Gateway</span>}
    </div>
  </div>;
}
