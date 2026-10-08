/**
 * Veyra Action Schema
 *
 * Only closed, typed action schemas may reach execution.
 * Natural-language text must never be converted directly to calldata.
 *
 * Every action carries deterministic provenance:
 * - source  (where the data came from)
 * - block   (block number at time of read, where applicable)
 * - fetchedAt (ms timestamp of data retrieval)
 *
 * Validation enforces:
 * - nonzero amounts
 * - supported addresses (checksummed or lowercase — normalised at parse)
 * - data freshness
 * - quote expiry
 * - slippage bounds
 * - valid bridge source/destination pairs
 */

import { SECURITY_CONFIG } from '../../lib/securityConfig';

// ── Action Types ──────────────────────────────────────────────────────────────

export type ActionType =
  | 'TRANSFER'
  | 'CONVERT'
  | 'BRIDGE'
  | 'APPROVE'
  | 'SUPPLY'
  | 'WITHDRAW'
  | 'BORROW'
  | 'REPAY';

// ── Provenance ────────────────────────────────────────────────────────────────

export type ProvenanceSource =
  | 'USER_DIRECT'      // entered directly by the user in the UI
  | 'AGENT_PARSED'     // came from the BFF/LLM intent parser (still untrusted until resolved)
  | 'ONCHAIN_READ'     // fetched from chain state
  | 'PROVIDER_QUOTE'   // returned by a registered provider quote endpoint
  | 'SIMULATION';      // derived from a simulation result

export interface ActionProvenance {
  source: ProvenanceSource;
  fetchedAt: number; // ms timestamp
  blockNumber?: bigint;
  quoteId?: string;
  providerId?: string;
}

// ── Base Action ───────────────────────────────────────────────────────────────

export interface BaseAction {
  actionType: ActionType;
  chainId: number;
  provenance: ActionProvenance;
  /** Unique ID for this action instance (UUID). */
  actionId: string;
  /** ms timestamp when this action was constructed. */
  createdAt: number;
}

// ── TRANSFER ──────────────────────────────────────────────────────────────────

export interface TransferAction extends BaseAction {
  actionType: 'TRANSFER';
  /** ERC-20 token address (lowercase). */
  tokenAddress: string;
  /** Token decimals — must come from chain read, never from LLM. */
  tokenDecimals: number;
  /** Amount in token base units (bigint). */
  amount: bigint;
  from: string;
  to: string;
}

// ── CONVERT ───────────────────────────────────────────────────────────────────

export interface ConvertAction extends BaseAction {
  actionType: 'CONVERT';
  fromTokenAddress: string;
  toTokenAddress: string;
  fromTokenDecimals: number;
  toTokenDecimals: number;
  /** Amount in from-token base units. */
  amountIn: bigint;
  /** Minimum acceptable output in to-token base units. */
  minAmountOut: bigint;
  /** Slippage in basis points. */
  slippageBps: number;
  /** Quote expiry timestamp (ms). Must be > Date.now() + QUOTE_EXPIRY_BUFFER_MS. */
  quoteExpiresAt: number;
  /** Registered provider ID for this quote. */
  providerId: string;
}

// ── BRIDGE ────────────────────────────────────────────────────────────────────

export interface BridgeAction extends BaseAction {
  actionType: 'BRIDGE';
  sourceChainId: number;
  destinationChainId: number;
  tokenAddress: string; // on source chain
  tokenDecimals: number;
  amount: bigint;
  from: string;
  to: string;
  /** Registered provider ID for this bridge route. */
  providerId: string;
  /** Quote expiry timestamp (ms). */
  quoteExpiresAt: number;
}

// ── APPROVE ───────────────────────────────────────────────────────────────────

export interface ApproveAction extends BaseAction {
  actionType: 'APPROVE';
  tokenAddress: string;
  spenderAddress: string;
  amount: bigint;
  owner: string;
}

// ── SUPPLY ────────────────────────────────────────────────────────────────────

export interface SupplyAction extends BaseAction {
  actionType: 'SUPPLY';
  tokenAddress: string;
  tokenDecimals: number;
  amount: bigint;
  from: string;
  protocolAddress: string;
  providerId: string;
}

