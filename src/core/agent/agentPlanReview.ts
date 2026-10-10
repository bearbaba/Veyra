import type {
  CapabilityIntentGraph,
  CapabilityIntentNode,
} from './intentGraph';
import { buildRegistryRoutePlan } from '../router/registryRouteCandidates';
import type {
  RegistryRouteRequest,
} from '../router/registryRouteCandidates';
import type {
  RouteCandidate,
  RoutePreference,
} from '../router/routeTypes';

export type AgentPlanNodeStatus =
  | 'INTERNAL'
  | 'ROUTED'
  | 'NEEDS_CONTEXT'
  | 'NO_EXECUTABLE_ROUTE'
  | 'BLOCKED_DEPENDENCY';

export interface AgentPlanNodeReview {
  nodeId: string;
  capability: CapabilityIntentNode['capability'];
  sourceText: string;
  status: AgentPlanNodeStatus;
  selectedRoute: RouteCandidate | null;
  alternativeCount: number;
  rejectedCount: number;
  walletSignatures: number;
  veyraAddedSignatures: 0;
  manualNetworkSwitches: number;
  explanation: string;
  dependsOn: string[];
}

export interface AgentPlanReview {
  raw: string;
  readyForReview: boolean;
  totalWalletSignatures: number;
  veyraAddedSignatures: 0;
  totalManualNetworkSwitches: number;
  nodes: AgentPlanNodeReview[];
}

export interface AgentPlanReviewContext {
  /**
   * Fully deterministic, caller-resolved route requests keyed by intent node ID.
   * The Agent never invents balances, addresses, networks, provider facts,
   * allowance, fee, ETA or health data.
   */
  routeRequests: Readonly<Record<string, RegistryRouteRequest | undefined>>;
  preference?: RoutePreference;
}

function internalNode(node: CapabilityIntentNode): AgentPlanNodeReview {
  return {
    nodeId: node.nodeId,
    capability: node.capability,
    sourceText: node.sourceText,
    status: 'INTERNAL',
    selectedRoute: null,
    alternativeCount: 0,
    rejectedCount: 0,
    walletSignatures: 0,
    veyraAddedSignatures: 0,
    manualNetworkSwitches: 0,
    explanation:
      node.capability === 'RESERVE'
        ? 'Reserve is a deterministic planning constraint and adds no wallet signature.'
        : 'Identity resolution is internal planning context and adds no wallet signature.',
    dependsOn: [...node.dependsOn],
  };
}

function dependencyBlocked(
  node: CapabilityIntentNode,
  dependencyId: string,
): AgentPlanNodeReview {
  return {
    nodeId: node.nodeId,
    capability: node.capability,
    sourceText: node.sourceText,
    status: 'BLOCKED_DEPENDENCY',
    selectedRoute: null,
    alternativeCount: 0,
    rejectedCount: 0,
    walletSignatures: 0,
    veyraAddedSignatures: 0,
    manualNetworkSwitches: 0,
    explanation: `Blocked because dependency ${dependencyId} is not reviewable.`,
    dependsOn: [...node.dependsOn],
  };
}

/**
 * Connects Agent intent nodes to deterministic registry routing.
 *
 * The graph may come from local parsing or an LLM, but nothing in this layer
 * trusts raw Agent values. A financial node is reviewable only when its caller
 * supplies an already-resolved RegistryRouteRequest. Missing context blocks the
 * node instead of guessing.
 */
