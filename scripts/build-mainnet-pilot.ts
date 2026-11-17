/** One exact Mainnet pilot build profile for Vercel and CI. */
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {assertAndPublish} from './assertMainnetArtifact';
const profile={
 VITE_VEYRA_ENV:'mainnet',
 VITE_VEYRA_UI_ONLY:'0',
 VITE_VEYRA_TESTNET_PAY:'0',
 VITE_VEYRA_MAINNET_MVP:'0',
 VITE_VEYRA_MAINNET_PAY:'1',
 VITE_VEYRA_EMERGENCY_READ_ONLY:'0',
 VITE_VEYRA_CANARY_ONLY:'1', // Legacy wallet Direct USDC remains canary-only.
 VITE_VEYRA_PUBLIC_BETA:'1',
 VITE_VEYRA_MAINNET_BRIDGE_BETA_ENABLED:'1',
 VITE_VEYRA_GATEWAY_MAINNET_WRITE_ENABLED:'1',
 VITE_VEYRA_GATEWAY_MAINNET_BETA_ENABLED:'1',
 VITE_VEYRA_IDENTITY_BETA:'0',
 VITE_VEYRA_UNIFIED_STAGING:'0',
} as const;
const result=spawnSync('bun',['run','build'],{env:{...process.env,...profile},stdio:'inherit'});
if(result.error)throw result.error;
if(result.status!==0){process.exitCode=result.status??1;}
else{
 // Inspect the emitted files, not the build log.
 const sha=process.env.VERCEL_GIT_COMMIT_SHA;
 const out=assertAndPublish(join(process.cwd(),'dist'),{expectedEnv:'mainnet',...(sha?{expectedSha:sha}:{})});
 console.log('[artifact] verified env='+out.env+' sha='+out.sha);
}
