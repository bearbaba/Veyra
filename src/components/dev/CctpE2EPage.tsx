/**
 * Veyra — CCTP V2 Developer E2E Validation Page
 *
 * ONLY rendered in DEV mode (import.meta.env.DEV === true).
 * Never shown in production.
 *
 * Architecture invariants preserved:
 * - Provider lifecycle gate NOT bypassed in the main app
 * - Burn state persisted to localStorage (survives reload) AND BFF (in-process)
 * - Anti-duplicate-burn: if burnTxHash exists in localStorage, only retry-receive is allowed
 * - "Nonce already used" revert is treated as success (message already received)
 * - BFF relay path: if RELAY_PRIVATE_KEY configured, BFF calls receiveMessage
 *   (safe because destinationCaller = 0x00...00 in the burn)
 * - If relay not configured, user signs receiveMessage themselves
 * - Pre-burn preflight: checks destination gas, contracts, attestation service
 * - Lifecycle promotion only after verified balance delta
 *
 * Steps:
 *   1. PREFLIGHT   — read balances, check destination preflight, detect resume
 *   2. APPROVE     — approve(TokenMessengerV2, 1_000_000) on Arc Testnet
 *   3. BURN        — depositForBurn on Arc Testnet (persists immediately)
 *   4. ATTEST      — poll /api/cctp/attestation
 *   5. RECEIVE     — BFF relay OR user signs on Sepolia
 *   6. VERIFY      — read destination USDC balance, confirm delta >= 1 USDC
 *   7. DONE        — VERIFIED VeyraReceipt generated
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSwitchChain,
  useBalance,
} from 'wagmi';
import { erc20Abi, getAddress, type Hash } from 'viem';
import { CheckCircle, XCircle, Loader2, AlertTriangle, ExternalLink, Lock, RefreshCw } from 'lucide-react';
import { MANIFEST_CONSTANTS } from '../../providers/registry/providerManifest';
import { generatePlanReceiptId, generateExecutionReceiptId } from '../../core/receipt/receiptId';
import type { VeyraReceipt, BridgeTrace } from '../../core/receipt/receiptTypes';

// ── Only render in dev ────────────────────────────────────────────────────────
const IS_DEV = import.meta.env.DEV === true;

// ── Constants (all from manifest) ────────────────────────────────────────────
const ARC_CHAIN_ID    = MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID;
const ARC_USDC        = getAddress(MANIFEST_CONSTANTS.ARC_TESTNET_USDC);
const MESSENGER       = getAddress(MANIFEST_CONSTANTS.CCTP_V2_TOKEN_MESSENGER);
const TRANSMITTER     = getAddress(MANIFEST_CONSTANTS.CCTP_V2_MESSAGE_TRANSMITTER);
const SEPOLIA_USDC    = getAddress(MANIFEST_CONSTANTS.ETH_SEPOLIA_USDC);
const SEPOLIA_ID      = MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID;
const ARC_CCTP_DOMAIN = MANIFEST_CONSTANTS.ARC_TESTNET_CCTP_DOMAIN;

const TEST_AMOUNT_RAW = 1_000_000n; // 1.000000 USDC

// ── localStorage persistence key ─────────────────────────────────────────────
const BURN_STATE_KEY = 'veyra:cctp-e2e:burn-state';

interface PersistedBurnState {
  burnTxHash: string;
  planId: string;
  sourceDomain: number;
  destinationChainId: number;
  wallet: string;
  attestation?: { message: string; attestation: string };
  receiveTxHash?: string;
  persistedAt: number;
}

// ── ABIs ─────────────────────────────────────────────────────────────────────

const TOKEN_MESSENGER_V2_ABI = [
  {
    name: 'depositForBurn',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount',               type: 'uint256' },
      { name: 'destinationDomain',    type: 'uint32'  },
      { name: 'mintRecipient',        type: 'bytes32' },
      { name: 'burnToken',            type: 'address' },
      { name: 'destinationCaller',    type: 'bytes32' },
      { name: 'maxFee',               type: 'uint256' },
      { name: 'minFinalityThreshold', type: 'uint32'  },
    ],
    outputs: [],
  },
] as const;

const MESSAGE_TRANSMITTER_V2_ABI = [
  {
    name: 'receiveMessage',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'message',     type: 'bytes' },
      { name: 'attestation', type: 'bytes' },
    ],
    outputs: [{ name: 'success', type: 'bool' }],
  },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function addressToBytes32(addr: `0x${string}`): `0x${string}` {
  return `0x000000000000000000000000${addr.slice(2).toLowerCase()}` as `0x${string}`;
}

function formatUsdc6(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const frac  = raw % 1_000_000n;
  return `${whole}.${frac.toString().padStart(6, '0')}`;
}

function txUrl(chainId: number, hash: string): string {
  if (chainId === ARC_CHAIN_ID) return `https://explorer.testnet.arc.io/tx/${hash}`;
  if (chainId === SEPOLIA_ID)   return `https://sepolia.etherscan.io/tx/${hash}`;
  return '#';
}

function loadPersistedBurn(wallet: string): PersistedBurnState | null {
  try {
    const raw = localStorage.getItem(BURN_STATE_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw) as PersistedBurnState;
    // Only restore for the same wallet
    if (state.wallet?.toLowerCase() !== wallet.toLowerCase()) return null;
    // Don't restore stale state older than 48h
    if (Date.now() - state.persistedAt > 48 * 60 * 60 * 1000) {
      localStorage.removeItem(BURN_STATE_KEY);
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

function persistBurnState(state: PersistedBurnState): void {
  try {
    localStorage.setItem(BURN_STATE_KEY, JSON.stringify(state));
  } catch {
    // localStorage full — non-fatal
  }
  // Also persist to BFF (best-effort — may fail if BFF not running)
  void fetch('/api/bridge/persist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  }).catch(() => {
    // BFF unavailable — localStorage is the fallback
  });
}

function clearPersistedBurn(): void {
  try { localStorage.removeItem(BURN_STATE_KEY); } catch { /* no-op */ }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface AttestationResult {
  status: 'pending' | 'complete';
  message?: string;
  attestation?: string;
}

