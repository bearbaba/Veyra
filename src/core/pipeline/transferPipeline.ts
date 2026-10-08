/**
 * Veyra TRANSFER Pipeline
 *
 * Creates a fully-validated TransferAction from direct-form or agent-resolved inputs.
 * Both paths converge here — there is no shortcut to execution.
 *
 * Pipeline:
 *   Input → validate → build TransferAction with USER_DIRECT provenance
 *
 * The returned action then flows through:
 *   Policy → Risk → Simulation → Review → User signature → Execution → Verification → Receipt
 */

import type { TransferAction } from '../actions/actionSchema';
import { validateAction } from '../actions/actionSchema';

export interface TransferInput {
  from: string;
  to: string;
  tokenAddress: string;
  tokenDecimals: number;
  amount: bigint;
  chainId: number;
}

/**
 * Build a validated TransferAction with USER_DIRECT provenance.
 * Throws if the action fails basic schema validation.
 */
export function createTransferAction(input: TransferInput): TransferAction {
  const action: TransferAction = {
    actionType: 'TRANSFER',
    actionId: crypto.randomUUID(),
    createdAt: Date.now(),
    chainId: input.chainId,
    provenance: {
      source: 'USER_DIRECT',
      fetchedAt: Date.now(),
    },
    tokenAddress: input.tokenAddress.toLowerCase(),
    tokenDecimals: input.tokenDecimals,
    amount: input.amount,
    from: input.from.toLowerCase(),
    to: input.to.toLowerCase(),
  };

  const result = validateAction(action);
  if (!result.valid) {
    throw new Error(
      `[transferPipeline] Invalid TransferAction: ${result.errors.join(', ')}. ` +
      `Details: ${result.details.join('; ')}`,
    );
  }

  return action;
}

/**
 * Build a TransferAction from an agent-resolved candidate.
 * The agent provides raw strings; this function accepts already-resolved,
 * deterministically-verified values (address from ENS resolution, amount from chain read).
 * Agent-provided raw strings must be resolved BEFORE calling this.
 */
export function createAgentTransferAction(input: TransferInput): TransferAction {
  const action: TransferAction = {
    actionType: 'TRANSFER',
    actionId: crypto.randomUUID(),
    createdAt: Date.now(),
    chainId: input.chainId,
    provenance: {
      source: 'AGENT_PARSED',
      fetchedAt: Date.now(),
    },
    tokenAddress: input.tokenAddress.toLowerCase(),
    tokenDecimals: input.tokenDecimals,
    amount: input.amount,
    from: input.from.toLowerCase(),
    to: input.to.toLowerCase(),
  };

  const result = validateAction(action);
  if (!result.valid) {
    throw new Error(
      `[transferPipeline] Invalid agent TransferAction: ${result.errors.join(', ')}. ` +
      `Details: ${result.details.join('; ')}`,
    );
  }

  return action;
}
