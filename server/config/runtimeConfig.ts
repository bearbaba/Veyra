/**
 * Server-side deployment configuration and production safety gates.
 * Secrets are read only from process.env and are never serialized to clients.
 */
export type ServerEnvironment = 'local' | 'testnet' | 'mainnet';
export type SignerBackend = 'none' | 'dev-private-key' | 'kms';

export interface ServerRuntimeConfig {
  environment: ServerEnvironment;
  nodeEnv: string;
  databaseUrl?: string;
  appOrigin?: string;
  sessionSecretConfigured: boolean;
  signerBackend: SignerBackend;
  kmsKeyId?: string;
  signerUrl?: string;
  signerAuthTokenConfigured: boolean;
  xClientIdConfigured: boolean;
  xRedirectUri?: string;
}

export interface RuntimeValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const TESTNET_MARKERS = ['testnet', 'sepolia', 'fuji', 'amoy', 'goerli', 'mumbai'];

export function resolveServerEnvironment(env: NodeJS.ProcessEnv = process.env): ServerEnvironment {
  const raw = (env.VEYRA_ENV ?? 'local').trim().toLowerCase();
  if (raw === 'local' || raw === 'testnet' || raw === 'mainnet') return raw;
  throw new Error(`[runtime-config] VEYRA_ENV must be local, testnet, or mainnet; got "${raw}"`);
}

function resolveSignerBackend(env: NodeJS.ProcessEnv): SignerBackend {
  const raw = (env.VEYRA_SIGNER_BACKEND ?? '').trim().toLowerCase();
  if (raw === 'kms') return 'kms';
  if (raw === 'dev-private-key') return 'dev-private-key';
  return env.RELAY_PRIVATE_KEY ? 'dev-private-key' : 'none';
}

export function readServerRuntimeConfig(env: NodeJS.ProcessEnv = process.env): ServerRuntimeConfig {
  return {
    environment: resolveServerEnvironment(env),
    nodeEnv: env.NODE_ENV ?? 'development',
    databaseUrl: env.DATABASE_URL,
    appOrigin: env.VEYRA_APP_ORIGIN,
    sessionSecretConfigured: Boolean(env.VEYRA_SESSION_SECRET && env.VEYRA_SESSION_SECRET.length >= 32),
    signerBackend: resolveSignerBackend(env),
    kmsKeyId: env.VEYRA_KMS_KEY_ID,
    signerUrl: env.VEYRA_SIGNER_URL,
    signerAuthTokenConfigured: Boolean(env.VEYRA_SIGNER_AUTH_TOKEN && env.VEYRA_SIGNER_AUTH_TOKEN.length >= 32),
    xClientIdConfigured: Boolean(env.X_CLIENT_ID),
    xRedirectUri: env.X_REDIRECT_URI,
  };
}

function isHttpsUrl(value: string | undefined): boolean {
  if (!value) return false;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

function findTestnetLeak(env: NodeJS.ProcessEnv): string | undefined {
  for (const [key, value] of Object.entries(env)) {
    if (!value || !/RPC|URL|ENDPOINT/i.test(key)) continue;
    const lower = value.toLowerCase();
    if (TESTNET_MARKERS.some((marker) => lower.includes(marker))) return key;
  }
  return undefined;
}

export function validateServerRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeValidationResult {
  const config = readServerRuntimeConfig(env);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (config.environment !== 'mainnet') {
    if (!config.databaseUrl) warnings.push('DATABASE_URL is not configured; DB-backed routes will fail.');
    if (config.signerBackend === 'dev-private-key') warnings.push('Dev relay private key is configured; never reuse it for mainnet.');
    return { ok: true, errors, warnings };
  }

  if (config.nodeEnv !== 'production') errors.push('Mainnet requires NODE_ENV=production.');
  if (!config.databaseUrl) errors.push('Mainnet requires DATABASE_URL.');
  else if (/localhost|127\.0\.0\.1/i.test(config.databaseUrl)) errors.push('Mainnet DATABASE_URL must not point to localhost.');
  if (!config.sessionSecretConfigured) errors.push('Mainnet requires VEYRA_SESSION_SECRET with at least 32 characters.');
  if (!isHttpsUrl(config.appOrigin)) errors.push('Mainnet requires VEYRA_APP_ORIGIN using https://.');
  if (env.RELAY_PRIVATE_KEY) errors.push('RELAY_PRIVATE_KEY is forbidden in mainnet. Use KMS/HSM signing.');
  if (config.signerBackend !== 'kms') errors.push('Mainnet requires VEYRA_SIGNER_BACKEND=kms.');
  if (!config.kmsKeyId) errors.push('Mainnet requires VEYRA_KMS_KEY_ID.');
  if (!isHttpsUrl(config.signerUrl)) errors.push('Mainnet requires VEYRA_SIGNER_URL using https://.');
  if (!config.signerAuthTokenConfigured) errors.push('Mainnet requires VEYRA_SIGNER_AUTH_TOKEN with at least 32 characters.');
  if (!config.xClientIdConfigured) errors.push('Mainnet requires X_CLIENT_ID for production account linking.');
  if (!isHttpsUrl(config.xRedirectUri)) errors.push('Mainnet requires X_REDIRECT_URI using https://.');

  const leakedKey = findTestnetLeak(env);
  if (leakedKey) errors.push(`Mainnet environment contains a testnet marker in ${leakedKey}.`);

  return { ok: errors.length === 0, errors, warnings };
}

export function assertServerRuntimeConfig(env: NodeJS.ProcessEnv = process.env): ServerRuntimeConfig {
  const result = validateServerRuntimeConfig(env);
  if (!result.ok) {
    throw new Error(`[runtime-config] Production safety gate failed:\n- ${result.errors.join('\n- ')}`);
  }
  return readServerRuntimeConfig(env);
}
