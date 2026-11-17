import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {paySigningBlock} from '../mainnet/paySigningGate';
import {exchangeSigningBlock} from '../mainnet/exchangeSigningGate';
const read=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

describe('Mainnet-only GitHub/Studio import defaults',()=>{
 it('defaults the user-facing app to Mainnet without environment variables',()=>{
  const env=read('lib/env.ts');
  expect(env).toContain("if (!raw) return typeof window === 'undefined' ? 'local' : 'mainnet';");
  expect(env).toContain("assertNoTestnetLeakInMainnet()");
  const vite=read('../vite.config.ts');
  expect(vite).toContain("process.env.VITE_VEYRA_ENV || 'mainnet'");
 });
 it('provides no Testnet RPC or chain in the public wagmi connector',()=>{
  const cfg=read('config.ts');
  expect(cfg).toContain('chains: [arc, base, mainnet]');
  expect(cfg).not.toContain('arcTestnet');
  expect(cfg).not.toContain('baseSepolia');
  expect(cfg).not.toContain('arc-testnet.drpc.org');
  expect(cfg).not.toContain('https://rpc.testnet.arc.io');
 });
 it('does not authorize Mainnet wallet signatures from a Studio or local build',()=>{
  expect(paySigningBlock({mainnet:true,releaseEnv:'local'})).toBe('preview');
  expect(paySigningBlock({mainnet:true,releaseEnv:'preview'})).toBe('preview');
  for(const mode of ['bridge','swap'] as const){
   expect(exchangeSigningBlock({mode,releaseEnv:'local',emergencyReadOnly:false,
    publicBeta:true,bridgeWriteEnabled:true})).toBe('preview');
  }
 });
});
