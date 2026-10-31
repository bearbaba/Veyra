/**
 * Veyra Convert Page
 *
 * USDC ↔ EURC via Circle StableFX (VERIFIED 2026-10-07)
 *
 * Pipeline enforced:
 *   User input → Quote (BFF/Circle API) → Policy → Risk → Simulation →
 *   Review sheet → User signs Permit2 → BFF trade → Verify → VeyraReceipt
 *
 * Requires: CIRCLE_API_KEY on BFF server
 * Requires: connected wallet (for Permit2 signing)
 */

import { useState } from 'react';
import {AppKitSwapPage} from './AppKitSwapPage';
import {VEYRA_ENV,IS_UI_ONLY_PREVIEW} from '../../lib/env';
import { useAccount, useSignTypedData, useWalletClient, usePublicClient } from 'wagmi';
import { ArrowLeftRight, Loader2, CheckCircle, AlertTriangle, Info, RefreshCw, Lock } from 'lucide-react';
import { formatUnits, getAddress } from 'viem';
import { useConvertExecution } from '../../hooks/useConvertExecution';
import { findManifestEntry } from '../../providers/registry/providerManifest';
import { currencyToAddress, type StableFxFundingPresign, type StableFxTradeStatus, type StableFxQuoteResponse } from '../../providers/stablefx/stableFxAdapter';
import { MANIFEST_CONSTANTS } from '../../providers/registry/providerManifest';
import type { ConvertAction } from '../../core/actions/actionSchema';
import type { IntentCandidate } from '../../core/intent/intentSchema';

// ── Lifecycle check ───────────────────────────────────────────────────────────
const STABLEFX_ENTRY = findManifestEntry('circle-stablefx');
const STABLEFX_LIFECYCLE_READY = STABLEFX_ENTRY?.lifecycleStage === 'ENABLED' && STABLEFX_ENTRY?.enabled === true;

type CurrencyOption = 'USDC' | 'EURC';

const PERMIT2 = getAddress('0x000000000022D473030F116dDEE9F6B43aC78BA3');
const ERC20_FUNDS_ABI = [
  { type:'function', name:'balanceOf', stateMutability:'view',
    inputs:[{name:'owner',type:'address'}], outputs:[{name:'balance',type:'uint256'}] },
  { type:'function', name:'allowance', stateMutability:'view',
    inputs:[{name:'owner',type:'address'},{name:'spender',type:'address'}],
    outputs:[{name:'allowance',type:'uint256'}] },
  { type:'function', name:'approve', stateMutability:'nonpayable',
    inputs:[{name:'spender',type:'address'},{name:'amount',type:'uint256'}],
    outputs:[{name:'success',type:'bool'}] },
] as const;

