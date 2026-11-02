/** Preflight for switching the ONLY public Veyra app to its isolated Mainnet BFF.
 * Does not deploy or contact any service; deliberately fails on Testnet rewrites.
 */
export type VercelRewrite={source:string;destination:string};
export type VercelRoutingConfig={rewrites?:VercelRewrite[]};
export const MAINNET_RECEIPT_ROUTES=[
 '/api/identity/mainnet-capability',
 '/api/auth/wallet-login/challenge',
 '/api/auth/wallet-login/complete',
 '/api/auth/session/restore',
 '/api/auth/session/logout',
 '/api/identity/register/challenge',
 '/api/identity/register/complete',
 '/api/identity/resolve',
 '/api/identity/prepare-payment',
 '/api/identity/verify-payment',
 '/api/profile/me',
 '/api/social/friends',
 '/api/mainnet/pay/receipt/verify',
 '/api/mainnet/pay/receipts',
 '/api/health/database',
 '/api/social/friend/request',
 '/api/social/friend/respond',
 '/api/social/friend/status',
 '/api/social/block',
 '/api/social/unblock',
 '/api/preferences/receive',
] as const;
export function verifyProductionMainnetRouting(
 config:VercelRoutingConfig,mainnetBackendOrigin:string,
):{ok:boolean;issues:string[]}{
 const issues:string[]=[];
 let origin='';
 try{
  const u=new URL(mainnetBackendOrigin);
  if(u.protocol!=='https:'||u.origin!==mainnetBackendOrigin||u.username||u.password||
    u.hostname==='localhost'||/testnet|sepolia|staging|preview/i.test(u.hostname)||
    u.hostname==='veyra-seven-beta.vercel.app')
   throw Error('invalid Mainnet backend origin');
  origin=u.origin;
 }catch{issues.push('Expected a separate exact HTTPS Mainnet BFF origin (not Testnet, Preview or app itself).');}
 const all=config.rewrites??[];
 for(const path of MAINNET_RECEIPT_ROUTES){
  const matches=all.filter(r=>r.source===path);
  if(matches.length!==1||matches[0]?.destination!==origin+path)
   issues.push('Missing or wrong Mainnet BFF rewrite: '+path);
 }
 for(const r of all){
  if(r.source.startsWith('/api/')&&(/testnet|sepolia/i.test(r.destination)||!r.destination.startsWith('https://')))
   issues.push('Unsafe API rewrite: '+r.source);
 }
 return {ok:issues.length===0,issues};
}