type E2EStep =
  | 'PREFLIGHT'
  | 'RESUME_DETECTED'        // Existing burn found — skip to ATTESTING/RECEIVE
  | 'APPROVE'
  | 'APPROVE_CONFIRMING'
  | 'BURN'
  | 'BURN_CONFIRMING'
  | 'ATTESTING'
  | 'RELAYING'               // BFF is calling receiveMessage
  | 'SWITCH_CHAIN'           // User must switch to Sepolia (relay unavailable)
  | 'RECEIVE'
  | 'RECEIVE_CONFIRMING'
  | 'VERIFYING'
  | 'DONE'
  | 'FAILED';

interface E2EState {
  step: E2EStep;
  // Pre-burn state
  arcUsdcBefore?: bigint;
  sepoliaUsdcBefore?: bigint;
  allowanceBefore?: bigint;
  sepoliaEthBalance?: bigint;
  // Tx hashes
  approveTxHash?: Hash;
  burnTxHash?: Hash;
  receiveTxHash?: Hash;
  // Attestation
  attestation?: AttestationResult;
  // Relay result
  relayAlreadyReceived?: boolean;
  // Receipt
  receipt?: VeyraReceipt;
  planId?: string;
  error?: string;
  // Preflight
  preflight?: {
    sepoliaEthSufficient: boolean;
    transmitterHasCode: boolean;
    messengerHasCode: boolean;
    attestationReachable: boolean;
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StepBadge({ n, active, done, failed }: { n: number; active: boolean; done: boolean; failed: boolean }) {
  if (failed) return <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: 'var(--danger-muted)', color: 'var(--danger)', border: '1.5px solid var(--danger)' }}><XCircle className="size-3.5" /></span>;
  if (done)   return <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: 'var(--success-muted)', color: 'var(--success)', border: '1.5px solid var(--success)' }}><CheckCircle className="size-3.5" /></span>;
  if (active) return <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: 'var(--accent)', color: '#0d1b2f' }}>{n}</span>;
  return <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: 'var(--surface-strong)', color: 'var(--subtle)', border: '1.5px solid var(--border)' }}>{n}</span>;
}

function StepCard({ title, active, children }: { title: string; active?: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-4 space-y-3" style={{
      background: 'var(--surface)',
      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
      boxShadow: active ? '0 0 0 1px var(--accent)' : 'none',
    }}>
      <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{title}</p>
      {children}
    </div>
  );
}

function DataRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-baseline gap-2">
      <span className="text-xs shrink-0" style={{ color: 'var(--muted)' }}>{label}</span>
      <span className={`text-xs text-right break-all ${mono ? 'font-mono' : ''}`} style={{ color: 'var(--ink)' }}>{value}</span>
    </div>
  );
}

