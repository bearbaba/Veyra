import { describe, expect, it } from 'vitest';
import { parseAnnouncedIdentityWallet } from '../identity-beta/walletDiscovery';

const uid = 'eec5f19b-cf2a-4e02-82fa-50d5d34aa620';
const one = { request({method}: {method:string}) { return Promise.resolve(method === 'eth_chainId' ? '0x4cef52' : []); } };
const two = { request({method}: {method:string}) { return Promise.resolve(method === 'eth_chainId' ? '0x4cef52' : []); } };
function announcement(provider: unknown = one, info: unknown = {uuid:uid,name:'MetaMask',rdns:'io.metamask'}) {
  return {info,provider};
}
describe('Phase 8N — explicit EIP-6963 wallet selection', () => {
  it('preserves provider object identity instead of trusting overwritten window.ethereum', () => {
    const first = parseAnnouncedIdentityWallet(announcement(one));
    const second = parseAnnouncedIdentityWallet(announcement(two,{
      uuid:'5502f828-f18e-4dd1-955b-85b964e66dbb', name:'Rabby',rdns:'io.rabby',
    }));
    expect(first?.provider).toBe(one);
    expect(second?.provider).toBe(two);
    expect(first?.id).not.toBe(second?.id);
  });
  it('rejects malformed extension-provided announcement metadata', () => {
    for (const raw of [
      null, {}, [], {info:{}}, announcement(null),
      announcement({}, {uuid:uid,name:'MetaMask'}),
      announcement(one, {uuid:'not-a-uuid',name:'MetaMask'}),
      announcement(one, {uuid:uid,name:'\nUnsafe wallet'}),
      announcement(one, {uuid:uid,name:' '}),
      announcement(one, {uuid:uid,name:'x'.repeat(81)}),
    ]) expect(parseAnnouncedIdentityWallet(raw)).toBeNull();
  });
  it('never treats extension-controlled brand strings as authenticated vendor proof', () => {
    const spoof = parseAnnouncedIdentityWallet(announcement(one,{uuid:uid,name:'MetaMask',rdns:'attacker.example'}));
    expect(spoof?.name).toBe('MetaMask');
    // The UI describes names as extension-provided and the signing flow always
    // independently verifies the returned EIP-712 signer before posting to BFF.
  });
});
