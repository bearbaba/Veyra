import { hydrateQuoteReplayStore } from '../core/receipt/quoteReplayStore';
import { validateEnv } from './env';
import {
  markSecurityGateFailed,
  markSecurityGateReady,
  resetSecurityGate,
} from './securityGate';

let bootstrapPromise: Promise<void> | null = null;

/**
 * Hydrate all security-critical browser state before execution is allowed.
 *
 * The app may render while this is running, but every fund-moving path must
 * fail closed through assertExecutionReady() until the gate reaches READY.
 * Initialization is idempotent so React StrictMode or repeated callers cannot
 * race multiple hydrations.
 */
export function initializeSecurityRuntime(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;

  resetSecurityGate();

  bootstrapPromise = (async () => {
    try {
      validateEnv();
      await hydrateQuoteReplayStore();
      markSecurityGateReady();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      markSecurityGateFailed(message);
      throw error;
    }
  })();

  return bootstrapPromise;
}

/** Test-only helper. Do not call from product code. */
export function resetSecurityRuntimeBootstrapForTesting(): void {
  bootstrapPromise = null;
}
