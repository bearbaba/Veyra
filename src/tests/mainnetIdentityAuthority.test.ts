import {describe,it,expect,vi,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {evaluateMainnetIdentityAuthority,OFFICIAL_VEYRA_ORIGIN} from '../../server/services/mainnetIdentityCapability';
import {isWalletLoginChainAllowed,resolveTrustedLoginOriginForEnv} from '../../server/services/walletLoginService';
import {issueBrowserRestoreCookie,verifyBrowserRestoreCookie} from '../../server/auth/browserRestoreSession';
import {isMainnetIdentityCapability,probeMainnetIdentityOrigin} from '../lib/api/identityOriginProbe';
const source=(p:string)=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const wallet='0x1111111111111111111111111111111111111111',user='usr_11111111111111111111';
const secret='s'.repeat(64),now=1793600000000;
const runtime={environment:'mainnet' as const,nodeEnv:'production',hostedBackend:true,
 appOrigin:OFFICIAL_VEYRA_ORIGIN,databaseUrl:'postgres://u:p@db.example.com/db',
 sessionSecretConfigured:true,testnetSecondaryAppOrigin:undefined};
const json=(status:number,data:unknown):Response=>({status,headers:{get:()=> 'application/json'},json:async()=>data}) as Response;
afterEach(()=>vi.unstubAllGlobals());
describe('Exactly one authorized Veyra Mainnet identity origin',()=>{
 it('accepts only the canonical hosted Mainnet service and explicit Arc chain authority',()=>{
  const good=evaluateMainnetIdentityAuthority(runtime,OFFICIAL_VEYRA_ORIGIN);
  expect(good).toEqual({ok:true,environment:'mainnet',origin:OFFICIAL_VEYRA_ORIGIN,
   chainId:5042,walletLogin:true,recipientSnapshots:true,cookieRestore:true});
  expect(isMainnetIdentityCapability(good)).toBe(true);
  for(const changes of [{environment:'testnet' as const},{hostedBackend:false},{nodeEnv:'development'},
    {sessionSecretConfigured:false},{appOrigin:'https://other.example'},{databaseUrl:undefined},
    {testnetSecondaryAppOrigin:'https://other.example'}])
   expect(evaluateMainnetIdentityAuthority({...runtime,...changes},OFFICIAL_VEYRA_ORIGIN)).toBeNull();
  expect(evaluateMainnetIdentityAuthority(runtime,'https://preview.vercel.app')).toBeNull();
  expect(evaluateMainnetIdentityAuthority(runtime,undefined)).toBeNull();
 });
 it('rejects Testnet capability, lookalike payloads and absent proof',()=>{
  for(const v of [{ok:true},{ok:true,environment:'testnet',origin:OFFICIAL_VEYRA_ORIGIN,chainId:5042},
    {ok:true,environment:'mainnet',origin:OFFICIAL_VEYRA_ORIGIN,chainId:5042002},
    {ok:true,environment:'mainnet',origin:OFFICIAL_VEYRA_ORIGIN,chainId:5042},null])
   expect(isMainnetIdentityCapability(v)).toBe(false);
 });
 it('probes the one Mainnet domain without wallet prompts and fails closed',async()=>{
  const result=evaluateMainnetIdentityAuthority(runtime,OFFICIAL_VEYRA_ORIGIN)!;
  const mock=vi.fn(()=>Promise.resolve(json(200,result)));
  vi.stubGlobal('fetch',mock);
  expect(await probeMainnetIdentityOrigin(undefined,OFFICIAL_VEYRA_ORIGIN)).toBe('ready');
  expect(mock.mock.calls[0]?.[0]).toBe('/api/identity/mainnet-capability');
  expect(await probeMainnetIdentityOrigin(undefined,'https://preview.vercel.app')).toBe('origin_blocked');
  expect(mock).toHaveBeenCalledTimes(1);
  vi.stubGlobal('fetch',vi.fn(()=>Promise.resolve(json(503,{error:'MAINNET_IDENTITY_NOT_READY'}))));
  expect(await probeMainnetIdentityOrigin(undefined,OFFICIAL_VEYRA_ORIGIN)).toBe('offline');
 });
 it('pins EIP-712 login to the Mainnet wallet binding and exact official origin',()=>{
  const env={VEYRA_ENV:'mainnet',VEYRA_APP_ORIGIN:OFFICIAL_VEYRA_ORIGIN};
  expect(isWalletLoginChainAllowed(5042,env)).toBe(true);
  expect(isWalletLoginChainAllowed(5042002,env)).toBe(false);
  expect(isWalletLoginChainAllowed(5042,{...env,VEYRA_ENV:'testnet'})).toBe(false);
  expect(resolveTrustedLoginOriginForEnv(OFFICIAL_VEYRA_ORIGIN,OFFICIAL_VEYRA_ORIGIN,env)).toBe(OFFICIAL_VEYRA_ORIGIN);
  expect(()=>resolveTrustedLoginOriginForEnv('https://evil.example',undefined,env)).toThrow('LOGIN_ORIGIN_NOT_ALLOWED');
 });
 it('issues HMAC cookie with Mainnet chain; legacy cookies are not enough to restore Mainnet',()=>{
  const newer=issueBrowserRestoreCookie(user,wallet,OFFICIAL_VEYRA_ORIGIN,secret,now,5042);
  const legacy=issueBrowserRestoreCookie(user,wallet,OFFICIAL_VEYRA_ORIGIN,secret,now);
  expect(verifyBrowserRestoreCookie(newer,secret,OFFICIAL_VEYRA_ORIGIN,wallet,now+1)?.chainId).toBe(5042);
  expect(verifyBrowserRestoreCookie(legacy,secret,OFFICIAL_VEYRA_ORIGIN,wallet,now+1)?.chainId).toBeUndefined();
  expect(verifyBrowserRestoreCookie(newer,secret,'https://other.example',wallet,now+1)).toBeNull();
  const server=source('server/bff.ts');
  expect(server).toContain('claims.chainId!==5042');
  expect(server).toContain('wb.chain_id = ${requiredChainId}');
 });
 it('keeps every wallet connection on the existing app, not an alternate Testnet website',()=>{
  const server=source('server/bff.ts');
  const entry=source('src/components/identity/VeyraIdentityAccess.tsx');
  expect(server).toContain("app.post('/api/identity/mainnet-capability'");
  expect(entry).not.toContain('Open stable Testnet site');
  expect(entry).toContain("VEYRA_ENV!=='mainnet'");
 });
});
