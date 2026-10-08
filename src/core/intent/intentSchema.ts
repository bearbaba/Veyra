/**
 * Veyra Intent Schema
 *
 * Validates and sanitizes BFF (LLM) output.
 * The BFF response is always treated as UNTRUSTED until validated here.
 *
 * Rules:
 * - Closed intent/action candidates only
 * - Unknown action types are removed (not passed through)
 * - Long display strings are bounded
 * - Missing required params produce NEEDS_CLARIFICATION status
 * - Raw LLM values remain UNTRUSTED_STRING until deterministically resolved
 *
 * The validated IntentResult is then handed to deterministic context resolution
 * which replaces all untrusted strings with onchain-verified values.
 */

import type { ActionType } from '../actions/actionSchema';

// ── Intent Status ─────────────────────────────────────────────────────────────

export type IntentStatus =
  | 'RESOLVED'           // all required parameters are present
  | 'NEEDS_CLARIFICATION'// one or more required params are missing
  | 'AMBIGUOUS'          // multiple interpretations are equally likely
  | 'UNSUPPORTED'        // the intent maps to a disabled/unverified capability
  | 'UNRECOGNISED';      // intent could not be parsed into a known action type

// ── Untrusted Value Wrapper ───────────────────────────────────────────────────

/**
 * A raw LLM-provided value that has not yet been deterministically resolved.
 * Must never be used directly for execution.
 */
export interface UntrustedString {
  kind: 'UNTRUSTED_STRING';
  raw: string;
}

export function untrusted(raw: string): UntrustedString {
  return { kind: 'UNTRUSTED_STRING', raw };
}

export function isUntrusted(v: unknown): v is UntrustedString {
  return typeof v === 'object' && v !== null && (v as UntrustedString).kind === 'UNTRUSTED_STRING';
}

// ── Intent Candidate ─────────────────────────────────────────────────────────

/**
 * A candidate action extracted by the LLM/BFF.
 * All values are UntrustedString until resolved by the context layer.
 */
export interface IntentCandidate {
  actionType: ActionType;

  /**
   * Untrusted recipient address string from LLM.
   * null means the LLM explicitly said no recipient; undefined means it was absent.
   */
  recipientRaw?: UntrustedString | null;

  /** Untrusted amount string (e.g. "10", "10.5 USDC"). */
  amountRaw?: UntrustedString;

  /** Untrusted token symbol or address (e.g. "USDC", "0x36..."). */
  tokenRaw?: UntrustedString;

  /** Untrusted source chain name or ID. */
  sourceChainRaw?: UntrustedString;

  /** Untrusted destination chain name or ID. */
  destinationChainRaw?: UntrustedString;

  /** Untrusted protocol or provider name (e.g. "Aave", "Uniswap"). */
  providerRaw?: UntrustedString;

  /** Confidence score from 0–1. Used for AMBIGUOUS detection. */
  confidence: number;
}

// ── IntentResult ──────────────────────────────────────────────────────────────

export interface IntentResult {
  /** LLM-generated display summary — display only, never used for execution. */
  displaySummary: string;

  /** Validated and bounded intent status. */
  status: IntentStatus;

  /**
   * Validated candidates — unknown action types have been removed.
   * May be empty if all candidates were invalid.
   */
  candidates: IntentCandidate[];

  /** Parameters explicitly missing from the best candidate. */
  missingParams: string[];

  /** LLM-generated clarification question — display only. */
  clarificationQuestion?: string;

  /** Timestamp of BFF response (ms). */
  parsedAt: number;
}

// ── Validation Constants ──────────────────────────────────────────────────────

const VALID_ACTION_TYPES = new Set<ActionType>([
  'TRANSFER',
  'CONVERT',
  'BRIDGE',
  'APPROVE',
  'SUPPLY',
  'WITHDRAW',
  'BORROW',
  'REPAY',
]);

const MAX_DISPLAY_SUMMARY_LENGTH = 200;
const MAX_CLARIFICATION_LENGTH = 300;
const MAX_RAW_VALUE_LENGTH = 100;
const MAX_CANDIDATES = 5;

// ── Raw BFF Response Shape ────────────────────────────────────────────────────

/** The raw unvalidated object returned by POST /api/agent/parse. */
export interface RawBffIntentResponse {
  displaySummary?: unknown;
  status?: unknown;
  candidates?: unknown;
  missingParams?: unknown;
  clarificationQuestion?: unknown;
  parsedAt?: unknown;
}

// ── Sanitization ──────────────────────────────────────────────────────────────

function truncate(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.slice(0, maxLen);
}

function sanitizeUntrustedString(raw: unknown): UntrustedString | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  return untrusted(s.slice(0, MAX_RAW_VALUE_LENGTH));
}

