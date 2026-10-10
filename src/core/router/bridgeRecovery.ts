export type AppKitBridgeRecoveryMode = 'NONE' | 'RETRY_BRIDGE' | 'START_NEW_AFTER_FIX';

export interface AppKitBridgeStepSnapshot {
  name: string;
  state: string;
  txHash?: string;
  error?: unknown;
}

export interface AppKitBridgeRecoveryPlan {
  mode: AppKitBridgeRecoveryMode;
  resultState: string;
  fundsInFlight: boolean;
  sourceTransferSubmitted: boolean;
  completedSteps: string[];
  failedStep: string | null;
  nextAction: string;
}

/**
 * Circle App Kit returns partial bridge step state after soft failures.
 * Once the source value-moving step (burn/transfer) was submitted, Veyra must
 * never start a brand-new bridge. Recovery must resume the existing result via
 * retryBridge() so an already completed source movement is not duplicated.
 */
export function analyzeAppKitBridgeRecovery(result: unknown): AppKitBridgeRecoveryPlan {
  const record = (result && typeof result === 'object') ? result as Record<string, unknown> : {};
  const resultState = typeof record.state === 'string' ? record.state : 'unknown';
  const rawSteps = Array.isArray(record.steps) ? record.steps : [];
  const steps: AppKitBridgeStepSnapshot[] = rawSteps
    .filter((step): step is Record<string, unknown> => Boolean(step) && typeof step === 'object')
    .map((step) => ({
      name: typeof step.name === 'string' ? step.name : 'unknown',
      state: typeof step.state === 'string' ? step.state : 'unknown',
      ...(typeof step.txHash === 'string' ? { txHash: step.txHash } : {}),
      ...('error' in step ? { error: step.error } : {}),
    }));

  const completedSteps = steps.filter((step) => step.state === 'success').map((step) => step.name);
  const failed = steps.find((step) => step.state === 'error') ?? null;

  // USDC CCTP uses burn; CCTPx uses transfer. Treat a tx hash as submitted
  // even if the SDK step did not reach its final success state.
  const sourceTransfer = steps.find((step) => step.name === 'burn' || step.name === 'transfer');
  const sourceTransferSubmitted = Boolean(
    sourceTransfer && (sourceTransfer.state === 'success' || sourceTransfer.txHash),
  );
  const fundsInFlight = sourceTransferSubmitted;

  if (resultState === 'success') {
    return {
      mode: 'NONE',
      resultState,
      fundsInFlight,
      sourceTransferSubmitted,
      completedSteps,
      failedStep: null,
      nextAction: 'Verify destination state and persist the final Veyra receipt.',
    };
  }

  if (fundsInFlight) {
    return {
      mode: 'RETRY_BRIDGE',
      resultState,
      fundsInFlight: true,
      sourceTransferSubmitted: true,
      completedSteps,
      failedStep: failed?.name ?? null,
      nextAction:
        'Resume this exact bridge result with App Kit retryBridge(). Never submit a new bridge/burn.',
    };
  }

  if (resultState === 'error') {
    return {
      mode: 'START_NEW_AFTER_FIX',
      resultState,
      fundsInFlight: false,
      sourceTransferSubmitted: false,
      completedSteps,
      failedStep: failed?.name ?? null,
      nextAction:
        'No source transfer was submitted. Fix the reported cause, obtain a fresh review/quote, then the user may start a new bridge.',
    };
  }

  return {
    mode: 'NONE',
    resultState,
    fundsInFlight: false,
    sourceTransferSubmitted: false,
    completedSteps,
    failedStep: failed?.name ?? null,
    nextAction: 'Wait for a terminal bridge state before choosing a recovery action.',
  };
}

export function assertRetryBridgeAllowed(result: unknown): void {
  const recovery = analyzeAppKitBridgeRecovery(result);
  if (recovery.mode !== 'RETRY_BRIDGE') {
    throw new Error(
      `App Kit bridge retry is not allowed for state "${recovery.resultState}" (${recovery.mode}).`,
    );
  }
}
