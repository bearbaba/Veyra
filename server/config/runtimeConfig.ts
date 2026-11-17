/**
 * Server-side deployment configuration and production safety gates.
 * Secrets are read only from process.env and are never serialized to clients.
 */
export type ServerEnvironment = 'local' | 'testnet' | 'mainnet';
export type SignerBackend = 'none' | 'dev-private-key' | 'kms';

export interface ServerRuntimeConfig {
  environment: ServerEnvironment;
  nodeEnv: string;
  hostedBackend: boolean;
  databaseUrl?: string;
  appOrigin?: string;
  testnetSecondaryAppOrigin?: string;
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
    hostedBackend: env.VEYRA_HOSTED_BACKEND === '1' || (env.NODE_ENV === 'production' && env.VEYRA_ENV === 'testnet'),
    databaseUrl: env.DATABASE_URL,
    appOrigin: env.VEYRA_APP_ORIGIN,
    testnetSecondaryAppOrigin: env.VEYRA_TESTNET_ADDITIONAL_ORIGIN,
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

  // A non-container invocation must not accidentally turn an unsafe
  // localhost/development BFF into a publicly reachable production process.
  if (config.nodeEnv === 'production' && config.environment === 'local') {
    errors.push('Production BFF cannot start with VEYRA_ENV=local.');
  }

  if (config.environment !== 'mainnet') {
    if (config.hostedBackend) {
      // The local/dev testnet BFF stays usable without infrastructure. Only
      // a public hosted backend is required to pass these non-negotiable
      // identity, transport, database and relay-signing preflight gates.
      if (config.environment !== 'testnet') {
        errors.push('Hosted BFF requires VEYRA_ENV=testnet; mainnet has a separate deployment gate.');
      }
      if (config.nodeEnv !== 'production') {
        errors.push('Hosted BFF requires NODE_ENV=production, disabling dev identity headers.');
      }
      if (!config.databaseUrl) {
        errors.push('Hosted BFF requires DATABASE_URL.');
      } else {
        try {
          const db = new URL(config.databaseUrl);
          if (!['postgres:', 'postgresql:'].includes(db.protocol) || !db.hostname ||
              /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(db.hostname)) {
            errors.push('Hosted BFF requires a non-local PostgreSQL database URL.');
          }
          const sslMode = db.searchParams.get('sslmode');
          const tlsConfigured = ['require', 'verify-ca', 'verify-full'].includes(sslMode ?? '');
          if (!tlsConfigured && env.VEYRA_DATABASE_PRIVATE_NETWORK !== '1') {
            errors.push('Hosted BFF requires PostgreSQL TLS (sslmode=require/verify-full) or an explicitly private database network.');
          }
        } catch {
          errors.push('Hosted BFF DATABASE_URL is not a valid PostgreSQL URL.');
        }
      }
      if (!config.sessionSecretConfigured) {
        errors.push('Hosted BFF requires VEYRA_SESSION_SECRET of at least 32 characters.');
      }
      if (!isHttpsUrl(config.appOrigin)) {
        errors.push('Hosted BFF requires VEYRA_APP_ORIGIN with HTTPS.');
      } else {
        const origin = new URL(config.appOrigin!);
        if (origin.origin !== config.appOrigin || origin.username || origin.password) {
          errors.push('Hosted BFF VEYRA_APP_ORIGIN must be an exact HTTPS origin without path, userinfo or trailing slash.');
        }
      }
      if (config.testnetSecondaryAppOrigin) {
        const extra = config.testnetSecondaryAppOrigin;
        if (!isHttpsUrl(extra) || new URL(extra).origin !== extra ||
            extra === config.appOrigin || !/^https:\/\/[a-z0-9.-]+(?::[0-9]{2,5})?$/i.test(extra)) {
          errors.push('VEYRA_TESTNET_ADDITIONAL_ORIGIN must be one distinct, exact HTTPS origin, not a wildcard or list.');
        }
      }
      if (env.RELAY_PRIVATE_KEY && env.VEYRA_ENABLE_TESTNET_RELAY !== '1') {
        errors.push('Hosted BFF forbids RELAY_PRIVATE_KEY unless VEYRA_ENABLE_TESTNET_RELAY=1 is explicitly configured.');
      }
      return { ok: errors.length === 0, errors, warnings };
    }
    if (!config.databaseUrl) warnings.push('DATABASE_URL is not configured; DB-backed routes will fail.');
    if (config.signerBackend === 'dev-private-key') warnings.push('Dev relay private key is configured; never reuse it for mainnet.');
    return { ok: errors.length === 0, errors, warnings };
  }