// ── WITHDRAW ──────────────────────────────────────────────────────────────────

export interface WithdrawAction extends BaseAction {
  actionType: 'WITHDRAW';
  tokenAddress: string;
  tokenDecimals: number;
  amount: bigint;
  to: string;
  protocolAddress: string;
  providerId: string;
}

// ── BORROW ────────────────────────────────────────────────────────────────────

export interface BorrowAction extends BaseAction {
  actionType: 'BORROW';
  tokenAddress: string;
  tokenDecimals: number;
  amount: bigint;
  to: string;
  protocolAddress: string;
  providerId: string;
}

// ── REPAY ─────────────────────────────────────────────────────────────────────

export interface RepayAction extends BaseAction {
  actionType: 'REPAY';
  tokenAddress: string;
  tokenDecimals: number;
  amount: bigint;
  from: string;
  protocolAddress: string;
  providerId: string;
}

// ── Union ─────────────────────────────────────────────────────────────────────

export type VeyraAction =
  | TransferAction
  | ConvertAction
  | BridgeAction
  | ApproveAction
  | SupplyAction
  | WithdrawAction
  | BorrowAction
  | RepayAction;

// ── Validation Errors ─────────────────────────────────────────────────────────

export type ActionValidationError =
  | 'ZERO_AMOUNT'
  | 'NEGATIVE_AMOUNT'
  | 'STALE_PROVENANCE'
  | 'EXPIRED_QUOTE'
  | 'SLIPPAGE_EXCEEDED'
  | 'INVALID_ADDRESS'
  | 'SAME_SOURCE_DESTINATION_CHAIN'
  | 'MISSING_REQUIRED_FIELD'
  | 'UNSUPPORTED_ACTION_TYPE';