export function ConvertPage({embedded = false, initialIntent = null}: {
  embedded?: boolean;
  initialIntent?: IntentCandidate | null;
} = {}) {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const arcClient = usePublicClient({ chainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID });
  const { signTypedDataAsync } = useSignTypedData();
  const { state, fetchQuote, executeConvert, reset } = useConvertExecution();
  const initialFrom = initialIntent?.tokenRaw?.raw.trim().toUpperCase();
  const initialTo = initialIntent?.targetTokenRaw?.raw.trim().toUpperCase();
  const initialValid = !initialIntent || ((initialFrom==='USDC'&&initialTo==='EURC') ||
    (initialFrom==='EURC'&&initialTo==='USDC'));
  const [fromCurrency, setFromCurrency] = useState<CurrencyOption>(
    initialFrom === 'EURC' ? 'EURC' : 'USDC',
  );
  const [amount, setAmount] = useState(initialIntent?.amountRaw?.raw.trim() ?? '');
  const [uiError, setUiError] = useState<string | null>(initialValid ? null :
    'Agent requested an unsupported Swap pair. Verify USDC and EURC on Arc Testnet.');

  const toCurrency: CurrencyOption = fromCurrency === 'USDC' ? 'EURC' : 'USDC';

  function handleSwapDirection() {
    setFromCurrency(toCurrency);
    reset();
  }

  async function handleGetQuote() {
    if (!address || !amount || !initialValid) return;
    if (!/^\d{1,18}(?:\.\d{1,6})?$/.test(amount) || Number(amount)<=0) {
      setUiError('Enter a positive USDC/EURC amount with at most six decimals.');
      return;
    }
    setUiError(null);
    await fetchQuote(fromCurrency, toCurrency, amount, address);
  }

  async function handleExecute(action: ConvertAction, quote: StableFxQuoteResponse) {
    if (!address) return;
    if (!walletClient?.account || walletClient.account.address.toLowerCase() !== address.toLowerCase() ||
        await walletClient.getChainId() !== MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID) {
      setUiError('Connect the reviewed wallet on Arc Testnet before signing Swap.');
      return;
    }
    setUiError(null);
    await executeConvert(action, quote, address, async (typedData) => {
      // Separate explicit signatures for trade intent and later funding.
      if (walletClient.account.address.toLowerCase() !== address.toLowerCase() ||
          await walletClient.getChainId() !== MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID)
        throw Error('Wallet or chain changed; signature is cancelled.');
      return signTypedDataAsync({
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
      });
    }, async (presign: StableFxFundingPresign, trade: StableFxTradeStatus) => {
      if (!arcClient) throw Error('Arc RPC is unavailable for Swap funding.');
      if (!walletClient.account || walletClient.account.address.toLowerCase() !== address.toLowerCase() ||
          await walletClient.getChainId() !== MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID ||
          await arcClient.getChainId() !== MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID)
        throw Error('Your wallet or RPC chain changed before funding.');
      const permitted = presign.typedData.message.permitted as {token:string;amount:string | number};
      const sourceToken = currencyToAddress(trade.from.currency as 'USDC'|'EURC');
      if (getAddress(permitted.token) !== getAddress(sourceToken))
        throw Error('Funding token differs from the reviewed Swap.');
      const amountRaw = BigInt(permitted.amount);
      const spender = getAddress(String(presign.typedData.message.spender));
      const [tokenCode, permitCode, spenderCode, balance, allowance] = await Promise.all([
        arcClient.getCode({address:sourceToken}),
        arcClient.getCode({address:PERMIT2}),
        arcClient.getCode({address:spender}),
        arcClient.readContract({address:sourceToken,abi:ERC20_FUNDS_ABI,functionName:'balanceOf',args:[address]}),
        arcClient.readContract({address:sourceToken,abi:ERC20_FUNDS_ABI,functionName:'allowance',args:[address,PERMIT2]}),
      ]);
      if (!tokenCode || tokenCode==='0x' || !permitCode || permitCode==='0x' ||
          !spenderCode || spenderCode==='0x')
        throw Error('Swap token, Permit2 or provider spender code is not verified on Arc.');
      if (balance<amountRaw) throw Error('Insufficient source token balance for Swap funding.');
      if (allowance<amountRaw) {
        // Exact bounded allowance, never uint256.max. Approval is a separate
        // signed on-chain transaction and cannot count as a completed Swap.
        const tx = await walletClient.writeContract({
          address: sourceToken, abi: ERC20_FUNDS_ABI, functionName:'approve',
          args:[PERMIT2,amountRaw],account:walletClient.account,chain:null,
        });
        const receipt = await arcClient.waitForTransactionReceipt({hash:tx});
        if (receipt.status!=='success') throw Error('Funding token approval did not succeed.');
        const confirmed = await arcClient.readContract({
          address:sourceToken,abi:ERC20_FUNDS_ABI,functionName:'allowance',args:[address,PERMIT2],
        });
        if (confirmed<amountRaw)throw Error('Exact funding allowance was not confirmed.');
      }
    });
  }

  // The authenticated browser-wallet Testnet route is permissionless Circle
  // App Kit Swap, not institution-only StableFX. Keep the original conservative
  // StableFX path unchanged for other modes and existing regression contracts.
  if(VEYRA_ENV==='testnet'&&!IS_UI_ONLY_PREVIEW)
    return <AppKitSwapPage embedded={embedded} initialIntent={initialIntent}/>;

  if (!isConnected) {
    return (
      <div className="max-w-md mx-auto px-4 py-8">
        <h1 className="display text-2xl font-bold mb-6" style={{ color: 'var(--ink)' }}>Convert</h1>
        <div className="rounded-2xl p-6 text-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <Info className="size-6 mx-auto mb-3" style={{ color: 'var(--accent)' }} />
          <p className="text-sm" style={{ color: 'var(--muted)' }}>Connect your wallet to convert between USDC and EURC.</p>
        </div>
      </div>
    );
  }

  // Lifecycle gate — provider must reach ENABLED before execution
  if (!STABLEFX_LIFECYCLE_READY) {
    return (
      <div className="max-w-md mx-auto px-4 py-8">
        <h1 className="display text-2xl font-bold mb-6" style={{ color: 'var(--ink)' }}>Convert</h1>
        <div className="rounded-2xl p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-start gap-3 mb-4">
            <Lock className="size-5 mt-0.5 shrink-0" style={{ color: 'var(--muted)' }} />
            <div>
              <p className="text-sm font-semibold mb-1" style={{ color: 'var(--ink)' }}>Convert is not yet available</p>
              <p className="text-sm" style={{ color: 'var(--muted)' }}>
                The Circle StableFX provider is <span className="font-medium">
                  {STABLEFX_ENTRY?.lifecycleStage ?? 'unregistered'}
                </span> — real testnet end-to-end execution must succeed before this feature can be enabled.
              </p>
            </div>
          </div>
          <div className="rounded-xl p-3 text-xs font-mono" style={{ background: 'var(--surface-raised)', color: 'var(--muted)' }}>
            <div>Provider: circle-stablefx</div>
            <div>Lifecycle: {STABLEFX_ENTRY?.lifecycleStage ?? 'UNKNOWN'}</div>
            <div>Required: ENABLED</div>
            <div>Path: DISCOVERED → VERIFIED → IMPLEMENTED → TESTED → ENABLED</div>
          </div>
        </div>
      </div>
    );
  }

  if (state.status === 'VERIFIED' && state.receipt) {
    return (
      <div className="max-w-md mx-auto px-4 py-8">
        <div className="rounded-2xl p-6 text-center space-y-4" style={{ background: 'var(--surface)', border: '1px solid var(--success-muted)' }}>
          <CheckCircle className="size-10 mx-auto" style={{ color: 'var(--success)' }} />
          <h2 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>Convert complete</h2>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>{state.receipt.displaySummary}</p>
          <button
            onClick={reset}
            className="w-full rounded-xl py-2.5 text-sm font-semibold"
            style={{ background: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid var(--border-strong)' }}
          >
            Convert again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={embedded ? 'min-w-0 w-full space-y-4' : 'max-w-md mx-auto px-4 py-8 space-y-4'}>
      <div className="mb-2">
        <h1 className="display text-2xl font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>Convert</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>USDC ↔ EURC via Circle StableFX</p>
      </div>

      {/* Input form */}
      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border-strong)' }}>
        {/* From */}
        <div className="px-4 py-4" style={{ background: 'var(--surface)' }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted)' }}>From</span>
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
              style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}>{fromCurrency}</span>
          </div>
          <input
            type="number"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); reset(); }}
            placeholder="0.00"
            className="w-full bg-transparent text-2xl font-semibold outline-none"
            style={{ color: 'var(--ink)' }}
          />
        </div>

        {/* Swap button */}
        <div className="flex items-center justify-center py-2 border-t border-b" style={{ borderColor: 'var(--border)', background: 'var(--surface-strong)' }}>
          <button
            onClick={handleSwapDirection}
            className="flex size-8 items-center justify-center rounded-full transition-all hover:bg-white/10"
            style={{ border: '1px solid var(--border)' }}
          >
            <ArrowLeftRight className="size-4" style={{ color: 'var(--accent)' }} />
          </button>
        </div>

        {/* To */}
        <div className="px-4 py-4" style={{ background: 'var(--surface)' }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted)' }}>To</span>
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
              style={{ background: 'var(--surface-strong)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}>{toCurrency}</span>
          </div>
          {state.evaluation?.simulationResult?.ok ? (
            <p className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>
              ≥ {formatUnits(state.evaluation.simulationResult.minAmountOut, 6)}
            </p>
          ) : (
            <p className="text-2xl font-semibold" style={{ color: 'var(--subtle)' }}>—</p>
          )}
        </div>
      </div>

      {/* Quote info */}
      {state.quote && state.evaluation?.simulationResult?.ok && (
        <div className="rounded-xl px-4 py-3 space-y-1.5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <InfoRow label="Rate" value={`1 ${fromCurrency} ≈ ${state.evaluation.simulationResult.quoteRate} ${toCurrency}`} />
          <InfoRow label="Slippage" value={`${state.evaluation.action.slippageBps / 100}%`} />
          <InfoRow label="Policy" value={state.evaluation.policyResult.decision} accent={state.evaluation.policyResult.decision === 'PASS'} />
          <InfoRow label="Risk" value={`${state.evaluation.riskResult.level} (${state.evaluation.riskResult.score})`} accent={state.evaluation.riskResult.level !== 'CRITICAL'} />
          <InfoRow label="Provider" value="Circle StableFX" />
        </div>
      )}

      {/* Error */}
      {uiError && <p role="alert" className="rounded-xl border px-3 py-2 text-sm"
        style={{borderColor:'var(--border-strong)',color:'var(--danger)'}}>{uiError}</p>}
      {(state.status === 'POLICY_BLOCKED' || state.status === 'FAILED') && state.error && (
        <div className="flex items-start gap-2 rounded-xl p-3.5" style={{ background: 'var(--danger-muted)', border: '1px solid var(--border)' }}>
          <AlertTriangle className="size-4 mt-0.5 shrink-0" style={{ color: 'var(--danger)' }} />
          <p className="text-sm" style={{ color: 'var(--danger)' }}>{state.error}</p>
        </div>
      )}

      {/* Provider completion alone cannot make funds spendable; no second
          quote or signature while a previously submitted trade is unresolved. */}
      {state.status === 'SETTLEMENT_PENDING' ? (
        <div role="status" className="rounded-2xl border px-4 py-3 text-sm leading-6"
          style={{borderColor:'var(--border-strong)',background:'var(--surface)',color:'var(--muted)'}}>
          StableFX reported completion, but the destination token receipt is not verified.
          Check Activity and the blockchain before preparing another Swap.
          No new trade is submitted automatically.
        </div>
      ) : state.status === 'PENDING' || state.status === 'FAILED' || state.status === 'POLICY_BLOCKED' ? (
        <button
          onClick={() => void handleGetQuote()}
          disabled={!amount || !isConnected}
          className="w-full rounded-2xl py-3.5 font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'var(--accent)', color: '#0d1b2f' }}
        >
          Get quote
        </button>
      ) : state.status === 'VALIDATING' ? (
        <button disabled className="w-full rounded-2xl py-3.5 font-semibold text-sm opacity-60"
          style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
          <Loader2 className="inline size-4 mr-2 animate-spin" />
          Getting quote...
        </button>
      ) : state.status === 'AWAITING_APPROVAL' && state.evaluation && state.quote ? (
        <button
          onClick={() => void handleExecute(state.evaluation!.action, state.quote!)}
          className="w-full rounded-2xl py-3.5 font-semibold text-sm transition-all hover:scale-[1.01] active:scale-[0.99]"
          style={{ background: 'var(--accent)', color: '#0d1b2f' }}
        >
          Sign &amp; convert
        </button>
      ) : state.status === 'SIGNING' || state.status === 'BROADCASTING' || state.status === 'VERIFYING' ? (
        <button disabled className="w-full rounded-2xl py-3.5 font-semibold text-sm opacity-60"
          style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
          <Loader2 className="inline size-4 mr-2 animate-spin" />
          {state.status === 'SIGNING' ? 'Waiting for signature...'
            : state.status === 'BROADCASTING' ? 'Submitting...'
            : 'Verifying...'}
        </button>
      ) : (
        <button
          onClick={() => { reset(); }}
          className="w-full rounded-2xl py-3.5 font-semibold text-sm"
          style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}
        >
          <RefreshCw className="inline size-4 mr-2" />
          Refresh quote
        </button>
      )}

      {/* Verified provider notice */}
      <div className="flex items-start gap-2 rounded-xl p-3" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
        <Info className="size-3.5 mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Circle StableFX — verified 2026-10-07. CIRCLE_API_KEY required on the server.
          All amounts come from Circle's quote API and are validated by Veyra's policy and risk engines before execution.
        </p>
      </div>
    </div>
  );
}

function InfoRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span className="font-medium" style={{ color: accent ? 'var(--success)' : 'var(--ink-2)' }}>{value}</span>
    </div>
  );
}
