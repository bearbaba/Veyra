/**
 * Veyra Receipt Types
 *
 * VeyraReceipt is the authoritative record of a completed financial action.
 * Numeric and authoritative values must come from deterministic execution data.
 * LLM-generated summaries are display-only.
 *
 * Receipt IDs use veyra- prefix.
 * Pre-execution plan IDs may use UUID.
 * Execution IDs should be deterministic hash-based when tx metadata exists.
 *
 * IndexedDB is a local cache only.
 * Chain/provider state is the execution source of truth.
 */

import type { ActionType } from '../actions/actionSchema';

// ── Receipt Status ────────────────────────────────────────────────────────────

export type ReceiptStatus =
  | 'PENDING'            // execution submitted, not yet verified
  | 'VERIFIED'           // post-execution verification passed
  | 'FAILED'             // execution failed or verification failed
  | 'BRIDGE_PENDING'     // source-chain success, destination pending
  | 'BRIDGE_UNCONFIRMED' // bridge destination monitoring active
  | 'CANCELLED';         // user cancelled before broadcast

// ── Bridge Trace ──────────────────────────────────────────────────────────────

export type BridgeStatus =
  | 'BRIDGE_PENDING'
  | 'BRIDGE_UNCONFIRMED'
  | 'VERIFIED'
  | 'FAILED';

export interface BridgeTrace {
  sourceChainId: number;
  destinationChainId: number;
  sourceTxHash: string;
  destinationTxHash?: string;
  /** CCTP/protocol message ID or hash. */
  messageId?: string;
  sourceBlock?: number;
  destinationBlock?: number;
  bridgeStatus: BridgeStatus;
  sourceTimestamp?: number;
  destinationTimestamp?: number;
}

export interface TransferRecoveryTrace {
  providerId: string;
  tokenAddress: string;
  tokenDecimals: number;
  fromAddress: string;
  recipientAddress: string;
  amountRaw: string;
  balanceBeforeRaw: string;
}

// ── VeyraReceipt ──────────────────────────────────────────────────────────────

export interface VeyraReceipt {
  /** Canonical receipt ID. Format: veyra-<hash> or veyra-plan-<uuid>. */
  receiptId: string;

  /** Pre-execution plan action ID (UUID). */
  planId?: string;

  /** Action type this receipt covers. */
  actionType: ActionType;

  /** Current receipt status. */
  status: ReceiptStatus;

  /** Chain ID of the primary action. */
  chainId: number;

  /** Transaction hash on the primary chain. */
  executionTxHash?: string;

  /** Block number where the transaction was included. */
  executionBlock?: number;

  /** ms timestamp when the action was created/prepared. */
  createdAt: number;

  /** ms timestamp when the receipt reached VERIFIED or FAILED. */
  completedAt?: number;

  /** Actual token amount sent/received in base units (from chain verification). */
  actualAmountDelta: bigint | null;

  /** Expected amount from the action schema. */
  expectedAmountDelta: bigint | null;

  /** Final balance of recipient after action (from chain read). */
  verifiedBalanceAfter?: bigint;

  /** Risk score 0–100 at execution time. Null if not evaluated. */
  riskScore: number | null;

  /** Policy decision at execution time. */
  policyDecision: string | null;

  /** LLM-generated display summary. Display only — not authoritative. */
  displaySummary?: string;

  /** Bridge trace. Present only for BRIDGE actions. */
  bridgeTrace?: BridgeTrace;

  /**
   * Durable same-chain transfer verification context. All numeric values are
   * strings so the record remains safe to persist and hydrate across devices.
   */
  transferTrace?: TransferRecoveryTrace;
}

// ── Plan Receipt ──────────────────────────────────────────────────────────────

/**
 * A pre-execution plan created before user approval.
 * Upgraded to a full VeyraReceipt after execution.
 */
export interface PlanReceipt {
  receiptId: string;
  actionType: ActionType;
  chainId: number;
  fromAddress: string;
  toAddress?: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
  amountBaseUnits: bigint;
  amountDisplay: string;
  createdAt: number;
}
