import { ArrowRight, CheckCircle2, HelpCircle, ShieldCheck } from 'lucide-react';
import { parseUnits } from 'viem';
import { beginAgentBridgeHandoff, agentBridgeReceiptState } from '@/core/agent/agentBridgeReceiptLink';
import type { ActivityReceiptRemoteRecord } from '@/lib/api/activityReceiptApi';
import type { IntentResult, IntentCandidate } from '@/core/intent/intentSchema';
import { validateAgentTransferDraft } from '@/core/agent/transferDraftGate';
import { validateAgentBridgeDraft } from '@/core/agent/bridgeDraftGate';
import type { VeyraPage } from '../layout/AppShell';

interface ActionCardProps {
  intent: IntentResult;
  onNavigate: (page: VeyraPage) => void;
  onReviewBridgeInline?: () => void;
  onReviewPayInline?: (candidate: IntentCandidate) => void;
  onClarifyDestination?: (network: 'Ethereum Sepolia' | 'Base Sepolia') => void;
  bridgeHandoffScope?: string | null;
  messageId?: string;
  linkedBridge?: { receiptId: string; receipt?: ActivityReceiptRemoteRecord; lookupFailed: boolean };
}

export function ActionCard({ intent, onNavigate, onReviewBridgeInline, onReviewPayInline, onClarifyDestination, bridgeHandoffScope, messageId, linkedBridge }: ActionCardProps) {
  const best = intent.candidates[0];
  if (!best) return null;

  const isTransfer = best.actionType === 'TRANSFER';
  const isConvert = best.actionType === 'CONVERT';
  const isBridge = best.actionType === 'BRIDGE';
  const isUnsupported = intent.status === 'UNSUPPORTED';
  const needsClarification = intent.status === 'NEEDS_CLARIFICATION' || intent.status === 'AMBIGUOUS';
  const transferGate = isTransfer ? validateAgentTransferDraft(best) : null;
  const bridgeGate = isBridge ? validateAgentBridgeDraft(best) : null;
  const isActionable = (isTransfer || isConvert || isBridge)
    && intent.status === 'RESOLVED'
    && (transferGate === null || transferGate.ok)
    && (bridgeGate === null || bridgeGate.ok);
  const ambiguousSepolia = isBridge && best.destinationChainRaw?.raw.trim().toLowerCase() === 'sepolia';
  const ambiguousBase = isBridge && needsClarification &&
    best.destinationChainRaw?.raw.trim().toLowerCase() === 'base';
  const bridgeOutcome = linkedBridge ? agentBridgeReceiptState(linkedBridge.receipt) : null;
  const cardStatus = linkedBridge
    ? bridgeOutcome === 'SUCCESS' ? 'Destination verified'
      : bridgeOutcome === 'FAILED' ? 'Needs attention'
      : bridgeOutcome === 'PENDING' ? 'Bridge in progress'
      : bridgeOutcome === 'PREPARED' ? 'Prepared · not submitted' : 'Checking receipt'
    : isActionable ? 'Ready to review' : isUnsupported || (transferGate && !transferGate.ok) ? 'Not available' : 'Needs input';
  const unavailableReason = ambiguousBase
    ? 'Choose Base Sepolia (Testnet) to prepare an Arc-source Bridge draft. Base Mainnet is not enabled.'
    : bridgeGate && !bridgeGate.ok
    ? bridgeGate.reason
    : transferGate && !transferGate.ok
      ? transferGate.reason
    : isUnsupported ? 'This action is not enabled on the requested network.'
    : intent.status === 'NEEDS_CLARIFICATION' ? 'Complete the missing details before reviewing.'
    : intent.status === 'AMBIGUOUS' ? 'The request needs clarification before reviewing.'
    : !isActionable ? 'This action is not available for review.' : null;

  function handleProceed() {
    if (!isActionable) return;
    // Keep canonical positive amount, never the model's display string.
    const prepared: IntentCandidate = transferGate?.ok
      ? { ...best, amountRaw: { kind: 'UNTRUSTED_STRING', raw: transferGate.amount } }
      : bridgeGate?.ok
        ? { ...best, amountRaw: { kind: 'UNTRUSTED_STRING', raw: bridgeGate.amount } }
        : best;
    if (isTransfer && onReviewPayInline) {
      // Same Pay preparation and signing flow, just rendered in the Agent task.
      onReviewPayInline(prepared);
      return;
    }
    sessionStorage.setItem('veyra:agent-intent', JSON.stringify(prepared));
    if (isBridge && bridgeGate?.ok && messageId) {
      beginAgentBridgeHandoff(bridgeHandoffScope ?? null, messageId, {
        amountRaw:parseUnits(bridgeGate.amount, 6).toString(),
        destinationChainId:bridgeGate.destinationChainId,
        recipientAddress:bridgeGate.recipientAddress,
      });
    }
    if (isTransfer) onNavigate('pay');
    else if (isConvert) onNavigate('convert');
    else if (isBridge) {
      // Reuse the existing verified CCTP flow in Agent. No duplicate signer.
      if (onReviewBridgeInline) onReviewBridgeInline();
      else onNavigate('bridge');
    }
  }

  const title = isTransfer ? 'Payment intent' : isConvert ? 'Conversion intent' : isBridge ? 'Cross-chain payment' : best.actionType;

  return (
    <div className="overflow-hidden rounded-3xl" style={{ background: 'linear-gradient(145deg,rgba(23,43,67,0.98),rgba(16,31,51,0.98))', border: '1px solid var(--border-strong)' }}>
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3.5" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-xl" style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}>
            {!isActionable ? <HelpCircle className="size-4" /> : <CheckCircle2 className="size-4" />}
          </span>
          <div>
            <div className="text-sm font-bold" style={{ color: 'var(--ink)' }}>{title}</div>
            <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>Agent proposal · {(best.confidence * 100).toFixed(0)}% confidence</div>
          </div>
        </div>
        <span className="rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wider" style={{ background: !isActionable ? 'var(--warning-muted)' : 'var(--success-muted)', color: !isActionable ? 'var(--warning)' : 'var(--success)' }}>
          {cardStatus}
        </span>
      </div>

      <div className="grid gap-2 p-4 sm:grid-cols-2">
        {best.amountRaw && <Detail label="Amount" value={best.amountRaw.raw} />}
        {best.tokenRaw && <Detail label={isConvert ? 'From asset' : 'Asset'} value={best.tokenRaw.raw} />}
        {best.targetTokenRaw && <Detail label="To asset" value={best.targetTokenRaw.raw} />}
        {best.recipientRaw && <Detail label="Recipient" value={best.recipientRaw.raw} />}
        {best.sourceChainRaw && <Detail label="From network" value={best.sourceChainRaw.raw} />}
        {best.destinationChainRaw && <Detail label="Destination" value={best.destinationChainRaw.raw} />}
      </div>

      <div className="flex items-start gap-2 border-t px-4 py-3" style={{ borderColor: 'var(--border)', background: 'rgba(255,255,255,0.018)' }}>
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
        <p className="text-[11px] leading-5" style={{ color: 'var(--subtle)' }}>
          {linkedBridge
            ? bridgeOutcome === 'SUCCESS'
              ? 'Veyra has verified destination settlement for the receipt linked to this Agent request. You can start a new request below.'
              : bridgeOutcome === 'PENDING'
                ? 'This linked Bridge is being processed. Source confirmation does not mean destination settlement. Check Activity.'
                : bridgeOutcome === 'PREPARED'
                ? 'An Activity record was prepared but no source burn has been verified. Check Activity before deciding what to do next.'
                : bridgeOutcome === 'FAILED'
                  ? 'This linked transaction needs attention. Inspect Activity before taking another action; do not repeat an existing burn.'
                  : linkedBridge.lookupFailed
                    ? 'Receipt status is unavailable. Veyra will not claim success; view Activity to verify the existing transaction.'
                    : 'Checking the linked transaction receipt. No new transaction will be submitted.'
            : 'This is a draft, not an executable transaction. Veyra verifies recipient, route, policy and chain state before any wallet signature.'}
        </p>
      </div>

      {!isActionable && unavailableReason && (
        <p role="status" className="border-t px-4 py-3 text-xs leading-5"
          style={{ borderColor: 'var(--border)', color: 'var(--warning)' }}>{unavailableReason}</p>
      )}
      {ambiguousSepolia && onClarifyDestination && (
        <div className="grid grid-cols-2 gap-2 border-t p-3" style={{ borderColor: 'var(--border)' }}>
          <button type="button" onClick={() => onClarifyDestination('Ethereum Sepolia')}
            className="rounded-xl border px-2 py-3 text-xs font-semibold"
            style={{ borderColor: 'var(--border-strong)', color: 'var(--ink)' }}>Ethereum Sepolia</button>
          <button type="button" onClick={() => onClarifyDestination('Base Sepolia')}
            className="rounded-xl border px-2 py-3 text-xs font-semibold"
            style={{ borderColor: 'var(--border-strong)', color: 'var(--ink)' }}>Base Sepolia</button>
        </div>
      )}
      {ambiguousBase && onClarifyDestination && (
        <div className="space-y-2 border-t p-3" style={{ borderColor: 'var(--border)' }}>
          <button type="button" onClick={() => onClarifyDestination('Base Sepolia')}
            className="w-full rounded-xl border px-3 py-3 text-xs font-semibold"
            style={{ borderColor: 'var(--border-strong)', color: 'var(--ink)' }}>
            Use Base Sepolia (Testnet) · Prepare draft
          </button>
          <p className="text-center text-[11px]" style={{ color: 'var(--muted)' }}>
            Base Mainnet · not enabled. No network is chosen or signed automatically.
          </p>
        </div>
      )}
      {linkedBridge && (
        <div className="border-t p-3" style={{borderColor:'var(--border)'}}>
          <button type="button" onClick={()=>onNavigate('activity')}
            className="w-full rounded-2xl border py-3 text-sm font-semibold"
            style={{borderColor:'var(--border-strong)',color:'var(--ink)'}}>
            {bridgeOutcome === 'SUCCESS' ? 'View completed receipt' : 'View existing Bridge in Activity'}
          </button>
        </div>
      )}
      {isActionable && !linkedBridge && (
        <div className="border-t p-3" style={{ borderColor: 'var(--border)' }}>
          <button onClick={handleProceed} className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold transition-transform hover:scale-[1.01]" style={{ background: 'linear-gradient(135deg,#c8ff65,#91e9b5)', color: '#0b1b25' }}>
            Review {isTransfer ? 'payment' : isConvert ? 'conversion' : 'route'} <ArrowRight className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl px-3.5 py-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>{label}</div>
      <div className="mono mt-1 truncate text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>{value}</div>
    </div>
  );
}

export type { IntentCandidate };
