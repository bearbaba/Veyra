/**
 * Veyra Settlement — Arc Studio-authored VeyraSettlement contract UI.
 *
 * P0 Financial-correctness invariants (enforced here, not assumed):
 *
 * 1. FAIL-CLOSED FEE READ: Review only unlocks once feeBps AND feeRecipient
 *    have been read successfully from the live contract. No silent zero fallback.
 *
 * 2. NETWORK FEE ESTIMATE — CORRECT DENOMINATION:
 *    Arc native gas uses 18 decimals; USDC ERC-20 uses 6 decimals.
 *    gasPrice from getGasPrice() is in 18-decimal native units (wei-equivalent).
 *    gasEstimateRaw * gasPrice produces a value in 10^18 denomination.
 *    We divide by 10^12 (= 10^18 / 10^6) to arrive at 6-decimal USDC micro-units.
 *    This is identical to the usdcToGasToken / gasTokenToUsdc rescale in
 *    @/onchain-money — we replicate the arithmetic inline rather than importing
 *    the Amount type so this file stays a React component with plain bigint.
 *    The estimate is shown as a SEPARATE line — never combined with protocol fee,
 *    gross amount, or net recipient amount.
 *    Approve tx gas is estimated separately and also shown before each signature.
 *    If estimation fails, "estimation unavailable" is shown explicitly (never near-zero).
 *    The estimate is refreshed immediately before the Sign button is enabled.
 *
 * 3. PRE-SIGN REVALIDATION: Before broadcasting, publicClient re-reads feeBps,
 *    feeRecipient, and USDC allowance. Any mismatch blocks broadcast.
 *    Wallet address and chain ID are also verified against the review snapshot.
 *
 * 4. INDEPENDENT PAYMENT VERIFICATION — ALL 12 CHECKS:
 *    After receipt confirmed, the verifier checks:
 *      (a) Chain ID matches Arc (5042002 or 5042)
 *      (b) Receipt status === 'success'
 *      (c) tx.to === deployment.address (contract was the target)
 *      (d) PaymentSettled event emitted BY deployment.address (not another contract)
 *      (e) args.payer === snapshot.address (correct sender)
 *      (f) args.recipient === snapshot.recipient (correct recipient)
 *      (g) args.amount === snapshot.amountParsed (correct gross)
 *      (h) args.fee === snapshot.feeAmount (correct protocol fee)
 *      (i) args.amount - args.fee === snapshot.netAmount (consistent net)
 *      (j) args.ref === snapshot.ref (matching payment reference)
 *      (k) USDC Transfer log from payer to contract present with correct amount
 *      (l) USDC Transfer log from contract to recipient present with net amount
 *    A single mismatch produces 'confirmed' (not 'verified').
 *    The reason for each failure is recorded and shown.
 *
 * 5. MAINNET ESCROW GATE: Escrow tab hidden on Arc Mainnet in the UI.
 *    The on-chain escrow functions remain callable (EVM is permissionless) —
 *    this is documented explicitly to users.
 *
 * 6. REVIEW SNAPSHOT FREEZE: sender, recipient, amount, chainId, mode, contract,
 *    feeBps, feeAmount, netAmount, and paymentRef are frozen into an immutable
 *    FeeSnapshot when the user clicks "Review". Execution uses snapshot values,
 *    not live state, so wallet/network changes after review are caught at
 *    revalidation and never silently used.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  useAccount, useWriteContract, useWaitForTransactionReceipt,
  useReadContract, useSwitchChain, useEstimateGas, usePublicClient,
} from 'wagmi';
import {
  parseUnits, isAddress, formatUnits, erc20Abi,
  decodeEventLog, decodeFunctionData, encodeFunctionData, encodeDeployData, parseAbi, keccak256, type Log,
} from 'viem';
import { ConnectKitButton } from 'connectkit';
import { AlertTriangle, CheckCircle, Clock, ExternalLink, Lock, Send, Unlock, Loader2 } from 'lucide-react';
import { VEYRA_ENV } from '@/lib/env';
import {recordLocalOperation,readLocalOperations} from '@/mainnet/localOperations';
import {readSettlementIntent,writeSettlementIntent,clearSettlementIntent,settlementUnresolved,type SettlementIntent} from '@/mainnet/settlementJournal';
import {inspectRecordedSettlement} from '@/mainnet/verifyRecordedSettlement';
import { MainnetSettlementDeploy } from './MainnetSettlementDeploy';
import { VEYRA_SETTLEMENT_CREATION_BYTECODE, VEYRA_SETTLEMENT_CREATION_KECCAK } from '@/generated/veyraSettlementCreation';
import {
  VEYRA_SETTLEMENT_ABI,
  ARC_TESTNET_CHAIN_ID,
  ARC_MAINNET_CHAIN_ID,
  ARC_TESTNET_USDC,
  ARC_MAINNET_USDC,
  VEYRA_SETTLEMENT_MAINNET_OWNER,
  buildSettlementTxExplorerUrl,
  getVeyraSettlementDeployment,
} from '@/config/veyraSettlement';
import { gasNativeToUsdcMicro, fmtGasUsdc } from '@/lib/settlementGas';
import {
  verifyPaymentReceipt,
  type VerifySnapshot,
  type PaymentSettledArgs,
  type TransferLog,
} from '@/lib/settlementVerify';

// ─── constants ────────────────────────────────────────────────────────────────

/** USDC ERC-20 interface uses 6 decimals on Arc. */
const USDC_DECIMALS = 6;

// gasNativeToUsdcMicro and fmtGasUsdc are imported from @/lib/settlementGas
// (18-dec Arc native → 6-dec USDC micro-units, ceiling division)

const MIN_ESCROW_HOURS = 1;
const MAX_ESCROW_DAYS = 30;
const BPS_DENOM = 10_000n;

// ─── helpers ──────────────────────────────────────────────────────────────────

function arcUsdcForChain(chainId: number): `0x${string}` {
  return chainId === ARC_MAINNET_CHAIN_ID ? ARC_MAINNET_USDC : ARC_TESTNET_USDC;
}

function arcChainLabel(chainId: number): string {
  if (chainId === ARC_MAINNET_CHAIN_ID) return 'Arc Mainnet';
  if (chainId === ARC_TESTNET_CHAIN_ID) return 'Arc Testnet';
  return `Chain ${chainId}`;
}

/** Format 6-decimal USDC raw amount, stripping trailing zeros. */
function fmtUsdc(raw: bigint): string {
  return formatUnits(raw, USDC_DECIMALS).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function ReviewRow({ label, value, mono = false, accent = false, warn = false }: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="px-4 py-3 flex justify-between items-center gap-3">
      <span className="text-xs text-white/50 shrink-0">{label}</span>
      <span className={
        `text-sm text-right break-all ` +
        `${mono ? 'font-mono' : 'font-medium'} ` +
        `${accent ? 'text-emerald-300' : warn ? 'text-amber-300' : 'text-white'}`
      }>
        {value}
      </span>
    </div>
  );
}

// ─── types ─────────────────────────────────────────────────────────────────────

type Mode = 'pay' | 'escrow';
type Step =
  | 'form'
  | 'loading-fees'
  | 'review'
  | 'approve'
  | 'revalidating'
  | 'execute'
  | 'pending'
  | 'verified'
  | 'confirmed'
  | 'error';

/**
 * Immutable snapshot of every parameter shown to the user at review time.
 * Execution MUST use these values; any live deviation is caught at revalidation.
 */
