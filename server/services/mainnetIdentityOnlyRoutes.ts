/** Allowlist for the wallet-signed, NO-RELAY Mainnet V1 identity/receipts BFF.
 * Enforced BEFORE all business routes, including Agent, Bridge, Gateway, X.
 * This mode is never permitted for the fully featured Mainnet signer release.
 */
const allowed=new Set([
 'GET /api/health',
 'GET /api/health/database',
 'POST /api/identity/mainnet-capability',
 'POST /api/auth/wallet-login/challenge',
 'POST /api/auth/wallet-login/complete',
 'POST /api/auth/session/restore',
 'POST /api/auth/session/logout',
 'POST /api/identity/register/challenge',
 'POST /api/identity/register/complete',
 'POST /api/identity/resolve',
 'POST /api/identity/prepare-payment',
 'POST /api/identity/verify-payment',
 'GET /api/profile/me',
 'PATCH /api/profile/me',
 'GET /api/social/friends',
 'POST /api/social/friend/request',
 'POST /api/social/friend/respond',
 'GET /api/social/friend/status',
 'POST /api/social/block',
 'POST /api/social/unblock',
 'GET /api/preferences/receive',
 'PATCH /api/preferences/receive',
 'POST /api/mainnet/pay/receipt/verify',
 'GET /api/mainnet/pay/receipts',
 // Read-only canonical contract proof indexing; these routes never sign or relay.
 'POST /api/mainnet/settlement/receipt/verify',
 'GET /api/mainnet/settlement/receipts',
 'POST /api/mainnet/exchange/across/quote',
 'GET /api/mainnet/exchange/across/capability',
 'GET /api/mainnet/exchange/across/status',
 'POST /api/auth/x/capability',
]);
export function isMainnetIdentityOnlyRouteAllowed(method:string,path:string):boolean{
 if(!/^\/[a-z0-9_/-]+$/.test(path)||!['GET','POST','PATCH'].includes(method))return false;
 return allowed.has(method+' '+path);
}
