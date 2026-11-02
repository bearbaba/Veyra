import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {validateServerRuntimeConfig} from '../../server/config/runtimeConfig';
import {isMainnetIdentityOnlyRouteAllowed} from '../../server/services/mainnetIdentityOnlyRoutes';
const origin='https://veyra-seven-beta.vercel.app';
const safe:NodeJS.ProcessEnv={
 NODE_ENV:'production',VEYRA_ENV:'mainnet',VEYRA_HOSTED_BACKEND:'1',
 VEYRA_MAINNET_IDENTITY_ONLY:'1',VEYRA_APP_ORIGIN:origin,
 VEYRA_SESSION_SECRET:'A'.repeat(64),
 DATABASE_URL:'postgresql://u:p@dpg-mainnet.internal/db',
 VEYRA_DATABASE_PRIVATE_NETWORK:'1',
 ARC_MAINNET_RPC_URL:'https://rpc.arc.network',
};
const src=(p:string)=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
describe('Budget-friendly Mainnet ID and receipt-only deployment boundary',()=>{
 it('accepts exact isolated Mainnet configuration without paid signer or X OAuth',()=>{
  expect(validateServerRuntimeConfig(safe)).toMatchObject({ok:true,errors:[]});
 });
 it('refuses cross-environment, unhosted, mismatched origin, plaintext RPC and signing credentials',()=>{
  const changes=[
   {VEYRA_ENV:'testnet',VEYRA_TESTNET_ADDITIONAL_ORIGIN:origin},
   {VEYRA_HOSTED_BACKEND:'0'},
   {VEYRA_APP_ORIGIN:'https://preview.vercel.app'},
   {DATABASE_URL:undefined},
   {VEYRA_DATABASE_PRIVATE_NETWORK:'0'},
   {ARC_MAINNET_RPC_URL:'http://rpc.arc.network'},
   {ARC_MAINNET_RPC_URL:'https://testnet.arc.network'},
   {VEYRA_SIGNER_BACKEND:'kms',VEYRA_KMS_KEY_ID:'a'},
   {RELAY_PRIVATE_KEY:'0x'+'1'.repeat(64)},
   {CIRCLE_API_KEY:'provider-key'},
   {X_CLIENT_SECRET:'oauth-secret'},
  ];
  for(const patch of changes){
   const result=validateServerRuntimeConfig({...safe,...patch});
   expect(result.ok).toBe(false);
  }
 });
 it('only permits identity, friends, receive preference and canonical Pay receipt endpoints',()=>{
  for(const endpoint of [
   ['POST','/api/identity/mainnet-capability'],['POST','/api/identity/register/complete'],
   ['POST','/api/auth/wallet-login/complete'],['POST','/api/identity/prepare-payment'],
   ['POST','/api/identity/verify-payment'],['GET','/api/social/friends'],
   ['POST','/api/social/friend/request'],['POST','/api/social/block'],
   ['PATCH','/api/preferences/receive'],['POST','/api/mainnet/pay/receipt/verify'],
   ['GET','/api/mainnet/pay/receipts'],['GET','/api/health'],['GET','/api/health/database']
  ])expect(isMainnetIdentityOnlyRouteAllowed(endpoint[0],endpoint[1])).toBe(true);
  for(const endpoint of [
   ['POST','/api/bridge/relay-receive'],['POST','/api/gateway/estimate'],
   ['POST','/api/stablefx/trade'],['POST','/api/agent/chat'],
   ['POST','/api/auth/x/start'],['GET','/api/auth/x/callback'],
   ['POST','/api/receipts/bridge'],['GET','/api/health/signer'],
   ['DELETE','/api/profile/me'],['POST','/api/identity/register/challenge/../complete'],
  ])expect(isMainnetIdentityOnlyRouteAllowed(endpoint[0],endpoint[1])).toBe(false);
 });
 it('never calls the Testnet notification service from Mainnet People',()=>{
  const social=src('src/features/social/UnifiedSocial.tsx');
  expect(social).toContain("VEYRA_ENV==='mainnet'?Promise.resolve<NoticesPage>");
  expect(social).toContain("if(VEYRA_ENV==='mainnet'){setIncomingStatus('unavailable');return;}");
 });
 it('keeps X OAuth disabled in Mainnet V1 without redirecting to another wallet site',()=>{
  const x=src('src/lib/api/identityApi.ts');
  const settings=src('src/components/pages/SettingsPage.tsx');
  expect(x).toContain("if(VEYRA_ENV==='mainnet')");
  expect(x).not.toContain('Open the stable Veyra Testnet V2 domain.');
  expect(settings).toContain('X linking is not enabled in Mainnet V1');
 });
 it('enforces the restrictive boundary BEFORE all business API routes',()=>{
  const server=src('server/bff.ts');
  const middleware=server.indexOf("app.use('/api', (req:Request,res:Response,next:NextFunction)");
  const firstBusiness=server.indexOf("app.post('/api/identity/mainnet-capability'");
  expect(middleware).toBeGreaterThan(0);
  expect(middleware).toBeLessThan(firstBusiness);
  expect(src('Dockerfile.bff.mainnet')).toContain('VEYRA_MAINNET_IDENTITY_ONLY=1');
 });
});