interface ReviewSnapshot {
  // identity
  walletAddress: `0x${string}`;
  chainId: number;
  chainLabel: string;
  // payment target
  mode: Mode;
  recipient: `0x${string}`;
  amountParsed: bigint;
  // contract
  contractAddress: `0x${string}`;
  usdcAddress: `0x${string}`;
  // fee config (from live contract read)
  feeBps: bigint;
  feeRecipient: string | null;
  feeAmount: bigint;
  netAmount: bigint;
  feePercent: number;
  // gas estimate (in 6-decimal USDC micro-units for display; raw native stored for pre-sign refresh)
  gasEstimateNative: bigint;
  approveGasNative: bigint;
  // payment reference (fixed at review entry)
  ref: `0x${string}`;
  // escrow (only set when mode === 'escrow')
  escrowHours?: string;
}

interface VerificationResult {
  verified: boolean;
  paymentId: `0x${string}`;
  feeOnChain: bigint;
  netOnChain: bigint;
  refOnChain: `0x${string}`;
  blockNumber: bigint;
  txHash: `0x${string}`;
  gasUsed: bigint;
  failReasons: string[];
}

// ─── crypto random ref ────────────────────────────────────────────────────────

function buildRef(): `0x${string}` {
  const entropy = crypto.getRandomValues(new Uint8Array(32));
  const hex = Array.from(entropy).map(b => b.toString(16).padStart(2, '0')).join('');
  return `0x${hex}`;
}

// ─── component ─────────────────────────────────────────────────────────────────

