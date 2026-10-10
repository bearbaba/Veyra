import type { VeyraCapability } from '../capabilities/capabilityTypes';
import type { RouteUxCost } from './routeTypes';

export type AllowanceState = 'SUFFICIENT' | 'INSUFFICIENT' | 'UNKNOWN';
export type SignatureOperation =
  | 'PAY'
  | 'BRIDGE'
  | 'UNIFIED_DEPOSIT'
  | 'UNIFIED_SPEND'
  | 'SWAP'
  | 'EARN_DISCOVER'
  | 'EARN_DEPOSIT'
  | 'EARN_POSITION'
  | 'EARN_WITHDRAW'
  | 'ONRAMP'
  | 'IDENTITY'
  | 'RESERVE';

export interface SignatureBudgetContext {
  capability: VeyraCapability;
  providerId: string;
  operation?: SignatureOperation;
  allowance?: AllowanceState;
  /** True when Circle/provider relays the destination leg. */
  destinationRelayAvailable?: boolean;
  /** True when Veyra can request the source network directly from the wallet. */
  sourceSwitchAutomated?: boolean;
  /** True when the underlying protocol itself requires another confirmation click. */
  extraManualConfirmations?: number;
}

export interface SignatureBudget extends RouteUxCost {
  sourceSignatures: number;
  destinationSignatures: number;
  explanation: string;
}

function approvalSignatures(allowance: AllowanceState | undefined): number {
  // Unknown must be budgeted conservatively; never promise a one-sign flow
  // until allowance/authorization state has been read.
  return allowance === 'SUFFICIENT' ? 0 : 1;
}

function operationFor(input: SignatureBudgetContext): SignatureOperation {
  if (input.operation) return input.operation;
  switch (input.capability) {
    case 'PAY': return 'PAY';
    case 'BRIDGE': return 'BRIDGE';
    case 'UNIFIED': return 'UNIFIED_SPEND';
    case 'SWAP': return 'SWAP';
    case 'EARN': return 'EARN_DEPOSIT';
    case 'ONRAMP': return 'ONRAMP';
    case 'IDENTITY': return 'IDENTITY';
    case 'RESERVE': return 'RESERVE';
  }
}

/**
 * Deterministic upper-bound wallet signature budget used during routing.
 *
 * It counts user wallet signature prompts, not Veyra UI confirmations.
 * Veyra-added signatures are hard-coded to zero.
 */
export function estimateSignatureBudget(input: SignatureBudgetContext): SignatureBudget {
  const operation = operationFor(input);
  const approval = approvalSignatures(input.allowance);
  const sourceSwitchAutomated = input.sourceSwitchAutomated !== false;
  const relayed = input.destinationRelayAvailable === true;

  let sourceSignatures = 0;
  let destinationSignatures = 0;
  let explanation = 'No wallet signature is required for this planning/read-only action.';

  switch (operation) {
    case 'PAY':
      sourceSignatures = 1;
      explanation = 'Direct payment requires the protocol transfer signature only.';
      break;
    case 'BRIDGE':
      sourceSignatures = approval + 1; // optional approval + source bridge/burn
      destinationSignatures = relayed ? 0 : 1;
      explanation = relayed
        ? `Bridge uses ${sourceSignatures} source signature(s); destination relay removes the destination signature.`
        : `Bridge budgets ${sourceSignatures} source signature(s) plus one destination signature because no relay is confirmed.`;
      break;
    case 'UNIFIED_DEPOSIT':
      // authorize / permit can be a single user authorization. Traditional
      // approve is conservatively represented by allowance state + deposit.
      sourceSignatures = input.allowance === 'INSUFFICIENT' ? 2 : 1;
      explanation = input.allowance === 'INSUFFICIENT'
        ? 'Unified deposit conservatively budgets approval plus deposit.'
        : 'Unified deposit budgets one authorization/signing step.';
      break;
    case 'UNIFIED_SPEND':
      sourceSignatures = 1;
      destinationSignatures = relayed ? 0 : 1;
      explanation = relayed
        ? 'Unified spend uses one source signing context; forwarding removes destination signing.'
        : 'Unified spend requires a destination signature when forwarding is unavailable.';
      break;
    case 'SWAP':
      sourceSignatures = approval + 1;
      explanation = approval === 0
        ? 'Existing allowance permits a one-sign swap execution.'
        : 'Swap budget includes token approval/authorization plus execution.';
      break;
    case 'EARN_DEPOSIT':
      sourceSignatures = approval + 1;
      explanation = approval === 0
        ? 'Existing allowance permits a one-sign Earn deposit.'
        : 'Earn deposit budget includes token approval plus deposit.';
      break;
    case 'EARN_WITHDRAW':
      sourceSignatures = 1;
      explanation = 'Earn withdrawal budgets the vault withdrawal signature only.';
      break;
    case 'EARN_DISCOVER':
    case 'EARN_POSITION':
      explanation = 'Earn discovery/position reads are signature-free.';
      break;
    case 'ONRAMP':
      // Provider-specific fiat authorization is not a wallet signature and is
      // intentionally not guessed here.
      explanation = 'Onramp wallet signature budget is provider-specific and not guessed.';
      break;
    case 'IDENTITY':
    case 'RESERVE':
      explanation = 'Identity and reserve planning add no wallet signatures.';
      break;
  }

  const protocolSignatures = sourceSignatures + destinationSignatures;
  const manualNetworkSwitches =
    (sourceSignatures > 0 && !sourceSwitchAutomated ? 1 : 0) +
    (destinationSignatures > 0 ? 1 : 0);

  return {
    protocolSignatures,
    veyraAddedSignatures: 0,
    manualNetworkSwitches,
    extraManualConfirmations: input.extraManualConfirmations ?? 0,
    sourceSignatures,
    destinationSignatures,
    explanation,
  };
}

export function assertZeroVeyraSignatures(budget: SignatureBudget): void {
  if (budget.veyraAddedSignatures !== 0) {
    throw new Error('Veyra-added wallet signatures must remain zero');
  }
}
