/**
 * Handoff guard for Agent -> Pay. Agent proposals, including model-originated
 * JSON and sessionStorage payloads, are untrusted. The one enabled payment
 * route is Arc Testnet USDC; explicit Base (or other chains) must stay blocked.
 * This is not an execution grant: Pay re-resolves policy, recipient and chain.
 */
import { parseUnits } from 'viem';
import type { IntentCandidate } from '../intent/intentSchema';

export type AgentTransferDraftResult =
  | { ok: true; amount: string }
  | { ok: false; reason: string };

const ARC_ONLY = /^(?:arc(?:[ -]testnet)?|5042002)$/i;

export function validateAgentTransferDraft(candidate: IntentCandidate): AgentTransferDraftResult {
  if (candidate.actionType !== 'TRANSFER')
    return { ok: false, reason: 'This proposal is not a payment.' };
  const network = [candidate.sourceChainRaw?.raw, candidate.destinationChainRaw?.raw]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0);
  if (network.some((part) => !ARC_ONLY.test(part.trim())))
    return { ok: false, reason: 'This network is not enabled for direct USDC payments. Only Arc Testnet USDC can be reviewed and sent.' };
  if (candidate.tokenRaw?.raw.trim().toUpperCase() !== 'USDC')
    return { ok: false, reason: 'Only Arc Testnet USDC payments are enabled.' };

  const raw = candidate.amountRaw?.raw.trim() ?? '';
  const match = raw.match(/^(\d{1,18}(?:\.\d{1,6})?)(?:\s+USDC)?$/i);
  if (!match) return { ok: false, reason: 'Enter an exact positive USDC amount (up to six decimal places).' };
  const amount = match[1];
  try {
    if (parseUnits(amount, 6) <= 0n)
      return { ok: false, reason: 'Payment amount must be greater than zero.' };
  } catch {
    return { ok: false, reason: 'This USDC amount is not valid.' };
  }
  const recipient = candidate.recipientRaw?.raw.trim();
  if (!recipient)
    return { ok: false, reason: 'Choose a recipient before reviewing a payment.' };
  if (/^0x/i.test(recipient) && !/^0x[\da-f]{40}$/i.test(recipient))
    return { ok: false, reason: 'The wallet address is incomplete or invalid.' };
  return { ok: true, amount };
}
