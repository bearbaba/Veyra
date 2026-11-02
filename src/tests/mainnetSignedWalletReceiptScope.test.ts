import {describe,expect,it} from 'vitest';
import {isMainnetSessionForWallet,scopedMainnetReceipts} from '../mainnet/signedWalletReceiptScope';

const walletA='0x1111111111111111111111111111111111111111';
const walletB='0x2222222222222222222222222222222222222222';
const records=[
 {txHash:'0x'+'a'.repeat(64),senderAddress:walletA,recipientAddress:walletB,note:'A only'},
 {txHash:'0x'+'b'.repeat(64),senderAddress:walletB,recipientAddress:walletA},
 {txHash:'0x'+'c'.repeat(64),senderAddress:walletB,recipientAddress:walletB},
];
describe('Identity and server receipt privacy across wallet changes',()=>{
 it('requires exact wallet and connector UID for a signed Mainnet Veyra session',()=>{
  const session={walletKey:walletA.toLowerCase()+':injected-1'};
  expect(isMainnetSessionForWallet(session,walletA,'injected-1')).toBe(true);
  expect(isMainnetSessionForWallet(session,walletA.toUpperCase().replace('0X','0x'),'injected-1')).toBe(true);
  expect(isMainnetSessionForWallet(session,walletB,'injected-1')).toBe(false);
  expect(isMainnetSessionForWallet(session,walletA,'injected-2')).toBe(false);
  expect(isMainnetSessionForWallet(session,walletA,undefined)).toBe(false);
  expect(isMainnetSessionForWallet(null,walletA,'injected-1')).toBe(false);
 });
 it('retains only receipts connected to the active wallet',()=>{
  expect(scopedMainnetReceipts(records,walletA).length).toBe(2);
  expect(scopedMainnetReceipts(records,walletB).length).toBe(3);
  expect(scopedMainnetReceipts(records,null)).toEqual([]);
  expect(scopedMainnetReceipts(records,'not a wallet')).toEqual([]);
 });
 it('server session A cannot display personal history after changing to an unrelated wallet C',()=>{
  const walletC='0x3333333333333333333333333333333333333333';
  const session={walletKey:walletA.toLowerCase()+':metamask'};
  expect(isMainnetSessionForWallet(session,walletC,'metamask')).toBe(false);
  expect(scopedMainnetReceipts(records,walletC)).toEqual([]);
 });
});
