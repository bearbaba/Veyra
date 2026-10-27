/**
 * Presentation-only link between an Agent proposal and a durable Veyra
 * Bridge receipt. The signed BFF receipt, NEVER this sessionStorage value,
 * determines settlement status. Do not pass these markers to execution.
 */
import type { ActivityReceiptRemoteRecord } from '../../lib/api/activityReceiptApi';

export interface AgentBridgeRouteSnapshot {
  amountRaw: string;
  destinationChainId: number;
  recipientAddress: string;
}
export interface AgentBridgeReceiptLink {
  messageId: string;
  receiptId: string;
  at: number;
}
interface PendingAgentBridge extends AgentBridgeRouteSnapshot {
  scope: string;
  messageId: string;
  at: number;
}
const PENDING_KEY = 'veyra:agent:pending-bridge-link';
const linkKey = (scope: string) => 'veyra:agent:bridge-receipts:' + scope;
const MAX_AGE_MS = 45 * 60 * 1000;

export function beginAgentBridgeHandoff(
  scope: string | null,
  messageId: string,
  route: AgentBridgeRouteSnapshot,
): void {
  if (!scope || !messageId) return;
  try {
    const pending: PendingAgentBridge = {...route, scope, messageId, at: Date.now()};
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch { /* No synthetic outcome when storage denied. */ }
}

export function readAgentBridgeReceiptLinks(scope: string | null): AgentBridgeReceiptLink[] {
  if (!scope) return [];
  try {
    const raw = sessionStorage.getItem(linkKey(scope));
    const value: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is AgentBridgeReceiptLink =>
      item !== null && typeof item === 'object' &&
      typeof (item as AgentBridgeReceiptLink).messageId === 'string' &&
      typeof (item as AgentBridgeReceiptLink).receiptId === 'string' &&
      typeof (item as AgentBridgeReceiptLink).at === 'number',
    ).slice(-20);
  } catch { return []; }
}

export function bindAgentBridgeReceipt(
  scope: string | null,
  receiptId: string,
  route: AgentBridgeRouteSnapshot,
): boolean {
  if (!scope || !receiptId) return false;
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return false;
    const pending = JSON.parse(raw) as PendingAgentBridge;
    if (pending.scope !== scope || !Number.isFinite(pending.at) ||
        Date.now() - pending.at > MAX_AGE_MS || Date.now() < pending.at ||
        pending.amountRaw !== route.amountRaw ||
        pending.destinationChainId !== route.destinationChainId ||
        pending.recipientAddress.toLowerCase() !== route.recipientAddress.toLowerCase()) return false;
    const links = readAgentBridgeReceiptLinks(scope);
    const updated = [...links.filter((x)=>x.messageId !== pending.messageId),
      {messageId:pending.messageId, receiptId, at:Date.now()}].slice(-20);
    sessionStorage.setItem(linkKey(scope),JSON.stringify(updated));
    sessionStorage.removeItem(PENDING_KEY);
    return true;
  } catch { return false; }
}

/** Only a backend-confirmed CCTP destination settlement can be called success. */
export function agentBridgeReceiptState(
  receipt: ActivityReceiptRemoteRecord | undefined,
): 'CHECKING' | 'SUCCESS' | 'PENDING' | 'FAILED' {
  if (!receipt) return 'CHECKING';
  if (receipt.providerId !== 'cctp-v2-bridge') return 'CHECKING';
  if (receipt.status === 'COMPLETE') return 'SUCCESS';
  if (receipt.status === 'FAILED' || receipt.status === 'CANCELLED') return 'FAILED';
  return 'PENDING';
}