  if (config.testnetSecondaryAppOrigin) errors.push('Mainnet must not allow VEYRA_TESTNET_ADDITIONAL_ORIGIN.');
  if (config.nodeEnv !== 'production') errors.push('Mainnet requires NODE_ENV=production.');
  if (!config.databaseUrl) errors.push('Mainnet requires DATABASE_URL.');
  else if (/localhost|127\.0\.0\.1/i.test(config.databaseUrl)) errors.push('Mainnet DATABASE_URL must not point to localhost.');
  if (!config.sessionSecretConfigured) errors.push('Mainnet requires VEYRA_SESSION_SECRET with at least 32 characters.');
  if (!isHttpsUrl(config.appOrigin)) errors.push('Mainnet requires VEYRA_APP_ORIGIN using https://.');
  if (env.RELAY_PRIVATE_KEY) errors.push('RELAY_PRIVATE_KEY is forbidden in mainnet. Use KMS/HSM signing.');
  // V1 wallet-owned identity and independently verified receipts never ask the
  // backend to sign or relay funds. This explicit restrictive mode can run on
  // Starter without a KMS or financial relay. The route allowlist in bff.ts MUST remain
  // active; full financial backend readiness still requires the original gates.
  if (env.VEYRA_MAINNET_IDENTITY_ONLY === '1') {
    if (!config.hostedBackend) errors.push('Identity-only Mainnet must be a hosted backend.');
    if (config.appOrigin !== 'https://veyra-seven-beta.vercel.app')
      errors.push('Identity-only Mainnet requires the single official Veyra browser origin.');
    if (config.signerBackend !== 'none' || env.VEYRA_KMS_KEY_ID || env.VEYRA_SIGNER_URL ||
        env.VEYRA_SIGNER_AUTH_TOKEN || env.CIRCLE_API_KEY || env.OPENAI_API_KEY ||
        env.ANTHROPIC_API_KEY)
      errors.push('Identity-only Mainnet must not be configured with financial signing, LLM or privileged provider secrets.');
    try {
      const db = new URL(config.databaseUrl??'');
      if (!['postgres:','postgresql:'].includes(db.protocol)||!db.hostname||
          /^(localhost|127\\.|10\\.|192\\.168\\.)/i.test(db.hostname))
        throw Error('invalid database URI');
      if (env.VEYRA_DATABASE_PRIVATE_NETWORK!=='1'&&
          !['require','verify-ca','verify-full'].includes(db.searchParams.get('sslmode')??''))
        throw Error('TLS or private Postgres network required');
    }catch { errors.push('Identity-only Mainnet requires isolated non-local PostgreSQL with TLS or private-network flag.'); }
    try {
      const rpc = new URL(env.ARC_MAINNET_RPC_URL??'');
      if(rpc.protocol!=='https:'||rpc.username||rpc.password||
         /testnet|sepolia|localhost|127\\.|10\\.|192\\.168\\./i.test(rpc.host))
        throw Error('invalid RPC URI');
    }catch {errors.push('Identity-only Mainnet requires an approved HTTPS Arc Mainnet RPC.');}
    // Only the single verified official callback may use X OAuth credentials;
    // neither OAuth identity linking nor Chat can access fund-signing routes.
    if (env.X_CLIENT_ID || env.X_REDIRECT_URI || env.X_CLIENT_SECRET) {
      if (!config.xClientIdConfigured ||
          config.xRedirectUri !== 'https://veyra-mainnet-v1-bff.onrender.com/api/auth/x/callback')
        errors.push('X linking requires X_CLIENT_ID and the exact official Mainnet backend callback.');
    } else warnings.push('X OAuth has no configured client and callback; feature stays unavailable.');
    return {ok:errors.length===0,errors,warnings};
  }
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