export function buildAgentPlanReview(
  graph: CapabilityIntentGraph,
  context: AgentPlanReviewContext,
): AgentPlanReview {
  const preference = context.preference ?? 'BALANCED';
  const reviews: AgentPlanNodeReview[] = [];
  const statusByNodeId = new Map<string, AgentPlanNodeStatus>();

  for (const node of graph.nodes) {
    const badDependency = node.dependsOn.find((dependencyId) => {
      const status = statusByNodeId.get(dependencyId);
      return status !== undefined && status !== 'ROUTED' && status !== 'INTERNAL';
    });

    if (badDependency) {
      const review = dependencyBlocked(node, badDependency);
      reviews.push(review);
      statusByNodeId.set(node.nodeId, review.status);
      continue;
    }

    if (node.capability === 'RESERVE' || node.capability === 'IDENTITY') {
      const review = internalNode(node);
      reviews.push(review);
      statusByNodeId.set(node.nodeId, review.status);
      continue;
    }

    const routeRequest = context.routeRequests[node.nodeId];
    if (!routeRequest) {
      const review: AgentPlanNodeReview = {
        nodeId: node.nodeId,
        capability: node.capability,
        sourceText: node.sourceText,
        status: 'NEEDS_CONTEXT',
        selectedRoute: null,
        alternativeCount: 0,
        rejectedCount: 0,
        walletSignatures: 0,
        veyraAddedSignatures: 0,
        manualNetworkSwitches: 0,
        explanation:
          'Deterministic route context is incomplete. Veyra will not guess network, asset, balance, provider, fee, allowance or recipient data.',
        dependsOn: [...node.dependsOn],
      };
      reviews.push(review);
      statusByNodeId.set(node.nodeId, review.status);
      continue;
    }

    if (routeRequest.capability !== node.capability) {
      const review: AgentPlanNodeReview = {
        nodeId: node.nodeId,
        capability: node.capability,
        sourceText: node.sourceText,
        status: 'NEEDS_CONTEXT',
        selectedRoute: null,
        alternativeCount: 0,
        rejectedCount: 0,
        walletSignatures: 0,
        veyraAddedSignatures: 0,
        manualNetworkSwitches: 0,
        explanation:
          `Resolved route capability ${routeRequest.capability} does not match Agent node capability ${node.capability}.`,
        dependsOn: [...node.dependsOn],
      };
      reviews.push(review);
      statusByNodeId.set(node.nodeId, review.status);
      continue;
    }

    const plan = buildRegistryRoutePlan(routeRequest, preference);
    const selected = plan.selected;

    if (!selected) {
      const review: AgentPlanNodeReview = {
        nodeId: node.nodeId,
        capability: node.capability,
        sourceText: node.sourceText,
        status: 'NO_EXECUTABLE_ROUTE',
        selectedRoute: null,
        alternativeCount: plan.alternatives.length,
        rejectedCount: plan.rejected.length,
        walletSignatures: 0,
        veyraAddedSignatures: 0,
        manualNetworkSwitches: 0,
        explanation:
          plan.rejected.length > 0
            ? `No executable route. ${plan.rejected.map((candidate) => `${candidate.providerId}: ${candidate.rejectionReason ?? 'rejected'}`).join('; ')}`
            : 'No registered route exists for this resolved action.',
        dependsOn: [...node.dependsOn],
      };
      reviews.push(review);
      statusByNodeId.set(node.nodeId, review.status);
      continue;
    }

    const review: AgentPlanNodeReview = {
      nodeId: node.nodeId,
      capability: node.capability,
      sourceText: node.sourceText,
      status: 'ROUTED',
      selectedRoute: selected,
      alternativeCount: plan.alternatives.length,
      rejectedCount: plan.rejected.length,
      walletSignatures: selected.ux.protocolSignatures,
      veyraAddedSignatures: 0,
      manualNetworkSwitches: selected.ux.manualNetworkSwitches,
      explanation: selected.explanation,
      dependsOn: [...node.dependsOn],
    };
    reviews.push(review);
    statusByNodeId.set(node.nodeId, review.status);
  }

  const readyForReview = reviews.every(
    (node) => node.status === 'ROUTED' || node.status === 'INTERNAL',
  );
  const totalWalletSignatures = reviews.reduce(
    (sum, node) => sum + node.walletSignatures,
    0,
  );
  const totalManualNetworkSwitches = reviews.reduce(
    (sum, node) => sum + node.manualNetworkSwitches,
    0,
  );

  return {
    raw: graph.raw,
    readyForReview,
    totalWalletSignatures,
    veyraAddedSignatures: 0,
    totalManualNetworkSwitches,
    nodes: reviews,
  };
}
