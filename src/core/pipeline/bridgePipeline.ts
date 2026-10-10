/**
 * Veyra Bridge Pipeline
 *
 * USDC Arc Testnet → Ethereum Sepolia / Base Sepolia via CCTP V2
 */

import type { BridgeAction } from '../actions/actionSchema';
import { validateAction } from '../actions/actionSchema';
import { evaluatePolicy, DEFAULT_VEYRA_POLICY } from '../policy/policyEngine';
import { scoreAction, getProviderRiskProfile } from '../risk/riskEngine';
import type { PolicyEvaluationResult } from '../policy/policyTypes';
import type { RiskScoringResult } from '../risk/riskTypes';
import { SECURITY_CONFIG } from '../../lib/securityConfig';
import { MANIFEST_CONSTANTS } from '../../providers/registry/providerManifest';
import type { RouteOption } from '../../providers/bridge/bridgeProviderTypes';

// ── Pipeline status ───────────────────────────────────────────────────────────

export type BridgePipelineStatus =
  | 'PENDING'
  | 'VALIDATING'
  | 'POLICY_BLOCKED'
  | 'RISK_BLOCKED'
  | 'PREFLIGHT_FAILED'
  | 'AWAITING_APPROVAL'
  | 'APPROVING'
  | 'BURNING'
  | 'BRIDGE_PENDING'
  | 'BRIDGE_UNCONFIRMED'
  | 'VERIFYING_DESTINATION'
  | 'VERIFIED'
  | 'FAILED';

export interface BridgeTrace {
  sourceChainId: number;
  destinationChainId: number;
  sourceTxHash?: string;
  destinationTxHash?: string;
  approveTxHash?: string;
  messageId?: string;
  sourceBlock?: number;
  destinationBlock?: number;
  bridgeStatus: 'BRIDGE_PENDING' | 'BRIDGE_UNCONFIRMED' | 'VERIFIED';
  createdAt: number;
  updatedAt: number;
}

export interface BridgePreflightResult {
  ok: boolean;
  sourceChainSupported: boolean;
  destinationChainSupported: boolean;
  providerHealthOk: boolean;
  quoteValid: boolean;
  detail?: string;
}

// ── Supported routes ──────────────────────────────────────────────────────────

const SUPPORTED_SOURCE_CHAINS = new Set<number>([MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID]);
const SUPPORTED_DESTINATION_CHAINS = new Set<number>([
  MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
  MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID,
]);

export function isSupportedBridgeRoute(sourceChainId: number, destinationChainId: number): boolean {
  return SUPPORTED_SOURCE_CHAINS.has(sourceChainId) && SUPPORTED_DESTINATION_CHAINS.has(destinationChainId);
}

// ── Preflight ─────────────────────────────────────────────────────────────────

export function preflightBridge(action: BridgeAction): BridgePreflightResult {
  const sourceChainSupported = SUPPORTED_SOURCE_CHAINS.has(action.sourceChainId);
  const destinationChainSupported = SUPPORTED_DESTINATION_CHAINS.has(action.destinationChainId);

  if (!sourceChainSupported) return { ok: false, sourceChainSupported, destinationChainSupported, providerHealthOk: false, quoteValid: false, detail: `Source chain ${action.sourceChainId} not supported` };
  if (!destinationChainSupported) return { ok: false, sourceChainSupported, destinationChainSupported, providerHealthOk: false, quoteValid: false, detail: `Destination chain ${action.destinationChainId} not supported` };

  const quoteValid = action.quoteExpiresAt > Date.now() + SECURITY_CONFIG.QUOTE_EXPIRY_BUFFER_MS;
  if (!quoteValid) return { ok: false, sourceChainSupported, destinationChainSupported, providerHealthOk: true, quoteValid, detail: 'Bridge quote has expired' };

  return { ok: true, sourceChainSupported, destinationChainSupported, providerHealthOk: true, quoteValid };
}

// ── Evaluation ────────────────────────────────────────────────────────────────

export interface BridgePipelineEvaluation {
  action: BridgeAction;
  policyResult: PolicyEvaluationResult;
  riskResult: RiskScoringResult;
  preflightResult: BridgePreflightResult;
  canProceed: boolean;
  blockedReason?: string;
}

