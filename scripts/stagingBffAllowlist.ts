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
  "/api/identity/register/challenge",
  "/api/identity/register/complete",
  "/api/identity/resolve",
  "/api/identity/prepare-payment",
  "/api/identity/verify-payment",
  "/api/profile/me",
  "/api/social/friends",
  "/api/social/friend/request",
  "/api/social/friend/respond",
  "/api/social/block",
  "/api/social/unblock",
  "/api/notifications",
  "/api/notifications/read",
  "/api/receipts",
  "/api/receipts/resumable",
  "/api/receipts/sync",
  "/api/receipts/bridge"
] as const;
export const STAGING_APPROVED_REWRITES=STAGING_ALLOWED_PATHS.map(source=>({
  source,destination:STAGING_BFF_ORIGIN+source,
}));
export function isExactStagingBffAllowlist(value:unknown):boolean {
  return JSON.stringify(value)===JSON.stringify(STAGING_APPROVED_REWRITES);
}
