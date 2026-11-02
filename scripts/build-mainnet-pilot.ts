/** One exact Mainnet pilot build profile for Vercel and CI. */
import {spawnSync} from 'node:child_process';
const profile={
 VITE_VEYRA_ENV:'mainnet',
 VITE_VEYRA_UI_ONLY:'0',
 VITE_VEYRA_TESTNET_PAY:'0',
 VITE_VEYRA_MAINNET_MVP:'0',
 VITE_VEYRA_MAINNET_PAY:'1',
 VITE_VEYRA_EMERGENCY_READ_ONLY:'0',
 VITE_VEYRA_CANARY_ONLY:'1',
 VITE_VEYRA_IDENTITY_BETA:'0',
 VITE_VEYRA_UNIFIED_STAGING:'0',
} as const;
const result=spawnSync('bun',['run','build'],{env:{...process.env,...profile},stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
