export type TreasuryEnvironment = 'testnet' | 'mainnet';

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * Canonical Veyra testnet revenue wallet.
 *
 * This address is public configuration only. It is intentionally safe to keep
 * in source control because no private key, seed phrase, signer material, or
 * credential is stored here.
 */
export const VEYRA_TESTNET_TREASURY_ADDRESS =
  '0xD6b8A3A5eB329410D9504784812b8569afA8C2aF' as const;

export type TreasuryAddressSource =
  | 'ENVIRONMENT_OVERRIDE'
  | 'DEFAULT_TESTNET'
  | 'UNCONFIGURED';

export interface ResolvedVeyraTreasury {
  environment: TreasuryEnvironment;
  address: string | null;
  source: TreasuryAddressSource;
}

function normalizeTreasuryAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return EVM_ADDRESS.test(trimmed) ? trimmed : null;
}

/**
 * Pure resolver used by tests and by the runtime configuration boundary.
 *
 * Rules:
 * - a valid explicit environment value wins;
 * - an invalid non-empty environment value fails closed;
 * - testnet falls back to the committed canonical testnet Treasury;
 * - mainnet has no fallback and remains disabled until a Safe/multisig address
 *   is deliberately configured.
 */
export function resolveVeyraTreasuryAddress(
  environment: TreasuryEnvironment,
  environmentValue?: unknown,
): ResolvedVeyraTreasury {
  if (typeof environmentValue === 'string' && environmentValue.trim().length > 0) {
    const address = normalizeTreasuryAddress(environmentValue);
    return {
      environment,
      address,
      source: address ? 'ENVIRONMENT_OVERRIDE' : 'UNCONFIGURED',
    };
  }

  if (environment === 'testnet') {
    return {
      environment,
      address: VEYRA_TESTNET_TREASURY_ADDRESS,
      source: 'DEFAULT_TESTNET',
    };
  }

  return {
    environment,
    address: null,
    source: 'UNCONFIGURED',
  };
}

/**
 * Treasury addresses are public configuration, never signing secrets.
 *
 * Testnet has a canonical committed Treasury so fee collection works without a
 * local .env file. Mainnet deliberately remains environment-only and fails
 * closed until a dedicated multisig/Safe address is configured.
 */
export function configuredVeyraTreasuryAddress(
  environment: TreasuryEnvironment,
): string | null {
  const raw = environment === 'mainnet'
    ? import.meta.env.VITE_VEYRA_TREASURY_MAINNET_ADDRESS
    : import.meta.env.VITE_VEYRA_TREASURY_TESTNET_ADDRESS;

  return resolveVeyraTreasuryAddress(environment, raw).address;
}

export function validateVeyraTreasuryAddress(address: string): string {
  const normalized = normalizeTreasuryAddress(address);
  if (!normalized) throw new Error('Invalid Veyra Treasury EVM address');
  return normalized;
}
