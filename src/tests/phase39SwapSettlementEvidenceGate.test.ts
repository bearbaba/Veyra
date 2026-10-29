import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const code=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');

describe('Swap acceptance: provider result is not settlement proof',()=>{
  it('never marks StableFX complete solely on its own API status',()=>{
    const hook=code('src/hooks/useConvertExecution.ts');
    const converted=hook.split("if (finalTrade.status !== 'complete')")[1];
    expect(converted).toContain("status: 'SETTLEMENT_PENDING'");
    expect(converted).toContain("status: 'PENDING'");
    expect(converted).toContain('ownerAddress: walletAddress');
    expect(converted).toContain('actualAmountDelta: null');
    expect(converted).not.toContain("status: 'VERIFIED'");
    expect(converted).toContain('await markQuoteUsed(quote.id)');
    expect(converted).toContain('await saveReceipt(receipt)');
  });
  it('does not reopen the Swap button after a provider-complete but unverified result',()=>{
    const ui=code('src/components/pages/ConvertPage.tsx');
    expect(ui).toContain("state.status === 'SETTLEMENT_PENDING'");
    expect(ui).toContain('No new trade is submitted automatically.');
    expect(code('src/core/pipeline/convertPipeline.ts')).toContain("'SETTLEMENT_PENDING'");
  });
  it('retains existing Pay wallet-bound receipt verification and separated approval',()=>{
    const pay=code('src/hooks/useTransferExecution.ts');
    expect(pay).toContain('verifyErc20TransferReceiptEvidence');
    expect(pay).toContain('waitForTransactionReceipt');
    expect(pay).toContain('saveReceipt(pendingReceipt)');
    expect(pay).toContain('saveReceipt(veyraReceipt)');
    expect(pay).toContain('classifyTransferOutcome');
  });
});
