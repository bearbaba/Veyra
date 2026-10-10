import type { VeyraCapability } from '../capabilities/capabilityTypes';

export type NetworkFamily = 'EVM' | 'SOLANA' | 'OTHER';

/**
 * Product-layer network reference. Numeric chainId is optional so the router is
 * not structurally limited to EVM networks.
 */
export interface NetworkRef {
  networkId: string;
  displayName: string;
  family: NetworkFamily;
  chainId?: number;
}

export type RoutePreference = 'SAFE' | 'BALANCED' | 'FAST';

export interface RouteMoneyCost {
  feeUsd?: number;
  etaSeconds?: number;
}

export interface RouteUxCost {
  /** Signatures required by the actual wallet/protocol flow. */
  protocolSignatures: number;
  /** Must always remain zero. Veyra review/policy/receipt never require signing. */
  veyraAddedSignatures: number;
  /** Manual network changes the user has to perform themselves. */
  manualNetworkSwitches: number;
  /** Non-wallet confirmation clicks after the one plan review. */
  extraManualConfirmations: number;
}

export interface RouteCandidate {
  routeId: string;
  capability: VeyraCapability;
  providerId: string;
  source: NetworkRef;
  destination?: NetworkRef;
  eligible: boolean;
  rejectionReason?: string;
  riskScore: number;
  health: 'OK' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';
  ux: RouteUxCost;
  cost: RouteMoneyCost;
  /** Short, deterministic explanation shown in “Why this route?”. */
  explanation: string;
}

export interface RoutePlan {
  selected: RouteCandidate | null;
  alternatives: RouteCandidate[];
  rejected: RouteCandidate[];
  preference: RoutePreference;
}
