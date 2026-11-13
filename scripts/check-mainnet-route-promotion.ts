/** Run only for an authorized production promotion.
 * Example: VEYRA_MAINNET_BFF_ORIGIN=https://<real-reviewed-host> bun run scripts/check-mainnet-route-promotion.ts
 */
import {readFileSync} from 'node:fs';
import {verifyProductionMainnetRouting,type VercelRoutingConfig} from '../server/services/mainnetReleaseRouting.js';
const config=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8')) as VercelRoutingConfig;
const result=verifyProductionMainnetRouting(config,process.env.VEYRA_MAINNET_BFF_ORIGIN??'');
if(!result.ok){
 console.error('NO-GO: Mainnet official-domain API routing is unsafe:\n'+result.issues.join('\n'));
 process.exitCode=1;
}else{
 console.log('Mainnet rewrites are consistent with the provided BFF origin. Live backend health and wallet E2E remain mandatory.');
}
