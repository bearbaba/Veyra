import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEPLOYMENT_CHECK_RETRY_DELAYS_MS,
  DeploymentVerificationError,
  describeDeploymentCheckFailure,
  runDeploymentCheckWithRetry,
} from '../lib/deploymentCheckRetry';

const noWait = async () => {};

describe('Settlement deployment gate retry policy', () => {
  it('passes on the first success without waiting', async () => {
    let runs = 0;
    await runDeploymentCheckWithRetry(() => { runs++; return Promise.resolve(); }, { sleep: noWait });
    expect(runs).toBe(1);
  });

  it('retries a transient lookup miss and succeeds, re-running the whole check each time', async () => {
    let runs = 0;
    const retries: number[] = [];
    await runDeploymentCheckWithRetry(() => {
      runs++;
      return runs < 3 ? Promise.reject(new Error('Transaction with hash "0xabc" could not be found.')) : Promise.resolve();
    }, { sleep: noWait, onRetry: (n) => retries.push(n) });
    expect(runs).toBe(3);
    expect(retries).toEqual([1, 2]);
  });

  it('NEVER retries a genuine mismatch', async () => {
    let runs = 0;
    await expect(runDeploymentCheckWithRetry(() => {
      runs++;
      return Promise.reject(new DeploymentVerificationError('Deployment transaction, runtime, owner, USDC, fee, or pause state failed verification.'));
    }, { sleep: noWait })).rejects.toBeInstanceOf(DeploymentVerificationError);
    expect(runs).toBe(1);
  });

  it('gives up after the bounded number of retries and reports the last transient error', async () => {
    let runs = 0;
    await expect(runDeploymentCheckWithRetry(() => { runs++; return Promise.reject(new Error(`miss ${runs}`)); }, { sleep: noWait }))
      .rejects.toThrow('miss 4');
    expect(runs).toBe(1 + DEPLOYMENT_CHECK_RETRY_DELAYS_MS.length);
  });

  it('is bounded to a short, fixed total wait', () => {
    expect(DEPLOYMENT_CHECK_RETRY_DELAYS_MS.length).toBe(3);
    expect(DEPLOYMENT_CHECK_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(12_000);
  });

  it('stops immediately when the component unmounts or the inputs change', async () => {
    let runs = 0;
    let cancelled = false;
    await expect(runDeploymentCheckWithRetry(() => { runs++; cancelled = true; return Promise.reject(new Error('miss')); },
      { sleep: noWait, isCancelled: () => cancelled })).rejects.toThrow('miss');
    expect(runs).toBe(1);
  });

  it('does not report success if every attempt fails', async () => {
    let settled = false;
    await runDeploymentCheckWithRetry(() => Promise.reject(new Error('down')), { sleep: noWait })
      .then(() => { settled = true; }, () => {});
    expect(settled).toBe(false);
  });

  it('shows users a plain sentence for infrastructure errors and keeps raw text as detail', () => {
    const raw = 'Transaction with hash "0xb509" could not be found.\n\nVersion: viem@2.56.8';
    const view = describeDeploymentCheckFailure(new Error(raw));
    expect(view.summary).toMatch(/temporary network issue/);
    expect(view.summary).not.toMatch(/viem|0x/);
    expect(view.detail).toBe('Transaction with hash "0xb509" could not be found.');
  });

  it('shows a definitive mismatch verbatim with no softening', () => {
    const view = describeDeploymentCheckFailure(new DeploymentVerificationError('Creation bytecode does not match reproducible build.'));
    expect(view).toEqual({ summary: 'Creation bytecode does not match reproducible build.', detail: null });
  });
});

describe('SettlementPage wiring', () => {
  const page = readFileSync(new URL('../components/pages/SettlementPage.tsx', import.meta.url), 'utf8');

  it('runs the gate through the retry policy', () => {
    expect(page).toContain('runDeploymentCheckWithRetry(validateMainnetDeployment');
  });

  it('raises every definitive check as DeploymentVerificationError so it cannot be retried away', () => {
    const body = page.slice(page.indexOf('async function validateMainnetDeployment'), page.indexOf('useEffect(() => {', page.indexOf('async function validateMainnetDeployment')));
    for (const text of ['RPC network is not Arc Mainnet', 'Creation bytecode does not match', 'Deployment transaction, runtime, owner, USDC, fee, or pause state failed verification']) {
      const at = body.indexOf(text);
      expect(at, text).toBeGreaterThan(-1);
      expect(body.slice(Math.max(0, at - 60), at), text).toContain('new DeploymentVerificationError(');
    }
    expect(body).not.toMatch(/throw new Error\(/);
  });

  it('keeps signing disabled until the gate is verified', () => {
    expect(page).toContain("const mainnetRegistryVerified = VEYRA_ENV !== 'mainnet' || mainnetDeploymentStatus === 'verified';");
  });
});
