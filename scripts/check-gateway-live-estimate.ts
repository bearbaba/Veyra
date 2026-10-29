/**
 * LIVE read-only Circle TESTNET quote contract check.
 *
 * A quote does not initiate, sign, or submit any transaction. The synthetic
 * owner has no Veyra session and no secret. Fail closed on provider schema
 * drift: a green unit test is insufficient to unlock Gateway signing.
 *
 * Run: bun scripts/check-gateway-live-estimate.ts
 */
import { randomBytes } from 'node:crypto';
import {createGatewayEstimateRequest,parseGatewayEstimate} from '../server/services/gatewayEstimate.js';

const request=createGatewayEstimateRequest({
 walletAddress:'0x1111111111111111111111111111111111111111',
 recipientAddress:'0x2222222222222222222222222222222222222222',
 sourceDomain:26,
 destinationDomain:6,
 amount:'10',
 salt:`0x${randomBytes(32).toString('hex')}`,
});
const response=await fetch('https://gateway-api-testnet.circle.com/v1/estimate',{
 method:'POST',
 headers:{'Content-Type':'application/json'},
 body:JSON.stringify([{spec:request.spec}]),
 signal:AbortSignal.timeout(15000),
});
if(!response.ok){
 console.error(`Gateway Testnet estimate refused: HTTP ${response.status}. Financial signing remains locked.`);
 process.exit(1);
}
const raw:unknown=await response.json();
try{
 const quote=parseGatewayEstimate(raw,request);
 if(quote.maxBlockHeight<=0n||quote.maxFee<0n)
  throw Error('Invalid block height or provider fee.');
 console.log('Circle Gateway TESTNET exact-spec fee and block-expiry estimate: PASS (read-only).');
}catch{
 const topKeys=raw&&typeof raw==='object'&&!Array.isArray(raw)
  ?Object.keys(raw as Record<string,unknown>):[];
 console.error('Gateway Testnet estimate response did not match the verified BurnIntent schema.');
 console.error(`Response is array: ${Array.isArray(raw)}; top-level keys: ${topKeys.join(',')}`);
 process.exit(1);
}
