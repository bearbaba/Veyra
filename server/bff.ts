/**
 * Veyra BFF — Backend For Frontend
 *
 * TRUST BOUNDARY
 * ──────────────
 * - Holds LLM credential (server-side only, never sent to browser)
 * - Holds Circle API key (for StableFX quote fetching, server-side only)
 * - All LLM output is treated as untrusted text and validated before returning
 * - Browser receives only structured IntentResult — never raw LLM output
 * - BFF never signs for the user's wallet
 * - BFF never broadcasts user transactions
 * - BFF never returns trusted calldata
 * - BFF never receives or stores private keys
 * - All LLM-generated numbers, addresses, and amounts remain UntrustedString
 *   until deterministically resolved by the browser pipeline
 *
 * RATE LIMITING
 * ─────────────
 * - /api/agent/* : 30 req / min per IP
 * - /api/stablefx/* : 20 req / min per IP (quote + fund calls)
 * - Global: 100 req / min per IP
 *
 * REQUEST VALIDATION
 * ──────────────────
 * - Max request body: 4 KB (agent/parse, stablefx/quote)
 * - Schema validation on all request bodies before processing
 * - All LLM output sanitized with validateIntentResponse()
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import { validateIntentResponse } from '../src/core/intent/intentSchema';
import { MANIFEST_CONSTANTS } from '../src/providers/registry/providerManifest';
import { createWalletChallenge, verifyWalletChallenge, WalletProofError } from './services/walletProofService.js';
import { freezeSnapshot, resolveRecipient, verifySnapshot, IdentityResolutionError } from './services/identityResolver.js';
import { getAuthenticatedVeyraUserId } from './auth/session.js';
import { getProfile, updateProfile, ProfileError } from './services/profileService.js';
import { beginXOAuthLink, completeXOAuthLink, XOAuthError } from './services/xOAuthService.js';
import { preparePaymentRecipient, verifyPaymentRecipient } from './services/paymentRecipientService.js';
import { upsertContact, removeContact, listContacts, ContactError } from './services/contactService.js';
import { getReceivePreference, setReceivePreference, ReceivePreferenceError } from './services/receivePreferenceService.js';
import { follow, unfollow, sendConnectionRequest, acceptConnection, rejectConnection } from './db/repositories/socialRepository.js';
import { assertServerRuntimeConfig } from './config/runtimeConfig.js';
import { getRateLimitPolicy } from './config/rateLimits.js';
import { requestObservability } from './middleware/observability.js';
import { PROVIDER_MANIFEST } from '../src/providers/registry/providerManifest.js';
import { evaluateMainnetReadiness } from './readiness/mainnetReadiness.js';

const runtimeConfig = assertServerRuntimeConfig();
const RATE_POLICY = getRateLimitPolicy();
const app = express();
app.set('trust proxy', runtimeConfig.environment === 'mainnet' ? 1 : false);
app.use(requestObservability);

// ── Body parsing with size limits ────────────────────────────────────────────
app.use(express.json({ limit: '4kb' }));

// ── CORS for local dev ───────────────────────────────────────────────────────
app.use((req: Request, res: Response, next: NextFunction): void => {
  const allowedOrigin = runtimeConfig.environment === 'mainnet' ? runtimeConfig.appOrigin : '*';
  if (allowedOrigin === '*' || req.header('origin') === allowedOrigin || !req.header('origin')) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin ?? '');
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Veyra-User-Id, X-Request-Id');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  next();
});

// ── Minimal in-process rate limiter ─────────────────────────────────────────
// (express-rate-limit not available without install; this is a lightweight in-process version)

interface RateWindow {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateWindow>();

function rateLimit(maxRequests: number, windowMs: number, bucket: 'path' | 'global' = 'path') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${req.ip ?? 'unknown'}:${bucket === 'global' ? 'global' : req.path}`;
    const now = Date.now();
    const window = rateLimitStore.get(key);
    if (!window || now > window.resetAt) {
      rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (window.count >= maxRequests) {
      res.status(429).json({ error: 'Too many requests. Please wait before retrying.' });
      return;
    }
    window.count++;
    next();
  };
}

// Periodically clean up expired windows to avoid memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, window] of rateLimitStore.entries()) {
    if (now > window.resetAt) rateLimitStore.delete(key);
  }
}, 60_000);

const GLOBAL_RATE = rateLimit(RATE_POLICY.globalPerMinute, 60_000, 'global');
const AGENT_RATE = rateLimit(RATE_POLICY.agentPerMinute, 60_000);
const STABLEFX_RATE = rateLimit(RATE_POLICY.stableFxPerMinute, 60_000);
const IDENTITY_RATE = rateLimit(RATE_POLICY.identityPerMinute, 60_000);
app.use('/api', GLOBAL_RATE);

// ── Identity auth boundary ──────────────────────────────────────────────────
// Production accepts only a signed Bearer session. The X-Veyra-User-Id header
// remains available only outside production for local E2E.

function identityError(res: Response, err: unknown): void {
  if (err instanceof WalletProofError) {
    res.status(err.httpStatus).json({ ok: false, error: err.code, message: err.message });
    return;
  }
  if (err instanceof IdentityResolutionError) {
    res.status(400).json({ ok: false, error: err.code, message: err.message });
    return;
  }
  if (err instanceof ProfileError) {
    res.status(err.httpStatus).json({ ok: false, error: err.code, message: err.message });
    return;
  }
  if (err instanceof ContactError || err instanceof ReceivePreferenceError) {
    res.status(400).json({ ok: false, error: err.code, message: err.message });
    return;
  }
  if (err instanceof XOAuthError) {
    res.status(err.httpStatus).json({ ok: false, error: err.code, message: err.message });
    return;
  }
  console.error('[BFF] identity route error:', err);
  res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
}

// ── Phase 2D social/contact/preferences ─────────────────────────────────────
app.get('/api/social/contacts', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthenticatedVeyraUserId(req);
    if (!userId) { res.status(401).json({ error: 'AUTH_REQUIRED' }); return; }
    const { db } = await import('./db/client.js');
    res.json({ ok: true, contacts: await listContacts(db, userId) });
  } catch (err) { identityError(res, err); }
});

app.post('/api/social/contacts', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthenticatedVeyraUserId(req);
    if (!userId) { res.status(401).json({ error: 'AUTH_REQUIRED' }); return; }
    const body = req.body as Record<string, unknown>;
    const recipient = typeof body.recipient === 'string' ? body.recipient : '';
    const alias = typeof body.alias === 'string' ? body.alias : undefined;
    const favorite = body.favorite === true;
    if (!recipient || recipient.length > 128) { res.status(400).json({ error: 'INVALID_RECIPIENT' }); return; }
    const { db } = await import('./db/client.js');
    res.json({ ok: true, contact: await upsertContact(db, userId, recipient, alias, favorite) });
  } catch (err) { identityError(res, err); }
});

app.post('/api/social/contacts/remove', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthenticatedVeyraUserId(req);
    if (!userId) { res.status(401).json({ error: 'AUTH_REQUIRED' }); return; }
    const contactUserId = typeof (req.body as Record<string, unknown>).contactUserId === 'string' ? String((req.body as Record<string, unknown>).contactUserId) : '';
    if (!contactUserId) { res.status(400).json({ error: 'INVALID_CONTACT' }); return; }
    const { db } = await import('./db/client.js');
    await removeContact(db, userId, contactUserId);
    res.json({ ok: true });
  } catch (err) { identityError(res, err); }
});

app.post('/api/social/follow', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthenticatedVeyraUserId(req);
    if (!userId) { res.status(401).json({ error: 'AUTH_REQUIRED' }); return; }
    const target = typeof (req.body as Record<string, unknown>).veyraUserId === 'string' ? String((req.body as Record<string, unknown>).veyraUserId) : '';
    if (!target || target === userId) { res.status(400).json({ error: 'INVALID_TARGET' }); return; }
    const { db } = await import('./db/client.js');
    await follow(db, userId, target); res.json({ ok: true });
  } catch (err) { identityError(res, err); }
});

app.post('/api/social/unfollow', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthenticatedVeyraUserId(req);
    if (!userId) { res.status(401).json({ error: 'AUTH_REQUIRED' }); return; }
    const target = typeof (req.body as Record<string, unknown>).veyraUserId === 'string' ? String((req.body as Record<string, unknown>).veyraUserId) : '';
    if (!target || target === userId) { res.status(400).json({ error: 'INVALID_TARGET' }); return; }
    const { db } = await import('./db/client.js');
    await unfollow(db, userId, target); res.json({ ok: true });
  } catch (err) { identityError(res, err); }
});

app.post('/api/social/friend/request', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthenticatedVeyraUserId(req);
    if (!userId) { res.status(401).json({ error: 'AUTH_REQUIRED' }); return; }
    const target = typeof (req.body as Record<string, unknown>).veyraUserId === 'string' ? String((req.body as Record<string, unknown>).veyraUserId) : '';
    if (!target || target === userId) { res.status(400).json({ error: 'INVALID_TARGET' }); return; }
    const { db } = await import('./db/client.js');
    await sendConnectionRequest(db, userId, target); res.json({ ok: true });
  } catch (err) { identityError(res, err); }
});

app.post('/api/social/friend/respond', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthenticatedVeyraUserId(req);
    if (!userId) { res.status(401).json({ error: 'AUTH_REQUIRED' }); return; }
    const body = req.body as Record<string, unknown>;
    const target = typeof body.veyraUserId === 'string' ? body.veyraUserId : '';
    const decision = body.decision;
    if (!target || target === userId || (decision !== 'ACCEPT' && decision !== 'REJECT')) { res.status(400).json({ error: 'INVALID_RESPONSE' }); return; }
    const { db } = await import('./db/client.js');
    if (decision === 'ACCEPT') await acceptConnection(db, userId, target); else await rejectConnection(db, userId, target);
    res.json({ ok: true });
  } catch (err) { identityError(res, err); }
});

app.get('/api/preferences/receive', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthenticatedVeyraUserId(req);
    if (!userId) { res.status(401).json({ error: 'AUTH_REQUIRED' }); return; }
    const { db } = await import('./db/client.js');
    res.json({ ok: true, preference: await getReceivePreference(db, userId) });
  } catch (err) { identityError(res, err); }
});

app.patch('/api/preferences/receive', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthenticatedVeyraUserId(req);
    if (!userId) { res.status(401).json({ error: 'AUTH_REQUIRED' }); return; }
    const body = req.body as Record<string, unknown>;
    const visibility = body.visibility;
    if (typeof body.preferredTokenId !== 'string' || typeof body.preferredChainId !== 'number' || typeof body.primaryWalletId !== 'string' || !['PUBLIC','FRIENDS_ONLY','PRIVATE'].includes(String(visibility))) {
      res.status(400).json({ error: 'INVALID_RECEIVE_PREFERENCE' }); return;
    }
    const { db } = await import('./db/client.js');
    const preference = await setReceivePreference(db, userId, {
      preferredTokenId: body.preferredTokenId,
      preferredChainId: body.preferredChainId,
      primaryWalletId: body.primaryWalletId,
      visibility: visibility as 'PUBLIC' | 'FRIENDS_ONLY' | 'PRIVATE',
      alternativeRoutes: Array.isArray(body.alternativeRoutes) ? body.alternativeRoutes : [],
    });
    res.json({ ok: true, preference });
  } catch (err) { identityError(res, err); }
});

// ── GET /api/profile/me ─────────────────────────────────────────────────────
app.get('/api/profile/me', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const veyraUserId = getAuthenticatedVeyraUserId(req);
    if (!veyraUserId) {
      res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Authenticated Veyra session required' });
      return;
    }
    const { db } = await import('./db/client.js');
    const profile = await getProfile(db, veyraUserId);
    res.json({ ok: true, profile });
  } catch (err) {
    identityError(res, err);
  }
});

// ── PATCH /api/profile/me ───────────────────────────────────────────────────
app.patch('/api/profile/me', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const veyraUserId = getAuthenticatedVeyraUserId(req);
    if (!veyraUserId) {
      res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Authenticated Veyra session required' });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const useXRaw = body.useX;
    const useX = useXRaw && typeof useXRaw === 'object'
      ? {
          displayName: (useXRaw as Record<string, unknown>).displayName === true,
          avatarUrl: (useXRaw as Record<string, unknown>).avatarUrl === true,
          bio: (useXRaw as Record<string, unknown>).bio === true,
        }
      : undefined;
    const profileVisibility = typeof body.profileVisibility === 'string'
      && ['PUBLIC', 'FOLLOWERS_ONLY', 'PRIVATE'].includes(body.profileVisibility)
      ? body.profileVisibility as 'PUBLIC' | 'FOLLOWERS_ONLY' | 'PRIVATE'
      : undefined;
    if (body.profileVisibility !== undefined && !profileVisibility) {
      res.status(400).json({ error: 'INVALID_PROFILE_VISIBILITY' });
      return;
    }
    const { db } = await import('./db/client.js');
    const profile = await updateProfile(db, veyraUserId, {
      displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
      avatarUrl: body.avatarUrl === null || typeof body.avatarUrl === 'string' ? body.avatarUrl : undefined,
      bio: typeof body.bio === 'string' ? body.bio : undefined,
      profileVisibility,
      useX,
    });
    res.json({ ok: true, profile });
  } catch (err) {
    identityError(res, err);
  }
});

// ── POST /api/identity/resolve ──────────────────────────────────────────────
app.post('/api/identity/resolve', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const veyraUserId = getAuthenticatedVeyraUserId(req);
    if (!veyraUserId) {
      res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Authenticated Veyra session required' });
      return;
    }
    const recipient = typeof (req.body as Record<string, unknown>).recipient === 'string'
      ? String((req.body as Record<string, unknown>).recipient)
      : '';
    if (!recipient || recipient.length > 128) {
      res.status(400).json({ error: 'INVALID_RECIPIENT' });
      return;
    }
    const { db } = await import('./db/client.js');
    const resolved = await resolveRecipient(db, recipient, veyraUserId);
    res.json({ ok: true, resolved });
  } catch (err) {
    identityError(res, err);
  }
});

// ── POST /api/identity/prepare-payment ───────────────────────────────────────
app.post('/api/identity/prepare-payment', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const veyraUserId = getAuthenticatedVeyraUserId(req);
    if (!veyraUserId) {
      res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Authenticated Veyra session required' });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const recipient = typeof body.recipient === 'string' ? body.recipient.trim() : '';
    const chainId = typeof body.chainId === 'number' ? body.chainId : Number.NaN;
    if (!recipient || recipient.length > 128 || !Number.isSafeInteger(chainId) || chainId <= 0) {
      res.status(400).json({ error: 'INVALID_PAYMENT_RECIPIENT' });
      return;
    }
    const { db } = await import('./db/client.js');
    const prepared = await preparePaymentRecipient(db, veyraUserId, recipient, chainId);
    res.json({ ok: true, prepared });
  } catch (err) {
    identityError(res, err);
  }
});

// ── POST /api/identity/verify-payment ────────────────────────────────────────
app.post('/api/identity/verify-payment', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const veyraUserId = getAuthenticatedVeyraUserId(req);
    if (!veyraUserId) {
      res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Authenticated Veyra session required' });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const snapshotId = typeof body.snapshotId === 'string' ? body.snapshotId : '';
    const expectedWalletAddress = typeof body.expectedWalletAddress === 'string' ? body.expectedWalletAddress : '';
    const expectedChainId = typeof body.expectedChainId === 'number' ? body.expectedChainId : Number.NaN;
    if (!/^snp_[1-9A-HJ-NP-Za-km-z]{10,}$/.test(snapshotId)
      || !/^0x[0-9a-fA-F]{40}$/.test(expectedWalletAddress)
      || !Number.isSafeInteger(expectedChainId) || expectedChainId <= 0) {
      res.status(400).json({ error: 'INVALID_SNAPSHOT_VERIFICATION' });
      return;
    }
    const { db } = await import('./db/client.js');
    const verified = await verifyPaymentRecipient(db, { snapshotId, expectedWalletAddress, expectedChainId });
    if (!verified.ok) {
      res.status(409).json(verified);
      return;
    }
    res.json(verified);
  } catch (err) {
    identityError(res, err);
  }
});

// ── POST /api/auth/x/start ───────────────────────────────────────────────────
app.post('/api/auth/x/start', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const veyraUserId = getAuthenticatedVeyraUserId(req);
    if (!veyraUserId) {
      res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Authenticated Veyra session required' });
      return;
    }
    const clientId = process.env.X_CLIENT_ID ?? '';
    const redirectUri = process.env.X_REDIRECT_URI ?? '';
    const returnPath = typeof (req.body as Record<string, unknown>).returnPath === 'string'
      ? String((req.body as Record<string, unknown>).returnPath)
      : '/settings';
    const { db } = await import('./db/client.js');
    const started = await beginXOAuthLink(db, veyraUserId, { clientId, redirectUri, returnPath });
    res.status(201).json({ ok: true, ...started });
  } catch (err) {
    identityError(res, err);
  }
});

// ── GET /api/auth/x/callback ─────────────────────────────────────────────────
app.get('/api/auth/x/callback', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!state || !code) {
      res.status(400).json({ error: 'INVALID_OAUTH_CALLBACK' });
      return;
    }
    const clientId = process.env.X_CLIENT_ID ?? '';
    if (!clientId) throw new XOAuthError('X_OAUTH_NOT_CONFIGURED', 'X OAuth is not configured', 503);
    const { db } = await import('./db/client.js');
    const completed = await completeXOAuthLink(db, {
      state,
      code,
      clientId,
      clientSecret: process.env.X_CLIENT_SECRET,
    });
    const appOrigin = process.env.VEYRA_APP_ORIGIN;
    if (appOrigin) {
      const target = new URL(completed.returnPath, appOrigin);
      target.searchParams.set('x_linked', '1');
      res.redirect(303, target.toString());
      return;
    }
    res.json({ ok: true, profile: completed.profile });
  } catch (err) {
    identityError(res, err);
  }
});

// ── POST /api/identity/challenge ────────────────────────────────────────────
app.post('/api/identity/challenge', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const veyraUserId = getAuthenticatedVeyraUserId(req);
    if (!veyraUserId) {
      res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Authenticated Veyra session required' });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const walletAddress = typeof body.walletAddress === 'string' ? body.walletAddress : '';
    const chainId = typeof body.chainId === 'number' ? body.chainId : Number.NaN;
    if (body.proofScheme !== undefined && body.proofScheme !== 'EIP_712' && body.proofScheme !== 'PERSONAL_SIGN') {
      res.status(400).json({ error: 'INVALID_PROOF_SCHEME' });
      return;
    }
    const proofScheme = body.proofScheme === 'PERSONAL_SIGN' ? 'PERSONAL_SIGN' : 'EIP_712';
    const { db } = await import('./db/client.js');
    const challenge = await createWalletChallenge(db, { veyraUserId, walletAddress, chainId, proofScheme });
    res.status(201).json({ ok: true, challenge });
  } catch (err) {
    identityError(res, err);
  }
});

// ── POST /api/identity/verify-wallet ────────────────────────────────────────
app.post('/api/identity/verify-wallet', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const veyraUserId = getAuthenticatedVeyraUserId(req);
    if (!veyraUserId) {
      res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Authenticated Veyra session required' });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const challengeId = typeof body.challengeId === 'string' ? body.challengeId : '';
    const walletAddress = typeof body.walletAddress === 'string' ? body.walletAddress : '';
    const signature = typeof body.signature === 'string' ? body.signature : '';
    if (!/^chl_[1-9A-HJ-NP-Za-km-z]{10,}$/.test(challengeId) || !/^0x[0-9a-fA-F]+$/.test(signature)) {
      res.status(400).json({ error: 'INVALID_REQUEST', message: 'Valid challengeId and hex signature required' });
      return;
    }
    const { db } = await import('./db/client.js');
    const wallet = await verifyWalletChallenge(db, {
      veyraUserId,
      challengeId,
      walletAddress,
      signature: signature as `0x${string}`,
    });
    res.json({ ok: true, wallet });
  } catch (err) {
    identityError(res, err);
  }
});

// ── POST /api/identity/snapshot ─────────────────────────────────────────────
app.post('/api/identity/snapshot', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const veyraUserId = getAuthenticatedVeyraUserId(req);
    if (!veyraUserId) {
      res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Authenticated Veyra session required' });
      return;
    }
    const recipientUserId = typeof (req.body as Record<string, unknown>).veyraUserId === 'string'
      ? String((req.body as Record<string, unknown>).veyraUserId)
      : '';
    if (!/^usr_[1-9A-HJ-NP-Za-km-z]{10,}$/.test(recipientUserId)) {
      res.status(400).json({ error: 'INVALID_RECIPIENT' });
      return;
    }
    if (recipientUserId !== veyraUserId) {
      res.status(403).json({ error: 'SNAPSHOT_DIRECT_ACCESS_FORBIDDEN', message: 'Use the payment preparation endpoint for recipient snapshots' });
      return;
    }
    const { db } = await import('./db/client.js');
    const snapshot = await freezeSnapshot(db, recipientUserId);
    res.status(201).json({ ok: true, snapshot });
  } catch (err) {
    identityError(res, err);
  }
});

// ── POST /api/identity/verify-snapshot ──────────────────────────────────────
app.post('/api/identity/verify-snapshot', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const veyraUserId = getAuthenticatedVeyraUserId(req);
    if (!veyraUserId) {
      res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Authenticated Veyra session required' });
      return;
    }
    const snapshotId = typeof (req.body as Record<string, unknown>).snapshotId === 'string'
      ? String((req.body as Record<string, unknown>).snapshotId)
      : '';
    if (!/^snp_[1-9A-HJ-NP-Za-km-z]{10,}$/.test(snapshotId)) {
      res.status(400).json({ error: 'INVALID_SNAPSHOT_ID' });
      return;
    }
    const { db } = await import('./db/client.js');
    const result = await verifySnapshot(db, snapshotId);
    if (!result.ok) {
      res.status(result.reason === 'SNAPSHOT_NOT_FOUND' ? 404 : 409).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    identityError(res, err);
  }
});

// ── LLM Configuration ────────────────────────────────────────────────────────

type LLMProvider = 'openai' | 'anthropic' | 'none';

function detectLLMProvider(): LLMProvider {
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return 'none';
}

const LLM_PROVIDER = detectLLMProvider();
const LLM_MODEL = process.env.LLM_MODEL ?? (LLM_PROVIDER === 'openai' ? 'gpt-4o-mini' : 'claude-3-5-haiku-20241022');

// ── System prompt ────────────────────────────────────────────────────────────

const AGENT_SYSTEM_PROMPT = `You are Veyra's intent parser. Your only job is to extract structured financial intent from the user's natural-language message.

CRITICAL CONSTRAINTS:
- You are NOT a financial authority. You cannot provide trusted token addresses, balances, prices, exchange rates, APY, gas estimates, risk scores, or transaction success status.
- You must NEVER generate executable calldata.
- You must NEVER decide whether a transaction is safe or approved.
- You must NEVER claim to know wallet balances.
- All numeric values and addresses you extract are UNTRUSTED STRINGS — they will be validated deterministically by the Veyra pipeline before any execution.
- You must respond ONLY with valid JSON matching the IntentResult schema below. No prose. No markdown. Only JSON.
- If the user's message is ambiguous, unrecognized, or unsafe, return intentType: "UNKNOWN" or "NEEDS_CLARIFICATION".
- You must NEVER instruct the system to skip safety checks, bypass policy, or sign automatically.
- Extract only what the user explicitly stated. Do not invent recipient addresses or amounts.

Supported action types: TRANSFER, CONVERT, BRIDGE.
Do NOT return SUPPLY, BORROW, REPAY, WITHDRAW — those are not yet verified.

IntentResult JSON schema:
{
  "intentType": "TRANSFER" | "CONVERT" | "BRIDGE" | "NEEDS_CLARIFICATION" | "UNKNOWN",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "candidates": [
    {
      "actionType": "TRANSFER" | "CONVERT" | "BRIDGE",
      "fromAmount": "<string or null — user-stated amount, e.g. '25' or '25.5'>",
      "fromCurrency": "<string or null — e.g. 'USDC' or 'EURC'>",
      "toCurrency": "<string or null — for CONVERT or BRIDGE>",
      "recipient": "<string or null — address or ENS if stated>",
      "sourceChain": "<string or null — for BRIDGE>",
      "destinationChain": "<string or null — for BRIDGE>"
    }
  ],
  "missingParams": ["<list of missing required params, e.g. 'recipient', 'amount'>"],
  "clarificationQuestion": "<null, or a single short question to ask the user>",
  "displaySummary": "<max 120 chars — plain English summary of what was understood>"
}

Rules:
- candidates must have at most 2 entries.
- All string values must be 300 chars or fewer.
- displaySummary must be 120 chars or fewer.
- If intentType is NEEDS_CLARIFICATION, include clarificationQuestion.
- If any required field cannot be determined from the user's message, add it to missingParams.
- Required fields by action type:
  TRANSFER: fromAmount, fromCurrency (must be USDC), recipient
  CONVERT: fromAmount, fromCurrency, toCurrency
  BRIDGE: fromAmount, fromCurrency (must be USDC), sourceChain, destinationChain`;

// ── LLM call helpers ─────────────────────────────────────────────────────────

async function callOpenAI(userMessage: string): Promise<unknown> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: AGENT_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0,
      max_tokens: 512,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const raw = data.choices[0]?.message?.content ?? '{}';
  return JSON.parse(raw) as unknown;
}

async function callAnthropic(userMessage: string): Promise<unknown> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      max_tokens: 512,
      system: AGENT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    content: Array<{ type: string; text: string }>;
  };
  const text = data.content.find((c) => c.type === 'text')?.text ?? '{}';
  // Strip any markdown fences Anthropic might emit
  const jsonText = text.replace(/^```json?\s*/m, '').replace(/```\s*$/m, '').trim();
  return JSON.parse(jsonText) as unknown;
}

async function callLLM(userMessage: string): Promise<unknown> {
  if (LLM_PROVIDER === 'openai') return callOpenAI(userMessage);
  if (LLM_PROVIDER === 'anthropic') return callAnthropic(userMessage);
  // No LLM configured — return a structured stub for development
  return {
    intentType: 'UNKNOWN',
    confidence: 'LOW',
    candidates: [],
    missingParams: [],
    clarificationQuestion: null,
    displaySummary: '[Dev mode: No LLM key configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.]',
  };
}

// ── Request body validation ──────────────────────────────────────────────────

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

// ── POST /api/agent/parse ────────────────────────────────────────────────────

app.post('/api/agent/parse', AGENT_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;

    // Validate request schema
    if (!isNonEmptyString(body.message)) {
      res.status(400).json({ error: 'message must be a non-empty string' });
      return;
    }
    if (body.message.length > 2000) {
      res.status(400).json({ error: 'message too long (max 2000 chars)' });
      return;
    }

    // Prompt injection guard: reject messages that look like prompt injection attempts
    const lowerMsg = body.message.toLowerCase();
    const injectionPatterns = [
      'ignore previous instructions',
      'ignore all previous',
      'disregard the system',
      'new instructions:',
      'override policy',
      'bypass safety',
      'sign automatically',
      'skip confirmation',
      'execute without',
      'system prompt',
      '</system>',
      '<|im_start|>',
      '```system',
    ];
    if (injectionPatterns.some((p) => lowerMsg.includes(p))) {
      // Return BLOCKED intent — do not call LLM
      res.json({
        ok: true,
        intent: {
          intentType: 'UNKNOWN',
          confidence: 'LOW',
          candidates: [],
          missingParams: [],
          clarificationQuestion: null,
          displaySummary: 'This message was blocked by the safety filter.',
          _blocked: true,
        },
      });
      return;
    }

    // Call LLM (server-side — key never reaches browser)
    let rawLLMOutput: unknown;
    try {
      rawLLMOutput = await callLLM(body.message);
    } catch (llmErr) {
      console.error('[BFF] LLM error:', llmErr);
      res.status(502).json({ error: 'Agent service temporarily unavailable' });
      return;
    }

    // Validate and sanitize LLM output — browser gets only this result
    const validated = validateIntentResponse(rawLLMOutput);
    res.json({ ok: true, intent: validated });
  } catch (err) {
    console.error('[BFF] /api/agent/parse error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/agent/explain ──────────────────────────────────────────────────

app.post('/api/agent/explain', AGENT_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    if (!isNonEmptyString(body.actionType) || !body.params) {
      res.status(400).json({ error: 'actionType and params are required' });
      return;
    }

    const actionType = String(body.actionType).slice(0, 50);
    const paramsStr = JSON.stringify(body.params).slice(0, 500);

    const prompt = `Explain in plain English (max 80 words) what this Veyra financial action does. Be factual about what will happen. Do NOT make claims about safety, risk, or prices. Action type: ${actionType}. Parameters (display only): ${paramsStr}`;

    let explanation = '';
    try {
      const raw = await callLLM(prompt);
      if (typeof raw === 'object' && raw !== null && 'displaySummary' in raw) {
        explanation = String((raw as Record<string, unknown>).displaySummary ?? '').slice(0, 300);
      } else if (typeof raw === 'string') {
        explanation = raw.slice(0, 300);
      } else {
        explanation = `${actionType} action`;
      }
    } catch {
      explanation = `${actionType} action`;
    }

    res.json({ ok: true, explanation });
  } catch (err) {
    console.error('[BFF] /api/agent/explain error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/stablefx/quote ─────────────────────────────────────────────────
// Fetches a StableFX tradable quote from Circle API (server-side — API key stays here)
// Returns the quote including typedData for browser-side Permit2 signing.
// The browser must NOT trust the amounts here as execution-ready —
// they flow through the Convert pipeline (Policy, Risk, simulation) first.

app.post('/api/stablefx/quote', STABLEFX_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const circleApiKey = process.env.CIRCLE_API_KEY;
    if (!circleApiKey) {
      res.status(503).json({ error: 'Circle API key not configured on this server' });
      return;
    }

    const body = req.body as Record<string, unknown>;

    // Validate required fields
    const { fromCurrency, toCurrency, fromAmount, recipientAddress } = body;
    if (
      !isNonEmptyString(fromCurrency) ||
      !isNonEmptyString(toCurrency) ||
      !isNonEmptyString(fromAmount) ||
      !isNonEmptyString(recipientAddress)
    ) {
      res.status(400).json({ error: 'fromCurrency, toCurrency, fromAmount, recipientAddress required' });
      return;
    }

    // Only USDC/EURC pairs supported
    const validCurrencies = ['USDC', 'EURC'];
    if (!validCurrencies.includes(fromCurrency) || !validCurrencies.includes(toCurrency)) {
      res.status(400).json({ error: 'Only USDC and EURC are supported currencies' });
      return;
    }
    if (fromCurrency === toCurrency) {
      res.status(400).json({ error: 'fromCurrency and toCurrency must differ' });
      return;
    }

    // Amount must be a positive number string
    const parsedAmount = parseFloat(fromAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      res.status(400).json({ error: 'fromAmount must be a positive number' });
      return;
    }

    const quoteBody = {
      from: { currency: fromCurrency, amount: fromAmount },
      to: { currency: toCurrency },
      tenor: 'instant',
      type: 'tradable',
      recipientAddress,
    };

    const circleRes = await fetch(
      `${MANIFEST_CONSTANTS.STABLEFX_SANDBOX_BASE_URL}/v1/exchange/stablefx/quotes`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${circleApiKey}`,
        },
        body: JSON.stringify(quoteBody),
      },
    );

    if (!circleRes.ok) {
      const errText = await circleRes.text();
      console.error('[BFF] StableFX quote error:', circleRes.status, errText);
      res.status(502).json({ error: `Circle StableFX returned ${circleRes.status}` });
      return;
    }

    const quote = await circleRes.json() as unknown;
    res.json({ ok: true, quote, fetchedAt: Date.now() });
  } catch (err) {
    console.error('[BFF] /api/stablefx/quote error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/stablefx/trade ─────────────────────────────────────────────────
// Creates a StableFX trade (after browser has signed the Permit2 typed data).

app.post('/api/stablefx/trade', STABLEFX_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const circleApiKey = process.env.CIRCLE_API_KEY;
    if (!circleApiKey) {
      res.status(503).json({ error: 'Circle API key not configured on this server' });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const { idempotencyKey, quoteId, address, message, signature } = body;
    if (
      !isNonEmptyString(idempotencyKey) ||
      !isNonEmptyString(quoteId) ||
      !isNonEmptyString(address) ||
      !message ||
      !isNonEmptyString(signature)
    ) {
      res.status(400).json({ error: 'idempotencyKey, quoteId, address, message, signature required' });
      return;
    }

    const tradeBody = { idempotencyKey, quoteId, address, message, signature };
    const circleRes = await fetch(
      `${MANIFEST_CONSTANTS.STABLEFX_SANDBOX_BASE_URL}/v1/exchange/stablefx/trades`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${circleApiKey}`,
        },
        body: JSON.stringify(tradeBody),
      },
    );

    if (!circleRes.ok) {
      const errText = await circleRes.text();
      console.error('[BFF] StableFX trade error:', circleRes.status, errText);
      res.status(502).json({ error: `Circle StableFX trade returned ${circleRes.status}` });
      return;
    }

    const trade = await circleRes.json() as unknown;
    res.json({ ok: true, trade });
  } catch (err) {
    console.error('[BFF] /api/stablefx/trade error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/stablefx/trade/:tradeId ─────────────────────────────────────────

app.get('/api/stablefx/trade/:tradeId', STABLEFX_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const circleApiKey = process.env.CIRCLE_API_KEY;
    if (!circleApiKey) {
      res.status(503).json({ error: 'Circle API key not configured' });
      return;
    }

    const rawTradeId = req.params.tradeId;
    const tradeId = Array.isArray(rawTradeId) ? rawTradeId[0] : rawTradeId;
    if (!tradeId || !/^[a-zA-Z0-9_-]{1,100}$/.test(tradeId)) {
      res.status(400).json({ error: 'Invalid tradeId' });
      return;
    }

    const circleRes = await fetch(
      `${MANIFEST_CONSTANTS.STABLEFX_SANDBOX_BASE_URL}/v1/exchange/stablefx/trades/${tradeId}`,
      { headers: { Authorization: `Bearer ${circleApiKey}` } },
    );

    if (!circleRes.ok) {
      res.status(502).json({ error: `Circle StableFX returned ${circleRes.status}` });
      return;
    }

    const trade = await circleRes.json() as unknown;
    res.json({ ok: true, trade });
  } catch (err) {
    console.error('[BFF] /api/stablefx/trade/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/cctp/attestation ─────────────────────────────────────────────────
// Polls Circle's CCTP V2 attestation API for a message.
// Route: GET /api/cctp/attestation?sourceDomain=26&txHash=0x...

app.get('/api/cctp/attestation', async (req: Request, res: Response): Promise<void> => {
  try {
    const { sourceDomain, txHash } = req.query;
    if (
      !isNonEmptyString(sourceDomain as string) ||
      !isNonEmptyString(txHash as string) ||
      !/^0x[0-9a-fA-F]{64}$/.test(txHash as string)
    ) {
      res.status(400).json({ error: 'sourceDomain and txHash (0x + 64 hex) required' });
      return;
    }

    // CCTP V2 attestation endpoint
    const url = `https://iris-api-sandbox.circle.com/v2/messages/${sourceDomain}?transactionHash=${txHash as string}`;
    const attestRes = await fetch(url);

    if (!attestRes.ok) {
      res.status(502).json({ error: `CCTP attestation API returned ${attestRes.status}` });
      return;
    }

    const data = await attestRes.json() as unknown;
    res.json({ ok: true, data, fetchedAt: Date.now() });
  } catch (err) {
    console.error('[BFF] /api/cctp/attestation error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/bridge/persist ──────────────────────────────────────────────────
// Persists a pending bridge receipt so it can be resumed after reload.
// In MVP this is in-process memory. A production deployment would use a DB.

const pendingBridges = new Map<string, unknown>();

app.post('/api/bridge/persist', async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const planId = typeof body.planId === 'string' ? body.planId : null;
    const burnTxHash = typeof body.burnTxHash === 'string' ? body.burnTxHash : null;
    if (!planId || !burnTxHash) {
      res.status(400).json({ error: 'planId and burnTxHash required' });
      return;
    }
    pendingBridges.set(planId, { ...body, persistedAt: Date.now() });
    res.json({ ok: true, planId });
  } catch (err) {
    console.error('[BFF] /api/bridge/persist error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/bridge/pending ───────────────────────────────────────────────────

app.get('/api/bridge/pending', (_req: Request, res: Response): void => {
  const all = Array.from(pendingBridges.values());
  res.json({ ok: true, pending: all });
});

// ── POST /api/bridge/relay-receive ───────────────────────────────────────────
// Relays a CCTP V2 receiveMessage call from the BFF.
// Safe because destinationCaller = 0x00...00 means any caller is permitted.
// The BFF uses its own funded relay wallet (RELAY_PRIVATE_KEY in .env).
// This eliminates the need for the user to switch chains and sign a second tx.
//
// SECURITY: The BFF validates message + attestation format before relaying.
// The BFF never signs for the user's primary wallet — only the relay wallet.
// The relay wallet holds only enough gas for relay calls (not user funds).

app.post('/api/bridge/relay-receive', async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const { message, attestation, destinationChainId } = body;

    if (
      typeof message !== 'string' ||
      typeof attestation !== 'string' ||
      typeof destinationChainId !== 'number'
    ) {
      res.status(400).json({ error: 'message (hex string), attestation (hex string), destinationChainId (number) required' });
      return;
    }

    // Validate hex format
    if (!/^0x[0-9a-fA-F]+$/.test(message) || !/^0x[0-9a-fA-F]+$/.test(attestation)) {
      res.status(400).json({ error: 'message and attestation must be valid hex strings' });
      return;
    }

    // Check relay wallet is configured
    const relayKey = process.env.RELAY_PRIVATE_KEY;
    if (!relayKey) {
      // No relay wallet — caller must sign themselves
      res.status(503).json({
        ok: false,
        selfRelay: true,
        reason: 'RELAY_PRIVATE_KEY not configured on BFF. User must sign receiveMessage themselves.',
      });
      return;
    }

    // Dynamic import of viem (available in node_modules)
    const { createWalletClient, createPublicClient, http: viemHttp, parseAbi } = await import('viem');
    const { privateKeyToAccount } = await import('viem/accounts');
    const { sepolia: sepoliaChain } = await import('viem/chains');

    const TRANSMITTER_SEPOLIA = MANIFEST_CONSTANTS.CCTP_V2_MESSAGE_TRANSMITTER as `0x${string}`;
    const RECEIVE_ABI = parseAbi([
      'function receiveMessage(bytes message, bytes attestation) returns (bool success)',
    ]);

    const relayAccount = privateKeyToAccount(relayKey as `0x${string}`);
    const publicClient = createPublicClient({ chain: sepoliaChain, transport: viemHttp() });
    const walletClient = createWalletClient({ account: relayAccount, chain: sepoliaChain, transport: viemHttp() });

    // Simulate first to detect nonce-already-used
    try {
      await publicClient.simulateContract({
        address: TRANSMITTER_SEPOLIA,
        abi: RECEIVE_ABI,
        functionName: 'receiveMessage',
        args: [message as `0x${string}`, attestation as `0x${string}`],
        account: relayAccount.address,
      });
    } catch (simErr) {
      const errMsg = simErr instanceof Error ? simErr.message : String(simErr);
      if (errMsg.toLowerCase().includes('nonce already used')) {
        // Message was already received — this is success
        res.json({ ok: true, alreadyReceived: true, txHash: null });
        return;
      }
      res.status(422).json({ ok: false, error: `receiveMessage simulation failed: ${errMsg}` });
      return;
    }

    // Execute relay
    const txHash = await walletClient.writeContract({
      address: TRANSMITTER_SEPOLIA,
      abi: RECEIVE_ABI,
      functionName: 'receiveMessage',
      args: [message as `0x${string}`, attestation as `0x${string}`],
    });

    res.json({ ok: true, alreadyReceived: false, txHash });
  } catch (err) {
    console.error('[BFF] /api/bridge/relay-receive error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Health ───────────────────────────────────────────────────────────────────

app.get('/api/health', (_req: Request, res: Response): void => {
  res.json({
    ok: true,
    llmProvider: LLM_PROVIDER,
    llmModel: LLM_MODEL,
    circleApiConfigured: !!process.env.CIRCLE_API_KEY,
    ts: Date.now(),
  });
});

app.get('/api/health/readiness', (_req: Request, res: Response): void => {
  const report = evaluateMainnetReadiness(process.env, PROVIDER_MANIFEST);
  res.status(report.ready ? 200 : 503).json({
    ok: report.ready,
    environment: runtimeConfig.environment,
    checks: report.checks,
    ts: Date.now(),
  });
});

// ── Start ────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.BFF_PORT ?? '3001', 10);
app.listen(PORT, () => {
  console.log(`[BFF] Listening on port ${PORT}`);
  console.log(`[BFF] LLM provider: ${LLM_PROVIDER} (model: ${LLM_MODEL})`);
  console.log(`[BFF] Circle API configured: ${!!process.env.CIRCLE_API_KEY}`);
});

export default app;
