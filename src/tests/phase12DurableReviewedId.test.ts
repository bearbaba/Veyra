import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {receiptUpdateAllowed} from '../core/receipt/receiptStore';
import type {VeyraReceipt} from '../core/receipt/receiptTypes';
const file=(p:string)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const original:VeyraReceipt={
 receiptId:'veyra-tx',actionType:'TRANSFER',status:'PENDING',chainId:5042002,
 ownerAddress:'0x1111111111111111111111111111111111111111',
 recipientAddress:'0x2222222222222222222222222222222222222222',
 recipientVeyraHandleAtReview:'gau123',tokenAddress:'0x3333333333333333333333333333333333333333',
 tokenDecimals:6,tokenSymbol:'USDC',executionTxHash:'0xabc',createdAt:1,
 actualAmountDelta:null,expectedAmountDelta:2000000n,riskScore:null,policyDecision:null
};
describe('Pay-by-ID historical label persistence',()=>{
 it('freezes recipient handle across pending to verified',()=>{
  expect(receiptUpdateAllowed(original,{...original,status:'VERIFIED',actualAmountDelta:2000000n})).toBe(true);
  expect(receiptUpdateAllowed(original,{...original,recipientVeyraHandleAtReview:'fake'})).toBe(false);
  expect(receiptUpdateAllowed(original,{...original,recipientVeyraHandleAtReview:undefined})).toBe(false);
  expect(receiptUpdateAllowed({...original,recipientVeyraHandleAtReview:undefined},original)).toBe(false);
 });
 it('leaves direct wallet transfers unlabeled',()=>{
  const direct={...original,recipientVeyraHandleAtReview:undefined};
  expect(receiptUpdateAllowed(direct,{...direct,status:'VERIFIED'})).toBe(true);
 });
 it('requires signed recipient check before attaching ID, then displays Activity metadata',()=>{
  const hook=file('hooks/useTransferExecution.ts');
  expect(hook).toContain('await verifyPaymentRecipient(verifiedGuard, sessionToken)');
  expect(hook).toContain('verifiedGuard.expectedWalletAddress.toLowerCase()!==action.to.toLowerCase()');
  expect(hook).toContain('recipientVeyraHandleAtReview: reviewedVeyraHandle');
  expect(file('components/pages/ActivityPage.tsx')).toContain('receipt.recipientVeyraHandleAtReview');
  expect(file('components/receipt/VeyraReceiptView.tsx')).toContain('receipt.recipientVeyraHandleAtReview');
  expect(file('components/pages/HomePage.tsx')).toContain('Copy Veyra ID');
 });
});
