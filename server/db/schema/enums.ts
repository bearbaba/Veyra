import { pgEnum } from 'drizzle-orm/pg-core';

// ── User / Account ─────────────────────────────────────────────────────────
export const userStatusEnum = pgEnum('user_status', [
  'ACTIVE',
  'SUSPENDED',
  'DELETED',
]);

export const profileVisibilityEnum = pgEnum('profile_visibility', [
  'PUBLIC',
  'FOLLOWERS_ONLY',
  'PRIVATE',
]);

export const profileSourceEnum = pgEnum('profile_source', ['VEYRA', 'X_IMPORT']);

// ── Linked Identities ───────────────────────────────────────────────────────
export const linkedIdentityProviderEnum = pgEnum('linked_identity_provider', [
  'X',
  'ENS',
  'FARCASTER',
]);

export const linkedIdentityStatusEnum = pgEnum('linked_identity_status', [
  'ACTIVE',
  'REVOKED',
  'EXPIRED',
]);

// ── Wallets ─────────────────────────────────────────────────────────────────
export const walletTypeEnum = pgEnum('wallet_type', ['EOA', 'SCA', 'MODULAR']);

export const walletProofSchemeEnum = pgEnum('wallet_proof_scheme', [
  'EIP_712',
  'PERSONAL_SIGN',
]);

export const walletStatusEnum = pgEnum('wallet_status', [
  'ACTIVE',
  'REVOKED',
  'SUSPENDED',
]);

// ── Social ──────────────────────────────────────────────────────────────────
export const preferenceVisibilityEnum = pgEnum('preference_visibility', [
  'PUBLIC',
  'FRIENDS_ONLY',
  'PRIVATE',
]);

export const followStatusEnum = pgEnum('follow_status', [
  'FOLLOWING',
  'UNFOLLOWED',
]);

export const connectionStatusEnum = pgEnum('connection_status', [
  'PENDING_INITIATOR',
  'PENDING_TARGET',
  'CONNECTED',
  'REJECTED',
  'DISCONNECTED',
]);

export const blockStatusEnum = pgEnum('block_status', ['BLOCKED', 'UNBLOCKED']);

// ── Receipts / Execution ────────────────────────────────────────────────────
export const receiptStatusEnum = pgEnum('receipt_status', [
  'INTENT_CAPTURED',
  'QUOTE_RESERVED',
  'PREFLIGHT_PASSED',
  'SIGNED',
  'BROADCAST',
  'CONFIRMING',
  'CONFIRMED',
  'SOURCE_CONFIRMED',
  'ATTESTATION_PENDING',
  'FAILED',
  'RECEIVE_PENDING',
  'RECEIVE_FAILED_RETRYABLE',
  'COMPLETE',
  'DUPLICATE_DETECTED',
  'INVALIDATED',
  'CANCELLED',
]);

export const executionEventTypeEnum = pgEnum('execution_event_type', [
  'INTENT_CAPTURED',
  'QUOTE_RESERVED',
  'PREFLIGHT_CHECK',
  'SNAPSHOT_FROZEN',
  'SNAPSHOT_VERIFIED',
  'SNAPSHOT_INVALIDATED',
  'POLICY_EVALUATED',
  'USER_CONFIRMED',
  'BURN_SUBMITTED',
  'BURN_CONFIRMED',
  'ATTESTATION_REQUESTED',
  'ATTESTATION_COMPLETE',
  'RELAY_SUBMITTED',
  'RELAY_CONFIRMED',
  'RECEIVE_SUBMITTED',
  'RECEIVE_CONFIRMED',
  'RECEIVE_FAILED',
  'RECEIPT_COMPLETE',
  'RECEIPT_FAILED',
  'DUPLICATE_REJECTED',
  'RESUMED',
  'CANCELLED',
  'STATUS_TRANSITION',
]);

export const quoteStatusEnum = pgEnum('quote_status', [
  'AVAILABLE',
  'RESERVED',
  'BROADCAST',
  'USED',
  'EXPIRED',
]);

export const intentSurfaceEnum = pgEnum('intent_surface', [
  'PAY',
  'AGENT',
  'BRIDGE',
  'REQUEST',
]);

export const intentStatusEnum = pgEnum('intent_status', [
  'PENDING',
  'RESOLVED',
  'POLICY_BLOCKED',
  'CANCELLED',
  'EXECUTED',
]);

// ── Audit ───────────────────────────────────────────────────────────────────
export const revisionTriggerEnum = pgEnum('revision_trigger', [
  'WALLET_ADDED',
  'WALLET_REVOKED',
  'RECEIVE_PREFERENCE_CHANGED',
  'LINKED_IDENTITY_ADDED',
  'LINKED_IDENTITY_REVOKED',
  'HANDLE_CHANGED',
  'ACCOUNT_SUSPENDED',
  'ACCOUNT_RESTORED',
  'PROFILE_UPDATED',
]);

// ── Posts (schema-forward) ──────────────────────────────────────────────────
export const postVisibilityEnum = pgEnum('post_visibility', [
  'PUBLIC',
  'FOLLOWERS_ONLY',
  'PRIVATE',
]);

export const postInteractionTypeEnum = pgEnum('post_interaction_type', [
  'LIKE',
  'REPLY',
  'REPOST',
  'TIP',
]);
