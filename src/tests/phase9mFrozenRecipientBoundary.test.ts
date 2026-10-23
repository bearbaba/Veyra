import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {assertPreparedRecipientReview} from '../core/execution/recipientReviewGuard';
import type {PreparedRecipient} from '../lib/api/identityApi';
const S='0x1111111111111111111111111111111111111111';
const T='0x2222222222222222222222222222222222222222';
const N=Date.parse('2026-10-23T12:00:00Z');
const proof={snapshotId:'snp_123',veyraUserId:'usr_5ABCDEFGH123',veyraHandle:'friend',displayName:'Friend',avatarUrl:null,expiresAt:'2026-10-23T12:01:00Z',walletId:'wallet_123',reviewToken:'signed_123'};
const id=():PreparedRecipient=>({kind:'VEYRA_IDENTITY',resolvedAddress:T,chainId:5042002,snapshot:{...proof}});
const check=(r:PreparedRecipient|null,originalRecipient='@friend.veyra')=>
  assertPreparedRecipientReview({prepared:r,originalRecipient,senderAddress:S,expectedChainId:5042002,now:N});
describe('P0 reviewed Veyra ID must have a frozen recipient proof',()=>{
  it('accepts valid live snapshot',()=>{expect(()=>check(id())).not.toThrow();});
  it('blocks missing snapshot, wrong kind, malformed or absent immutable fields',()=>{
    expect(()=>check({...id(),snapshot:null})).toThrow('requires a fresh');
    expect(()=>check({...id(),kind:'WALLET'})).toThrow('requires a fresh');
    for(const key of ['snapshotId','walletId','reviewToken','veyraHandle','veyraUserId'] as const){
      expect(()=>check({...id(),snapshot:{...proof,[key]:''}})).toThrow('Incomplete');
    }
  });
  it('blocks old/malformed proof, wrong chain, self payments and bad addresses',()=>{
    expect(()=>check({...id(),snapshot:{...proof,expiresAt:'2026-10-23T11:59:00Z'}})).toThrow('expired');
    expect(()=>check({...id(),snapshot:{...proof,expiresAt:'bogus'}})).toThrow('expired');
    expect(()=>check({...id(),chainId:1})).toThrow('different blockchain');
    expect(()=>check({...id(),resolvedAddress:S})).toThrow('different verified wallet');
    expect(()=>check({...id(),resolvedAddress:'0x0000000000000000000000000000000000000000'})).toThrow('not be verified');
  });
  it('literal wallet must be exact, without identity proof',()=>{
    const wallet:PreparedRecipient={kind:'WALLET',resolvedAddress:T,chainId:5042002,snapshot:null};
    expect(()=>check(wallet,T)).not.toThrow();
    expect(()=>check(wallet,S)).toThrow('changed after review');
    expect(()=>check({...id(),kind:'WALLET'},T)).toThrow('unexpected identity proof');
  });
  it('checks receipt proof before action and prevents bypass in review UI',()=>{
    const pay=readFileSync(new URL('../components/pages/PayPage.tsx',import.meta.url),'utf8');
    const review=readFileSync(new URL('../components/transfer/TransactionReviewSheet.tsx',import.meta.url),'utf8');
    expect(pay).toContain('assertPreparedRecipientReview({');
    expect(pay.indexOf('assertPreparedRecipientReview({')).toBeLessThan(pay.indexOf('const action = createTransferAction'));
    expect(review).toContain("recipient?.kind === 'VEYRA_IDENTITY' && !recipient.snapshot");
  });
});