function sanitizeCandidate(raw: unknown): IntentCandidate | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  const rawActionType = obj.actionType;
  const actionType = (typeof rawActionType === 'string' ? rawActionType : '').toUpperCase();
  if (!VALID_ACTION_TYPES.has(actionType as ActionType)) return null;

  const confidence = typeof obj.confidence === 'number' ? Math.max(0, Math.min(1, obj.confidence)) : 0.5;

  // Handle null recipient explicitly (not the same as undefined)
  const recipientValue = 'recipient' in obj ? obj.recipient : undefined;
  const recipientRaw = recipientValue === null ? null : (sanitizeUntrustedString(obj.recipientRaw ?? recipientValue ?? obj.to) ?? undefined);

  return {
    actionType: actionType as ActionType,
    recipientRaw,
    amountRaw: sanitizeUntrustedString(obj.amountRaw ?? obj.amount ?? obj.fromAmount),
    tokenRaw: sanitizeUntrustedString(obj.tokenRaw ?? obj.token ?? obj.asset ?? obj.fromCurrency),
    sourceChainRaw: sanitizeUntrustedString(obj.sourceChainRaw ?? obj.sourceChain ?? obj.fromChain),
    destinationChainRaw: sanitizeUntrustedString(obj.destinationChainRaw ?? obj.destinationChain ?? obj.toChain),
    providerRaw: sanitizeUntrustedString(obj.providerRaw ?? obj.provider ?? obj.protocol),
    confidence,
  };
}

function sanitizeMissingParams(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v) => typeof v === 'string')
    .map((v) => String(v).slice(0, 50))
    .slice(0, 10);
}

function sanitizeStatus(raw: unknown): IntentStatus {
  const valid: IntentStatus[] = ['RESOLVED', 'NEEDS_CLARIFICATION', 'AMBIGUOUS', 'UNSUPPORTED', 'UNRECOGNISED'];
  const s = ((typeof raw === 'string' ? raw : '')).toUpperCase() as IntentStatus;
  return valid.includes(s) ? s : 'UNRECOGNISED';
}

// ── Required Param Check ──────────────────────────────────────────────────────

const REQUIRED_PARAMS_BY_ACTION: Record<ActionType, string[]> = {
  TRANSFER: ['recipientRaw', 'amountRaw', 'tokenRaw'],
  CONVERT: ['amountRaw', 'tokenRaw'],
  BRIDGE: ['amountRaw', 'tokenRaw', 'destinationChainRaw'],
  APPROVE: ['recipientRaw', 'amountRaw', 'tokenRaw'],
  SUPPLY: ['amountRaw', 'tokenRaw', 'providerRaw'],
  WITHDRAW: ['amountRaw', 'tokenRaw', 'providerRaw'],
  BORROW: ['amountRaw', 'tokenRaw', 'providerRaw'],
  REPAY: ['amountRaw', 'tokenRaw', 'providerRaw'],
};

function computeMissingParams(candidates: IntentCandidate[]): string[] {
  if (candidates.length === 0) return [];
  const best = candidates.reduce((prev, curr) => (curr.confidence > prev.confidence ? curr : prev));
  const required = REQUIRED_PARAMS_BY_ACTION[best.actionType] ?? [];
  return required.filter((param) => !best[param as keyof IntentCandidate]);
}

// ── Main Validation ───────────────────────────────────────────────────────────

const UNRECOGNISED_RESULT: () => IntentResult = () => ({
  displaySummary: 'Could not understand this request.',
  status: 'UNRECOGNISED',
  candidates: [],
  missingParams: [],
  parsedAt: Date.now(),
});

/**
 * Validate and sanitize a raw BFF intent response.
 * Accepts any input including null/undefined/non-objects and returns a safe, bounded IntentResult.
 *
 * NEVER passes raw LLM values through to execution.
 * All values in the result remain UntrustedString until resolved by the context layer.
 */
export function validateIntentResponse(rawInput: unknown): IntentResult {
  if (rawInput === null || rawInput === undefined || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    return UNRECOGNISED_RESULT();
  }
  const raw = rawInput as RawBffIntentResponse;

  const parsedAt =
    typeof raw.parsedAt === 'number' && raw.parsedAt > 0
      ? raw.parsedAt
      : Date.now();

  const rawCandidates = Array.isArray(raw.candidates) ? raw.candidates : [];
  const candidates = rawCandidates
    .slice(0, MAX_CANDIDATES)
    .map(sanitizeCandidate)
    .filter((c): c is IntentCandidate => c !== null);

  // If all candidates were scrubbed, status is UNRECOGNISED
  const status: IntentStatus =
    candidates.length === 0 && rawCandidates.length > 0
      ? 'UNRECOGNISED'
      : sanitizeStatus(raw.status);

  const missingFromRaw = sanitizeMissingParams(raw.missingParams);
  const missingFromCandidates = computeMissingParams(candidates);
  const missingParams = Array.from(new Set([...missingFromRaw, ...missingFromCandidates]));

  const finalStatus: IntentStatus =
    missingParams.length > 0 && status === 'RESOLVED'
      ? 'NEEDS_CLARIFICATION'
      : status;

  return {
    displaySummary: truncate(raw.displaySummary, MAX_DISPLAY_SUMMARY_LENGTH) || 'Processing your request...',
    status: finalStatus,
    candidates,
    missingParams,
    clarificationQuestion: raw.clarificationQuestion
      ? truncate(raw.clarificationQuestion, MAX_CLARIFICATION_LENGTH)
      : undefined,
    parsedAt,
  };
}
