/**
 * Veyra BFF — Backend For Frontend
 *
 * TRUST BOUNDARY
 * ──────────────
 * - Holds LLM credential (server-side only, never sent to browser)
 * - Holds Circle API key (for StableFX quote fetching, server-side only)
 * - All LLM output is treated as untrusted text and validated before returning
 * - Browser receives only structured IntentResult — never raw LLM output
 * - BFF never signs for the user's primary wallet
 * - User-originated money actions remain wallet-authorized
 * - The optional testnet CCTP relay may broadcast receiveMessage with a
 *   dedicated gas-only relay key after owned checkpoint + chain evidence checks
 * - Mainnet forbids RELAY_PRIVATE_KEY and requires the KMS/HSM signer boundary
 * - BFF never returns LLM/provider-supplied calldata as trusted execution input
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
import { createFallbackAgentResponse, validateAgentChatResponse, type AgentHistoryMessage } from '../src/core/agent/agentV2';
import { MANIFEST_CONSTANTS } from '../src/providers/registry/providerManifest';
import { createWalletChallenge, verifyWalletChallenge, WalletProofError } from './services/walletProofService.js';
import { beginIdentityRegistration, completeIdentityRegistration, IdentityRegistrationError } from './services/identityRegistrationService.js';
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
import { probeSignerReadiness } from './readiness/signerReadiness.js';
import { probeDatabaseReadiness } from './readiness/databaseReadiness.js';
import { refreshMainnetProviderHealth } from './services/providerHealthService.js';
import { getAllProviderHealthRecords } from '../src/providers/registry/providerRegistry.js';
import {
  ActivityReceiptInputError,
  createBridgeActivityReceipt,
} from './services/activityReceiptService.js';
import {
  ActivityReceiptEvidenceError,
  verifyOwnedActivityReceiptTransitionEvidence,
  finalizeOwnedRevertedCctpSource,
} from './services/activityReceiptVerificationService.js';
import {
  getResumableReceipts as getResumableActivityReceipts,
  listReceiptsForUser,
  ReceiptTransitionError,
  syncReceiptRevision,
  type ReceiptStatus as ActivityReceiptStatus,
} from './db/repositories/receiptRepository.js';
import {
  claimDestinationSubmission,
  getDestinationSubmissionClaim,
  recordDestinationSubmission,
} from './db/repositories/bridgeDestinationSubmissionRepository.js';
import {
  verifyRevertedCctpDestinationReceiveFromNetwork,
} from './services/cctpDestinationRevertVerificationService.js';
import {
  recordVerifiedFirstDestinationRevert,
} from './db/repositories/bridgeDestinationRevertRepository.js';
import { getOwnedDestinationAttemptHistory } from './db/repositories/bridgeDestinationRetryRepository.js';
import { getSecondDestinationAttempt } from './db/repositories/bridgeDestinationRetryRepository.js';
import { verifySecondCctpDestinationMintFromNetwork } from './services/cctpSecondDestinationVerificationService.js';
import { inspectCctpDestinationNonceFromNetwork } from './services/cctpDestinationNonceInspectionService.js';
import { recordVerifiedSecondDestinationMint } from './db/repositories/bridgeSecondDestinationVerificationRepository.js';
import { finalizeVerifiedSecondCctpSettlement } from './db/repositories/bridgeSecondSettlementRepository.js';
import { assertSelfRelayNetworkEvidence } from './services/cctpSelfRelayVerification.js';
import { verifyCctpSourceCheckpointAttestationFromNetwork } from './services/cctpBridgeSourceAttestationService.js';
import { receiptStatusEnum } from './db/schema/enums.js';
import {
  BridgeRecoveryConflictError,
  assertBridgeRecoveryWalletOwnership,
  assertBrowserBridgeCheckpointWritable,
  evaluateBridgeRelayDecision,
  getBridgeRecoveryCheckpointForOwner,
  loadPendingBridgeRecoveryCheckpoints,
  persistBridgeRecoveryCheckpoint,
  type BridgeRecoveryInput,
  type BridgeRecoveryStage,
} from './db/repositories/bridgeRecoveryRepository.js';

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
  if (err instanceof WalletProofError || err instanceof IdentityRegistrationError) {
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

// ── Veyra ID registration ────────────────────────────────────────────────────
// Registration is wallet-owned: the server issues a short-lived, HMAC-bound
// claim and the connected wallet signs EIP-712 before the identity is created.
app.post('/api/identity/register/challenge', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const handle = typeof body.handle === 'string' ? body.handle : '';
    const walletAddress = typeof body.walletAddress === 'string' ? body.walletAddress : '';
    const chainId = typeof body.chainId === 'number' ? body.chainId : Number.NaN;
    const { db } = await import('./db/client.js');
    const challenge = await beginIdentityRegistration(db, { handle, walletAddress, chainId });
    res.status(201).json({ ok: true, challenge });
  } catch (err) {
    identityError(res, err);
  }
});

app.post('/api/identity/register/complete', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const claimToken = typeof body.claimToken === 'string' ? body.claimToken : '';
    const signature = typeof body.signature === 'string' ? body.signature : '';
    if (!claimToken || !/^0x[0-9a-fA-F]+$/.test(signature)) {
      res.status(400).json({ error: 'INVALID_REQUEST', message: 'claimToken and a hex signature are required' });
      return;
    }
    const { db } = await import('./db/client.js');
    const registration = await completeIdentityRegistration(db, { claimToken, signature: signature as `0x${string}` });
    const profile = await getProfile(db, registration.veyraUserId);
    res.status(201).json({ ok: true, registration, profile, sessionToken: registration.sessionToken });
  } catch (err) {
    identityError(res, err);
  }
});

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

const AGENT_CHAT_SYSTEM_PROMPT = `You are Veyra, a multilingual assistant for a human-first payment application.

PRODUCT ROLE:
- Veyra helps people pay another person using a Veyra ID, X handle, or wallet address.
- Veyra can prepare TRANSFER, CONVERT, and BRIDGE intents for review.
- Identity resolution, balances, token contracts, routes, fees, policy, risk, signing, and execution are deterministic system responsibilities — never facts you invent.
- The user always reviews and signs financial actions. You never sign, broadcast, or bypass policy.

CONVERSATION:
- Reply naturally in the SAME language as the user's latest message. English is the default only when the language is unclear.
- Support mixed-language messages naturally.
- Be concise, warm, and practical. Do not behave like a parser-only bot.
- You may explain how Veyra works and help the user formulate an action.
- Do not provide investment advice, predictions, or fabricated balances, prices, fees, APY, routes, transaction status, or recipient ownership.
- Never alter or translate wallet addresses, transaction hashes, token symbols, contract addresses, numeric amounts, Veyra IDs, or X handles.
- If an action is missing one required detail, ask ONLY for the missing detail rather than repeating fields already provided.

OUTPUT:
Return ONLY JSON in this shape:
{
  "reply": "natural-language reply in the user's language",
  "locale": "best-effort BCP-47 language code such as en, vi, ja, es",
  "mode": "CHAT" | "ACTION" | "CLARIFICATION",
  "intent": null | {
    "displaySummary": "short summary in the user's language",
    "status": "RESOLVED" | "NEEDS_CLARIFICATION" | "AMBIGUOUS" | "UNSUPPORTED" | "UNRECOGNISED",
    "candidates": [{
      "actionType": "TRANSFER" | "CONVERT" | "BRIDGE",
      "recipient": "string or null",
      "fromAmount": "string or null",
      "fromCurrency": "string or null",
      "toCurrency": "string or null",
      "sourceChain": "string or null",
      "destinationChain": "string or null",
      "confidence": 0.0
    }],
    "missingParams": [],
    "clarificationQuestion": null
  }
}

Required intent fields:
- TRANSFER: recipient, fromAmount, fromCurrency.
- CONVERT: fromAmount, fromCurrency, toCurrency.
- BRIDGE: fromAmount, fromCurrency, destinationChain. sourceChain is optional if the user did not state it.
For ordinary conversation, set mode=CHAT and intent=null.
All extracted values are untrusted strings and must reflect only what the user explicitly said.`;

// ── LLM call helpers ─────────────────────────────────────────────────────────

async function callOpenAI(
  userMessage: string,
  systemPrompt: string = AGENT_SYSTEM_PROMPT,
  history: AgentHistoryMessage[] = [],
): Promise<unknown> {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map((message) => ({ role: message.role === 'agent' ? 'assistant' : 'user', content: message.text })),
    { role: 'user', content: userMessage },
  ];
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages,
      temperature: 0.2,
      max_tokens: 700,
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

async function callAnthropic(
  userMessage: string,
  systemPrompt: string = AGENT_SYSTEM_PROMPT,
  history: AgentHistoryMessage[] = [],
): Promise<unknown> {
  const messages = [
    ...history.map((message) => ({ role: message.role === 'agent' ? 'assistant' : 'user', content: message.text })),
    { role: 'user', content: userMessage },
  ];
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      max_tokens: 700,
      system: systemPrompt,
      messages,
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    content: Array<{ type: string; text: string }>;
  };
  const text = data.content.find((c) => c.type === 'text')?.text ?? '{}';
  const jsonText = text.replace(/^```json?\s*/m, '').replace(/```\s*$/m, '').trim();
  return JSON.parse(jsonText) as unknown;
}

async function callLLM(
  userMessage: string,
  systemPrompt: string = AGENT_SYSTEM_PROMPT,
  history: AgentHistoryMessage[] = [],
): Promise<unknown> {
  if (LLM_PROVIDER === 'openai') return callOpenAI(userMessage, systemPrompt, history);
  if (LLM_PROVIDER === 'anthropic') return callAnthropic(userMessage, systemPrompt, history);
  throw new Error('No LLM provider configured');
}

function sanitizeAgentHistory(raw: unknown): AgentHistoryMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(-10)
    .map((item): AgentHistoryMessage | null => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const role = record.role === 'agent' ? 'agent' : record.role === 'user' ? 'user' : null;
      const text = typeof record.text === 'string' ? record.text.trim().slice(0, 500) : '';
      return role && text ? { role, text } : null;
    })
    .filter((item): item is AgentHistoryMessage => item !== null);
}

function messageLooksLikeInjection(message: string): boolean {
  const lowerMsg = message.toLowerCase();
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
  return injectionPatterns.some((pattern) => lowerMsg.includes(pattern));
}

// ── Request body validation ──────────────────────────────────────────────────

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

// ── POST /api/agent/chat ─────────────────────────────────────────────────────
// Conversation and planning are deliberately separate from execution. If the
// configured LLM is unavailable, this endpoint still returns a deterministic,
// multilingual fallback response instead of taking the Agent UI down.
app.post('/api/agent/chat', AGENT_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    if (!isNonEmptyString(body.message)) {
      res.status(400).json({ error: 'message must be a non-empty string' });
      return;
    }
    if (body.message.length > 2000) {
      res.status(400).json({ error: 'message too long (max 2000 chars)' });
      return;
    }

    const history = sanitizeAgentHistory(body.history);
    const providerLabel = LLM_PROVIDER === 'none' ? 'local-fallback' : `${LLM_PROVIDER}:${LLM_MODEL}`;
    const fallback = createFallbackAgentResponse(body.message, {
      provider: providerLabel,
      executionAvailable: false,
      history,
    });

    if (messageLooksLikeInjection(body.message)) {
      res.json({
        ...fallback,
        reply: 'I can help with Veyra, but I cannot follow instructions that try to bypass safety or signing rules.',
        mode: 'CHAT',
        intent: undefined,
      });
      return;
    }

    if (LLM_PROVIDER === 'none') {
      res.json(fallback);
      return;
    }

    try {
      const raw = await callLLM(body.message, AGENT_CHAT_SYSTEM_PROMPT, history);
      const validated = validateAgentChatResponse(raw, body.message, {
        conversation: 'ONLINE',
        planning: 'ONLINE',
        execution: 'LOCKED',
        provider: providerLabel,
      });
      res.json({
        ...validated,
        degraded: false,
        capabilities: {
          ...validated.capabilities,
          conversation: 'ONLINE',
          planning: 'ONLINE',
          execution: 'LOCKED',
          provider: providerLabel,
        },
      });
    } catch (llmErr) {
      console.error('[BFF] Agent chat provider error; using fallback:', llmErr);
      res.json(fallback);
    }
  } catch (err) {
    console.error('[BFF] /api/agent/chat error:', err);
    const message = typeof (req.body as Record<string, unknown> | undefined)?.message === 'string'
      ? String((req.body as Record<string, unknown>).message)
      : '';
    const history = sanitizeAgentHistory((req.body as Record<string, unknown> | undefined)?.history);
    res.json(createFallbackAgentResponse(message || 'help', { provider: 'server-fallback', history }));
  }
});

app.get('/api/agent/status', (_req: Request, res: Response): void => {
  const online = LLM_PROVIDER !== 'none';
  res.json({
    ok: true,
    conversation: online ? 'ONLINE' : 'FALLBACK',
    planning: online ? 'ONLINE' : 'FALLBACK',
    execution: 'LOCKED',
    provider: online ? `${LLM_PROVIDER}:${LLM_MODEL}` : 'local-fallback',
    ts: Date.now(),
  });
});

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
    if (messageLooksLikeInjection(body.message)) {
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
      console.error('[BFF] LLM parse error; using deterministic fallback:', llmErr);
      const fallback = createFallbackAgentResponse(body.message, { provider: 'server-fallback' });
      res.json({ ok: true, intent: fallback.intent ?? validateIntentResponse({ status: 'UNRECOGNISED', candidates: [], displaySummary: fallback.reply }) });
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

app.get('/api/cctp/health', async (_req: Request, res: Response): Promise<void> => {
  try {
    const zeroHash = `0x${'0'.repeat(64)}`;
    const url =
      `https://iris-api-sandbox.circle.com/v2/messages/${MANIFEST_CONSTANTS.ARC_TESTNET_CCTP_DOMAIN}` +
      `?transactionHash=${zeroHash}`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(4_000),
    });

    // A 404/400 for a deliberately unknown transaction still proves the
    // attestation service is reachable. 5xx/network failures do not.
    const reachable = response.status < 500;
    res.status(reachable ? 200 : 503).json({
      ok: reachable,
      service: 'circle-cctp-attestation',
      status: response.status,
    });
  } catch {
    res.status(503).json({
      ok: false,
      service: 'circle-cctp-attestation',
    });
  }
});

