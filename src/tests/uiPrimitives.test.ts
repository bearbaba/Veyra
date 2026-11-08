import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Notice, StatusPill, TxStepper, TX_STAGES, txStageIndex } from '../components/ui/primitives';

const read = (p: string) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

describe('Shared transaction lifecycle', () => {
  it('defines the single Enter, Review, Confirm, Processing, Verified sequence', () => {
    expect([...TX_STAGES]).toEqual(['Enter details', 'Review', 'Confirm in wallet', 'Processing', 'Verified']);
    expect(txStageIndex('Review')).toBeLessThan(txStageIndex('Confirm in wallet'));
  });
  it('marks exactly the current step and announces an unresolved outcome', () => {
    const html = renderToStaticMarkup(createElement(TxStepper, { stage: 'Processing', stalled: true }));
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toContain('Do not submit again');
    expect(renderToStaticMarkup(createElement(TxStepper, { stage: 'Review' }))).not.toContain('Do not submit again');
  });
  it('uses statically discoverable Tailwind classes for the small-screen stage labels', () => {
    const html = renderToStaticMarkup(createElement(TxStepper, { stage: 'Review' }));
    expect(html).toContain('max-[389px]:block');
    expect(html).toContain('max-[389px]:hidden');
    const source = read('src/components/ui/primitives.tsx');
    expect(source).not.toContain("max-[389px]:\u0024{");
  });
  it('never marks a step current once the transaction is Verified', () => {
    expect(renderToStaticMarkup(createElement(TxStepper, { stage: 'Verified' }))).not.toContain('aria-current');
  });
});

describe('Notice and StatusPill', () => {
  it('announces errors assertively and everything else politely', () => {
    expect(renderToStaticMarkup(createElement(Notice, { tone: 'danger', children: 'x' }))).toContain('role="alert"');
    expect(renderToStaticMarkup(createElement(Notice, { tone: 'warning', children: 'x' }))).toContain('role="status"');
    expect(renderToStaticMarkup(createElement(StatusPill, { tone: 'success', children: 'Verified' }))).toContain('Verified');
  });
});

describe('Mainnet Home keeps wallet and Gateway funds separate', () => {
  const home = read('src/components/pages/MainnetHomePage.tsx');
  it('renders Gateway in its own card, outside the wallet balance card', () => {
    const wallet = home.indexOf('aria-label="Wallet balance"');
    const walletEnd = home.indexOf('</section>', wallet);
    const gateway = home.indexOf('<MainnetUnifiedBalancePanel compact standalone/>');
    expect(wallet).toBeGreaterThan(-1);
    expect(gateway).toBeGreaterThan(walletEnd);
    expect(home).toContain('held separately from your wallet USDC');
  });
  it('keeps the phone layout compact: one Quick actions row and no unconditional tall cards', () => {
    expect(home).toContain('grid grid-cols-5 gap-2 sm:gap-3');
    expect(home).not.toMatch(/grid-cols-2 gap-3 sm:grid-cols-5/);
    // Minimum heights apply from the sm breakpoint up only; phones size to their content.
    expect(home).not.toMatch(/className="[^"]*(?<![:\w-])min-h-\[(?:250|257|273|265|94)px\]/);
    // Every class is a static string so Tailwind can generate it.
    expect(home).not.toMatch(/className=\{[^}]*\$\{[^}]*(?:min-h|grid-cols|text-\[)/);
  });
  it('shows no duplicate hero action and no developer jargon', () => {
    const hero = home.slice(home.indexOf('aria-label="Veyra overview"'), home.indexOf('aria-label="Your Veyra identity"'));
    expect(hero).not.toContain('Friends');
    expect(home).not.toContain('Testnet fallback');
    expect(home).toContain('<h2 className="sr-only">Quick actions</h2>');
  });
});