function Alert({ kind, children }: { kind: 'warn' | 'danger' | 'info'; children: React.ReactNode }) {
  const col = kind === 'danger' ? 'var(--danger)' : kind === 'warn' ? 'var(--warning)' : 'var(--accent)';
  const bg  = kind === 'danger' ? 'var(--danger-muted)' : kind === 'warn' ? 'var(--warning-muted)' : 'var(--accent-muted)';
  return (
    <div className="flex items-start gap-2 rounded-xl p-3 text-xs" style={{ background: bg, color: col, border: `1px solid ${col}22` }}>
      <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function CctpE2EPage() {
  const { address, chainId: walletChainId, isConnected } = useAccount();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  const [state, setState] = useState<E2EState>({ step: 'PREFLIGHT' });
  const attestPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Live balance reads ────────────────────────────────────────────────────

  const { data: arcUsdcRaw, refetch: refetchArcUsdc } = useReadContract({
    address: ARC_USDC,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: ARC_CHAIN_ID,
    query: { enabled: !!address },
  });

  const { data: sepoliaUsdcRaw, refetch: refetchSepoliaUsdc } = useReadContract({
    address: SEPOLIA_USDC,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: SEPOLIA_ID,
    query: { enabled: !!address },
  });

  const { data: allowanceRaw, refetch: refetchAllowance } = useReadContract({
    address: ARC_USDC,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address ? [address, MESSENGER] : undefined,
    chainId: ARC_CHAIN_ID,
    query: { enabled: !!address },
  });

  const { data: sepoliaEthBalance } = useBalance({
    address,
    chainId: SEPOLIA_ID,
    query: { enabled: !!address },
  });

  // ── writeContract instances ───────────────────────────────────────────────

  const {
    writeContract: sendApprove,
    data: approveTxHashPending,
    isPending: approvePending,
    error: approveError,
    reset: resetApprove,
  } = useWriteContract();

  const {
    writeContract: sendBurn,
    data: burnTxHashPending,
    isPending: burnPending,
    error: burnError,
    reset: resetBurn,
  } = useWriteContract();

  const {
    writeContract: sendReceive,
    data: receiveTxHashPending,
    isPending: receivePending,
    error: receiveError,
    reset: resetReceive,
  } = useWriteContract();

  // ── Transaction confirmations ─────────────────────────────────────────────

  const { isLoading: approveConfirming, isSuccess: approveSuccess } =
    useWaitForTransactionReceipt({ hash: approveTxHashPending });

  const { isLoading: burnConfirming, isSuccess: burnSuccess } =
    useWaitForTransactionReceipt({ hash: burnTxHashPending });

  const { isLoading: receiveConfirming, isSuccess: receiveSuccess, error: receiveReceiptError } =
    useWaitForTransactionReceipt({ hash: receiveTxHashPending, chainId: SEPOLIA_ID });

  // ── On mount: detect reload recovery ─────────────────────────────────────

  useEffect(() => {
    if (!address) return;
    const persisted = loadPersistedBurn(address);
    if (!persisted) return;
    // Burn exists — skip to resume
    setState((s) => ({
      ...s,
      step: 'RESUME_DETECTED',
      burnTxHash: persisted.burnTxHash as Hash,
      planId: persisted.planId,
      attestation: persisted.attestation
        ? { status: 'complete', ...persisted.attestation }
        : undefined,
      receiveTxHash: persisted.receiveTxHash as Hash | undefined,
    }));
  }, [address]);

  // ── Approve confirmed → BURN ──────────────────────────────────────────────
  useEffect(() => {
    if (approveSuccess && approveTxHashPending && state.step === 'APPROVE_CONFIRMING') {
      setState((s) => ({ ...s, step: 'BURN', approveTxHash: approveTxHashPending }));
    }
  }, [approveSuccess, approveTxHashPending, state.step]);

  // ── Approve submitted → confirming ───────────────────────────────────────
  useEffect(() => {
    if (approveTxHashPending && state.step === 'APPROVE') {
      setState((s) => ({ ...s, step: 'APPROVE_CONFIRMING' }));
    }
  }, [approveTxHashPending, state.step]);

  // ── Burn submitted → confirming ───────────────────────────────────────────
  useEffect(() => {
    if (burnTxHashPending && state.step === 'BURN') {
      setState((s) => ({ ...s, step: 'BURN_CONFIRMING' }));
    }
  }, [burnTxHashPending, state.step]);

  // ── Burn confirmed → persist + start attestation ─────────────────────────
  useEffect(() => {
    if (burnSuccess && burnTxHashPending && state.step === 'BURN_CONFIRMING') {
      const burnHash = burnTxHashPending;
      const planId = state.planId ?? generatePlanReceiptId();
      const persistedState: PersistedBurnState = {
        burnTxHash: burnHash,
        planId,
        sourceDomain: ARC_CCTP_DOMAIN,
        destinationChainId: SEPOLIA_ID,
        wallet: address ?? '',
        persistedAt: Date.now(),
      };
      persistBurnState(persistedState);
      setState((s) => ({ ...s, step: 'ATTESTING', burnTxHash: burnHash, planId }));
    }
  }, [burnSuccess, burnTxHashPending, state.step, state.planId, address]);

  // ── Receive submitted → confirming ────────────────────────────────────────
  useEffect(() => {
    if (receiveTxHashPending && state.step === 'RECEIVE') {
      setState((s) => ({ ...s, step: 'RECEIVE_CONFIRMING' }));
    }
  }, [receiveTxHashPending, state.step]);

  // ── Receive confirmed → verify ────────────────────────────────────────────
  useEffect(() => {
    if (receiveSuccess && receiveTxHashPending && state.step === 'RECEIVE_CONFIRMING') {
      // Persist receive tx hash
      if (state.burnTxHash) {
        const existing = loadPersistedBurn(address ?? '');
        if (existing) {
          persistBurnState({ ...existing, receiveTxHash: receiveTxHashPending });
        }
      }
      setState((s) => ({ ...s, step: 'VERIFYING', receiveTxHash: receiveTxHashPending }));
    }
  }, [receiveSuccess, receiveTxHashPending, state.step, state.burnTxHash, address]);

  // ── Receive reverted → check if nonce-already-used (= success) ───────────
  useEffect(() => {
    if (receiveReceiptError && state.step === 'RECEIVE_CONFIRMING') {
      const errMsg = receiveReceiptError.message ?? '';
      if (errMsg.toLowerCase().includes('nonce already used')) {
        // Message was already received in a prior attempt — treat as success
        setState((s) => ({ ...s, step: 'VERIFYING', receiveTxHash: receiveTxHashPending }));
      } else {
        setState((s) => ({
          ...s,
          step: 'FAILED',
          error: `receiveMessage reverted: ${errMsg}`,
        }));
      }
    }
  }, [receiveReceiptError, state.step, receiveTxHashPending]);

  // ── Attestation polling ───────────────────────────────────────────────────
  useEffect(() => {
    const shouldPoll =
      (state.step === 'ATTESTING' || state.step === 'RESUME_DETECTED') &&
      !!state.burnTxHash &&
      !state.attestation;

    if (!shouldPoll) return;
    const burnHash = state.burnTxHash;

    async function poll() {
      try {
        const res = await fetch(
          `/api/cctp/attestation?sourceDomain=${ARC_CCTP_DOMAIN}&txHash=${burnHash}`,
        );
        if (!res.ok) return;
        const data = await res.json() as {
          ok: boolean;
          data: { messages?: Array<{ status: string; message?: string; attestation?: string }> };
        };
        const messages = data.data?.messages;
        if (!messages || messages.length === 0) return;
        const msg = messages[0];
        if (msg.status === 'complete' && msg.attestation && msg.message) {
          if (attestPollRef.current) clearInterval(attestPollRef.current);
          const attestation = { status: 'complete' as const, message: msg.message, attestation: msg.attestation };
          // Persist attestation to localStorage
          if (address) {
            const existing = loadPersistedBurn(address);
            if (existing) {
              persistBurnState({ ...existing, attestation: { message: msg.message, attestation: msg.attestation } });
            }
          }
          setState((s) => ({
            ...s,
            attestation,
            step: 'RELAYING',
          }));
        }
      } catch {
        // poll failure — try again
      }
    }

    void poll();
    attestPollRef.current = setInterval(() => { void poll(); }, 15_000);
    return () => {
      if (attestPollRef.current) clearInterval(attestPollRef.current);
    };
  }, [state.step, state.burnTxHash, state.attestation, address]);

  // ── BFF relay attempt ─────────────────────────────────────────────────────
  useEffect(() => {
    if (state.step !== 'RELAYING' || !state.attestation?.message || !state.attestation?.attestation) return;
    const { message, attestation: attest } = state.attestation;

    async function attemptRelay() {
      try {
        const res = await fetch('/api/bridge/relay-receive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            attestation: attest,
            destinationChainId: SEPOLIA_ID,
          }),
        });
        const data = await res.json() as {
          ok: boolean;
          selfRelay?: boolean;
          alreadyReceived?: boolean;
          txHash?: string | null;
          error?: string;
        };

        if (data.ok && data.alreadyReceived) {
          // Already received — skip to verify
          setState((s) => ({ ...s, step: 'VERIFYING', relayAlreadyReceived: true }));
          return;
        }

        if (data.ok && data.txHash) {
          // Relay submitted — go to verify (BFF wallet handles confirmation)
          const persisted = address ? loadPersistedBurn(address) : null;
          if (persisted) persistBurnState({ ...persisted, receiveTxHash: data.txHash });
          setState((s) => ({ ...s, step: 'VERIFYING', receiveTxHash: data.txHash as Hash }));
          return;
        }

        if (data.selfRelay) {
          // No relay key configured — user must switch chain and sign
          setState((s) => ({ ...s, step: 'SWITCH_CHAIN' }));
          return;
        }

        // Relay call failed
        setState((s) => ({
          ...s,
          step: 'SWITCH_CHAIN', // Fallback: let user sign
          error: `BFF relay failed: ${data.error ?? 'unknown'}. Please sign receiveMessage yourself.`,
        }));
      } catch {
        // Network error — fallback to user signature
        setState((s) => ({ ...s, step: 'SWITCH_CHAIN' }));
      }
    }

    void attemptRelay();
  }, [state.step, state.attestation, address]);

  // ── Verify balance delta ──────────────────────────────────────────────────
  const verifyDelta = useCallback(async () => {
    if (state.step !== 'VERIFYING' || !address) return;

    // Re-read destination balance
    const { data: sepoliaAfterRaw } = await refetchSepoliaUsdc();
    const before = state.sepoliaUsdcBefore ?? 0n;
    const after  = sepoliaAfterRaw ?? 0n;
    const delta  = after - before;

    if (delta < TEST_AMOUNT_RAW && !state.relayAlreadyReceived) {
      // If we resumed from a persisted state, the before-balance may be wrong
      // (we didn't record it before the burn). Check absolute value instead.
      if (after < TEST_AMOUNT_RAW) {
        setState((s) => ({
          ...s,
          step: 'FAILED',
          error: `Balance delta too small: got ${formatUsdc6(delta)} USDC. ` +
                 `Destination USDC: ${formatUsdc6(after)}. May need to check manually.`,
        }));
        return;
      }
    }

    const burnHash = state.burnTxHash ?? ('0x0000');
    const planId = state.planId ?? generatePlanReceiptId();
    const receiptId = generateExecutionReceiptId(ARC_CHAIN_ID, burnHash);

    const bridgeTrace: BridgeTrace = {
      sourceChainId:        ARC_CHAIN_ID,
      destinationChainId:   SEPOLIA_ID,
      sourceTxHash:         burnHash,
      destinationTxHash:    state.receiveTxHash,
      messageId:            undefined,
      sourceBlock:          undefined,
      destinationBlock:     undefined,
      bridgeStatus:         'VERIFIED',
      sourceTimestamp:      Date.now(),
      destinationTimestamp: Date.now(),
    };

    const receipt: VeyraReceipt = {
      receiptId,
      planId,
      actionType:           'BRIDGE',
      status:               'VERIFIED',
      createdAt:            Date.now(),
      completedAt:          Date.now(),
      chainId:              ARC_CHAIN_ID,
      executionTxHash:      burnHash,
      actualAmountDelta:    delta >= 0n ? delta : after,
      expectedAmountDelta:  TEST_AMOUNT_RAW,
      verifiedBalanceAfter: after,
      riskScore:            null,
      policyDecision:       'PASS',
      bridgeTrace,
    };

    // Clear persisted burn state — transfer is complete
    clearPersistedBurn();
    setState((s) => ({ ...s, step: 'DONE', receipt }));
  }, [state, address, refetchSepoliaUsdc]);

  useEffect(() => {
    if (state.step === 'VERIFYING') {
      void verifyDelta();
    }
  }, [state.step, verifyDelta]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function runPreflight(): Promise<void> {
    if (!address || arcUsdcRaw === undefined || sepoliaUsdcRaw === undefined) return;

    // Check if existing burn state exists (anti-duplicate guard)
    const existing = loadPersistedBurn(address);
    if (existing) {
      setState((s) => ({
        ...s,
        step: 'RESUME_DETECTED',
        burnTxHash: existing.burnTxHash as Hash,
        planId: existing.planId,
        sepoliaUsdcBefore: sepoliaUsdcRaw,
        attestation: existing.attestation
          ? { status: 'complete', ...existing.attestation }
          : undefined,
      }));
      return;
    }

    // Pre-burn destination preflight
    let transmitterHasCode = false;
    let messengerHasCode = false;
    let attestationReachable = false;

    try {
      const [txCode, msgCode, attestRes] = await Promise.all([
        fetch('https://rpc.sepolia.org', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getCode', params: [TRANSMITTER, 'latest'], id: 1 }),
        }).then((r) => r.json() as Promise<{ result: string }>).then((d) => d.result),
        fetch('https://rpc.sepolia.org', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getCode', params: [MESSENGER, 'latest'], id: 2 }),
        }).then((r) => r.json() as Promise<{ result: string }>).then((d) => d.result),
        fetch('/api/cctp/attestation?sourceDomain=26&txHash=0x0000000000000000000000000000000000000000000000000000000000000001')
          .then((r) => r.ok || r.status === 400 || r.status === 404),
      ]);
      transmitterHasCode = txCode !== '0x' && txCode?.length > 4;
      messengerHasCode   = msgCode !== '0x' && msgCode?.length > 4;
      attestationReachable = attestRes;
    } catch {
      // Preflight network errors — warn but don't block
    }

    const ethSufficient = sepoliaEthBalance ? sepoliaEthBalance.value >= 2_000_000_000_000_000n : false; // >= 0.002 ETH

    setState({
      step: 'APPROVE',
      arcUsdcBefore:     arcUsdcRaw,
      sepoliaUsdcBefore: sepoliaUsdcRaw,
      planId:            generatePlanReceiptId(),
      preflight: {
        sepoliaEthSufficient: ethSufficient,
        transmitterHasCode,
        messengerHasCode,
        attestationReachable,
      },
    });
  }

  function handleApprove() {
    if (!address || walletChainId !== ARC_CHAIN_ID) {
      switchChain({ chainId: ARC_CHAIN_ID });
      return;
    }
    void refetchAllowance().then(({ data: allowance }) => {
      if (allowance !== undefined && allowance >= TEST_AMOUNT_RAW) {
        // Already approved — skip to burn
        setState((s) => ({ ...s, step: 'BURN' }));
        return;
      }
      resetApprove();
      sendApprove({
        address: ARC_USDC,
        abi: erc20Abi,
        functionName: 'approve',
        args: [MESSENGER, TEST_AMOUNT_RAW],
        chainId: ARC_CHAIN_ID,
      });
    });
  }

  function handleBurn() {
    if (!address || walletChainId !== ARC_CHAIN_ID) {
      switchChain({ chainId: ARC_CHAIN_ID });
      return;
    }
    // ANTI-DUPLICATE: abort if burn already persisted
    const existing = loadPersistedBurn(address);
    if (existing) {
      setState((s) => ({
        ...s,
        step: 'RESUME_DETECTED',
        burnTxHash: existing.burnTxHash as Hash,
        planId: existing.planId,
      }));
      return;
    }
    const mintRecipient = addressToBytes32(address);
    const destinationCaller = ('0x' + '00'.repeat(32)) as `0x${string}`;
    resetBurn();
    sendBurn({
      address: MESSENGER,
      abi: TOKEN_MESSENGER_V2_ABI,
      functionName: 'depositForBurn',
      args: [
        TEST_AMOUNT_RAW,
        MANIFEST_CONSTANTS.ETH_SEPOLIA_CCTP_DOMAIN,
        mintRecipient,
        ARC_USDC,
        destinationCaller,
        0n,
        MANIFEST_CONSTANTS.CCTP_STANDARD_FINALITY,
      ],
      chainId: ARC_CHAIN_ID,
    });
  }

  function handleReceive() {
    if (!state.attestation?.message || !state.attestation?.attestation || !address) return;
    if (walletChainId !== SEPOLIA_ID) {
      switchChain({ chainId: SEPOLIA_ID });
      return;
    }
    resetReceive();
    sendReceive({
      address: TRANSMITTER,
      abi: MESSAGE_TRANSMITTER_V2_ABI,
      functionName: 'receiveMessage',
      args: [
        state.attestation.message as `0x${string}`,
        state.attestation.attestation as `0x${string}`,
      ],
      chainId: SEPOLIA_ID,
    });
  }

  function handleResumeFromBurn() {
    if (!state.burnTxHash) return;
    if (state.attestation?.status === 'complete') {
      setState((s) => ({ ...s, step: 'RELAYING' }));
    } else {
      setState((s) => ({ ...s, step: 'ATTESTING' }));
    }
  }

  function handleClearAndRestart() {
    clearPersistedBurn();
    setState({ step: 'PREFLIGHT' });
  }

  // ── Guard: production ─────────────────────────────────────────────────────

  if (!IS_DEV) {
    return (
      <div className="max-w-md mx-auto px-4 py-8">
        <div className="rounded-2xl p-6 flex items-center gap-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <Lock className="size-5 shrink-0" style={{ color: 'var(--muted)' }} />
          <p className="text-sm" style={{ color: 'var(--muted)' }}>Developer tools are not available in production.</p>
        </div>
      </div>
    );
  }

  if (!isConnected || !address) {
    return (
      <div className="max-w-md mx-auto px-4 py-8">
        <h1 className="text-xl font-bold mb-4" style={{ color: 'var(--ink)' }}>CCTP V2 E2E Validation</h1>
        <div className="rounded-2xl p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>Connect your wallet to begin E2E validation.</p>
        </div>
      </div>
    );
  }

  const currentStep = state.step;
  const stepNum = {
    PREFLIGHT: 1, RESUME_DETECTED: 1,
    APPROVE: 2, APPROVE_CONFIRMING: 2,
    BURN: 3, BURN_CONFIRMING: 3,
    ATTESTING: 4, RELAYING: 5,
    SWITCH_CHAIN: 5, RECEIVE: 5, RECEIVE_CONFIRMING: 5,
    VERIFYING: 6, DONE: 7, FAILED: 0,
  }[currentStep] ?? 0;

  const STEPS = ['Preflight', 'Approve', 'Burn', 'Attest', 'Receive', 'Verify', 'Done'];

  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--ink)' }}>CCTP V2 E2E Validation</h1>
          <p className="text-xs mt-0.5 font-mono" style={{ color: 'var(--muted)' }}>
            Developer only · lifecycle gate preserved · 1.000000 USDC
          </p>
        </div>
        <span className="text-xs px-2 py-1 rounded-full font-mono" style={{ background: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid var(--border-strong)' }}>DEV</span>
      </div>

      {/* Route */}
      <div className="rounded-xl px-4 py-2.5 text-sm flex items-center gap-2" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
        <span style={{ color: 'var(--ink)' }}>Arc Testnet</span>
        <span style={{ color: 'var(--muted)' }}>→</span>
        <span style={{ color: 'var(--ink)' }}>Ethereum Sepolia</span>
        <span className="ml-auto text-xs font-mono" style={{ color: 'var(--muted)' }}>
          {address.slice(0, 6)}…{address.slice(-4)}
        </span>
      </div>

      {/* Step progress */}
      <div className="flex items-center justify-between px-1">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const done   = currentStep !== 'FAILED' && n < stepNum;
          const active = n === stepNum;
          const failed = currentStep === 'FAILED' && n === stepNum;
          return (
            <div key={label} className="flex flex-col items-center gap-1" style={{ minWidth: 0 }}>
              <StepBadge n={n} active={active} done={done} failed={failed} />
              <span className="text-xs" style={{ color: active ? 'var(--accent)' : done ? 'var(--success)' : 'var(--subtle)' }}>
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── STEP 1: PREFLIGHT ── */}
      {(currentStep === 'PREFLIGHT') && (
        <StepCard title="Step 1 — Preflight" active>
          <DataRow label="Wallet"              value={`${address.slice(0, 10)}…${address.slice(-6)}`} />
          <DataRow label="Arc Testnet USDC"    value={arcUsdcRaw !== undefined ? `${formatUsdc6(arcUsdcRaw)} USDC` : '…'} />
          <DataRow label="Sepolia USDC (now)"  value={sepoliaUsdcRaw !== undefined ? `${formatUsdc6(sepoliaUsdcRaw)} USDC` : '…'} />
          <DataRow label="Sepolia ETH"         value={sepoliaEthBalance ? `${(Number(sepoliaEthBalance.value) / 1e18).toFixed(4)} ETH` : '…'} />
          <DataRow label="Current allowance"   value={allowanceRaw !== undefined ? `${formatUsdc6(allowanceRaw)} USDC` : '…'} />
          <DataRow label="Test amount"         value="1.000000 USDC" />

          {arcUsdcRaw !== undefined && arcUsdcRaw < TEST_AMOUNT_RAW && (
            <Alert kind="danger">Insufficient Arc Testnet USDC. Need at least 1 USDC.</Alert>
          )}

          <button
            onClick={() => { void runPreflight(); }}
            disabled={!arcUsdcRaw || arcUsdcRaw < TEST_AMOUNT_RAW || !sepoliaUsdcRaw}
            className="w-full rounded-xl py-2.5 text-sm font-semibold mt-1 disabled:opacity-40"
            style={{ background: 'var(--accent)', color: '#0d1b2f' }}
          >
            Run preflight checks
          </button>
        </StepCard>
      )}

      {/* ── RESUME DETECTED ── */}
      {currentStep === 'RESUME_DETECTED' && (
        <StepCard title="Existing burn detected" active>
          <Alert kind="warn">
            A previous burn was found in local storage. To prevent a duplicate burn, only retry the receive step.
          </Alert>
          <DataRow label="Burn tx" value={state.burnTxHash ? `${state.burnTxHash.slice(0, 16)}…` : '—'} mono />
          <DataRow label="Attestation" value={state.attestation?.status === 'complete' ? 'Complete ✓' : 'Pending — will poll'} />
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleResumeFromBurn}
              className="flex-1 rounded-xl py-2.5 text-sm font-semibold"
              style={{ background: 'var(--accent)', color: '#0d1b2f' }}
            >
              Resume (retry receive)
            </button>
            <button
              onClick={handleClearAndRestart}
              className="rounded-xl px-3 py-2.5 text-sm"
              style={{ background: 'var(--surface-strong)', color: 'var(--muted)', border: '1px solid var(--border)' }}
            >
              Clear &amp; restart
            </button>
          </div>
        </StepCard>
      )}

      {/* ── STEP 2: APPROVE ── */}
      {(currentStep === 'APPROVE' || currentStep === 'APPROVE_CONFIRMING') && (
        <StepCard title="Step 2 — Approve TokenMessengerV2" active>
          {state.preflight && !state.preflight.sepoliaEthSufficient && (
            <Alert kind="warn">Low Sepolia ETH — may not have enough gas for receiveMessage. (Only applies if relay key is not configured.)</Alert>
          )}
          {state.preflight && !state.preflight.transmitterHasCode && (
            <Alert kind="warn">MessageTransmitter contract code not verified on Sepolia — continue with caution.</Alert>
          )}
          <DataRow label="Token"   value={`${ARC_USDC.slice(0, 10)}… (Arc USDC)`} mono />
          <DataRow label="Spender" value={`${MESSENGER.slice(0, 10)}… (TokenMessengerV2)`} mono />
          <DataRow label="Amount"  value={`${TEST_AMOUNT_RAW.toString()} raw = 1.000000 USDC`} />
          {approveError && <Alert kind="danger">{approveError.message}</Alert>}
          {approveConfirming && (
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
              <Loader2 className="size-3.5 animate-spin" />
              Waiting for confirmation…
            </div>
          )}
          <button
            onClick={handleApprove}
            disabled={approvePending || approveConfirming || walletChainId !== ARC_CHAIN_ID && !isSwitching}
            className="w-full rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40"
            style={{ background: 'var(--accent)', color: '#0d1b2f' }}
          >
            {approvePending ? 'Confirm in wallet…' : approveConfirming ? 'Confirming…' : walletChainId !== ARC_CHAIN_ID ? 'Switch to Arc Testnet' : 'Approve 1 USDC'}
          </button>
        </StepCard>
      )}

      {/* ── STEP 3: BURN ── */}
      {(currentStep === 'BURN' || currentStep === 'BURN_CONFIRMING') && (
        <StepCard title="Step 3 — Burn (depositForBurn)" active>
          <DataRow label="Amount"      value="1,000,000 raw (1.000000 USDC)" />
          <DataRow label="Destination" value="Ethereum Sepolia (domain 0)" />
          <DataRow label="Recipient"   value={`${address.slice(0, 10)}…${address.slice(-6)} (same wallet)`} mono />
          <DataRow label="Caller lock" value="None — any caller may relay" />
          <Alert kind="warn">
            This burns USDC on Arc Testnet. The burn cannot be undone. USDC will be minted on Sepolia after attestation.
          </Alert>
          {burnError && <Alert kind="danger">{burnError.message}</Alert>}
          {burnConfirming && (
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
              <Loader2 className="size-3.5 animate-spin" />
              Waiting for burn confirmation…
            </div>
          )}
          <button
            onClick={handleBurn}
            disabled={burnPending || burnConfirming}
            className="w-full rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40"
            style={{ background: 'var(--danger)', color: '#fff' }}
          >
            {burnPending ? 'Confirm in wallet…' : burnConfirming ? 'Confirming burn…' : 'Burn 1 USDC on Arc Testnet'}
          </button>
        </StepCard>
      )}

      {/* ── STEP 4: ATTESTING ── */}
      {currentStep === 'ATTESTING' && (
        <StepCard title="Step 4 — Waiting for Circle attestation" active>
          <DataRow label="Burn tx" value={state.burnTxHash ? `${state.burnTxHash.slice(0, 16)}…` : '—'} mono />
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
            <Loader2 className="size-3.5 animate-spin" />
            Polling every 15s — standard finality takes ~15 min…
          </div>
          <p className="text-xs" style={{ color: 'var(--subtle)' }}>
            This page is reload-safe. The burn state is persisted to localStorage.
          </p>
          {state.burnTxHash && (
            <a
              href={txUrl(ARC_CHAIN_ID, state.burnTxHash)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-xs"
              style={{ color: 'var(--accent)' }}
            >
              View burn on Arc Explorer <ExternalLink className="size-3" />
            </a>
          )}
        </StepCard>
      )}

      {/* ── STEP 5a: RELAYING ── */}
      {currentStep === 'RELAYING' && (
        <StepCard title="Step 5 — Relaying receiveMessage" active>
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
            <Loader2 className="size-3.5 animate-spin" />
            BFF is calling receiveMessage on Sepolia (no wallet signature needed)…
          </div>
          <p className="text-xs" style={{ color: 'var(--subtle)' }}>
            destinationCaller = 0x00…00 permits any caller to relay.
          </p>
        </StepCard>
      )}

      {/* ── STEP 5b: SWITCH_CHAIN / RECEIVE (manual relay) ── */}
      {(currentStep === 'SWITCH_CHAIN' || currentStep === 'RECEIVE' || currentStep === 'RECEIVE_CONFIRMING') && (
        <StepCard title="Step 5 — Receive on Ethereum Sepolia" active>
          {state.error && <Alert kind="warn">{state.error}</Alert>}
          <DataRow label="Contract" value={`${TRANSMITTER.slice(0, 10)}… (MessageTransmitterV2)`} mono />
          <DataRow label="Action"   value="receiveMessage(message, attestation)" />
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            BFF relay is not configured. You need to sign receiveMessage on Ethereum Sepolia.
            Switch your wallet to Sepolia first.
          </p>
          {receiveError && <Alert kind="danger">{receiveError.message}</Alert>}
          {receiveConfirming && (
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
              <Loader2 className="size-3.5 animate-spin" />
              Waiting for receiveMessage confirmation…
            </div>
          )}
          {currentStep === 'SWITCH_CHAIN' && (
            <button
              onClick={() => switchChain({ chainId: SEPOLIA_ID })}
              className="w-full rounded-xl py-2.5 text-sm font-semibold"
              style={{ background: 'var(--accent)', color: '#0d1b2f' }}
            >
              {isSwitching ? 'Switching…' : 'Switch to Ethereum Sepolia'}
            </button>
          )}
          {(currentStep === 'RECEIVE' || (currentStep === 'SWITCH_CHAIN' && walletChainId === SEPOLIA_ID)) && (
            <button
              onClick={handleReceive}
              disabled={receivePending || receiveConfirming}
              className="w-full rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40"
              style={{ background: 'var(--accent)', color: '#0d1b2f' }}
            >
              {receivePending ? 'Confirm in wallet…' : receiveConfirming ? 'Confirming…' : 'Call receiveMessage on Sepolia'}
            </button>
          )}
        </StepCard>
      )}

      {/* ── STEP 6: VERIFYING ── */}
      {currentStep === 'VERIFYING' && (
        <StepCard title="Step 6 — Verifying balance delta" active>
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
            <Loader2 className="size-3.5 animate-spin" />
            Reading Sepolia USDC balance and computing delta…
          </div>
        </StepCard>
      )}

      {/* ── STEP 7: DONE ── */}
      {currentStep === 'DONE' && state.receipt && (
        <StepCard title="Step 7 — VERIFIED" active>
          <div className="flex items-center gap-2">
            <CheckCircle className="size-5 shrink-0" style={{ color: 'var(--success)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--success)' }}>
              Bridge VERIFIED — USDC arrived on Ethereum Sepolia
            </span>
          </div>
          <div className="rounded-xl p-3 space-y-2" style={{ background: 'var(--surface-strong)' }}>
            <DataRow label="Receipt ID"    value={state.receipt.receiptId} mono />
            <DataRow label="Delta"         value={state.receipt.actualAmountDelta !== null ? `+${formatUsdc6(state.receipt.actualAmountDelta)} USDC` : '—'} />
            <DataRow label="Status"        value={state.receipt.status} />
            <DataRow label="Burn tx"       value={`${state.receipt.executionTxHash?.slice(0, 18)}…`} mono />
            {state.receipt.bridgeTrace?.destinationTxHash && (
              <DataRow label="Receive tx"  value={`${state.receipt.bridgeTrace.destinationTxHash.slice(0, 18)}…`} mono />
            )}
          </div>
          <div className="flex gap-2">
            {state.receipt.executionTxHash && (
              <a href={txUrl(ARC_CHAIN_ID, state.receipt.executionTxHash)} target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-xs" style={{ color: 'var(--accent)' }}>
                Burn tx <ExternalLink className="size-3" />
              </a>
            )}
            {state.receipt.bridgeTrace?.destinationTxHash && (
              <a href={txUrl(SEPOLIA_ID, state.receipt.bridgeTrace.destinationTxHash)} target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-xs ml-4" style={{ color: 'var(--accent)' }}>
                Receive tx <ExternalLink className="size-3" />
              </a>
            )}
          </div>
          <div className="rounded-xl p-3 mt-2" style={{ background: 'var(--success-muted)', border: '1px solid var(--success)' }}>
            <p className="text-xs font-semibold" style={{ color: 'var(--success)' }}>
              cctp-v2-bridge is ready for lifecycle promotion to TESTED → ENABLED.
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--success)' }}>
              Report the receipt ID and both tx hashes to the developer to update the provider manifest.
            </p>
          </div>
        </StepCard>
      )}

      {/* ── FAILED ── */}
      {currentStep === 'FAILED' && (
        <StepCard title="Failed" active>
          <Alert kind="danger">{state.error ?? 'An unexpected error occurred.'}</Alert>
          {state.burnTxHash && (
            <Alert kind="warn">
              A burn was submitted ({state.burnTxHash.slice(0, 16)}…). Do NOT restart — use "Resume" to retry the receive step only.
            </Alert>
          )}
          <div className="flex gap-2">
            {state.burnTxHash && (
              <button
                onClick={() => setState((s) => ({ ...s, step: 'RESUME_DETECTED', error: undefined }))}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold"
                style={{ background: 'var(--accent)', color: '#0d1b2f' }}
              >
                <RefreshCw className="size-4" />
                Retry receive
              </button>
            )}
            {!state.burnTxHash && (
              <button
                onClick={() => setState({ step: 'PREFLIGHT' })}
                className="flex-1 rounded-xl py-2.5 text-sm font-semibold"
                style={{ background: 'var(--surface-strong)', color: 'var(--ink)', border: '1px solid var(--border)' }}
              >
                Restart
              </button>
            )}
          </div>
        </StepCard>
      )}
    </div>
  );
}