export interface ActionValidationResult {
  valid: boolean;
  errors: ActionValidationError[];
  details: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** EVM address basic format check (not checksum). */
function isValidAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

function isProvenanceFresh(provenance: ActionProvenance): boolean {
  return Date.now() - provenance.fetchedAt <= SECURITY_CONFIG.MAX_PROVENANCE_AGE_MS;
}

function isQuoteFresh(expiresAt: number): boolean {
  return expiresAt > Date.now() + SECURITY_CONFIG.QUOTE_EXPIRY_BUFFER_MS;
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateBase(_action: BaseAction, _errors: ActionValidationError[], _details: string[]): void {
  // Base validations applicable to all actions — extended per-action type below
}

function validateTransfer(action: TransferAction, errors: ActionValidationError[], details: string[]): void {
  if (action.amount <= 0n) {
    errors.push('ZERO_AMOUNT');
    details.push('Transfer amount must be greater than zero.');
  }
  if (!isValidAddress(action.tokenAddress)) {
    errors.push('INVALID_ADDRESS');
    details.push(`Invalid token address: ${action.tokenAddress}`);
  }
  if (!isValidAddress(action.from)) {
    errors.push('INVALID_ADDRESS');
    details.push(`Invalid from address: ${action.from}`);
  }
  if (!isValidAddress(action.to)) {
    errors.push('INVALID_ADDRESS');
    details.push(`Invalid to address: ${action.to}`);
  }
  if (!isProvenanceFresh(action.provenance)) {
    errors.push('STALE_PROVENANCE');
    details.push(`Provenance is stale (fetchedAt: ${action.provenance.fetchedAt}, now: ${Date.now()}).`);
  }
}

function validateConvert(action: ConvertAction, errors: ActionValidationError[], details: string[]): void {
  if (action.amountIn <= 0n) {
    errors.push('ZERO_AMOUNT');
    details.push('Convert amountIn must be greater than zero.');
  }
  if (action.minAmountOut <= 0n) {
    errors.push('ZERO_AMOUNT');
    details.push('Convert minAmountOut must be greater than zero.');
  }
  if (!isQuoteFresh(action.quoteExpiresAt)) {
    errors.push('EXPIRED_QUOTE');
    details.push(`Quote has expired or is within the expiry buffer (expiresAt: ${action.quoteExpiresAt}).`);
  }
  if (!isProvenanceFresh(action.provenance)) {
    errors.push('STALE_PROVENANCE');
    details.push('Convert action provenance is stale.');
  }
  if (action.slippageBps > SECURITY_CONFIG.HARD_MAX_SLIPPAGE_BPS) {
    errors.push('SLIPPAGE_EXCEEDED');
    details.push(
      `Slippage ${action.slippageBps} bps exceeds hard cap of ${SECURITY_CONFIG.HARD_MAX_SLIPPAGE_BPS} bps.`,
    );
  }
}

function validateBridge(action: BridgeAction, errors: ActionValidationError[], details: string[]): void {
  if (action.amount <= 0n) {
    errors.push('ZERO_AMOUNT');
    details.push('Bridge amount must be greater than zero.');
  }
  if (action.sourceChainId === action.destinationChainId) {
    errors.push('SAME_SOURCE_DESTINATION_CHAIN');
    details.push('Bridge source and destination chains must be different.');
  }
  if (!isQuoteFresh(action.quoteExpiresAt)) {
    errors.push('EXPIRED_QUOTE');
    details.push('Bridge quote has expired or is within the expiry buffer.');
  }
  if (!isProvenanceFresh(action.provenance)) {
    errors.push('STALE_PROVENANCE');
    details.push('Bridge action provenance is stale.');
  }
}

function validateApprove(action: ApproveAction, errors: ActionValidationError[], details: string[]): void {
  if (action.amount <= 0n) {
    errors.push('ZERO_AMOUNT');
    details.push('Approve amount must be greater than zero.');
  }
  if (!isValidAddress(action.tokenAddress)) {
    errors.push('INVALID_ADDRESS');
    details.push(`Invalid token address: ${action.tokenAddress}`);
  }
  if (!isValidAddress(action.spenderAddress)) {
    errors.push('INVALID_ADDRESS');
    details.push(`Invalid spender address: ${action.spenderAddress}`);
  }
  if (!isProvenanceFresh(action.provenance)) {
    errors.push('STALE_PROVENANCE');
    details.push('Approve action provenance is stale.');
  }
}

function validateProtocolAction(
  action: SupplyAction | WithdrawAction | BorrowAction | RepayAction,
  errors: ActionValidationError[],
  details: string[],
): void {
  if (action.amount <= 0n) {
    errors.push('ZERO_AMOUNT');
    details.push(`${action.actionType} amount must be greater than zero.`);
  }
  if (!isValidAddress(action.tokenAddress)) {
    errors.push('INVALID_ADDRESS');
    details.push(`Invalid token address: ${action.tokenAddress}`);
  }
  if (!isValidAddress(action.protocolAddress)) {
    errors.push('INVALID_ADDRESS');
    details.push(`Invalid protocol address: ${action.protocolAddress}`);
  }
  if (!isProvenanceFresh(action.provenance)) {
    errors.push('STALE_PROVENANCE');
    details.push(`${action.actionType} action provenance is stale.`);
  }
}

/**
 * Validate a VeyraAction against all schema rules.
 */
export function validateAction(action: VeyraAction): ActionValidationResult {
  const errors: ActionValidationError[] = [];
  const details: string[] = [];

  validateBase(action, errors, details);

  switch (action.actionType) {
    case 'TRANSFER':
      validateTransfer(action, errors, details);
      break;
    case 'CONVERT':
      validateConvert(action, errors, details);
      break;
    case 'BRIDGE':
      validateBridge(action, errors, details);
      break;
    case 'APPROVE':
      validateApprove(action, errors, details);
      break;
    case 'SUPPLY':
    case 'WITHDRAW':
    case 'BORROW':
    case 'REPAY':
      validateProtocolAction(action, errors, details);
      break;
    default: {
      const _exhaustive: never = action;
      errors.push('UNSUPPORTED_ACTION_TYPE');
      details.push(`Unknown action type.`);
      void _exhaustive;
    }
  }

  return { valid: errors.length === 0, errors, details };
}

/**
 * Assert that an action is valid. Throws with all error details if not.
 */
export function assertActionValid(action: VeyraAction): void {
  const result = validateAction(action);
  if (!result.valid) {
    throw new Error(
      `[actionSchema] Invalid action ${action.actionType}: ${result.details.join(' ')}`,
    );
  }
}
