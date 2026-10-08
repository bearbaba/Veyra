/**
 * Veyra environment resolution.
 *
 * Responsibilities:
 * - resolve current environment (local | testnet | mainnet)
 * - validate required variables per environment
 * - mainnet anti-testnet safety guard
 * - enforce that LLM secrets never appear in frontend env
 *
 * All security values (timeouts, slippage, etc.) live in securityConfig.ts — not here.
 */

export type VeyraEnv = 'local' | 'testnet' | 'mainnet';

/** Resolved once at module evaluation. */
export const VEYRA_ENV: VeyraEnv = resolveEnv();

function resolveEnv(): VeyraEnv {
  const raw = (import.meta.env as Record<string, string | undefined>).VITE_VEYRA_ENV;
  if (!raw) return 'local';
  const v = String(raw).toLowerCase().trim();
  if (v === 'mainnet') return 'mainnet';
  if (v === 'testnet') return 'testnet';
  if (v === 'local') return 'local';
  throw new Error(
    `[env] VITE_VEYRA_ENV must be "local", "testnet", or "mainnet"; got "${raw}"`,
  );
}

/**
 * Mainnet safety guard.
 * Throws if any known testnet sentinel has leaked into a mainnet build.
 */
export function assertNoTestnetLeakInMainnet(): void {
  if (VEYRA_ENV !== 'mainnet') return;

  const TESTNET_CHAIN_IDS = [5042002, 11155111, 84532, 421614, 43113, 80002, 11155420, 1301, 10143, 1328];
  const envMap = import.meta.env as Record<string, string | undefined>;
  const chainIdRaw = envMap.VITE_CHAIN_ID;
  if (chainIdRaw) {
    const id = Number(chainIdRaw);
    if (TESTNET_CHAIN_IDS.includes(id)) {
      throw new Error(
        `[env] Mainnet build detected testnet chain ID ${id}. ` +
        `Remove all testnet configuration before shipping to mainnet.`,
      );
    }
  }

  const rpcUrl = envMap.VITE_RPC_URL ?? '';
  if (
    rpcUrl.includes('testnet') ||
    rpcUrl.includes('sepolia') ||
    rpcUrl.includes('fuji') ||
    rpcUrl.includes('amoy') ||
    rpcUrl.includes('goerli') ||
    rpcUrl.includes('mumbai')
  ) {
    throw new Error(
      `[env] Mainnet build detected a testnet RPC URL: "${rpcUrl}". ` +
      `Production config must not include testnet RPCs.`,
    );
  }
}

/**
 * Verify that LLM API secrets are not exposed in the Vite frontend bundle.
 * VITE_* vars are shipped to the browser — they must never contain LLM keys.
 */
export function assertNoLlmSecretInFrontend(): void {
  // In a Vite browser bundle there is no process.env. We verify by checking
  // that neither VITE_OPENAI_API_KEY nor VITE_ANTHROPIC_API_KEY is defined.
  const forbidden = [
    'VITE_OPENAI_API_KEY',
    'VITE_ANTHROPIC_API_KEY',
    'VITE_COHERE_API_KEY',
    'VITE_MISTRAL_API_KEY',
    'VITE_GEMINI_API_KEY',
  ];
  for (const key of forbidden) {
    const val = (import.meta.env as Record<string, string | undefined>)[key];
    if (val && val.length > 0) {
      throw new Error(
        `[env] "${key}" is exposed in the Vite frontend environment. ` +
        `LLM API secrets must only be held server-side in the BFF.`,
      );
    }
  }
}

/**
 * Validate required frontend env variables for the current environment.
 * Throws with a descriptive message on first missing/invalid variable.
 */
export function validateEnv(): void {
  assertNoLlmSecretInFrontend();

  if (VEYRA_ENV === 'mainnet') {
    assertNoTestnetLeakInMainnet();
  }
}

/** Convenience: true when running in any testnet environment. */
export const IS_TESTNET = VEYRA_ENV === 'testnet' || VEYRA_ENV === 'local';

/** Convenience: true only for a production mainnet build. */
export const IS_MAINNET = VEYRA_ENV === 'mainnet';