export function SettlementPage({embedded=false}:{embedded?:boolean}) {
  const { address, isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const publicClient = usePublicClient({ chainId });

  // form state
  const [mode, setMode] = useState<Mode>('pay');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [escrowHours, setEscrowHours] = useState('24');

  // lifecycle
  const [step, setStep] = useState<Step>('form');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [intentState,setIntentState]=useState<ReturnType<typeof readSettlementIntent>>({kind:'empty'});
  useEffect(()=>{
    const sync=()=>setIntentState(address?readSettlementIntent(address):{kind:'empty'});
    sync();
    window.addEventListener('veyra:mainnet:journal',sync);
    window.addEventListener('focus',sync);
    return()=>{
      window.removeEventListener('veyra:mainnet:journal',sync);
      window.removeEventListener('focus',sync);
    };
  },[address]);
  const [approveTxHash, setApproveTxHash] = useState<`0x${string}` | undefined>();
  const [settleTxHash, setSettleTxHash] = useState<`0x${string}` | undefined>();

  // frozen snapshot (set at review entry, read during execution and verification)
  const [snapshot, setSnapshot] = useState<ReviewSnapshot | null>(null);

  // verification result
  const [verResult, setVerResult] = useState<VerificationResult | null>(null);

  // derived chain state
  const onArc = VEYRA_ENV === 'mainnet' ? chainId === ARC_MAINNET_CHAIN_ID : chainId === ARC_TESTNET_CHAIN_ID;
  const deployment = onArc && chainId ? getVeyraSettlementDeployment(chainId) : null;
  const isMainnet = chainId === ARC_MAINNET_CHAIN_ID;
  const activeUsdcAddress = chainId ? arcUsdcForChain(chainId) : ARC_TESTNET_USDC;
  const chainLabel = chainId ? arcChainLabel(chainId) : 'Arc';

  // Mainnet financial signing is gated by a fresh, independent onchain readback
  // of the exact user-authorized deployment. A registry address alone is never proof.
  const [mainnetDeploymentStatus, setMainnetDeploymentStatus] = useState<'checking'|'verified'|'failed'>('checking');
  const [mainnetDeploymentMessage, setMainnetDeploymentMessage] = useState<string>('');
  const [deploymentCheckGeneration, setDeploymentCheckGeneration] = useState(0);

  async function validateMainnetDeployment() {
    if (!deployment || !publicClient || chainId !== ARC_MAINNET_CHAIN_ID) {
      throw new Error('Arc Mainnet provider or deployed address is unavailable.');
    }
    if (await publicClient.getChainId() !== ARC_MAINNET_CHAIN_ID) {
      throw new Error('RPC network is not Arc Mainnet (5042).');
    }
    if (keccak256(VEYRA_SETTLEMENT_CREATION_BYTECODE) !== VEYRA_SETTLEMENT_CREATION_KECCAK) {
      throw new Error('Creation bytecode does not match reproducible build.');
    }
    const expectedInput = encodeDeployData({
      abi: parseAbi(['constructor(address usdc_,address initialOwner,address feeRecipient_,uint16 feeBps_)']),
      bytecode: VEYRA_SETTLEMENT_CREATION_BYTECODE,
      args: [ARC_MAINNET_USDC, VEYRA_SETTLEMENT_MAINNET_OWNER, VEYRA_SETTLEMENT_MAINNET_OWNER, 0],
    });
    const [tx, receipt, code, chainOwner, token, fee, paused] = await Promise.all([
      publicClient.getTransaction({hash: deployment.deployTxHash}),
      publicClient.getTransactionReceipt({hash: deployment.deployTxHash}),
      publicClient.getBytecode({address: deployment.address}),
      publicClient.readContract({address: deployment.address,abi: VEYRA_SETTLEMENT_ABI,functionName:'owner'}),
      publicClient.readContract({address: deployment.address,abi: VEYRA_SETTLEMENT_ABI,functionName:'usdc'}),
      publicClient.readContract({address: deployment.address,abi: VEYRA_SETTLEMENT_ABI,functionName:'feeBps'}),
      publicClient.readContract({address: deployment.address,abi: VEYRA_SETTLEMENT_ABI,functionName:'paused'}),
    ]);
    if (tx.to !== null || tx.from.toLowerCase() !== VEYRA_SETTLEMENT_MAINNET_OWNER.toLowerCase() ||
        tx.input.toLowerCase() !== expectedInput.toLowerCase() ||
        receipt.status !== 'success' ||
        receipt.contractAddress?.toLowerCase() !== deployment.address.toLowerCase() ||
        !code || code === '0x' ||
        String(chainOwner).toLowerCase() !== VEYRA_SETTLEMENT_MAINNET_OWNER.toLowerCase() ||
        String(token).toLowerCase() !== ARC_MAINNET_USDC.toLowerCase() ||
        BigInt(fee as bigint) !== 0n || paused !== false) {
      throw new Error('Deployment transaction, runtime, owner, USDC, fee, or pause state failed verification.');
    }
  }

  useEffect(() => {
    if (VEYRA_ENV !== 'mainnet' || !onArc || !deployment || !publicClient) {
      setMainnetDeploymentStatus('checking');
      setMainnetDeploymentMessage('');
      return;
    }
    let cancelled = false;
    setMainnetDeploymentStatus('checking');
    setMainnetDeploymentMessage('');
    validateMainnetDeployment().then(() => {
      if (!cancelled) setMainnetDeploymentStatus('verified');
    }).catch(e => {
      if (!cancelled) {
        setMainnetDeploymentStatus('failed');
        setMainnetDeploymentMessage(e instanceof Error ? e.message : 'Mainnet verification failed.');
      }
    });
    return () => {cancelled = true;};
    // Validate when chain, RPC or a deliberate refresh changes. Do not poll signing automatically.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId, publicClient, deployment?.address, deploymentCheckGeneration]);

  const mainnetRegistryVerified = VEYRA_ENV !== 'mainnet' || mainnetDeploymentStatus === 'verified';

  // form-derived values (only used in form/review-entry phase)
  const amountParsed = (() => {
    try { return parseUnits(amount, USDC_DECIMALS); } catch { return 0n; }
  })();
  const recipientValid = isAddress(recipient.trim());
  const escrowSecondsValid = (() => {
    const h = parseFloat(escrowHours);
    return !isNaN(h) && h >= MIN_ESCROW_HOURS && h <= MAX_ESCROW_DAYS * 24;
  })();
  const escrowAllowedInUi = !isMainnet;
  const effectiveMode: Mode = (mode === 'escrow' && !escrowAllowedInUi) ? 'pay' : mode;
  const canReview =
    recipientValid && amountParsed > 0n &&
    (effectiveMode === 'pay' || escrowSecondsValid) &&
    !!deployment && onArc && isConnected && mainnetRegistryVerified;

  // ── live contract reads ──────────────────────────────────────────────────────

  const { data: liveFeeBps, isError: feeBpsError, isLoading: feeBpsLoading } = useReadContract({
    address: deployment?.address,
    abi: VEYRA_SETTLEMENT_ABI,
    functionName: 'feeBps',
    chainId,
    query: { enabled: !!deployment && onArc, staleTime: 30_000, refetchInterval: 60_000 },
  });

  const { data: liveFeeRecipient, isError: feeRecipientError, isLoading: feeRecipientLoading } = useReadContract({
    address: deployment?.address,
    abi: VEYRA_SETTLEMENT_ABI,
    functionName: 'feeRecipient',
    chainId,
    query: { enabled: !!deployment && onArc, staleTime: 30_000, refetchInterval: 60_000 },
  });

  const { data: currentAllowance, refetch: refetchAllowance } = useReadContract({
    address: activeUsdcAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && deployment ? [address, deployment.address] : undefined,
    chainId,
    query: { enabled: isConnected && !!deployment && !!address && onArc, staleTime: 10_000 },
  });

  const liveFeeBpsReady = !feeBpsLoading && !feeBpsError && liveFeeBps !== undefined;
  const liveFeesRecipientReady = !feeRecipientLoading && !feeRecipientError && liveFeeRecipient !== undefined;
  const liveFeesReady = liveFeeBpsReady && liveFeesRecipientReady;

  const currentFeeBps: bigint =
    typeof liveFeeBps === 'bigint' ? liveFeeBps :
    typeof liveFeeBps === 'number' ? BigInt(liveFeeBps) : 0n;
  const currentFeeAmount = amountParsed > 0n ? (amountParsed * currentFeeBps) / BPS_DENOM : 0n;
  const currentNetAmount = amountParsed - currentFeeAmount;

  // ── gas estimates (18-decimal native units from getGasPrice) ─────────────────

  /**
   * Live gas price in 18-decimal native units from the RPC.
   * Starts as null (unknown) — not a fabricated fallback.
   * When null, gas estimates are shown as "unavailable" rather than a made-up value.
   * Refreshed after approve confirmation to pick up any price movement.
   */
  const [gasPriceNative, setGasPriceNative] = useState<bigint | null>(null);
  const gasPriceFetchCountRef = useRef(0);

  useEffect(() => {
    if (!publicClient) return;
    let cancelled = false;
    const fetchId = ++gasPriceFetchCountRef.current;
    publicClient.getGasPrice()
      .then(p => { if (!cancelled && fetchId === gasPriceFetchCountRef.current) setGasPriceNative(p); })
      .catch(() => { if (!cancelled) setGasPriceNative(null); });
    return () => { cancelled = true; };
  }, [publicClient, chainId]);

  // Dummy ref for gas estimation call — value doesn't affect gas cost
  const dummyRef = '0x0000000000000000000000000000000000000000000000000000000000000001' as `0x${string}`;
  const dummyRecipient = (recipientValid ? recipient.trim() : '0x0000000000000000000000000000000000000001') as `0x${string}`;

  const gasEstimateEnabled =
    !!deployment && !!address && amountParsed > 0n && onArc && isConnected;

  const payGasCallData = (gasEstimateEnabled && deployment)
    ? encodeFunctionData({
        abi: VEYRA_SETTLEMENT_ABI,
        functionName: 'pay',
        args: [dummyRecipient, amountParsed, dummyRef],
      })
    : undefined;

  const { data: payGasEstimateRaw, isLoading: payGasLoading, isError: payGasError } = useEstimateGas(
    (gasEstimateEnabled && deployment && payGasCallData) ? {
      account: address,
      to: deployment.address,
      data: payGasCallData,
      chainId,
    } : undefined
  );

  // Approve gas estimate (fixed ERC-20 approve call)
  const approveGasCallData = (gasEstimateEnabled && deployment)
    ? encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [deployment.address, amountParsed],
      })
    : undefined;

  const { data: approveGasEstimateRaw, isLoading: approveGasLoading } = useEstimateGas(
    (gasEstimateEnabled && deployment && approveGasCallData) ? {
      account: address,
      to: activeUsdcAddress,
      data: approveGasCallData,
      chainId,
    } : undefined
  );

  /**
   * Convert gas estimate to 18-decimal native units (gasUnits * gasPrice).
   * Returns 0n when gas units OR the live gas price are unavailable.
   * 0n is the explicit sentinel for "estimation unavailable" — the caller
   * shows "unavailable" rather than a fabricated near-zero amount.
   * A fabricated fallback gas price (e.g. 1 gwei) is never substituted.
   */
  function toGasNative(gasUnits: bigint | undefined): bigint {
    if (!gasUnits || gasUnits === 0n) return 0n;
    if (gasPriceNative === null) return 0n; // price not yet loaded from RPC
    return gasUnits * gasPriceNative;
  }

  const payGasNative = toGasNative(payGasEstimateRaw);
  const approveGasNative = toGasNative(approveGasEstimateRaw);

  // ── wagmi write hooks ────────────────────────────────────────────────────────
  const { writeContractAsync: writeApprove, isPending: approving } = useWriteContract();
  const { writeContractAsync: writeSettle, isPending: settling } = useWriteContract();

  const { data: approveReceipt, isSuccess: approveConfirmed } = useWaitForTransactionReceipt({ hash: approveTxHash });
  const { data: settleReceipt, isSuccess: settleConfirmed } =
    useWaitForTransactionReceipt({ hash: settleTxHash });

  // ── approve auto-advance + gas price refresh ─────────────────────────────────
  useEffect(() => {
    if (!approveConfirmed || !approveReceipt || step !== 'approve' || !approveTxHash) return;
    if(approveReceipt.status!=='success'){
      if(isMainnet&&address){
        const journal=readSettlementIntent(address);
        if(journal.kind==='active'&&journal.value.phase==='APPROVAL'&&
           journal.value.hash?.toLowerCase()===approveTxHash.toLowerCase())
          writeSettlementIntent({...journal.value,stage:'REVERTED'});
      }
      setErrorMsg('The original token approval reverted. No payment was submitted.');
      setStep('error');return;
    }
    // Refresh gas price after approval so pay-step estimate reflects current price
    if (publicClient) {
      publicClient.getGasPrice()
        .then(p => setGasPriceNative(p))
        .catch(() => undefined);
    }
    void refetchAllowance();
    if(isMainnet&&address){
      const journal=readSettlementIntent(address);
      if(journal.kind==='active'&&journal.value.phase==='APPROVAL'&&
         journal.value.stage==='PENDING'&&journal.value.hash?.toLowerCase()===approveTxHash.toLowerCase()){
        writeSettlementIntent({...journal.value,stage:'VERIFIED'});
      }
    }
    setStep('review');
  }, [approveConfirmed, approveReceipt, step, approveTxHash, publicClient, refetchAllowance, isMainnet, address]);

  // ── receipt verification (delegates to @/lib/settlementVerify) ───────────────
  useEffect(() => {
    if (!settleConfirmed || !settleReceipt || !snapshot || !deployment) return;
    if (step !== 'pending') return;

    const snap = snapshot;

    // Build typed PaymentSettledArgs from receipt logs
    let paymentSettledLog: PaymentSettledArgs | null = null;
    const transferLogs: TransferLog[] = [];

    try {
      for (const log of settleReceipt.logs as Log[]) {
        const logAddress = (log.address ?? '').toLowerCase();
        const deploymentLc = snap.contractAddress.toLowerCase();
        const usdcLc = snap.usdcAddress.toLowerCase();

        // PaymentSettled — only from VeyraSettlement
        if (logAddress === deploymentLc && !paymentSettledLog) {
          try {
            const decoded = decodeEventLog({ abi: VEYRA_SETTLEMENT_ABI, data: log.data, topics: log.topics });
            if (decoded.eventName === 'PaymentSettled') {
              const a = decoded.args as unknown as {
                paymentId: `0x${string}`; payer: `0x${string}`; recipient: `0x${string}`;
                amount: bigint; fee: bigint; ref: `0x${string}`;
              };
              paymentSettledLog = {
                emitterAddress: log.address ?? '',
                paymentId: a.paymentId,
                payer: a.payer,
                recipient: a.recipient,
                amount: a.amount,
                fee: a.fee,
                ref: a.ref,
              };
            }
          } catch { /* not a PaymentSettled log */ }
        }

        // USDC Transfer — only from canonical USDC contract
        if (logAddress === usdcLc) {
          try {
            const decoded = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics });
            if (decoded.eventName === 'Transfer') {
              const { from, to, value } = decoded.args;
              transferLogs.push({ tokenAddress: log.address ?? '', from, to, value });
            }
          } catch { /* not a Transfer log */ }
        }
      }
    } catch { /* receipt log parse failure — verifier will fail all event checks */ }

    // Build VerifySnapshot from frozen ReviewSnapshot
    const verifySnap: VerifySnapshot = {
      chainId: snap.chainId,
      walletAddress: snap.walletAddress,
      recipient: snap.recipient,
      amountParsed: snap.amountParsed,
      contractAddress: snap.contractAddress,
      usdcAddress: snap.usdcAddress,
      feeBps: snap.feeBps,
      feeAmount: snap.feeAmount,
      netAmount: snap.netAmount,
      ref: snap.ref,
    };

    const result = verifyPaymentReceipt(
      {
        status: settleReceipt.status,
        to: settleReceipt.to,
        transactionHash: settleReceipt.transactionHash,
        blockNumber: settleReceipt.blockNumber,
        gasUsed: settleReceipt.gasUsed,
      },
      chainId ?? 0,
      paymentSettledLog,
      transferLogs,
      verifySnap,
    );

    setVerResult({
      verified: result.verified,
      paymentId: result.paymentId as `0x${string}`,
      feeOnChain: result.feeOnChain,
      netOnChain: result.netOnChain,
      refOnChain: result.refOnChain as `0x${string}`,
      blockNumber: result.blockNumber,
      txHash: result.txHash as `0x${string}`,
      gasUsed: result.gasUsed,
      failReasons: result.failReasons,
    });
    if(result.verified && VEYRA_ENV==='mainnet' && result.txHash){
      recordLocalOperation({type:'Settlement',owner:snap.walletAddress,hash:result.txHash,amount:formatUnits(snap.amountParsed,6),asset:'USDC',chainId:ARC_MAINNET_CHAIN_ID,status:'RECORDED',destination:snap.recipient});
    }
    if(VEYRA_ENV==='mainnet'&&result.verified){
      const intent=readSettlementIntent(snap.walletAddress);
      if(intent.kind==='active'&&intent.value.phase==='PAYMENT'&&
         intent.value.hash?.toLowerCase()===result.txHash.toLowerCase())
        writeSettlementIntent({...intent.value,stage:'VERIFIED'});
    }
    setStep(result.verified ? 'verified' : 'confirmed');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settleConfirmed, settleReceipt]);


  // Restore a signed transaction after reload without re-opening the wallet.
  useEffect(()=>{
    if(!address||VEYRA_ENV!=='mainnet')return;
    let live=true,checking=false;
    async function poll(){
      if(!live||checking||!address)return;
      const saved=readSettlementIntent(address);
      if(saved.kind!=='active'||saved.value.stage!=='PENDING'||!saved.value.hash)return;
      const originalHash=saved.value.hash;
      checking=true;
      try{
        const intent=saved.value;
        if(intent.phase==='PAYMENT'){
          const evidence=await inspectRecordedSettlement(originalHash,address,intent.amount,intent.recipient);
          if(live&&(evidence.status==='VERIFIED'||evidence.status==='REVERTED')){
            writeSettlementIntent({...intent,stage:evidence.status});
            recordLocalOperation({type:'Settlement',owner:address,hash:originalHash,
              amount:intent.amount,asset:'USDC',chainId:ARC_MAINNET_CHAIN_ID,
              status:evidence.status==='VERIFIED'?'RECORDED':'REVERTED',destination:intent.recipient});
          }
        }else if(chainId===ARC_MAINNET_CHAIN_ID&&publicClient&&deployment){
          const hash=originalHash as `0x${string}`;
          const tx=await publicClient.getTransaction({hash});
          const receipt=await publicClient.getTransactionReceipt({hash});
          if(!live||tx.from.toLowerCase()!==address.toLowerCase()||
              tx.to?.toLowerCase()!==activeUsdcAddress.toLowerCase())return;
          const decoded=decodeFunctionData({abi:erc20Abi,data:tx.input});
          if(decoded.functionName!=='approve'||decoded.args[0].toLowerCase()!==deployment.address.toLowerCase()||
             decoded.args[1]!==parseUnits(intent.amount,6))return;
          if(receipt.status==='success'||receipt.status==='reverted')
            writeSettlementIntent({...intent,stage:receipt.status==='success'?'VERIFIED':'REVERTED'});
        }
      }catch{/* Missing receipt or RPC failure is not evidence of a failed payment. */}
      finally{checking=false;}
    }
    void poll();
    const interval=window.setInterval(()=>void poll(),15000);
    return()=>{live=false;window.clearInterval(interval);};
  },[address,chainId,publicClient,deployment?.address,activeUsdcAddress]);

  // ── reset ─────────────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    if(address&&VEYRA_ENV==='mainnet'&&settlementUnresolved(readSettlementIntent(address))){
      setErrorMsg('Your previous wallet request is unresolved. Check Activity and do not resubmit.');
      setStep('error');return;
    }
    setStep('form');
    setErrorMsg(null);
    setApproveTxHash(undefined);
    setSettleTxHash(undefined);
    setSnapshot(null);
    setVerResult(null);
  }, [address]);

  // ── review entry: load fees, lock snapshot ─────────────────────────────────────
  function handleReview() {
    if(address&&VEYRA_ENV==='mainnet'&&settlementUnresolved(readSettlementIntent(address))){
      setErrorMsg('An earlier payment or approval request is unresolved. Check the original wallet request before signing again.');
      setStep('error');return;
    }
    if (!mainnetRegistryVerified) { setErrorMsg('Mainnet contract verification has not passed.'); setStep('error'); return; }
    if (!liveFeesReady) { setStep('loading-fees'); return; }
    lockSnapshot();
  }

  function lockSnapshot() {
    if (!address || !chainId || !deployment) return;

    if (feeBpsError || feeRecipientError) {
      setErrorMsg(
        'Unable to read fee configuration from the contract. ' +
        'Review is blocked until live contract state is confirmed.'
      );
      setStep('error');
      return;
    }
    if (liveFeeBps === undefined || liveFeeRecipient === undefined) {
      setErrorMsg('Fee configuration still loading — please wait and try again.');
      setStep('error');
      return;
    }

    const bps =
      typeof liveFeeBps === 'bigint' ? liveFeeBps :
      typeof liveFeeBps === 'number' ? BigInt(liveFeeBps) : 0n;
    const fee = amountParsed > 0n ? (amountParsed * bps) / BPS_DENOM : 0n;
    const net = amountParsed - fee;

    setSnapshot({
      walletAddress: address,
      chainId,
      chainLabel,
      mode: effectiveMode,
      recipient: recipient.trim() as `0x${string}`,
      amountParsed,
      contractAddress: deployment.address,
      usdcAddress: activeUsdcAddress,
      feeBps: bps,
      feeRecipient: bps > 0n && typeof liveFeeRecipient === 'string' ? liveFeeRecipient : null,
      feeAmount: fee,
      netAmount: net,
      feePercent: Number(bps) / 100,
      gasEstimateNative: payGasNative,
      approveGasNative: approveGasNative,
      ref: buildRef(),
      ...(effectiveMode === 'escrow' ? { escrowHours } : {}),
    });
    setStep('review');
  }

  useEffect(() => {
    if (step !== 'loading-fees') return;
    if (liveFeesReady) lockSnapshot();
    if (feeBpsError || feeRecipientError) {
      setErrorMsg('Failed to load fee configuration from the contract. Review blocked.');
      setStep('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, liveFeesReady, feeBpsError, feeRecipientError]);

  // ── approve ──────────────────────────────────────────────────────────────────
  async function handleApprove() {
    if (!deployment || !address || !snapshot) return;
    if (!mainnetRegistryVerified) {setErrorMsg('Mainnet contract verification has not passed.');setStep('error');return;}
    if (isMainnet) {try{await validateMainnetDeployment();}catch(e){setErrorMsg(e instanceof Error?e.message:'Mainnet contract validation failed');setStep('error');return;}}
    if(isMainnet){
      if(settlementUnresolved(readSettlementIntent(address))){
        setErrorMsg('Previous contract wallet request unresolved. Check its status before approving again.');
        setStep('error');return;
      }
      const intent:SettlementIntent={owner:address,phase:'APPROVAL',stage:'AWAITING_WALLET',
       recipient:snapshot.recipient,amount:formatUnits(snapshot.amountParsed,6),
       ref:snapshot.ref,hash:null,createdAt:Date.now()};
      if(!writeSettlementIntent(intent)){
        setErrorMsg('Cannot save secure approval recovery. Wallet signature was not requested.');
        setStep('error');return;
      }
    }
    setStep('approve');
    setErrorMsg(null);
    try {
      const hash = await writeApprove({
        address: snapshot.usdcAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [snapshot.contractAddress, snapshot.amountParsed],
      });
      if(isMainnet){
        const current=readSettlementIntent(address);
        if(current.kind==='active'&&!writeSettlementIntent({...current.value,stage:'PENDING',hash}))
          setErrorMsg('Approval submitted but local recovery failed. Keep the original hash and do not repeat.');
      }
      setApproveTxHash(hash);
    } catch (e) {
      if(isMainnet){
        const current=readSettlementIntent(address);
        if(current.kind==='active'){
          const code=typeof e==='object'&&e!==null&&'code' in e?e.code:undefined;
          if(code===4001||code==='ACTION_REJECTED')clearSettlementIntent(address);
          else writeSettlementIntent({...current.value,stage:'UNKNOWN',hash:null});
        }
      }
      setErrorMsg((e instanceof Error?e.message:'Approval result unavailable')+
       '. Check the original wallet request before trying again.');
      setStep('error');
    }
  }

  // ── P0-3: pre-sign revalidation + broadcast ───────────────────────────────────
  async function handleSettle() {
    if (!deployment || !address || !snapshot || !publicClient) return;
    if (!mainnetRegistryVerified) {setErrorMsg('Mainnet contract verification has not passed.');setStep('error');return;}
    if (isMainnet) {try{await validateMainnetDeployment();}catch(e){setErrorMsg(e instanceof Error?e.message:'Mainnet contract validation failed');setStep('error');return;}}
    setStep('revalidating');
    setErrorMsg(null);

    try {
      // Detect wallet / chain change since snapshot
      if (address.toLowerCase() !== snapshot.walletAddress.toLowerCase()) {
        throw new Error(
          `Wallet changed since review (was ${snapshot.walletAddress}, now ${address}). ` +
          `Please start a new transaction.`
        );
      }
      if (chainId !== snapshot.chainId) {
        throw new Error(
          `Network changed since review (was chain ${snapshot.chainId}, now ${chainId ?? 'unknown'}). ` +
          `Please start a new transaction.`
        );
      }

      // Re-read from live chain
      const [freshFeeBpsRaw, freshFeeRecipientRaw, freshAllowanceRaw] = await Promise.all([
        publicClient.readContract({
          address: deployment.address,
          abi: VEYRA_SETTLEMENT_ABI,
          functionName: 'feeBps',
        }),
        publicClient.readContract({
          address: deployment.address,
          abi: VEYRA_SETTLEMENT_ABI,
          functionName: 'feeRecipient',
        }),
        publicClient.readContract({
          address: snapshot.usdcAddress,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [address, deployment.address],
        }),
      ]);

      const freshFeeBps: bigint =
        typeof freshFeeBpsRaw === 'bigint' ? freshFeeBpsRaw :
        typeof freshFeeBpsRaw === 'number' ? BigInt(freshFeeBpsRaw) : 0n;
      const freshAllowance =
        typeof freshAllowanceRaw === 'bigint' ? freshAllowanceRaw : 0n;

      if (freshFeeBps !== snapshot.feeBps) {
        throw new Error(
          `Protocol fee changed (shown: ${snapshot.feePercent}%, current: ${Number(freshFeeBps) / 100}%). ` +
          `Please review the transaction again.`
        );
      }

      if (
        freshFeeBps > 0n &&
        snapshot.feeRecipient !== null &&
        typeof freshFeeRecipientRaw === 'string' &&
        freshFeeRecipientRaw.toLowerCase() !== snapshot.feeRecipient.toLowerCase()
      ) {
        throw new Error(
          `Fee recipient changed since review. Please review the transaction again.`
        );
      }

      if (freshAllowance < snapshot.amountParsed) {
        await refetchAllowance();
        throw new Error(
          `USDC allowance insufficient (${fmtUsdc(freshAllowance)} approved, ` +
          `${fmtUsdc(snapshot.amountParsed)} needed). Please approve again.`
        );
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Pre-sign validation failed');
      setStep('error');
      return;
    }

    // Never blindly re-broadcast an earlier Mainnet Settlement payment.
    // Activity automatically verifies and resolves the original recorded hash.
    if(isMainnet && readLocalOperations(address).some(v=>v.type==='Settlement'&&v.status==='SUBMITTED')){
      setErrorMsg('A prior Settlement is still processing. Open Activity to follow its receipt before signing again.');
      setStep('error');
      return;
    }
    // A confirmed ERC-20 allowance is not a successful payment. Before a
    // Mainnet pay() signature, simulate the exact frozen review call against
    // the current chain. Fail closed on RPC/simulation failure.
    if(isMainnet && snapshot.mode==='pay'){
      try {
        if(await publicClient.getChainId()!==ARC_MAINNET_CHAIN_ID)
          throw new Error('Wallet network and Arc Mainnet RPC differ.');
        await publicClient.simulateContract({
          account:address,
          address:snapshot.contractAddress,
          abi:VEYRA_SETTLEMENT_ABI,
          functionName:'pay',
          args:[snapshot.recipient,snapshot.amountParsed,snapshot.ref],
        });
      }catch(e){
        setErrorMsg('Contract payment could not be simulated. No payment signature requested. '+(e instanceof Error?e.message:'Check your network and allowance.'));
        setStep('error');
        return;
      }
    }
    // Save the frozen payment intent BEFORE the wallet request is opened.
    if(isMainnet&&snapshot.mode==='pay'){
      if(settlementUnresolved(readSettlementIntent(address))){
        setErrorMsg('An earlier Settlement request is unresolved. Check Activity before signing again.');
        setStep('error');return;
      }
      const intent:SettlementIntent={owner:address,phase:'PAYMENT',
       stage:'AWAITING_WALLET',recipient:snapshot.recipient,
       amount:formatUnits(snapshot.amountParsed,6),ref:snapshot.ref,hash:null,createdAt:Date.now()};
      if(!writeSettlementIntent(intent)){
        setErrorMsg('Recovery storage unavailable. No wallet signature requested.');
        setStep('error');return;
      }
    }
    // Revalidation passed — broadcast
    setStep('execute');
    try {
      let hash: `0x${string}`;
      if (snapshot.mode === 'pay') {
        hash = await writeSettle({
          address: snapshot.contractAddress,
          abi: VEYRA_SETTLEMENT_ABI,
          functionName: 'pay',
          args: [snapshot.recipient, snapshot.amountParsed, snapshot.ref],
        });
      } else {
        const timeoutSeconds = BigInt(Math.round(parseFloat(snapshot.escrowHours ?? '24') * 3600));
        hash = await writeSettle({
          address: snapshot.contractAddress,
          abi: VEYRA_SETTLEMENT_ABI,
          functionName: 'createEscrow',
          args: [snapshot.recipient, snapshot.amountParsed, timeoutSeconds, snapshot.ref],
        });
      }
      // Capture the wallet-returned hash immediately, before the receipt exists.
      if(isMainnet && snapshot.mode==='pay'){
        const intent=readSettlementIntent(address);
        if(intent.kind==='active'&&!writeSettlementIntent({...intent.value,stage:'PENDING',hash}))
          setErrorMsg('Payment broadcast but recovery storage failed. Preserve the original wallet transaction; do not resubmit.');
        const stored=recordLocalOperation({
          type:'Settlement',owner:snapshot.walletAddress,hash,
          amount:formatUnits(snapshot.amountParsed,6),asset:'USDC',
          chainId:ARC_MAINNET_CHAIN_ID,status:'SUBMITTED',destination:snapshot.recipient,
        });
        if(!stored){
          setErrorMsg('Payment submitted but browser storage is unavailable. Check this transaction in your wallet; do not sign it again.');
        }
      }
      setSettleTxHash(hash);
      setStep('pending');
    } catch (e) {
      if(isMainnet&&snapshot.mode==='pay'){
        const prior=readSettlementIntent(address);
        if(prior.kind==='active'){
          const code=typeof e==='object'&&e!==null&&'code' in e?e.code:undefined;
          if(code===4001||code==='ACTION_REJECTED')clearSettlementIntent(address);
          else writeSettlementIntent({...prior.value,stage:'UNKNOWN',hash:null});
        }
      }
      setErrorMsg((e instanceof Error?e.message:'Wallet outcome unavailable')+
       '. A wallet/RPC error does not prove the funds were not submitted. Do not resend.');
      setStep('error');
    }
  }

  const needsApproval =
    currentAllowance !== undefined ? currentAllowance < amountParsed : true;

  const explorerTxUrl = settleTxHash
    ? buildSettlementTxExplorerUrl(chainId ?? ARC_TESTNET_CHAIN_ID, settleTxHash)
    : null;

  // ── gas display helpers ────────────────────────────────────────────────────────
  function GasRow({ label, native, loading, error }: {
    label: string;
    native: bigint;
    loading: boolean;
    error: boolean;
  }) {
    return (
      <ReviewRow
        label={label}
        warn
        value={
          loading
            ? <span className="text-white/40 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />estimating…</span>
            : error || native === 0n
              ? <span className="text-amber-300/60">estimation unavailable</span>
              : fmtGasUsdc(native) + ' (gas)'
        }
      />
    );
  }

  // ── render ────────────────────────────────────────────────────────────────────
  return (
    <div className={embedded?'flex flex-col':'flex flex-col h-full overflow-y-auto'}>
      {!embedded&&<div className="px-4 pt-6 pb-4 border-b border-white/[0.06]">
        <h1 className="text-xl font-semibold text-white">Settlement</h1>
        <p className="text-sm text-white/50 mt-1">
          USDC payments powered by the Arc-native VeyraSettlement contract
        </p>
      </div>}

      <div className="flex-1 px-4 py-6 space-y-5 max-w-2xl mx-auto w-full">

        {isMainnet&&settlementUnresolved(intentState)&&<div role="alert"
          className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          <p className="font-semibold">Original wallet request needs checking</p>
          <p className="mt-2 text-xs leading-5">Veyra will not repeat this approval or payment
            while its result is unknown. A saved transaction hash is checked automatically.</p>
          {intentState.kind==='active'&&intentState.value.hash&&
            <p className="mt-2 break-all font-mono text-xs">{intentState.value.hash}</p>}
        </div>}
        {/* Wallet connection */}
        {!isConnected && (
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] p-5 text-center space-y-3">
            <p className="text-white/70 text-sm">Connect your wallet to use Settlement</p>
            <ConnectKitButton />
          </div>
        )}

        {/* Wrong chain */}
        {isConnected && !onArc && (
          <div className="rounded-2xl bg-amber-500/10 border border-amber-500/20 p-4 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-amber-300 font-medium">
                Switch to {VEYRA_ENV === 'mainnet' ? 'Arc Mainnet (5042)' : 'Arc Testnet (5042002)'}
              </p>
              <div className="mt-3 flex gap-3">
                {VEYRA_ENV !== 'mainnet' && <button onClick={() => switchChain({ chainId: ARC_TESTNET_CHAIN_ID })}
                  className="text-xs font-medium text-amber-300 underline">Arc Testnet</button>}
                {VEYRA_ENV === 'mainnet' && <button onClick={() => switchChain({ chainId: ARC_MAINNET_CHAIN_ID })}
                  className="text-xs font-medium text-amber-300 underline">Arc Mainnet</button>}
              </div>
            </div>
          </div>
        )}

        {/* Contract badge */}
        {deployment && (
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs text-emerald-300 font-medium">Contract on {chainLabel}</span>
            </div>
            <a href={deployment.explorerUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs text-emerald-400/70 flex items-center gap-1 hover:text-emerald-300">
              {deployment.address.slice(0, 6)}…{deployment.address.slice(-4)}
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}

        {isConnected && onArc && isMainnet && deployment && mainnetDeploymentStatus !== 'verified' && (
          <div className="rounded-2xl bg-amber-500/10 border border-amber-500/20 p-4 space-y-2">
            <p className="text-sm text-amber-300 font-medium">
              {mainnetDeploymentStatus === 'checking'
                ? 'Checking verified Mainnet deployment onchain…'
                : 'Mainnet contract verification failed — all signing disabled'}
            </p>
            {mainnetDeploymentMessage && <p className="text-xs text-amber-200">{mainnetDeploymentMessage}</p>}
            <button type="button" className="text-xs underline text-amber-300"
              onClick={() => setDeploymentCheckGeneration(g => g+1)}>Retry Mainnet verification</button>
          </div>
        )}

        {/* Fee error banner */}
        {isConnected && onArc && !!deployment && mainnetRegistryVerified && step === 'form' && (feeBpsError || feeRecipientError) && (
          <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <p className="text-xs text-red-300">
              Unable to read contract fee configuration. Review is blocked.
            </p>
          </div>
        )}

        {/* Not yet deployed */}
        {isConnected && onArc && !deployment && (
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] p-5 text-center space-y-2">
            <p className="text-sm text-white/70 font-medium">VeyraSettlement not yet deployed on {chainLabel}</p>
            <p className="text-xs text-white/40">
              {isMainnet
                ? 'Owner-signed Arc Mainnet deployment is available below. No private keys or Studio credits required.'
                : 'Switch to Arc Testnet.'}
            </p>
            {VEYRA_ENV !== 'mainnet' && <button onClick={() => switchChain({ chainId: ARC_TESTNET_CHAIN_ID })}
              className="mt-2 text-xs font-medium text-blue-400 underline">Use Arc Testnet</button>}
          </div>
        )}

        {isConnected && onArc && isMainnet && !deployment && <MainnetSettlementDeploy />}

        {/* ── FORM ── */}
        {isConnected && onArc && !!deployment && mainnetRegistryVerified && step === 'form' && (
          <>
            {/* Mode toggle — escrow hidden on mainnet */}
            {!isMainnet ? (
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-white/[0.04] p-1">
                {(['pay', 'escrow'] as Mode[]).map((m) => (
                  <button key={m} onClick={() => setMode(m)}
                    className={`py-2 rounded-lg text-sm font-medium transition-colors ${
                      mode === m ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
                    }`}>
                    {m === 'pay'
                      ? <span className="flex items-center justify-center gap-1.5"><Send className="w-3.5 h-3.5" />Direct Pay</span>
                      : <span className="flex items-center justify-center gap-1.5"><Lock className="w-3.5 h-3.5" />Escrow</span>}
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-xl bg-white/[0.04] border border-white/[0.08] px-4 py-3 space-y-1">
                <p className="text-xs text-white/70 font-medium flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-white/40" />Direct Pay only on Mainnet
                </p>
                <p className="text-xs text-white/40 leading-relaxed">
                  Escrow is not available in this application on Arc Mainnet pending a live canary test.
                  Note: escrow functions remain callable directly on-chain (application-level gate only).
                </p>
              </div>
            )}

            <p className="text-xs text-white/40 px-1">
              {effectiveMode === 'pay'
                ? 'Immediately transfers USDC to recipient via the settlement contract. Instant and final.'
                : 'Locks USDC in the contract. Recipient claims before timeout, or you refund after.'}
            </p>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-white/50 uppercase tracking-wide">Recipient address</label>
              <input value={recipient} onChange={(e) => setRecipient(e.target.value)}
                placeholder="0x…"
                className="w-full rounded-xl bg-white/[0.06] border border-white/[0.08] px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/20" />
              {recipient && !recipientValid && (
                <p className="text-xs text-red-400">Not a valid EVM address</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-white/50 uppercase tracking-wide">Amount (USDC)</label>
              <input value={amount} onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00" inputMode="decimal"
                className="w-full rounded-xl bg-white/[0.06] border border-white/[0.08] px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/20" />
            </div>

            {effectiveMode === 'escrow' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-white/50 uppercase tracking-wide">Escrow timeout (hours)</label>
                <input value={escrowHours} onChange={(e) => setEscrowHours(e.target.value)}
                  placeholder="24" inputMode="numeric"
                  className="w-full rounded-xl bg-white/[0.06] border border-white/[0.08] px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/20" />
                <p className="text-xs text-white/30">Min {MIN_ESCROW_HOURS}h — Max {MAX_ESCROW_DAYS * 24}h</p>
              </div>
            )}

            {canReview && !liveFeesReady && !feeBpsError && !feeRecipientError && (
              <p className="text-xs text-white/40 flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" />Loading contract fee configuration…
              </p>
            )}

            <button
              disabled={!canReview || !!feeBpsError || !!feeRecipientError}
              onClick={handleReview}
              className="w-full py-3.5 rounded-2xl bg-white text-black text-sm font-semibold disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/90 transition-colors">
              Review transaction
            </button>
          </>
        )}

        {/* ── LOADING FEES ── */}
        {step === 'loading-fees' && (
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] p-6 text-center space-y-3">
            <Loader2 className="w-8 h-8 text-white/30 mx-auto animate-spin" />
            <p className="text-sm text-white/70">Loading contract fee configuration…</p>
            <p className="text-xs text-white/30">Review is blocked until live contract state is confirmed.</p>
          </div>
        )}

        {/* ── REVIEW ── */}
        {step === 'review' && snapshot && (
          <div className="space-y-4">
            <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 px-4 py-2.5 flex items-center gap-2">
              <CheckCircle className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <p className="text-xs text-blue-300">
                Fee verified from live contract · feeBps = {snapshot.feeBps.toString()} · parameters frozen
              </p>
            </div>

            <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] divide-y divide-white/[0.06]">
              <ReviewRow label="Network" value={snapshot.chainLabel} />
              <ReviewRow label="Your wallet" value={
                <span className="font-mono">{snapshot.walletAddress.slice(0, 8)}…{snapshot.walletAddress.slice(-6)}</span>
              } mono />
              <ReviewRow label="Type" value={snapshot.mode === 'pay' ? 'Direct payment' : 'Escrow'} />
              <ReviewRow label="Recipient" value={
                <span className="font-mono">{snapshot.recipient.slice(0, 10)}…{snapshot.recipient.slice(-6)}</span>
              } mono />
              <ReviewRow label="Gross amount" value={`${fmtUsdc(snapshot.amountParsed)} USDC`} />
              <ReviewRow label="Protocol fee" value={
                `${fmtUsdc(snapshot.feeAmount)} USDC (${snapshot.feePercent}%)`
              } />
              {snapshot.feeRecipient && (
                <ReviewRow label="Fee recipient" value={
                  <span className="font-mono text-xs">
                    {snapshot.feeRecipient.slice(0, 8)}…{snapshot.feeRecipient.slice(-6)}
                  </span>
                } mono />
              )}
              <ReviewRow label="Net to recipient" value={`${fmtUsdc(snapshot.netAmount)} USDC`} accent />
              {/* Step-specific gas — shown before each signature step */}
              {needsApproval && (
                <GasRow
                  label="Est. Approve gas"
                  native={snapshot.approveGasNative}
                  loading={approveGasLoading}
                  error={false}
                />
              )}
              <GasRow
                label="Est. Pay gas"
                native={snapshot.gasEstimateNative}
                loading={payGasLoading}
                error={payGasError}
              />
              {snapshot.mode === 'escrow' && (
                <ReviewRow label="Escrow timeout" value={
                  <span className="flex items-center gap-1.5 justify-end">
                    <Clock className="w-3.5 h-3.5 text-white/40" />{snapshot.escrowHours}h
                  </span>
                } />
              )}
              <ReviewRow label="Contract" value={
                <a href={deployment?.explorerUrl} target="_blank" rel="noopener noreferrer"
                  className="text-blue-400 flex items-center gap-1 hover:underline text-xs font-mono">
                  {snapshot.contractAddress.slice(0, 10)}…{snapshot.contractAddress.slice(-6)}
                  <ExternalLink className="w-3 h-3" />
                </a>
              } />
              <ReviewRow label="USDC contract" value={
                <span className="font-mono text-xs text-white/60">
                  {snapshot.usdcAddress.slice(0, 10)}…{snapshot.usdcAddress.slice(-6)}
                </span>
              } mono />
              <ReviewRow label="Payment ref" value={
                <span className="font-mono text-xs text-white/60">{snapshot.ref.slice(0, 18)}…</span>
              } mono />
            </div>

            {needsApproval ? (
              <div className="space-y-3">
                <p className="text-xs text-white/50 text-center">
                  Step 1 of 2: Approve settlement contract to spend exactly {fmtUsdc(snapshot.amountParsed)} USDC
                </p>
                <button disabled={approving} onClick={() => { void handleApprove(); }}
                  className="w-full py-3.5 rounded-2xl bg-white text-black text-sm font-semibold disabled:opacity-50 hover:bg-white/90 transition-colors">
                  {approving ? 'Waiting for signature…' : `Approve ${fmtUsdc(snapshot.amountParsed)} USDC`}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {approveTxHash && (
                  <p className="text-xs text-emerald-400 text-center flex items-center justify-center gap-1.5">
                    <CheckCircle className="w-3.5 h-3.5" />
                    Approval confirmed — fees re-verified before signing
                  </p>
                )}
                <p className="text-xs text-white/50 text-center">
                  {approveTxHash ? 'Step 2 of 2: ' : ''}
                  Fee configuration and allowance will be re-verified immediately before broadcast.
                </p>
                <button disabled={settling} onClick={() => { void handleSettle(); }}
                  className="w-full py-3.5 rounded-2xl bg-white text-black text-sm font-semibold disabled:opacity-50 hover:bg-white/90 transition-colors">
                  {settling ? 'Waiting for signature…' : snapshot.mode === 'pay' ? 'Send payment' : 'Create escrow'}
                </button>
              </div>
            )}

            <button onClick={reset} className="w-full py-2 text-sm text-white/40 hover:text-white/70">
              ← Back
            </button>
          </div>
        )}

        {/* ── PENDING STATES ── */}
        {(step === 'approve' || step === 'revalidating' || step === 'execute') && (
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] p-6 text-center space-y-3">
            <div className="w-10 h-10 mx-auto rounded-full border-2 border-white/20 border-t-white animate-spin" />
            <p className="text-sm text-white/70">
              {step === 'approve' ? 'Approving USDC…' :
               step === 'revalidating' ? 'Re-verifying fee configuration and allowance before signing…' :
               'Submitting transaction…'}
            </p>
          </div>
        )}

        {/* ── WAITING FOR CONFIRMATION ── */}
        {step === 'pending' && (
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] p-6 text-center space-y-3">
            <Unlock className="w-8 h-8 text-white/30 mx-auto" />
            <p className="text-sm text-white/70">Waiting for on-chain confirmation…</p>
            {explorerTxUrl && (
              <a href={explorerTxUrl} target="_blank" rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:underline flex items-center justify-center gap-1">
                Track on Arc Explorer <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}

        {/* ── VERIFIED (all 12 checks passed) ── */}
        {step === 'verified' && snapshot && verResult && (
          <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/20 p-6 space-y-4">
            <div className="text-center space-y-2">
              <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto" />
              <p className="text-base font-semibold text-white">
                {snapshot.mode === 'pay' ? 'Payment verified' : 'Escrow verified'}
              </p>
              <p className="text-xs text-emerald-300/70">
                All verification checks passed: chain, receipt, contract, event, USDC transfers
              </p>
            </div>
            <div className="rounded-xl bg-white/[0.04] border border-white/[0.06] divide-y divide-white/[0.06]">
              <ReviewRow label="Gross" value={`${fmtUsdc(snapshot.amountParsed)} USDC`} />
              <ReviewRow label="Protocol fee" value={`${fmtUsdc(verResult.feeOnChain)} USDC`} />
              <ReviewRow label="Net received" value={`${fmtUsdc(verResult.netOnChain)} USDC`} accent />
              <ReviewRow label="Gas used" value={`${verResult.gasUsed.toString()} gas units`} />
              <ReviewRow label="Payment ref" value={
                <span className="font-mono text-xs text-white/60">{verResult.refOnChain.slice(0, 18)}…</span>
              } mono />
              <ReviewRow label="Payment ID" value={
                <span className="font-mono text-xs text-white/40">{verResult.paymentId.slice(0, 14)}…</span>
              } mono />
              <ReviewRow label="Block" value={verResult.blockNumber.toString()} />
            </div>
            {explorerTxUrl && (
              <a href={explorerTxUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 text-sm text-blue-400 hover:underline">
                View on Arc Explorer <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            {verResult.txHash && (
              <p className="text-xs text-white/30 font-mono break-all text-center">{verResult.txHash}</p>
            )}
            <button onClick={reset} className="w-full py-2 text-sm text-white/40 hover:text-white/70">
              New transaction
            </button>
          </div>
        )}

        {/* ── CONFIRMED but not fully verified ── */}
        {step === 'confirmed' && snapshot && verResult && (
          <div className="rounded-2xl bg-white/[0.04] border border-amber-500/20 p-6 space-y-4">
            <div className="text-center space-y-2">
              <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto" />
              <p className="text-base font-semibold text-white">Transaction confirmed — not fully verified</p>
              <p className="text-xs text-amber-300/70">
                Receipt received but one or more verification checks failed.
                Verify manually on the explorer.
              </p>
            </div>
            {verResult.failReasons.length > 0 && (
              <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-3 space-y-1">
                <p className="text-xs text-amber-300 font-medium">Failed checks:</p>
                {verResult.failReasons.map((r, i) => (
                  <p key={i} className="text-xs text-amber-400/70">• {r}</p>
                ))}
              </div>
            )}
            <div className="rounded-xl bg-white/[0.04] border border-white/[0.06] divide-y divide-white/[0.06]">
              <ReviewRow label="Block" value={verResult.blockNumber.toString()} />
            </div>
            {explorerTxUrl && (
              <a href={explorerTxUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 text-sm text-blue-400 hover:underline">
                Verify manually on Arc Explorer <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            {settleTxHash && (
              <p className="text-xs text-white/30 font-mono break-all text-center">{settleTxHash}</p>
            )}
            <button onClick={reset} className="w-full py-2 text-sm text-white/40 hover:text-white/70">
              New transaction
            </button>
          </div>
        )}

        {/* ── ERROR ── */}
        {step === 'error' && (
          <div className="rounded-2xl bg-red-500/10 border border-red-500/20 p-5 space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm text-red-300 font-medium">Transaction blocked</p>
                <p className="text-xs text-red-400/70 mt-1 break-words">{errorMsg}</p>
              </div>
            </div>
            <button onClick={reset} disabled={isMainnet&&settlementUnresolved(intentState)}
              className="w-full py-2 text-sm text-white/40 hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-30">
              {isMainnet&&settlementUnresolved(intentState)?'Checking original request':'← Start again'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
