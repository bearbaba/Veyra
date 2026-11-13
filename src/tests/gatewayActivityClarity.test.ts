import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';

const source=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const receipts=source('components/pages/MainnetUnifiedActivity.tsx');
const activity=source('components/pages/MainnetActivityPage.tsx');
const home=source('components/pages/MainnetHomePage.tsx');
const reconcile=source('mainnet/gatewayMainnetReconcile.ts');
const journal=source('mainnet/gatewayMainnetJournal.ts');
const ledger=source('mainnet/gatewayMainnetBalances.ts');

describe('unified deposits present finality and spendable Circle ledger separately',()=>{
 it('presents the exact source receipt as source finalized, never individual credit verified',()=>{
  expect(receipts).toContain("receipt.kind==='deposit'&&receipt.status==='SOURCE_FINALIZED'");
  expect(receipts).toContain("finalizedDeposit?'Deposit confirmed'");
  expect(receipts).toContain("Deposit confirmed onchain.");
  expect(receipts).toContain("individual Gateway credit has not been attributed.");
  expect(receipts).toContain("Circle Available is read separately");
  expect(receipts).not.toContain('Source finalized · credit not attributed');
 });
 it('preserves original transaction evidence and provider credit reference in expanded details',()=>{
  expect(receipts).toContain('View source');
  expect(receipts).toContain("explorer(receipt.chainId)+receipt.sourceHash");
  expect(receipts).toContain('Receipt details');
  expect(receipts).toContain('Circle credit reference: {receipt.gatewayCreditReference}');
  expect(receipts).toContain('Destination: {receipt.destinationHash}');
 });
 it('does not convert aggregate available USDC into attributed deposit proof',()=>{
  expect(reconcile).toContain("kind:'deposit',status:'SOURCE_FINALIZED'");
  expect(reconcile).toContain("Only Circle live Available is spendable.");
  expect(journal).toContain("gatewayCreditReference");
  expect(ledger).toContain("return parseGatewayMainnetBalance(response,owner)");
  expect(receipts).not.toContain("receipt.status==='SOURCE_FINALIZED'?'Verified'");
 });
 it('avoids misleading fully synced and completed-payment language',()=>{
  expect(activity).toContain("serverHistoryStatus==='ready'?'Account receipts checked':'Local history available'");
  expect(activity).not.toContain("syncing?'Updating…':'Up to date'");
  expect(home).toContain('An earlier transaction needs reconciliation. View its original status in Activity.');
  expect(home).toContain('pending.length>0');
 });
});
