import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TxStepper, TX_STAGES, txDisplayStep } from '../components/ui/primitives';

const source = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const circle = source('components/pages/MainnetCirclePage.tsx');
const exchange = source('components/pages/MainnetExchangePage.tsx');
const css = source('index.css');

describe('single-surface Mainnet Swap and Bridge', () => {
  it('keeps the real financial lifecycle unchanged while presenting three quiet labels', () => {
    expect(TX_STAGES.map(txDisplayStep)).toEqual(['Review','Review','Confirm','Track','Track']);
    const pending = renderToStaticMarkup(createElement(TxStepper, { stage: 'Processing', stalled: true }));
    expect(pending.match(/<li\b/g)).toHaveLength(3);
    expect(pending.match(/aria-current="step"/g)).toHaveLength(1);
    expect(pending).toContain('Outcome unresolved. Do not submit again.');
    expect(pending).toContain('veyra-step-label');
    expect(pending).not.toContain('Step 3 of 3');
    expect(pending).not.toContain('rounded-xl border p-1');
    const verified = renderToStaticMarkup(createElement(TxStepper, { stage: 'Verified' }));
    expect(verified).not.toContain('aria-current');
    expect(verified).toContain('Transaction verified onchain');
  });

  it('removes duplicate bordered tracking panels without hiding safety status', () => {
    const start = circle.indexOf('{(recovery||unknownStorage)&&<section');
    const end = circle.indexOf('{proof&&<p role="status"', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const tracking = circle.slice(start, end);
    expect(tracking).toContain('aria-label="Exchange tracking status"');
    expect(tracking).toContain('Do not submit again.');
    expect(tracking).toContain('Signing stays locked.');
    expect(tracking).toContain('Evidence &amp; history');
    expect(tracking).toContain('No funds were resent.');
    expect(tracking).toContain('Transaction ID unavailable.');
    expect(tracking).toContain('Verify onchain');
    expect(tracking).toContain('Open Activity');
    expect(tracking).not.toContain('rounded-2xl border p-3.5');
    expect(tracking).not.toContain('linear-gradient(');
  });

  it('preserves read-only verifier and real Activity navigation, hiding unusable rechecks', () => {
    expect(circle).toContain("onOpenActivity?:()=>void");
    expect(circle).toContain("mode==='swap'?!!recovery.hash:!!recovery.burnHash");
    expect(circle).toContain('onClick={()=>void verify()}');
    expect(exchange).toContain("onOpenActivity={onNavigate?()=>onNavigate('activity'):undefined}");
    expect(circle).toContain("if(localStorage.getItem(key(otherMode,address)))");
    expect(circle).toContain('return withFreshVerification(v as Recovery);');
  });

  it('styles a single route card and ensures locked selectors remain legible', () => {
    expect(css).toContain('.veyra-route-page .veyra-card::before');
    expect(css).toContain('[aria-label="Bridge route"] button:disabled');
    expect(css).toContain('opacity:.84!important');
    expect(circle).toContain("background:embedded?'transparent':'var(--surface)'");
  });
});
