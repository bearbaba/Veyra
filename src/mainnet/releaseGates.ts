/** A hard emergency shutdown ALWAYS wins. During the first Hackathon release,
 * direct Arc USDC may be canary-enabled for exactly one publicly identified
 * owner wallet, capped at 0.01 USDC. Other money features remain off.
 */
export const MAINNET_EMERGENCY_READ_ONLY =
  import.meta.env.VITE_VEYRA_EMERGENCY_READ_ONLY === '1';
export const MAINNET_CANARY_ONLY = import.meta.env.VITE_VEYRA_CANARY_ONLY === '1';
export const MAINNET_CANARY_OWNER = '0x4C7cb73aC8F8999af21cfc9fF4cF2333a9508Dcb';
export const MAINNET_CANARY_MAX_UNITS = 10_000n;
/** The deployed Settlement contract has not passed a public, multi-account
 * reference-uniqueness release. Never advertise public signing from a
 * generic env flag while the contract-only guard is still a hard canary.
 */
/** Explicit owner's public-beta authorization. This does not certify a completed funded E2E. */
export const MAINNET_PUBLIC_BETA = import.meta.env.VITE_VEYRA_PUBLIC_BETA === '1';
export const MAINNET_SETTLEMENT_CANARY_ONLY = !MAINNET_PUBLIC_BETA;
/** Consumer routes are independent of legacy direct-USDC canary.
 * They must re-check provider quote, account, chain, recipient and recovery locks.
 */
export function assertMainnetConsumerSigningAllowed(
 emergency=MAINNET_EMERGENCY_READ_ONLY,
 beta=MAINNET_PUBLIC_BETA,
):void{
 if(emergency)throw new Error('Mainnet emergency read-only recovery is active; no new signing.');
 if(!beta)throw new Error('Mainnet consumer execution is not enabled on this release.');
}
export function assertMainnetPublicSettlementSigningAllowed(
 address:string,units:bigint,mode:'pay'|'escrow',
 emergency=MAINNET_EMERGENCY_READ_ONLY,beta=MAINNET_PUBLIC_BETA,
):void{
 if(mode!=='pay')throw new Error('Mainnet escrow signing is not available in public beta.');
 assertMainnetConsumerSigningAllowed(emergency,beta);
 if(!/^0x[0-9a-fA-F]{40}$/.test(address)||units<=0n)
  throw new Error('Valid payer and positive USDC amount required before signing.');
}

export function assertMainnetSigningAllowed(
 readOnly = MAINNET_EMERGENCY_READ_ONLY||MAINNET_CANARY_ONLY,
):void{
 if(readOnly)throw new Error(
  'Veyra is in read-only recovery mode. Existing transactions can be checked, but no new wallet signing is permitted.');
}
export function canSignMainnetCanary(address:string|undefined,units:bigint):boolean{
 return !!address&&address.toLowerCase()===MAINNET_CANARY_OWNER.toLowerCase()&&
  units>0n&&units<=MAINNET_CANARY_MAX_UNITS;
}
export function assertMainnetCanarySigningAllowed(
 address:string,units:bigint,emergency=MAINNET_EMERGENCY_READ_ONLY,canary=MAINNET_CANARY_ONLY,
):void{
 if(emergency)assertMainnetSigningAllowed(true);
 if(canary&&!canSignMainnetCanary(address,units))
  throw new Error('Mainnet pilot signing is limited to the authorized canary wallet and 0.01 USDC. No transaction started.');
}

/** App-only guard for the first *contract* Settlement canary.
 * Intentionally enforces owner/amount even when CANARY_ONLY is accidentally
 * omitted from the build. A public onchain contract is NOT access-controlled
 * by a frontend guard; this only prevents Veyra from prompting disallowed
 * signatures. Emergency read-only always takes precedence.
 */
export function assertMainnetContractCanarySigningAllowed(
 address:string,units:bigint,mode:'pay'|'escrow',
 emergency=MAINNET_EMERGENCY_READ_ONLY,
):void{
 if(MAINNET_PUBLIC_BETA){
  assertMainnetPublicSettlementSigningAllowed(address,units,mode,emergency,true);
  return;
 }
 if(mode!=='pay')throw new Error('Mainnet escrow signing is not enabled in M0.');
 assertMainnetCanarySigningAllowed(address,units,emergency,true);
}
