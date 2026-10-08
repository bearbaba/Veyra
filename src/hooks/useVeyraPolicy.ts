/**
 * useVeyraPolicy
 * Returns the active Veyra policy.
 * Phase C: static default. Phase D: loaded from user settings / IndexedDB.
 */
import { DEFAULT_VEYRA_POLICY } from '../core/policy/policyEngine';
import type { VeyraPolicy } from '../core/policy/policyTypes';

export function useVeyraPolicy(): { policy: VeyraPolicy } {
  return { policy: DEFAULT_VEYRA_POLICY };
}
