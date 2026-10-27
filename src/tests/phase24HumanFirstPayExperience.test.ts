import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { evaluateBrowserOrigin } from '../../server/middleware/browserOriginPolicy';
import { validateAgentTransferDraft } from '../core/agent/transferDraftGate';
import { validateIntentResponse } from '../core/intent/intentSchema';

const file=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const TARGET='0xEE8fB2f35EAAa614286e32b4813D42B5dBb76579';

describe('Phase 24 — fast, honest and safe first payment',()=>{
  it('shows Send, verified balance, Receive and recent activity before registry details',()=>{
    const home=file('src/components/pages/HomePage.tsx');
    expect(home).toContain('Send USDC, simply.');
    expect(home).toContain('Receive USDC');
    expect(home).toContain('Copy receiving address');
    expect(home).toContain('onNavigate(\'pay\')');
    expect(home).toContain('Recent activity');
    expect(home).toContain('<details className="rounded-2xl');
    expect(home).toContain('Listing an asset here does not mean payments are enabled');
    expect(home).not.toContain('without a duplicate Home flow');
    expect(home).not.toContain('Everything else stays underneath the routing engine');
    expect(home).not.toContain('Verified registry metadata. Execution remains separately gated');
    expect(home).not.toContain('<VeyraIdentityAccess');
  });
  it('allows a guest to enter a draft, choose Friends/Wallet, or paste without signing',()=>{
    const pay=file('src/components/pages/PayPage.tsx');
    expect(pay).toContain("useState<'WALLET' | 'FRIEND'>('WALLET')");
    expect(pay).toContain("recipientMode==='WALLET'");
    expect(pay).toContain("recipientMode==='FRIEND'");
    expect(pay).toContain("await navigator.clipboard.readText()");
    expect(pay).toContain('Your draft is ready to edit');
    expect(pay).toContain('<ConnectKitButton />');
    expect(pay).toContain('preparePaymentRecipient(');
    expect(pay).toContain('assertPreparedRecipientReview(');
    expect(pay).toContain('createTransferAction(');
    expect(pay).toContain('disabled={!canProceed}');
    expect(pay).not.toContain('!isConnected ? (');
    expect(pay).not.toContain('writeContractAsync(');
  });
  it('does not silently sanitize 2,5 into 25 or accept invalid wallet input',()=>{
    const pay=file('src/components/pages/PayPage.tsx');
    expect(pay).toContain('const value = event.target.value;');
    expect(pay).toContain('Enter a positive USDC amount with no more than 6 decimal places');
    expect(pay).toContain("isAddress(recipient.trim())");
    expect(pay).not.toContain("event.target.value.replace(/[^0-9.]/g");
    const candidate=validateIntentResponse({status:'RESOLVED',candidates:[{
      actionType:'TRANSFER',fromAmount:'2,5',fromCurrency:'USDC',recipient:TARGET,
    }]}).candidates[0];
    expect(validateAgentTransferDraft(candidate).ok).toBe(false);
  });
  it('only signs after actual Arc RPC fee estimate, never synthetic fee values',()=>{
    const hook=file('src/core/execution/useArcTransferFeeEstimate.ts');
    const review=file('src/components/transfer/TransactionReviewSheet.tsx');
    expect(hook).toContain('client.estimateContractGas(');
    expect(hook).toContain('client.getGasPrice()');
    expect(hook).toContain('client.getBalance({address:sender})');
    expect(hook).toContain('const fee=gas*gasPrice');
    expect(hook).toContain('action.amount*1_000_000_000_000n+fee');
    expect(hook).toContain('formatUnits(fee,18)');
    expect(hook).toContain('formatUnits(total,18)');
    expect(hook).toContain('12_000');
    expect(review).toContain('useArcTransferFeeEstimate(action)');
    expect(review).toContain("fee.status !== 'ready'");
    expect(review).toContain('Retry fee estimate');
    expect(review).toContain('Network fee (estimated)');
    expect(review).toContain('Total debit (estimated)');
    expect(review).toContain('Recipient wallet');
    expect(review).toContain('Destination network');
    expect(review).not.toContain('0.002 USDC'); // no fabricated constant fee
  });
  it('does not show internal Agent pipeline status to first-time users',()=>{
    const agent=file('src/components/pages/AgentPage.tsx');
    const quick=file('src/components/agent/AgentQuickStart.tsx');
    expect(agent).not.toContain('Fallback ready');
    expect(agent).not.toContain('Local planner');
    expect(agent).not.toContain('Review locked');
    expect(agent).toContain('Same-language replies');
    expect(quick).toContain('Create draft');
    expect(quick).toContain('Swap');
    expect(quick).toContain('Bridge');
    expect(quick).toContain('Unified');
    expect(agent).not.toContain('writeContract(');
  });
  it('shows clear disconnected Activity and still prevents unauthenticated remote data',()=>{
    const activity=file('src/components/pages/ActivityPage.tsx');
    expect(activity).toContain('Connect your wallet to view activity');
    expect(activity).toContain('if (!isConnected)');
    expect(activity).toContain('bridgeCheckpointBelongsToWallet');
    expect(activity).toContain('viewIsCurrent');
  });
  it('keeps explicit trusted origin allowlist instead of opening all Vercel previews',()=>{
    const origin=file('server/middleware/browserOriginPolicy.ts');
    expect(origin).toContain("if (!appOrigin || appOrigin === '*')");
    expect(evaluateBrowserOrigin('https://random.vercel.app',
      'https://trusted.example',true).allowed).toBe(false);
    expect(evaluateBrowserOrigin('https://trusted.example',
      'https://trusted.example',true).allowed).toBe(true);
    const banner=file('src/components/system/WebPreviewBanner.tsx');
    expect(banner).toContain('Sign-in unavailable on this Preview');
    expect(banner).toContain("social.identityOrigin === 'origin_blocked'");
  });
});
