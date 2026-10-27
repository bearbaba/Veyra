import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  STAGING_ALLOWED_PATHS,
  STAGING_APPROVED_REWRITES,
  STAGING_BFF_ORIGIN,
  isExactStagingBffAllowlist,
} from '../../scripts/stagingBffAllowlist';

const root = (path: string) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const bff = root('server/bff.ts');
const vercel = JSON.parse(root('vercel.json')) as {
  rewrites: Array<{ source: string; destination: string }>;
};
const routeSource = (path: string): string => {
  const route = ['get', 'post', 'patch', 'put', 'delete']
    .map(method => bff.indexOf("app." + method + "('" + path + "'"))
    .find(index => index >= 0);
  if (route === undefined) throw new Error('Unimplemented Veyra backend route: ' + path);
  const end = bff.indexOf('\napp.', route + 5);
  return bff.slice(route, end < 0 ? bff.length : end);
};
const strictOwnerPaths = [
  '/api/receipts/cctp/resolve-source-revert',
  '/api/bridge/persist',
  '/api/bridge/pending',
  '/api/bridge/destination-attempts',
  '/api/bridge/reconcile-second-receive',
  '/api/bridge/inspect-destination-nonce',
  '/api/bridge/resolve-destination-revert',
  '/api/bridge/claim-self-receive',
  '/api/bridge/record-self-receive',
  '/api/bridge/relay-receive',
  '/api/bridge/verify-second-destination',
  '/api/bridge/finalize-second-settlement',
];

describe('full Testnet BFF routing is exact, implemented and owner-protected', () => {
  it('all forwarded API paths exist as literal BFF handlers (not SPA/HTML fallbacks)', () => {
    // The two purpose-bound cookie restore/logout endpoints are explicitly reviewed.
    expect(STAGING_ALLOWED_PATHS.length).toBe(45);
    const unique = new Set<string>(STAGING_ALLOWED_PATHS);
    expect(unique.size).toBe(STAGING_ALLOWED_PATHS.length);
    for (const path of STAGING_ALLOWED_PATHS) {
      expect(path).toMatch(/^\/api\/[a-z0-9/-]+$/);
      expect(() => routeSource(path), path).not.toThrow();
      expect(STAGING_APPROVED_REWRITES).toContainEqual({
        source: path, destination: STAGING_BFF_ORIGIN + path,
      });
    }
    expect(vercel.rewrites).toEqual(STAGING_APPROVED_REWRITES);
    expect(isExactStagingBffAllowlist(vercel.rewrites)).toBe(true);
  });

  it('chat routes use wallet-bound sessions and do not allow unauthenticated creation of messages or payment notices',()=>{
    for(const path of ['/api/social/chat','/api/social/chat/send','/api/social/chat/capability']){
      expect(STAGING_ALLOWED_PATHS).toContain(path);
      expect(routeSource(path)).toContain('getAuthenticatedVeyraUserId(req)');
    }
    expect(routeSource('/api/social/chat/send')).toContain('sendDirectMessage(db,owner');
    expect(routeSource('/api/social/chat')).toContain('listDirectMessages(db,owner');
    expect(root('server/services/directMessageService.ts')).toContain("getConnectionStatus(db,owner,peer)!=='CONNECTED'");
    expect(root('server/services/directMessageService.ts')).toContain("kind:'MESSAGE'");
    expect(STAGING_ALLOWED_PATHS).not.toContain('/api/notifications/create');
  });
  it('each source burn or destination recovery endpoint checks signed owner identity', () => {
    for (const path of strictOwnerPaths) {
      expect(STAGING_ALLOWED_PATHS).toContain(path);
      expect(routeSource(path), path).toContain('getAuthenticatedVeyraUserId(req)');
    }
    const relay = routeSource('/api/bridge/relay-receive');
    expect(relay).toContain('getBridgeRecoveryCheckpointForOwner');
    expect(relay).toContain('verifyCctpSourceCheckpointAttestationFromNetwork');
    expect(relay).toContain('claimDestinationSubmission');
    const settlement = routeSource('/api/bridge/finalize-second-settlement');
    expect(settlement).toContain('verifySecondCctpDestinationMintFromNetwork');
    expect(settlement).toContain('finalizeVerifiedSecondCctpSettlement');
    expect(settlement).not.toContain('writeContract(');
    const cctp = routeSource('/api/cctp/attestation');
    expect(cctp).toContain('MANIFEST_CONSTANTS.ARC_TESTNET_CCTP_DOMAIN');
    expect(cctp).toContain('/v2/messages/');
  });

  it('exposes guarded X start, but not callback forwarding, autonomous signing, or unverified FX/Swap/Gateway', () => {
    expect(routeSource('/api/auth/x/capability')).toContain('checkedXReturnOrigin(origin');
    const xStart=routeSource('/api/auth/x/start');
    expect(xStart).toContain('getAuthenticatedVeyraUserId(req)');
    expect(xStart).toContain("checkedXReturnOrigin(req.header('origin')");
    expect(xStart).toContain('beginXOAuthLink(db');
    const denied = [
      '/api/:path*',
      '/api/agent/execute',
      '/api/auth/x/callback',
      '/api/stablefx/quote',
      '/api/stablefx/trade',
      '/api/swap/execute',
      '/api/bridge/execute',
    ];
    for (const path of denied) expect(STAGING_ALLOWED_PATHS).not.toContain(path);
    expect(routeSource('/api/agent/status')).toContain("execution: 'LOCKED'");
    expect(routeSource('/api/agent/chat')).toContain("execution: 'LOCKED'");
    expect(root('src/providers/registry/mainnetProviderManifest.ts')).not.toMatch(/enabled:\s*true/);
  });
});
