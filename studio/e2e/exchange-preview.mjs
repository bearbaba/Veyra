// Swap and Bridge in the Studio Preview, against Circle's live quote service.
//
// The Preview is not the authorized Production release, so wallet signing is disabled by design.
// This checks what the user is told and shown: the Preview notice, the itemized quote (expected and
// minimum received, provider fee, network gas, total), the proportional-fee warning on small amounts,
// a disabled primary button, and that the wallet is never asked to sign or send anything.
//
// It sends read-only quote requests (an estimate for a throwaway address; no funds). If Circle's
// service does not answer, a case is reported as SKIPPED, never as a pass. Requires the Preview
// (bun run dev) and studio/browser/setup.sh.
import { createWalletKit } from './mockWallet.mjs';
import { createFakeBackend } from './fakeIdentityBackend.mjs';
import { openApp, goto } from './harness.mjs';

const results = [];
let skipped = 0;
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  [${extra}]`}`); };
const text = (page) => page.locator('body').innerText();

async function open(mode, vp) {
  const wallet = createWalletKit(1);
  const app = await openApp({ backend: createFakeBackend({ registered: {} }), wallet, funded: true, circleQuotes: true, viewport: vp });
  await goto(app.page);
  await app.page.getByRole('button', { name: /connect wallet/i }).first().click();
  await app.page.getByText('Browser Wallet').click();
  await app.page.waitForTimeout(2200);
  const visible = app.page.getByRole('button', { name: mode, exact: true }).locator('visible=true');
  if (await visible.count()) await visible.first().click();
  else {                                           // phones: Swap and Bridge are Quick actions on Home
    await app.page.getByRole('button', { name: 'Home', exact: true }).locator('visible=true').first().click();
    await app.page.waitForTimeout(500);
    await app.page.locator('button:visible', { hasText: new RegExp(`^\\s*${mode}\\s*$`) }).first().click();
  }
  await app.page.waitForTimeout(1500);
  return { app, wallet };
}

async function run({ mode, amount, vp, tag, expectWarning }) {
  console.log(`\n  ${mode} ${amount} USDC @ ${vp.width}px (${tag})`);
  const { app, wallet } = await open(mode, vp);
  const { page } = app;
  try {
    // Before any quote: the Preview notice and its explanation must already be visible.
    let t = await text(page);
    check('Preview mode label is shown', t.includes('Preview mode — quotes available, wallet signing disabled.'));
    check('explains that real transactions are Production-only', /only through the authorized Production release/.test(t) && /subject to all existing safety checks/.test(t));
    check('does not call the Preview a pause', !/temporarily paused/i.test(t));

    await page.locator('input[inputmode="decimal"]:visible').first().fill(amount);
    await page.getByRole('button', { name: new RegExp(`review ${mode.toLowerCase()}`, 'i') }).first().click();
    await page.waitForTimeout(14000);
    t = await text(page);
    if (!/Live quote/.test(t)) {
      skipped++;
      console.log(`    SKIPPED  no live quote returned (provider/network). Page said: ${(t.match(/(Circle[^|]*|Insufficient[^|]*|[^|]*quote[^|]*)\|?/i) ?? [''])[0].slice(0, 120)}`);
      return;
    }
    for (const label of ['Expected received', 'Minimum received', 'Network gas']) check(`quote shows "${label}"`, t.includes(label));
    check('quote shows a fee line', /Provider fee|Forwarding fee/.test(t));
    check('gas is never shown with raw 18-digit precision', !/\d\.\d{9,}/.test(t));
    check('primary button is disabled and says why', await page.getByRole('button', { name: 'Signing disabled in Preview' }).isDisabled());
    check('"Confirm in wallet" is not offered', !(await page.getByRole('button', { name: 'Confirm in wallet' }).count()));
    check('inline note says the quote cannot be signed here', t.includes('Preview mode: this quote cannot be signed here.'));
    const warned = /of this (swap|transfer)\./.test(t);
    check(expectWarning ? 'small amount: proportional fee warning is shown' : 'larger amount: no fee warning', warned === expectWarning, warned ? 'warning present' : 'warning absent');
    if (mode === 'Swap' && expectWarning) check('Swap warning names gas and provider fees', /Network gas and provider fees are about [\d.]+% of this swap/.test(t));
    check('no horizontal overflow', (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
    await page.screenshot({ path: `/tmp/shots/exchange-${mode}-${tag}.png`, fullPage: true });
  } finally {
    check('wallet was never asked to sign or send anything', wallet.forbidden.length === 0 && wallet.prompts.length === 0, JSON.stringify({ forbidden: wallet.forbidden, prompts: wallet.prompts.length }));
    await app.browser.close();
  }
}

const D = { width: 1280, height: 900 }, M = { width: 390, height: 844 }, S = { width: 320, height: 700 };
await run({ mode: 'Swap', amount: '1', vp: D, tag: 'desktop', expectWarning: true });
await run({ mode: 'Swap', amount: '1', vp: M, tag: 'phone390', expectWarning: true });
await run({ mode: 'Swap', amount: '1', vp: S, tag: 'phone320', expectWarning: true });
await run({ mode: 'Swap', amount: '20', vp: M, tag: 'phone390-large', expectWarning: false });
await run({ mode: 'Bridge', amount: '5', vp: D, tag: 'desktop', expectWarning: true });
await run({ mode: 'Bridge', amount: '5', vp: M, tag: 'phone390', expectWarning: true });

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? `, ${failed.length} FAILED` : ''}${skipped ? `, ${skipped} case(s) SKIPPED (no live quote)` : ''}`);
process.exit(failed.length ? 1 : 0);
