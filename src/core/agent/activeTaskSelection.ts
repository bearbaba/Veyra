/**
 * Agent task selection is distinct from chat history and transaction execution.
 * This module never signs, broadcasts, auto-resubmits or clears a remote receipt.
 */
export interface ActiveTaskMessageSnapshot {
  id: string;
  role: 'agent' | 'user';
  intent?: { status?: string; candidates: readonly unknown[] };
}

/** A normal reply cannot erase an already selected transaction task. */
export function selectActiveTaskAfterReply(
  selectedId: string | null,
  replyId: string,
  hasActionableIntent: boolean,
): string | null {
  return selectedId ?? (hasActionableIntent && replyId ? replyId : null);
}

/** Only recover a task that belongs to the already wallet-scoped conversation. */
export function restoreWalletScopedActiveTask(
  savedId: string | null,
  messages: readonly ActiveTaskMessageSnapshot[],
): string | null {
  if (!savedId || savedId.length > 100) return null;
  return messages.some((message) =>
    message.id === savedId &&
    message.role === 'agent' &&
    message.intent?.status !== 'UNSUPPORTED' &&
    Array.isArray(message.intent?.candidates) &&
    message.intent.candidates.length > 0
  ) ? savedId : null;
}