export function evaluateBridgeAction(action: BridgeAction): BridgePipelineEvaluation {
  // 1. Schema
  const schemaResult = validateAction(action);
  if (!schemaResult.valid) {
    const msg = `Schema invalid: ${schemaResult.details.join('; ')}`;
    return {
      action,
      policyResult: { decision: 'BLOCKED', ruleResults: [], blockedBy: [], confirmationRequired: [] },
      riskResult: { score: 100, level: 'CRITICAL', factors: [], providerId: action.providerId, computedAt: Date.now() },
      preflightResult: { ok: false, sourceChainSupported: false, destinationChainSupported: false, providerHealthOk: false, quoteValid: false },
      canProceed: false,
      blockedReason: msg,
    };
  }

  // 2. Risk
  const riskProfile = getProviderRiskProfile(action.providerId);
  const riskResult = scoreAction({
    providerProfiles: [riskProfile],
    chainId: action.chainId,
    wasSimulated: false,
  });

  // 3. Policy
  const policyResult = evaluatePolicy(action, {
    riskScore: riskResult.score,
    simulationCompleted: false,
    quoteId: action.provenance.quoteId,
    providerId: action.providerId,
  }, DEFAULT_VEYRA_POLICY);

  if (policyResult.decision === 'BLOCKED') {
    return { action, policyResult, riskResult, preflightResult: { ok: false, sourceChainSupported: true, destinationChainSupported: true, providerHealthOk: true, quoteValid: true }, canProceed: false, blockedReason: `Policy blocked: ${policyResult.blockedBy.join(', ')}` };
  }

  if (riskResult.level === 'CRITICAL') {
    return { action, policyResult, riskResult, preflightResult: { ok: false, sourceChainSupported: true, destinationChainSupported: true, providerHealthOk: true, quoteValid: true }, canProceed: false, blockedReason: `Risk too high: CRITICAL (${riskResult.score})` };
  }

  // 4. Preflight
  const preflightResult = preflightBridge(action);
  if (!preflightResult.ok) {
    return { action, policyResult, riskResult, preflightResult, canProceed: false, blockedReason: `Preflight failed: ${preflightResult.detail ?? 'unknown'}` };
  }

  return { action, policyResult, riskResult, preflightResult, canProceed: true };
}

// ── BridgeAction factory ──────────────────────────────────────────────────────

export function createBridgeAction(params: {
  from: string;
  to: string;
  amount: bigint;
  sourceChainId: number;
  destinationChainId: number;
  tokenAddress: string;
  tokenDecimals: number;
}): BridgeAction {
  const now = Date.now();
  return {
    actionType: 'BRIDGE',
    actionId: crypto.randomUUID(),
    chainId: params.sourceChainId,
    createdAt: now,
    provenance: { source: 'USER_DIRECT', fetchedAt: now, providerId: 'cctp-v2-bridge' },
    sourceChainId: params.sourceChainId,
    destinationChainId: params.destinationChainId,
    tokenAddress: params.tokenAddress.toLowerCase(),
    tokenDecimals: params.tokenDecimals,
    amount: params.amount,
    from: params.from.toLowerCase(),
    to: params.to.toLowerCase(),
    providerId: 'cctp-v2-bridge',
    quoteExpiresAt: now + 30 * 60 * 1000,
  };
}


/**
 * Convert a reviewed provider route into the deterministic BridgeAction that
 * crosses the final execution boundary. The routeId becomes the actionId so
 * the same client intent/route cannot obtain a fresh replay identity.
 */
export function createBridgeActionFromRoute(params: {
  route: RouteOption;
  from: string;
  tokenDecimals: number;
}): BridgeAction {
  const { route } = params;

  return {
    actionType: 'BRIDGE',
    actionId: route.routeId,
    chainId: route.sourceChainId,
    createdAt: route.quotedAt,
    provenance: {
      source: 'PROVIDER_QUOTE',
      fetchedAt: route.quotedAt,
      quoteId: route.routeId,
      providerId: route.provider,
    },
    sourceChainId: route.sourceChainId,
    destinationChainId: route.destinationChainId,
    tokenAddress: route.sourceTokenAddress.toLowerCase(),
    tokenDecimals: params.tokenDecimals,
    amount: route.amountIn,
    from: params.from.toLowerCase(),
    to: route.destinationAddress.toLowerCase(),
    providerId: route.provider,
    quoteExpiresAt: route.expiresAt,
  };
}
