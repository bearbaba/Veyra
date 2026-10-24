import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {classifyTransferOutcome,isExplicitWalletRejection} from '../core/execution/transferOutcome';

const source=(name:string)=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const base={submissionStarted:false,broadcastHash:null,revertedOnChain:false,userExplicitlyRejected:false};
describe('Veyra transaction feedback always follows chain truth',()=>{
  it('distinguishes pre-submit failure, verified revert and unresolved broadcast',()=>{
    expect(classifyTransferOutcome(base)).toBe('FAILED');
    expect(classifyTransferOutcome({...base,submissionStarted:true,broadcastHash:'0xabc'})).toBe('PENDING');
    expect(classifyTransferOutcome({...base,submissionStarted:true,broadcastHash:'0xabc',revertedOnChain:true})).toBe('FAILED');
  });
  it('does not declare failure if wallet submission could have happened but no hash arrived',()=>{
    expect(classifyTransferOutcome({...base,submissionStarted:true})).toBe('PENDING');
    expect(classifyTransferOutcome({...base,submissionStarted:true,userExplicitlyRejected:true})).toBe('CANCELLED');
    expect(classifyTransferOutcome({...base,submissionStarted:true,broadcastHash:'0xabc',userExplicitlyRejected:true})).toBe('PENDING');
  });
  it('requires explicit EIP-1193 error code 4001, not ambiguous string heuristics',()=>{
    expect(isExplicitWalletRejection({code:4001})).toBe(true);
    expect(isExplicitWalletRejection({cause:{code:4001}})).toBe(true);
    expect(isExplicitWalletRejection({message:'user rejected'})).toBe(false);
    expect(isExplicitWalletRejection({code:-32000,message:'rpc failed'})).toBe(false);
    expect(isExplicitWalletRejection(null)).toBe(false);
  });
  it('persists pending receipt with tx hash before waiting for receipt',()=>{
    const hook=source('hooks/useTransferExecution.ts');
    const pending=hook.indexOf("status: 'PENDING'");
    const persisted=hook.indexOf('await saveReceipt(pendingReceipt)');
    const wait=hook.indexOf('await publicClient.waitForTransactionReceipt({ hash })');
    expect(pending).toBeGreaterThan(0);
    expect(persisted).toBeGreaterThan(pending);
    expect(wait).toBeGreaterThan(persisted);
    expect(hook).toContain("const outcomeKind = classifyTransferOutcome({");
    expect(hook).toContain("step: 'PREPARING'");
    expect(hook).toContain("step: 'SIGNING'");
    expect(hook).toContain("chainReceiptReverted = txReceipt.status === 'reverted'");
    expect(hook).not.toContain('Transfer failed: ${msg}');
  });
  it('shows responsive detail panel and active/proven status to humans and screen readers',()=>{
    const view=source('components/transfer/TransactionReviewSheet.tsx');
    expect(view).toContain('role="status" aria-live="polite"');
    expect(view).toContain('max-w-3xl');
    expect(view).toContain('md:grid-cols-');
    expect(view).toContain('Pending verification');
    expect(view).toContain('Submission status unknown');
    expect(view).toContain('Transfer verified');
    expect(view).toContain('Transaction reverted');
    expect(view).toContain('Wallet request cancelled');
    expect(view).toContain('Open transaction on Arc explorer');
    expect(view).toContain("['DONE', 'FAILED', 'PENDING', 'CANCELLED']");
    expect(view).not.toContain('Transfer succeeded before blockchain verification');
  });
});
