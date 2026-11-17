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
});
