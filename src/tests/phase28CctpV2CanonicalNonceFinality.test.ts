import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { matchesCctpV2AttestedSourceMessage } from '../providers/cctp/cctpV2Adapter';
import {
  CCTP_V2_SOURCE_TEMPLATE,
  CCTP_V2_ATTESTED_MESSAGE,
  cctpV2SignedMessage,
} from './fixtures/cctpV2MessageFixture';

const check=(source:string,signed:string)=>matchesCctpV2AttestedSourceMessage(source,signed);
const mutate=(message:string,byte:number,value:string)=>{
  const raw=message.slice(2);
  return '0x'+raw.slice(0,byte*2)+value+raw.slice((byte+1)*2);
};
const read=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');

describe('Phase 28: CCTP V2 signed message differs only in assigned nonce/finality',()=>{
  it('accepts a finalized Circle message after assigning nonce and executed finality',()=>{
    expect(check(CCTP_V2_SOURCE_TEMPLATE,CCTP_V2_ATTESTED_MESSAGE)).toBe(true);
    expect(check(CCTP_V2_SOURCE_TEMPLATE,
      cctpV2SignedMessage(CCTP_V2_SOURCE_TEMPLATE,'a'.repeat(64),2200))).toBe(true);
  });

  it('rejects every changed immutable message field and body (including token/amount/recipient)',()=>{
    for(const byte of [0,4,8,44,76,108,140,148,170,190,220,280]){
      const original=CCTP_V2_ATTESTED_MESSAGE.slice(2+byte*2,2+byte*2+2);
      expect(check(CCTP_V2_SOURCE_TEMPLATE,mutate(CCTP_V2_ATTESTED_MESSAGE,byte,
        original==='ff'?'fe':'ff'))).toBe(false);
    }
    expect(check(CCTP_V2_SOURCE_TEMPLATE,CCTP_V2_ATTESTED_MESSAGE+'aa')).toBe(false);
    expect(check(CCTP_V2_SOURCE_TEMPLATE,CCTP_V2_ATTESTED_MESSAGE.slice(0,-2))).toBe(false);
  });

  it('rejects weak finality and malformed/empty source-template header',()=>{
    expect(check(CCTP_V2_SOURCE_TEMPLATE,cctpV2SignedMessage(
      CCTP_V2_SOURCE_TEMPLATE,'1'.padStart(64,'0'),1000))).toBe(false);
    expect(check(CCTP_V2_SOURCE_TEMPLATE,CCTP_V2_SOURCE_TEMPLATE)).toBe(false);
    expect(check(mutate(CCTP_V2_SOURCE_TEMPLATE,12,'aa'),CCTP_V2_ATTESTED_MESSAGE)).toBe(false);
    expect(check(mutate(CCTP_V2_SOURCE_TEMPLATE,144,'aa'),CCTP_V2_ATTESTED_MESSAGE)).toBe(false);
    expect(check(mutate(CCTP_V2_SOURCE_TEMPLATE,140,'ff'),CCTP_V2_ATTESTED_MESSAGE)).toBe(false);
    expect(check('0xdeadbeef','0xdeadbeef')).toBe(false);
    expect(check('0xabc',CCTP_V2_ATTESTED_MESSAGE)).toBe(false);
  });

  it('uses the same strict helper for read-only attestation check and Activity proof',()=>{
    const relay=read('server/services/cctpBridgeSourceAttestationService.ts');
    const activity=read('server/services/activityReceiptVerificationService.ts');
    expect(relay).toContain('matchesCctpV2AttestedSourceMessage(sourceMessage, circle.message)');
    expect(activity).toContain('matchesCctpV2AttestedSourceMessage(sourceMessage, message)');
    expect(relay).toContain('parseUniqueCctpAttestationResponse(circleResponse)');
    expect(relay).toContain('verifyCctpSourceReceiptEvidence(receipt');
    expect(activity).toContain('sourceReceiptContainsCctpMessage(sourceReceipt, authoritativeAttestation.message)');
    expect(relay).toContain('circle.attestation.toLowerCase() !== checkpoint.attestationSignature.toLowerCase()');
  });
});
