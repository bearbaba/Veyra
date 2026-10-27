/**
 * Only these identity, owner-activity and reviewed-pay routes may be forwarded
 * from the protected unified Testnet host to the hosted Render Testnet BFF.
 * A route added here must be independently reviewed; never use /api/:path*.
 */
export const STAGING_BFF_ORIGIN='https://veyra-testnet-acceptance-bff.onrender.com';
export const STAGING_ALLOWED_PATHS=[
  "/api/health",
  "/api/health/readiness",
  "/api/auth/wallet-login/challenge",
  "/api/auth/wallet-login/complete",
  "/api/auth/session/restore",
  "/api/auth/session/logout",
  // X OAuth only becomes interactive if this exact BFF reports a reviewed
  // callback/client configuration. The callback itself stays on Render.
  "/api/auth/x/capability",
  "/api/auth/x/start",
  "/api/auth/x/finish",
  "/api/identity/register/challenge",
  "/api/identity/register/complete",
  "/api/identity/resolve",
  "/api/identity/prepare-payment",
  "/api/identity/verify-payment",
  "/api/profile/me",
  "/api/social/friends",
  "/api/social/chat/capability",
  "/api/social/chat",
  "/api/social/chat/send",
  "/api/social/friend/request",
  "/api/social/friend/respond",
  "/api/social/block",
  "/api/social/unblock",
  "/api/notifications",
  "/api/notifications/read",
  "/api/notifications/sync-incoming",
  "/api/receipts",
  "/api/receipts/resumable",
  "/api/receipts/sync",
  "/api/receipts/bridge",
  // Agent cannot sign; only the reviewed chat/status endpoints are exposed.
  "/api/agent/status",
  "/api/agent/chat",
  // Circle Iris testnet source-domain/hash are validated inside the BFF.
  "/api/cctp/health",
  "/api/cctp/attestation",
  // Recovery requires wallet-bound authentication and independent chain proof.
  "/api/receipts/cctp/resolve-source-revert",
  "/api/bridge/persist",
  "/api/bridge/pending",
  "/api/bridge/destination-attempts",
  "/api/bridge/reconcile-second-receive",
  "/api/bridge/inspect-destination-nonce",
  "/api/bridge/resolve-destination-revert",
  "/api/bridge/claim-self-receive",
  "/api/bridge/record-self-receive",
  "/api/bridge/relay-receive",
  // Separately verified second attempt mint and terminal settlement; read-only
  // chain proof. These endpoints never sign or broadcast transactions.
  "/api/bridge/verify-second-destination",
  "/api/bridge/finalize-second-settlement"
] as const;
export const STAGING_APPROVED_REWRITES=STAGING_ALLOWED_PATHS.map(source=>({
  source,destination:STAGING_BFF_ORIGIN+source,
}));
export function isExactStagingBffAllowlist(value:unknown):boolean {
  return JSON.stringify(value)===JSON.stringify(STAGING_APPROVED_REWRITES);
}
