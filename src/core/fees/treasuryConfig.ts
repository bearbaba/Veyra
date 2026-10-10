export type TreasuryEnvironment = 'testnet' | 'mainnet';

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function normalizeTreasuryAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return EVM_ADDRESS.test(trimmed) ? trimmed : null;
}

/**
 * Treasury addresses are public configuration, never signing secrets.
 *
 * Separate testnet/mainnet variables prevent accidental revenue routing across
 * environments. Missing/invalid configuration disables Veyra fee collection;
 * it must never redirect to a deployer or personal wallet as a fallback.
 */
export function configuredVeyraTreasuryAddress(
  environment: TreasuryEnvironment,
): string | null {
  const raw = environment === 'mainnet'
    ? import.meta.env.VITE_VEYRA_TREASURY_MAINNET_ADDRESS
    : import.meta.env.VITE_VEYRA_TREASURY_TESTNET_ADDRESS;
  return normalizeTreasuryAddress(raw);
}

export function validateVeyraTreasuryAddress(address: string): string {
  const normalized = normalizeTreasuryAddress(address);
  if (!normalized) throw new Error('Invalid Veyra Treasury EVM address');
  return normalized;
}
