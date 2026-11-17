import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../components/pages/MainnetUnifiedBalancePanel.tsx',import.meta.url),'utf8');

describe('Compact Home Unified Send and Add dialog',()=>{
 it('opens a focused modal instead of expanding a nested duplicate balance card',()=>{
  expect(source).toContain("import {createPortal} from 'react-dom'");
  expect(source).toContain("const modalVisible=compact&&!fundingToWallet&&!!transferForm;");
  expect(source).toContain('role="dialog" aria-modal="true"');
  expect(source).toContain("onClick={()=>selectMode('spend')}");
  expect(source).toContain("onClick={()=>selectMode('deposit')}");
  expect(source).not.toContain('setExpanded(true);');
  expect(source).toContain("{(!compact||Boolean(fundingToWallet))&&transferForm}");
  expect(source).toContain('priorFocus?.focus()');
  expect(source).toContain("document.body.style.overflow='hidden'");
 });
 it('preserves fee review, fail-closed transaction checkpoints and status errors',()=>{
  expect(source).toContain('const good=!!current&&!previous&&validAmount&&enough&&validRecipient&&signed&&!loading');
  expect(source).toContain('if(!review||!good||busy||!canPilot||!reviewedPlan.current)return;');
  expect(source).toContain('submitGatewayMainnetReview(');
  expect(source).toContain('matchingGatewayAllocation(');
  expect(source).toContain('readGatewayMainnetOperation(address)');
  expect(source).toContain('Review transfer fees');
  expect(source).toContain('role="alert"');
  expect(source).toContain("if(busy)return;");
 });
 it('distinguishes Gateway quote liquidity from transfer authorization',()=>{
  expect(source).toContain('const canPilot=GATEWAY_MAINNET_WRITE_ENABLED;');
  expect(source).toContain("canPilot?'Send to wallet':'Review transfer'");
  expect(source).toContain("canPilot?'Confirm in wallet':'Signing not enabled'");
  expect(source).toContain("canPilot?'Signing source':'Quote source'");
  expect(source).toContain('USDC on quote-supported sources');
  expect(source).toContain('This is a Gateway wallet transfer, not a Veyra ID payment.');
  expect(source).not.toContain('USDC send-ready');
  expect(source).not.toContain('3 execution-ready');
  expect(source).toContain('disabled={!good||busy||review&&(!canPilot');
  const execution=readFileSync(new URL('../mainnet/gatewayMainnetExecution.ts',import.meta.url),'utf8');
  expect(execution).toContain('if(!GATEWAY_MAINNET_WRITE_ENABLED)');
 });
});
