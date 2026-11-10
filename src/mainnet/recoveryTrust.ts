import {parseUnits} from 'viem';
import {circleCctpBridgePair} from './circleBridgePolicy';

/**
 * Which stored Swap/Bridge records may be shown as "Destination verified".
 *
 * The exchange component writes status VERIFIED only after it has checked the
 * destination onchain, and at that moment it also stores the proof it used:
 *   swap   -> `hash`            (the swap transaction)
 *   bridge -> `burnHash` and `mintHash` (source burn and destination mint)
 * localStorage is only a cache, though. A record that says VERIFIED but carries no
 * proof (corrupted, left by an older build, or edited) must not be shown as verified.
 * It is downgraded to PENDING: still locked against a second attempt, with the
 * existing "Verify destination onchain" recheck available (which never signs).
 *
 * Evidence is never discarded. Every field, including each transaction hash, is kept, and
 * `downgradedFrom` records that the entry was saved as verified. A missing LOCAL proof is not
 * evidence that the transfer failed, so the status is "unresolved" (PENDING), never REVERTED.
 *
 * This only ever makes a record MORE conservative; it never upgrades one.
 */
export interface StoredExchangeRecord {
  mode: 'swap' | 'bridge';
  status: 'UNKNOWN' | 'PENDING' | 'VERIFIED' | 'REVERTED';
  hash?: string;
  burnHash?: string;
  mintHash?: string;
  /** Set when a stored VERIFIED entry was found without its proof and treated as unresolved. */
  downgradedFrom?: 'VERIFIED' | 'REVERTED';
}

export function hasVerificationProof(record: StoredExchangeRecord): boolean {
  return record.mode === 'swap'
    ? record.hash !== undefined
    : record.burnHash !== undefined && record.mintHash !== undefined;
}

export function withTrustedStatus<T extends StoredExchangeRecord>(record: T): T {
  return record.status === 'VERIFIED' && !hasVerificationProof(record)
    ? { ...record, status: 'PENDING', downgradedFrom: 'VERIFIED' }
    : record;
}

/**
 * Hydrated local storage is NEVER independent evidence of settlement, even when
 * the previous save contains syntactically valid source/destination proof hashes.
 *
 * Every historical terminal outcome is held behind the original operation lock
 * while the existing read-only, chain-backed verifier rechecks it. A verified
 * source revert must also be rechecked: a forged local REVERTED flag is not
 * permission to send money again.
 *
 * The old hashes, evidence and intent ID are preserved for read-only recovery.
 * This helper never upgrades any status or infers failure from unavailable RPCs.
 */
export function withFreshVerification<T extends StoredExchangeRecord>(record:T):T {
  return record.status==='VERIFIED'||record.status==='REVERTED'
    ? {...record,status:'PENDING',downgradedFrom:record.status}
    : record;
}

/** Reject malformed local metadata before using it for any verification or signing decision. */
export function validStoredExchangeRecovery(record:unknown,owner:string,mode:'swap'|'bridge'):boolean {
  if(!record||typeof record!=='object'||Array.isArray(record))return false;
  const r=record as Record<string,unknown>;
  const ownerPattern=/^0x[0-9a-f]{40}$/i;
  const txHash=/^0x[0-9a-f]{64}$/i;
  const decimal=/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/;
  const units=(value:unknown)=> {
    if(typeof value!=='string'||value.length>30||!decimal.test(value))return null;
    try{const raw=parseUnits(value,6);return raw>0n&&raw<=100_000_000n?raw:null;}
    catch{return null;}
  };
  if(!ownerPattern.test(owner)||r.owner!==owner.toLowerCase()||r.mode!==mode||
    !['UNKNOWN','PENDING','VERIFIED','REVERTED'].includes(String(r.status))||
    units(r.amount)===null||units(r.minimum)===null||
    !Number.isSafeInteger(r.source)||!Number.isSafeInteger(r.destination)||
    (r.intentId!==undefined&&(typeof r.intentId!=='string'||!/^[0-9a-f-]{36}$/i.test(r.intentId)))||
    (r.downgradedFrom!==undefined&&!['VERIFIED','REVERTED'].includes(String(r.downgradedFrom)))||
    [r.hash,r.burnHash,r.mintHash].some(value=>value!==undefined&&
      (typeof value!=='string'||!txHash.test(value))))
    return false;
  if(mode==='swap')
    return r.source===5042&&r.destination===5042&&
      (r.fromToken==='USDC'&&r.toToken==='EURC'||
       r.fromToken==='EURC'&&r.toToken==='USDC');
  return r.fromToken==='USDC'&&r.toToken==='USDC'&&
    typeof r.source==='number'&&typeof r.destination==='number'&&
    circleCctpBridgePair(r.source,r.destination,'USDC','USDC');
}
