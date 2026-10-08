/**
 * useVeyraRiskProfile
 * Returns a mapping of static provider risk profiles for the UI.
 * Phase C: static. Phase D: live data augmentation.
 */
import { STATIC_PROVIDER_RISK_PROFILES } from '../core/risk/riskEngine';
import type { ProviderRiskProfile } from '../core/risk/riskTypes';

export function useVeyraRiskProfile(): { profiles: Record<string, ProviderRiskProfile> } {
  return { profiles: STATIC_PROVIDER_RISK_PROFILES };
}
