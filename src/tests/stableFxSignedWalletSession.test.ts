import { afterEach,describe,expect,it } from 'vitest';
import { bindCurrentIdentityWallet, clearSignedIdentitySession, setSignedIdentitySession } from '../lib/api/liveIdentitySession';
import { stableFxSignedSessionHeaders } from '../providers/stablefx/stableFxAdapter';
afterEach(()=>{clearSignedIdentitySession();bindCurrentIdentityWallet('');});
describe('StableFX financial requests require the current signed wallet session',()=>{
  it('denies API operations until wallet identity has signed in',()=>{
    bindCurrentIdentityWallet('0xabc:5042002');
    expect(()=>stableFxSignedSessionHeaders()).toThrow(/sign into your Veyra ID/);
  });
  it('removes old token authority immediately on wallet switch',()=>{
    bindCurrentIdentityWallet('0xaaa:5042002');
    setSignedIdentitySession('test-signed-credential-wallet-a','0xaaa:5042002');
    expect(stableFxSignedSessionHeaders()).toEqual({Authorization:'Bearer test-signed-credential-wallet-a'});
    bindCurrentIdentityWallet('0xbbb:5042002');
    expect(()=>stableFxSignedSessionHeaders()).toThrow();
    expect(()=>setSignedIdentitySession('token-wallet-a','0xaaa:5042002')).toThrow(/Wallet changed/);
  });
  it('clears API authority after explicit disconnect',()=>{
    bindCurrentIdentityWallet('0xccc:5042002');
    setSignedIdentitySession('test-signed-credential-wallet-c','0xccc:5042002');
    clearSignedIdentitySession();
    expect(()=>stableFxSignedSessionHeaders()).toThrow();
  });
});
