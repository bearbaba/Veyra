/**
 * Veyra Security Initialization Gate
 *
 * No executable financial action may proceed until the gate reaches READY.
 * FAILED is a terminal state — the application must prompt the user to reload.
 *
 * States:
 *   PENDING  → hydration in progress
 *   READY    → all security stores hydrated successfully
 *   FAILED   → hydration failed; execution must be disabled
 */

import { SECURITY_CONFIG } from './securityConfig';

export type SecurityGateState = 'PENDING' | 'READY' | 'FAILED';

export interface SecurityGateStatus {
  state: SecurityGateState;
  failureReason?: string;
  readyAt?: number;
}

type SecurityGateListener = (status: SecurityGateStatus) => void;

let _status: SecurityGateStatus = { state: 'PENDING' };
const _listeners: Set<SecurityGateListener> = new Set();
let _timeoutHandle: ReturnType<typeof setTimeout> | null = null;

function notify(): void {
  for (const listener of _listeners) {
    try {
      listener({ ..._status });
    } catch {
      // listener errors must not crash the gate
    }
  }
}

/**
 * Register a listener that is called whenever gate state changes.
 * Returns an unsubscribe function.
 */
export function onSecurityGateChange(listener: SecurityGateListener): () => void {
  _listeners.add(listener);
  // Immediately deliver current state to the new listener
  try {
    listener({ ..._status });
  } catch {
    // ignore
  }
  return () => {
    _listeners.delete(listener);
  };
}

/** Returns a snapshot of the current gate status. */
export function getSecurityGateStatus(): SecurityGateStatus {
  return { ..._status };
}

/** True only when the gate is READY — call this before any financial action. */
export function isSecurityGateReady(): boolean {
  return _status.state === 'READY';
}

/**
 * Transition the gate to READY.
 * Called by the security initialization orchestrator after all stores hydrate.
 */
export function markSecurityGateReady(): void {
  if (_status.state === 'FAILED') return; // terminal — cannot recover
  if (_timeoutHandle !== null) {
    clearTimeout(_timeoutHandle);
    _timeoutHandle = null;
  }
  _status = { state: 'READY', readyAt: Date.now() };
  notify();
}

/**
 * Transition the gate to FAILED with a reason.
 * This is a terminal state. The UI must show a hard error requiring reload.
 */
export function markSecurityGateFailed(reason: string): void {
  if (_timeoutHandle !== null) {
    clearTimeout(_timeoutHandle);
    _timeoutHandle = null;
  }
  _status = { state: 'FAILED', failureReason: reason };
  notify();
}

/**
 * Reset the gate back to PENDING and start the timeout.
 * Used at application startup or explicit reinitialisation.
 */
export function resetSecurityGate(): void {
  if (_timeoutHandle !== null) {
    clearTimeout(_timeoutHandle);
    _timeoutHandle = null;
  }
  _status = { state: 'PENDING' };

  // Automatically fail if hydration takes too long
  _timeoutHandle = setTimeout(() => {
    if (_status.state === 'PENDING') {
      markSecurityGateFailed(
        `Security gate hydration timed out after ${SECURITY_CONFIG.SECURITY_GATE_TIMEOUT_MS}ms`,
      );
    }
  }, SECURITY_CONFIG.SECURITY_GATE_TIMEOUT_MS);

  notify();
}

/**
 * Assert that the security gate is READY before proceeding with a financial action.
 * Throws a descriptive error if not ready.
 */
export function assertSecurityGateReady(): void {
  if (_status.state === 'READY') return;
  if (_status.state === 'FAILED') {
    throw new Error(
      `[securityGate] Security initialization failed: ${_status.failureReason ?? 'unknown reason'}. ` +
      `Reload the application to retry.`,
    );
  }
  throw new Error(
    '[securityGate] Security stores have not finished initializing. ' +
    'Financial actions cannot proceed until the security gate is READY.',
  );
}
