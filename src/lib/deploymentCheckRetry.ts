/**
 * Retry policy for the Mainnet Settlement deployment gate.
 *
 * The gate re-reads the deployment transaction, receipt, runtime code, owner, USDC,
 * fee and pause state and compares each with the reviewed values. Public RPC nodes
 * are load balanced and an old transaction lookup can transiently return "not found"
 * (observed: a few `null` answers for the deployment transaction while every other
 * lookup was fine, then none). Failing the whole session closed on that is safe
 * but wrong: the user is told signing is disabled until they click Retry.
 *
 * Rule: only INFRASTRUCTURE failures are retried, and each retry runs the complete,
 * identical verification again. A genuine mismatch is a DeploymentVerificationError
 * and is never retried. Signing stays disabled until a full pass succeeds.
 */
export class DeploymentVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeploymentVerificationError';
  }
}

/** Waits between attempts: three retries, about ten seconds in total. */
export const DEPLOYMENT_CHECK_RETRY_DELAYS_MS: readonly number[] = [1500, 3000, 6000];

export interface DeploymentCheckRetryOptions {
  delays?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  isCancelled?: () => boolean;
  /** Called before each wait, with the number of the retry about to start (1-based). */
  onRetry?: (retry: number, total: number) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runDeploymentCheckWithRetry(
  run: () => Promise<void>,
  options: DeploymentCheckRetryOptions = {},
): Promise<void> {
  const delays = options.delays ?? DEPLOYMENT_CHECK_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      await run();
      return;
    } catch (error) {
      if (error instanceof DeploymentVerificationError) throw error;   // definitive: never retry
      if (options.isCancelled?.() || attempt >= delays.length) throw error;
      options.onRetry?.(attempt + 1, delays.length);
      await sleep(delays[attempt] ?? 0);
      if (options.isCancelled?.()) throw error;
    }
  }
}

export interface DeploymentCheckFailureView {
  /** One plain sentence for the user. */
  summary: string;
  /** Raw technical text for an expandable section, or null when the summary says it all. */
  detail: string | null;
}

export function describeDeploymentCheckFailure(error: unknown): DeploymentCheckFailureView {
  if (error instanceof DeploymentVerificationError) {
    return { summary: error.message, detail: null };
  }
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const firstLine = raw.split('\n')[0]?.trim().slice(0, 240) ?? '';
  return {
    summary: 'Could not confirm the contract on Arc Mainnet. This is usually a temporary network issue. Signing stays disabled until it is confirmed.',
    detail: firstLine || null,
  };
}