app.get('/api/cctp/attestation', async (req: Request, res: Response): Promise<void> => {
  try {
    const { sourceDomain, txHash } = req.query;
    const sourceDomainText =
      typeof sourceDomain === 'string' ? sourceDomain : '';
    const txHashText = typeof txHash === 'string' ? txHash : '';
    const parsedSourceDomain = /^\d+$/.test(sourceDomainText)
      ? Number(sourceDomainText)
      : Number.NaN;

    if (
      parsedSourceDomain !== MANIFEST_CONSTANTS.ARC_TESTNET_CCTP_DOMAIN ||
      !/^0x[0-9a-fA-F]{64}$/.test(txHashText)
    ) {
      res.status(400).json({
        error:
          'Only Arc Testnet CCTP source domain and a 0x + 64 hex txHash are accepted',
      });
      return;
    }

    // CCTP V2 attestation endpoint. Domain and hash are allow-listed above.
    const url =
      `https://iris-api-sandbox.circle.com/v2/messages/${parsedSourceDomain}` +
      `?transactionHash=${txHashText}`;
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

// ── Activity receipts ──────────────────────────────────────────────────────

const ACTIVITY_RECEIPT_STATUSES = new Set<string>(receiptStatusEnum.enumValues);

function parseOptionalHash(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new ReceiptTransitionError('Invalid transaction hash in receipt sync.');
  }
  return value;
}

app.post('/api/receipts/bridge', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthenticatedVeyraUserId(req);
    if (!userId) {
      res.status(401).json({ ok: false, error: 'AUTH_REQUIRED' });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const input = {
      clientIntentId:
        typeof body.clientIntentId === 'string' ? body.clientIntentId : '',
      routeId: typeof body.routeId === 'string' ? body.routeId : '',
      senderAddress:
        typeof body.senderAddress === 'string' ? body.senderAddress : '',
      sourceChainId:
        typeof body.sourceChainId === 'number'
          ? body.sourceChainId
          : Number.NaN,
      destinationAddress:
        typeof body.destinationAddress === 'string'
          ? body.destinationAddress
          : '',
      destinationChainId:
        typeof body.destinationChainId === 'number'
          ? body.destinationChainId
          : Number.NaN,
      amountRaw: typeof body.amountRaw === 'string' ? body.amountRaw : '',
      tokenAddress:
        typeof body.tokenAddress === 'string' ? body.tokenAddress : '',
      recipientSnapshotId:
        typeof body.recipientSnapshotId === 'string'
          ? body.recipientSnapshotId
          : null,
      policyResult:
        body.policyResult &&
        typeof body.policyResult === 'object' &&
        !Array.isArray(body.policyResult)
          ? (body.policyResult as Record<string, unknown>)
          : undefined,
      preflightResults: Array.isArray(body.preflightResults)
        ? body.preflightResults
        : undefined,
    };

    const { db } = await import('./db/client.js');
    const created = await createBridgeActivityReceipt(db, userId, input);
    res.status(201).json({ ok: true, ...created });
  } catch (err) {
    if (err instanceof ActivityReceiptInputError) {
      res.status(err.httpStatus).json({
        ok: false,
        error: err.code,
        message: err.message,
      });
      return;
    }
    console.error('[BFF] /api/receipts/bridge error:', err);
    res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

app.post('/api/receipts/sync', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthenticatedVeyraUserId(req);
    if (!userId) {
      res.status(401).json({ ok: false, error: 'AUTH_REQUIRED' });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const status =
      typeof body.status === 'string' &&
      ACTIVITY_RECEIPT_STATUSES.has(body.status)
        ? (body.status as ActivityReceiptStatus)
        : null;
    const revision =
      typeof body.revision === 'number' ? body.revision : Number.NaN;
    const receiptId =
      typeof body.receiptId === 'string' ? body.receiptId : '';

    if (
      !receiptId ||
      !status ||
      !Number.isSafeInteger(revision) ||
      revision < 1
    ) {
      res.status(400).json({
        ok: false,
        error: 'INVALID_RECEIPT_SYNC',
      });
      return;
    }

    const input = {
      receiptId,
      revision,
      status,
      burnTxHash: parseOptionalHash(body.burnTxHash),
      burnChainId:
        typeof body.burnChainId === 'number' ? body.burnChainId : undefined,
      burnBlockNumber:
        typeof body.burnBlockNumber === 'number'
          ? body.burnBlockNumber
          : undefined,
      receiveTxHash: parseOptionalHash(body.receiveTxHash),
      receiveChainId:
        typeof body.receiveChainId === 'number'
          ? body.receiveChainId
          : undefined,
      receiveBlockNumber:
        typeof body.receiveBlockNumber === 'number'
          ? body.receiveBlockNumber
          : undefined,
      messageHash:
        typeof body.messageHash === 'string' ? body.messageHash : undefined,
      messageBytes:
        typeof body.messageBytes === 'string' ? body.messageBytes : undefined,
      attestationNonce:
        typeof body.attestationNonce === 'string'
          ? body.attestationNonce
          : undefined,
      failureReason:
        typeof body.failureReason === 'string'
          ? body.failureReason.slice(0, 1000)
          : undefined,
      resumable:
        typeof body.resumable === 'boolean' ? body.resumable : undefined,
      resumePayload:
        body.resumePayload &&
        typeof body.resumePayload === 'object' &&
        !Array.isArray(body.resumePayload)
          ? (body.resumePayload as Record<string, unknown>)
          : undefined,
    };

    const { db } = await import('./db/client.js');
    await verifyOwnedActivityReceiptTransitionEvidence(db, userId, input);
    const result = await syncReceiptRevision(db, userId, input);
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ActivityReceiptEvidenceError) {
      res.status(err.httpStatus).json({
        ok: false,
        error: err.code,
        message: err.message,
      });
      return;
    }
    if (err instanceof ReceiptTransitionError) {
      res.status(409).json({
        ok: false,
        error: 'RECEIPT_TRANSITION_CONFLICT',
        message: err.message,
      });
      return;
    }
    console.error('[BFF] /api/receipts/sync error:', err);
    res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

/**
 * No browser-supplied status/hash/block is trusted here. The authenticated
 * BFF independently verifies a canonical reverted CCTP source burn and
 * atomically closes only its owner's matching BROADCAST receipt.
 */
app.post('/api/receipts/cctp/resolve-source-revert', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthenticatedVeyraUserId(req);
    if (!userId) {
      res.status(401).json({ ok: false, error: 'AUTH_REQUIRED' });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const receiptId =
      typeof body?.receiptId === 'string' ? body.receiptId : '';
    if (!receiptId || receiptId.length > 150) {
      res.status(400).json({ ok: false, error: 'INVALID_RECEIPT_ID' });
      return;
    }

    const { db } = await import('./db/client.js');
    const resolved = await finalizeOwnedRevertedCctpSource(db, userId, receiptId);
    res.json({ ok: true, ...resolved });
  } catch (err) {
    if (err instanceof ActivityReceiptEvidenceError) {
      res.status(err.httpStatus).json({
        ok: false,
        error: err.code,
        message: err.message,
      });
      return;
    }
    if (err instanceof ReceiptTransitionError) {
      res.status(409).json({
        ok: false,
        error: 'RECEIPT_TRANSITION_CONFLICT',
        message: err.message,
      });
      return;
    }
    console.error('[BFF] /api/receipts/cctp/resolve-source-revert error:', err);
    res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

app.get('/api/receipts', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthenticatedVeyraUserId(req);
    if (!userId) {
      res.status(401).json({ ok: false, error: 'AUTH_REQUIRED' });
      return;
    }

    const rawLimit =
      typeof req.query.limit === 'string' ? Number(req.query.limit) : 100;
    const { db } = await import('./db/client.js');
    const receipts = await listReceiptsForUser(
      db,
      userId,
      Number.isFinite(rawLimit) ? rawLimit : 100,
    );
    res.json({ ok: true, receipts });
  } catch (err) {
    console.error('[BFF] /api/receipts error:', err);
    res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

app.get('/api/receipts/resumable', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthenticatedVeyraUserId(req);
    if (!userId) {
      res.status(401).json({ ok: false, error: 'AUTH_REQUIRED' });
      return;
    }

    const { db } = await import('./db/client.js');
    const receipts = await getResumableActivityReceipts(db, userId);
    res.json({ ok: true, receipts });
  } catch (err) {
    console.error('[BFF] /api/receipts/resumable error:', err);
    res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

// ── Durable bridge recovery persistence ───────────────────────────────────────
// Authenticated Veyra users get a Postgres-backed mirror of local recovery
// checkpoints. Chain/provider state remains authoritative; this server state is
// advancement-only recovery metadata and can never create a new source burn.

const BRIDGE_RECOVERY_STAGES = new Set<BridgeRecoveryStage>([
  'SOURCE_BROADCAST',
  'SOURCE_CONFIRMED',
  'ATTESTATION_READY',
  'DESTINATION_BROADCAST',
  'VERIFIED',
]);

function parseBridgeRecoveryInput(body: Record<string, unknown>): BridgeRecoveryInput {
  const stage = typeof body.stage === 'string' && BRIDGE_RECOVERY_STAGES.has(body.stage as BridgeRecoveryStage)
    ? body.stage as BridgeRecoveryStage
    : null;

  const input: BridgeRecoveryInput = {
    planId: typeof body.planId === 'string' ? body.planId : '',
    stage: stage ?? 'SOURCE_BROADCAST',
    burnTxHash: typeof body.burnTxHash === 'string' ? body.burnTxHash : '',
    sourceChainId: typeof body.sourceChainId === 'number' ? body.sourceChainId : Number.NaN,
    destinationChainId: typeof body.destinationChainId === 'number' ? body.destinationChainId : Number.NaN,
    walletAddress: typeof body.walletAddress === 'string' ? body.walletAddress : '',
    recipientAddress: typeof body.recipientAddress === 'string' ? body.recipientAddress : '',
    amount: typeof body.amount === 'string' ? body.amount : '',
    tokenAddress: typeof body.tokenAddress === 'string' ? body.tokenAddress : '',
    balanceBefore: typeof body.balanceBefore === 'string' ? body.balanceBefore : '',
    createdAt: typeof body.createdAt === 'number' ? body.createdAt : Number.NaN,
    updatedAt: typeof body.updatedAt === 'number' ? body.updatedAt : Number.NaN,
  };

  if (!stage) throw new BridgeRecoveryConflictError('Invalid bridge recovery stage');
  if (typeof body.attestationMessage === 'string') input.attestationMessage = body.attestationMessage;
  if (typeof body.attestationSignature === 'string') input.attestationSignature = body.attestationSignature;
  if (typeof body.receiveTxHash === 'string') input.receiveTxHash = body.receiveTxHash;

  return input;
}

app.post('/api/bridge/persist', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthenticatedVeyraUserId(req);
    if (!userId) {
      res.status(401).json({ ok: false, error: 'AUTH_REQUIRED' });
      return;
    }

    const input = parseBridgeRecoveryInput(req.body as Record<string, unknown>);

    if (
      input.sourceChainId !== MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID ||
      input.tokenAddress.toLowerCase() !==
        MANIFEST_CONSTANTS.ARC_TESTNET_USDC.toLowerCase() ||
      (input.destinationChainId !== MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID &&
        input.destinationChainId !== MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID)
    ) {
      throw new BridgeRecoveryConflictError(
        'Bridge recovery checkpoint is outside the enabled CCTP testnet route scope',
      );
    }

    // This endpoint only mirrors pre-destination recovery metadata.
    // A browser cannot forge a destination tx hash or VERIFIED state here.
    // Server-side relay and chain-verifying self-relay endpoints own that truth.
    assertBrowserBridgeCheckpointWritable(input);
    const { db } = await import('./db/client.js');
    await assertBridgeRecoveryWalletOwnership(db, userId, input);
    const checkpoint = await persistBridgeRecoveryCheckpoint(db, userId, input);
    res.json({ ok: true, checkpoint });
  } catch (err) {
    if (err instanceof BridgeRecoveryConflictError) {
      res.status(409).json({ ok: false, error: 'BRIDGE_RECOVERY_CONFLICT', message: err.message });
      return;
    }
    console.error('[BFF] /api/bridge/persist error:', err);
    res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

app.get('/api/bridge/pending', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthenticatedVeyraUserId(req);
    if (!userId) {
      res.status(401).json({ ok: false, error: 'AUTH_REQUIRED' });
      return;
    }

    const { db } = await import('./db/client.js');
    const pending = await loadPendingBridgeRecoveryCheckpoints(db, userId);
    res.json({ ok: true, pending });
  } catch (err) {
    console.error('[BFF] /api/bridge/pending error:', err);
    res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

/**
 * Read-only attempt history for authenticated cross-device recovery.
 * A history response does not grant another signing or relay permission.
 */
app.get('/api/bridge/destination-attempts', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthenticatedVeyraUserId(req);
    if (!userId) {
      res.status(401).json({ ok: false, error: 'AUTH_REQUIRED' });
      return;
    }
    const planId = typeof req.query.planId === 'string'
      ? req.query.planId.trim() : '';
    if (!planId || planId.length > 160) {
      res.status(400).json({ ok: false, error: 'INVALID_BRIDGE_PLAN' });
      return;
    }
    const { db } = await import('./db/client.js');
    const history = await getOwnedDestinationAttemptHistory(db, userId, planId);
    if (!history) {
      res.status(404).json({ ok: false, error: 'BRIDGE_RECOVERY_NOT_FOUND' });
      return;
    }
    res.json({
      ok: true,
      history,
      retryAuthorized: false,
    });
  } catch (err) {
    console.error('[BFF] /api/bridge/destination-attempts error:', err);
    res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

/**
 * Verifies successful SECOND receive without requesting a new signature.
 * Only an owned, already-recorded attempt #2 hash can be verified. Source
 * burn and Circle evidence are independently rechecked from Arc and Circle.
 *
 * Never overwrites the original ActivityReceipt's first receive tx hash.
 */
app.post('/api/bridge/verify-second-destination', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthenticatedVeyraUserId(req);
    if (!userId) {
      res.status(401).json({ ok: false, error: 'AUTH_REQUIRED' });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const planId = typeof body?.planId === 'string' ? body.planId.trim() : '';
    if (!planId || planId.length > 160) {
      res.status(400).json({ ok: false, error: 'INVALID_BRIDGE_PLAN' });
      return;
    }

    const { db } = await import('./db/client.js');
    const checkpoint = await getBridgeRecoveryCheckpointForOwner(db, userId, planId);
    if (!checkpoint) {
      res.status(404).json({ ok: false, error: 'BRIDGE_RECOVERY_NOT_FOUND' });
      return;
    }
    await assertBridgeRecoveryWalletOwnership(db, userId, checkpoint);

    const attempt = await getSecondDestinationAttempt(db, userId, planId);
    if (!attempt || attempt.mode !== 'ALREADY_SUBMITTED') {
      throw new BridgeRecoveryConflictError(
        'No immutable second destination receive hash is available for verification.',
      );
    }

    if (checkpoint.stage !== 'DESTINATION_BROADCAST') {
      throw new BridgeRecoveryConflictError(
        'Second receive verification requires an unresolved first destination checkpoint.',
      );
    }

    // The shared source+CIRCLE verifier expects a pre-signature stage.
    // Adapt ONLY that field for proof checking; the original DB checkpoint
    // is independently checked again with row locks when recording the proof.
    await verifyCctpSourceCheckpointAttestationFromNetwork({
      ...checkpoint,
      stage: 'ATTESTATION_READY',
    });

    const proof = await verifySecondCctpDestinationMintFromNetwork(
      checkpoint,
      attempt.txHash,
    );
    const token = checkpoint.destinationChainId ===
      MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID
      ? MANIFEST_CONSTANTS.ETH_SEPOLIA_USDC
      : MANIFEST_CONSTANTS.BASE_SEPOLIA_USDC;
    const verified = await recordVerifiedSecondDestinationMint(
      db, userId, planId, proof, token,
    );

    res.json({
      ok: true,
      planId,
      attemptNumber: 2,
      outcome: 'VERIFIED_MINT',
      evidence: verified,
      activityReceiptCompleted: false,
      retryAuthorized: false,
    });
  } catch (err) {
    if (err instanceof BridgeRecoveryConflictError) {
      res.status(409).json({
        ok: false,
        error: 'SECOND_DESTINATION_MINT_NOT_VERIFIED',
        message: err.message,
      });
      return;
    }
    console.error('[BFF] /api/bridge/verify-second-destination error:', err);
    res.status(503).json({ ok: false, error: 'SECOND_DESTINATION_EVIDENCE_UNAVAILABLE' });
  }
});

/**
 * Server-only terminal ActivityReceipt gate for a VERIFIED second CCTP mint.
 * The first receive hash remains immutable; separate settlement fields and
 * audit event identify the actual successful second destination transaction.
 */
app.post('/api/bridge/finalize-second-settlement', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthenticatedVeyraUserId(req);
    if (!userId) {
      res.status(401).json({ ok: false, error: 'AUTH_REQUIRED' });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const planId = typeof body?.planId === 'string' ? body.planId.trim() : '';
    if (!planId || planId.length > 160) {
      res.status(400).json({ ok: false, error: 'INVALID_BRIDGE_PLAN' });
      return;
    }

    const { db } = await import('./db/client.js');
    const checkpoint = await getBridgeRecoveryCheckpointForOwner(db, userId, planId);
    if (!checkpoint) {
      res.status(404).json({ ok: false, error: 'BRIDGE_RECOVERY_NOT_FOUND' });
      return;
    }
    await assertBridgeRecoveryWalletOwnership(db, userId, checkpoint);
    if (checkpoint.stage !== 'DESTINATION_BROADCAST') {
      throw new BridgeRecoveryConflictError(
        'Second settlement requires the original destination broadcast checkpoint.',
      );
    }

    const retry = await getSecondDestinationAttempt(db, userId, planId);
    if (!retry || retry.mode !== 'ALREADY_SUBMITTED') {
      throw new BridgeRecoveryConflictError(
        'No recorded second destination receive can be settled.',
      );
    }

    // Revalidate independent Arc/Circle and destination finality NOW, rather
    // than only relying on a previously observed browser or DB status.
    await verifyCctpSourceCheckpointAttestationFromNetwork({
      ...checkpoint,
      stage: 'ATTESTATION_READY',
    });
    const proof = await verifySecondCctpDestinationMintFromNetwork(
      checkpoint,
      retry.txHash,
    );
    const token = checkpoint.destinationChainId ===
      MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID
      ? MANIFEST_CONSTANTS.ETH_SEPOLIA_USDC
      : MANIFEST_CONSTANTS.BASE_SEPOLIA_USDC;
    await recordVerifiedSecondDestinationMint(
      db, userId, planId, proof, token,
    );
    const settled = await finalizeVerifiedSecondCctpSettlement(
      db, userId, planId,
    );

    res.json({
      ok: true,
      planId,
      receiptId: settled.receiptId,
      status: settled.status,
      firstReceiveTxHash: settled.receiveTxHash,
      settlementReceiveTxHash: settled.settlementReceiveTxHash,
      settlementReceiveBlockNumber: settled.settlementReceiveBlockNumber,
      settlementAttemptNumber: settled.settlementAttemptNumber,
      retryAuthorized: false,
    });
  } catch (err) {
    if (err instanceof BridgeRecoveryConflictError) {
      res.status(409).json({
        ok: false,
        error: 'SECOND_CCTP_SETTLEMENT_NOT_VERIFIED',
        message: err.message,
      });
      return;
    }
    console.error('[BFF] /api/bridge/finalize-second-settlement error:', err);
    res.status(503).json({ ok: false, error: 'SECOND_SETTLEMENT_EVIDENCE_UNAVAILABLE' });
  }
});

/**
 * Read-only CCTP V2 usedNonces inspection for an owner's reverted FIRST
 * destination receive. Observations are never authorization to sign a retry.
 *
 * IMPORTANT: usedNonces=0 at a recent block is not a mempool guarantee;
 * another relayer can consume it before the next transaction. The second
 * signing boundary must be separately designed and authorized.
 */
app.post('/api/bridge/inspect-destination-nonce', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthenticatedVeyraUserId(req);
    if (!userId) {
      res.status(401).json({ ok: false, error: 'AUTH_REQUIRED' });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const planId = typeof body?.planId === 'string' ? body.planId.trim() : '';
    if (!planId || planId.length > 160) {
      res.status(400).json({ ok: false, error: 'INVALID_BRIDGE_PLAN' });
      return;
    }

    const { db } = await import('./db/client.js');
    const checkpoint = await getBridgeRecoveryCheckpointForOwner(db, userId, planId);
    if (!checkpoint) {
      res.status(404).json({ ok: false, error: 'BRIDGE_RECOVERY_NOT_FOUND' });
      return;
    }
    await assertBridgeRecoveryWalletOwnership(db, userId, checkpoint);

    // An already claimed second submission may be stuck without a hash.
    // Never treat an unused nonce as permission to reclaim or sign again.
    const history = await getOwnedDestinationAttemptHistory(db, userId, planId);
    if (
      !history ||
      history.first.state !== 'RECORDED' ||
      history.first.reverted !== true ||
      !history.first.receiveTxHash ||
      !history.first.revertBlockHash ||
      history.first.receiveTxHash.toLowerCase() !== checkpoint.receiveTxHash?.toLowerCase() ||
      history.second.state !== 'UNCLAIMED'
    ) {
      throw new BridgeRecoveryConflictError(
        'Nonce inspection requires a verified reverted first receive and no second submission reservation.',
      );
    }

    // Reprove the FIRST attempt's exact recorded transaction/reorg safety,
    // and match the append-only original block hash. Never trust its status
    // from a browser or stale database snapshot alone.
    const first = await verifyRevertedCctpDestinationReceiveFromNetwork(
      checkpoint, history.first.receiveTxHash,
    );
    if (first.destinationBlockHash.toLowerCase() !== history.first.revertBlockHash.toLowerCase()) {
      throw new BridgeRecoveryConflictError(
        'Original destination revert proof is not canonical at the stored block.',
      );
    }

    // The same source/Circle verifier used at the initial signing boundary.
    await verifyCctpSourceCheckpointAttestationFromNetwork({
      ...checkpoint,
      stage: 'ATTESTATION_READY',
    });
    const observation = await inspectCctpDestinationNonceFromNetwork(checkpoint);

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      planId,
      attemptNumber: 1,
      firstRevertBlockHash: first.destinationBlockHash,
      observation,
      retryAuthorized: false,
      caveat: 'Nonce was checked at one canonical destination block. It may change before any transaction.',
    });
  } catch (err) {
    if (err instanceof BridgeRecoveryConflictError) {
      res.status(409).json({
        ok: false,
        error: 'DESTINATION_NONCE_NOT_VERIFIED',
        message: err.message,
        retryAuthorized: false,
      });
      return;
    }
    console.error('[BFF] /api/bridge/inspect-destination-nonce error:', err);
    res.status(503).json({
      ok: false,
      error: 'DESTINATION_NONCE_RPC_UNAVAILABLE',
      retryAuthorized: false,
    });
  }
});

/**
 * Authenticated read-only on-chain resolution of a FIRST destination revert.
 * No browser-supplied tx hash, block, status or confirmations are accepted.
 * Recording this append-only evidence NEVER authorizes a second receiveMessage.
 */
app.post('/api/bridge/resolve-destination-revert', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthenticatedVeyraUserId(req);
    if (!userId) {
      res.status(401).json({ ok: false, error: 'AUTH_REQUIRED' });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const planId = typeof body?.planId === 'string' ? body.planId : '';
    if (!planId || planId.length > 160) {
      res.status(400).json({ ok: false, error: 'INVALID_BRIDGE_PLAN' });
      return;
    }

    const { db } = await import('./db/client.js');
    const checkpoint = await getBridgeRecoveryCheckpointForOwner(db, userId, planId);
    if (!checkpoint) {
      res.status(404).json({ ok: false, error: 'BRIDGE_RECOVERY_NOT_FOUND' });
      return;
    }
    await assertBridgeRecoveryWalletOwnership(db, userId, checkpoint);
    const claim = await getDestinationSubmissionClaim(db, userId, planId);
    if (!claim || claim.mode !== 'ALREADY_SUBMITTED') {
      throw new BridgeRecoveryConflictError(
        'A canonical first destination receive hash must be recorded before revert resolution.',
      );
    }

    const proof = await verifyRevertedCctpDestinationReceiveFromNetwork(
      checkpoint,
      claim.txHash,
    );
    const recorded = await recordVerifiedFirstDestinationRevert(
      db,
      userId,
      planId,
      proof,
    );

    res.json({
      ok: true,
      planId,
      outcome: 'REVERTED',
      attemptNumber: 1,
      evidence: recorded,
      retryAuthorized: false,
    });
  } catch (err) {
    if (err instanceof BridgeRecoveryConflictError) {
      res.status(409).json({
        ok: false,
        error: 'DESTINATION_REVERT_NOT_VERIFIED',
        message: err.message,
      });
      return;
    }
    console.error('[BFF] /api/bridge/resolve-destination-revert error:', err);
    res.status(503).json({ ok: false, error: 'DESTINATION_REVERT_EVIDENCE_UNAVAILABLE' });
  }
});

// ── Shared destination claim for user-signed self-relay ────────────────────
// The server and the browser compete for the SAME durable plan claim. No user
// signature may be requested before this transaction commits. If the browser
// crashes or the wallet RPC loses the broadcast response, do not reopen it.
app.post('/api/bridge/claim-self-receive', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthenticatedVeyraUserId(req);
    if (!userId) {
      res.status(401).json({ ok: false, error: 'AUTH_REQUIRED' });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const planId = typeof body?.planId === 'string' ? body.planId : '';
    if (!planId || planId.length > 160) {
      res.status(400).json({ ok: false, error: 'INVALID_BRIDGE_PLAN' });
      return;
    }

    const { db } = await import('./db/client.js');
    const checkpoint = await getBridgeRecoveryCheckpointForOwner(db, userId, planId);
    if (!checkpoint) {
      res.status(404).json({ ok: false, error: 'BRIDGE_RECOVERY_NOT_FOUND' });
      return;
    }
    await assertBridgeRecoveryWalletOwnership(db, userId, checkpoint);

    // Claiming grants permission to request the user's destination wallet
    // signature. Revalidate reviewed source calldata and Circle's sole
    // canonical MessageSent before granting that permission.
    await verifyCctpSourceCheckpointAttestationFromNetwork(checkpoint);

    const claim = await claimDestinationSubmission(db, userId, planId);
    if (claim.mode !== 'CLAIMED') {
      res.status(409).json({
        ok: false,
        error: 'DESTINATION_SUBMISSION_ALREADY_CLAIMED',
        message:
          'A destination submission was already started; reconcile the original transaction before signing another.',
      });
      return;
    }

    res.json({ ok: true, mode: 'CLAIMED' });
  } catch (err) {
    if (err instanceof BridgeRecoveryConflictError) {
      res.status(409).json({
        ok: false,
        error: 'BRIDGE_RECOVERY_CONFLICT',
        message: err.message,
      });
      return;
    }
    console.error('[BFF] /api/bridge/claim-self-receive error:', err);
    res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

/**
 * The browser can report a self-relay tx hash, but it cannot choose receipt
 * truth. Verify the *actual* chain transaction sender, target and calldata
 * before writing it to the immutable destination submission ledger.
 */
app.post('/api/bridge/record-self-receive', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthenticatedVeyraUserId(req);
    if (!userId) {
      res.status(401).json({ ok: false, error: 'AUTH_REQUIRED' });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const planId = typeof body?.planId === 'string' ? body.planId : '';
    const txHash = typeof body?.txHash === 'string' ? body.txHash : '';
    if (
      !planId ||
      planId.length > 160 ||
      !/^0x[0-9a-fA-F]{64}$/.test(txHash)
    ) {
      res.status(400).json({ ok: false, error: 'INVALID_DESTINATION_SUBMISSION' });
      return;
    }

    const { db } = await import('./db/client.js');
    const checkpoint = await getBridgeRecoveryCheckpointForOwner(db, userId, planId);
    if (!checkpoint) {
      res.status(404).json({ ok: false, error: 'BRIDGE_RECOVERY_NOT_FOUND' });
      return;
    }
    const claim = await getDestinationSubmissionClaim(db, userId, planId);
    if (!claim) {
      throw new BridgeRecoveryConflictError(
        'Self-relay transaction cannot be recorded without a committed destination claim.',
      );
    }
    if (claim.mode === 'ALREADY_SUBMITTED') {
      if (claim.txHash.toLowerCase() !== txHash.toLowerCase()) {
        throw new BridgeRecoveryConflictError('A different destination tx hash is already immutable.');
      }
      res.json({ ok: true, txHash: claim.txHash, alreadyRecorded: true });
      return;
    }

    if (
      checkpoint.destinationChainId !== MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID &&
      checkpoint.destinationChainId !== MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID
    ) {
      throw new BridgeRecoveryConflictError('Unsupported self-relay destination chain.');
    }

    const { createPublicClient, http: viemHttp } = await import('viem');
    const { sepolia, baseSepolia } = await import('viem/chains');
    const destination = checkpoint.destinationChainId === MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID
      ? sepolia
      : baseSepolia;
    const rpcUrl = checkpoint.destinationChainId === MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID
      ? (process.env.ETH_SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com')
      : (process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org');

    const client = createPublicClient({
      chain: destination,
      transport: viemHttp(rpcUrl),
    });
    let transaction;
    try {
      transaction = await client.getTransaction({ hash: txHash as `0x${string}` });
    } catch {
      res.status(503).json({
        ok: false,
        error: 'SELF_RELAY_TRANSACTION_NOT_INDEXED',
        message: 'The destination RPC has not indexed this hash. The claim remains locked; reconcile later.',
      });
      return;
    }

    try {
      // A configured viem chain is not proof that an external RPC URL is
      // actually serving that chain. Hash reconciliation must verify BOTH.
      const rpcChainId = await client.getChainId();
      assertSelfRelayNetworkEvidence(checkpoint, txHash, rpcChainId, {
        hash: transaction.hash,
        from: transaction.from,
        to: transaction.to,
        input: transaction.input,
      });
    } catch (err) {
      throw new BridgeRecoveryConflictError(
        err instanceof Error ? err.message : 'Self-relay call mismatch.',
      );
    }

    await recordDestinationSubmission(db, userId, planId, txHash);
    res.json({ ok: true, txHash, alreadyRecorded: false });
  } catch (err) {
    if (err instanceof BridgeRecoveryConflictError) {
      res.status(409).json({
        ok: false,
        error: 'BRIDGE_RECOVERY_CONFLICT',
        message: err.message,
      });
      return;
    }
    console.error('[BFF] /api/bridge/record-self-receive error:', err);
    res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
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

app.post('/api/bridge/relay-receive', IDENTITY_RATE, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getAuthenticatedVeyraUserId(req);
    if (!userId) {
      res.status(401).json({ ok: false, error: 'AUTH_REQUIRED' });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const planId = typeof body.planId === 'string' ? body.planId.trim() : '';
    if (!planId) {
      res.status(400).json({
        ok: false,
        error: 'PLAN_ID_REQUIRED',
        message: 'planId is required for an owned bridge recovery relay',
      });
      return;
    }

    const { db } = await import('./db/client.js');
    const checkpoint = await getBridgeRecoveryCheckpointForOwner(
      db,
      userId,
      planId,
    );
    if (!checkpoint) {
      res.status(404).json({
        ok: false,
        error: 'BRIDGE_RECOVERY_NOT_FOUND',
      });
      return;
    }

    await assertBridgeRecoveryWalletOwnership(db, userId, checkpoint);

    // A separate durable claim is committed before any wallet broadcast.
    // Crashed/missing-hash submissions remain UNCERTAIN, never auto-retry.
    const previousClaim = await getDestinationSubmissionClaim(
      db, userId, planId,
    );
    if (previousClaim?.mode === 'ALREADY_SUBMITTED') {
      res.json({
        ok: true,
        alreadySubmitted: true,
        alreadyReceived: false,
        txHash: previousClaim.txHash,
      });
      return;
    }
    if (previousClaim?.mode === 'UNCERTAIN') {
      throw new BridgeRecoveryConflictError(
        'Destination submission is uncertain after a prior relay claim. Reconcile chain/provider evidence before any retry.',
      );
    }

    const {
      createWalletClient,
      createPublicClient,
      http: viemHttp,
      parseAbi,
    } = await import('viem');

    // Both server relay and wallet-signed self-relay now use the SAME
    // independent proof: exact source tx hash/sender/TokenMessenger target,
    // reviewed depositForBurn calldata and event, canonical single
    // MessageSent, and unique Circle attestation matching the checkpoint.
    // Do not start a destination signature/broadcast if ANY check fails.
    await verifyCctpSourceCheckpointAttestationFromNetwork(checkpoint);

    const relay = evaluateBridgeRelayDecision(checkpoint);

    if (relay.mode === 'ALREADY_SUBMITTED') {
      res.json({
        ok: true,
        alreadySubmitted: true,
        alreadyReceived: false,
        txHash: relay.receiveTxHash,
      });
      return;
    }

    const { destinationChainId, message, attestation } = relay;
    if (
      destinationChainId !== MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID &&
      destinationChainId !== MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID
    ) {
      res.status(400).json({
        ok: false,
        error: 'UNSUPPORTED_CCTP_RELAY_DESTINATION',
      });
      return;
    }

    // A raw relay key is permitted only outside mainnet. Mainnet startup already
    // rejects RELAY_PRIVATE_KEY and requires the separate KMS/HSM signer boundary.
    const relayKey = process.env.RELAY_PRIVATE_KEY;
    if (!relayKey) {
      res.status(503).json({
        ok: false,
        selfRelay: true,
        reason:
          'Server relay signer is not configured. The user must complete the destination receive flow.',
      });
      return;
    }

    const { privateKeyToAccount } = await import('viem/accounts');
    const {
      sepolia: sepoliaChain,
      baseSepolia: baseSepoliaChain,
    } = await import('viem/chains');

    const relayChain =
      destinationChainId === MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID
        ? sepoliaChain
        : baseSepoliaChain;
    const transmitter =
      MANIFEST_CONSTANTS.CCTP_V2_MESSAGE_TRANSMITTER as `0x${string}`;
    const RECEIVE_ABI = parseAbi([
      'function receiveMessage(bytes message, bytes attestation) returns (bool success)',
    ]);

    const relayAccount = privateKeyToAccount(relayKey as `0x${string}`);
    const publicClient = createPublicClient({
      chain: relayChain,
      transport: viemHttp(),
    });
    const walletClient = createWalletClient({
      account: relayAccount,
      chain: relayChain,
      transport: viemHttp(),
    });

    try {
      await publicClient.simulateContract({
        address: transmitter,
        abi: RECEIVE_ABI,
        functionName: 'receiveMessage',
        args: [message as `0x${string}`, attestation as `0x${string}`],
        account: relayAccount.address,
      });
    } catch (simErr) {
      const errMsg = simErr instanceof Error ? simErr.message : String(simErr);
      if (errMsg.toLowerCase().includes('nonce already used')) {
        res.json({
          ok: true,
          alreadyReceived: true,
          alreadySubmitted: false,
          txHash: null,
        });
        return;
      }
      res.status(422).json({
        ok: false,
        error: 'RELAY_SIMULATION_FAILED',
        message: errMsg,
      });
      return;
    }

    // Atomic, crash-safe claim BEFORE opening the wallet broadcast boundary.
    // Two requests that passed simulation concurrently still cannot both send.
    const claim = await claimDestinationSubmission(db, userId, planId);
    if (claim.mode === 'ALREADY_SUBMITTED') {
      res.json({
        ok: true,
        alreadySubmitted: true,
        alreadyReceived: false,
        txHash: claim.txHash,
      });
      return;
    }
    if (claim.mode === 'UNCERTAIN') {
      throw new BridgeRecoveryConflictError(
        'Destination submission already claimed; the tx hash is not yet known. No automatic duplicate relay is allowed.',
      );
    }

    // A failure after this line leaves the durable claim UNCERTAIN, even when
    // the client reports a timeout. Never release it based on RPC errors.
    const txHash = await walletClient.writeContract({
      address: transmitter,
      abi: RECEIVE_ABI,
      functionName: 'receiveMessage',
      args: [message as `0x${string}`, attestation as `0x${string}`],
    });

    // The hash, the canonical checkpoint and the immutable broadcast event
    // are committed together. A crash before commit remains fail-closed.
    await recordDestinationSubmission(db, userId, planId, txHash);

    res.json({
      ok: true,
      alreadyReceived: false,
      alreadySubmitted: false,
      txHash,
    });
  } catch (err) {
    if (err instanceof BridgeRecoveryConflictError) {
      res.status(409).json({
        ok: false,
        error: 'BRIDGE_RELAY_CONFLICT',
        message: err.message,
      });
      return;
    }
    console.error('[BFF] /api/bridge/relay-receive error:', err);
    res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
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

app.get('/api/health/database', async (_req: Request, res: Response): Promise<void> => {
  const report = await probeDatabaseReadiness(process.env.DATABASE_URL);
  res.status(report.ready ? 200 : 503).json({ ok: report.ready, ...report, ts: Date.now() });
});

app.get('/api/health/providers', async (_req: Request, res: Response): Promise<void> => {
  const report = await refreshMainnetProviderHealth(process.env);
  const ok = report.providerRecords.length > 0 && report.providerRecords.every((record) => record.status === 'OK');
  res.status(ok ? 200 : 503).json({ ok, ...report, ts: Date.now() });
});

app.get('/api/health/signer', async (_req: Request, res: Response): Promise<void> => {
  const report = await probeSignerReadiness(process.env);
  res.status(report.ready ? 200 : 503).json({ ok: report.ready, ...report, ts: Date.now() });
});

app.get('/api/health/readiness', async (_req: Request, res: Response): Promise<void> => {
  const [database, signer] = await Promise.all([
    probeDatabaseReadiness(process.env.DATABASE_URL),
    probeSignerReadiness(process.env),
  ]);
  if (runtimeConfig.environment === 'mainnet') {
    await refreshMainnetProviderHealth(process.env);
  }
  const report = evaluateMainnetReadiness(process.env, PROVIDER_MANIFEST, {
    database,
    signer,
    providerHealth: getAllProviderHealthRecords(),
  });
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
