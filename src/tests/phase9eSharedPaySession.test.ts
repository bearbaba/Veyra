import {describe,expect,it,vi,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {preparePaymentRecipient,verifyPaymentRecipient,requireSignedIdentityToken} from '../lib/api/identityApi';

const read=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
afterEach(()=>vi.unstubAllGlobals());

describe('wallet-bound Veyra session is reused by Identity Pay and pre-sign verification',()=>{
  it('never sends an ID recipient request without the active signed Social token',async()=>{
    const spy=vi.fn();
    vi.stubGlobal('fetch',spy);
    await expect(preparePaymentRecipient('@friend.veyra',5042002,'')).rejects.toThrow(/Sign in to Veyra ID/);
    await expect(verifyPaymentRecipient({
      snapshotId:'snp_example',expectedWalletId:'wid',expectedWalletAddress:'0x1111111111111111111111111111111111111111',
      expectedChainId:5042002,reviewToken:'review',
    },'')).rejects.toThrow(/Sign in to Veyra ID/);
    expect(spy).not.toHaveBeenCalled();
  });
  it('uses the explicit session and does not even READ legacy sessionStorage',async()=>{
    const fake=vi.fn((_url: string, _options?: RequestInit)=>Promise.resolve({
      ok:true,
      json:()=>Promise.resolve({ok:true,prepared:{
        kind:'VEYRA_IDENTITY',resolvedAddress:'0x2222222222222222222222222222222222222222',
        chainId:5042002,snapshot:{snapshotId:'snp_test',veyraUserId:'usr_123456789ABCDEFGJ',
        veyraHandle:'friend',displayName:'Friend',avatarUrl:null,expiresAt:'2026-12-01T00:00:00Z',
        walletId:'wid_test',reviewToken:'review_test'},
      }}),
    }));
    vi.stubGlobal('fetch',fake);
    vi.stubGlobal('sessionStorage',{getItem:()=>{throw new Error('Legacy storage must not be accessed for signed Pay');}});
    const prepared=await preparePaymentRecipient('@friend.veyra',5042002,'signed-wallet-token');
    expect(prepared.snapshot?.veyraHandle).toBe('friend');
    const opts=fake.mock.calls[0]?.[1] as {headers:Record<string,string>};
    expect(opts.headers.Authorization).toBe('Bearer signed-wallet-token');
  });
  it('passes owner auth for pre-sign snapshot validation instead of a stale stored token',async()=>{
    const fake=vi.fn((_url: string, _options?: RequestInit)=>Promise.resolve({ok:true,json:()=>Promise.resolve({ok:true})}));
    vi.stubGlobal('fetch',fake);
    vi.stubGlobal('sessionStorage',{getItem:()=>{throw new Error('Storage token must not authorize the payment');}});
    await verifyPaymentRecipient({
      snapshotId:'snp_test',expectedWalletId:'wid_test',
      expectedWalletAddress:'0x2222222222222222222222222222222222222222',
      expectedChainId:5042002,reviewToken:'review_test',
    },'signed-current-wallet');
    const opts=fake.mock.calls[0]?.[1] as {headers:Record<string,string>};
    expect(opts.headers.Authorization).toBe('Bearer signed-current-wallet');
  });
  it('rejects malformed tokens and prevents stale review after wallet/session change',()=>{
    expect(()=>requireSignedIdentityToken('hello world')).toThrow();
    expect(()=>requireSignedIdentityToken(undefined)).toThrow();
    const pay=read('components/pages/PayPage.tsx');
    const hook=read('hooks/useTransferExecution.ts');
    const review=read('components/transfer/TransactionReviewSheet.tsx');
    expect(pay).toContain('prepareEpoch.current += 1');
    expect(pay).toContain('epoch !== prepareEpoch.current');
    expect(pay).toContain('Sign in to your Veyra ID in Social before paying a person.');
    expect(pay).toContain('sessionToken={sessionToken}');
    expect(hook).toContain('verifyPaymentRecipient(recipientGuard, sessionToken)');
    expect(hook).toContain('Your Veyra ID session ended.');
  });
});
