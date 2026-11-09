// Pay in the Studio Preview, in a real browser.
//
// Pay Review used to show a live-looking "Approve" button and only explained that
// signing is disabled after the click. These scenarios check the behaviour a user
// actually sees, at desktop and phone sizes, with the funded throwaway wallet:
//   - the Preview notice is visible BEFORE any signing step
//   - Review stays available, and shows what will be paid
//   - no live "Approve" / "Send payment" button exists; the disabled action says why
//   - even a forced click on it reaches no wallet method
//   - the wallet is never asked to sign anything beyond the one identity sign-in
// Requires the Preview (bun run dev) and studio/browser/setup.sh. Read-only.
import { createWalletKit } from './mockWallet.mjs';
import { createFakeBackend } from './fakeIdentityBackend.mjs';
import { openApp, goto, connectAndSignIn, openPay } from './harness.mjs';

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  [${extra}]`}`); };
const body = (page) => page.locator('body').innerText();

const VIEWPORTS = [
  ['desktop', 1280, 900],
  ['phone390', 390, 844],
  ['phone320', 320, 700],
];

for (const [name, width, height] of VIEWPORTS.filter(([n]) => !process.env.PAY_PREVIEW_ONLY || n === process.env.PAY_PREVIEW_ONLY)) {
  console.log(`\n  Pay @ ${width}px (${name})`);
  const wallet = createWalletKit(2);
  const backend = createFakeBackend({ registered: { [wallet.addressOf(0)]: 'alice' } });
  const app = await openApp({ backend, wallet, funded: true, viewport: { width, height } });
  const { page } = app;
  try {
    await goto(page);
    await connectAndSignIn(page);
    await openPay(page);
    await page.waitForTimeout(6500);                     // contract gate (real node) + balance reads

    let t = await body(page);
    check('Preview notice is visible before anything is entered', /Preview mode — payment review available, wallet signing disabled\./.test(t), t.slice(0, 160));
    check('notice explains live payments are Production-only', /only through the authorized Production release, subject to all existing safety checks/.test(t));
    check('contract gate verified (Review is available)', /Review payment/.test(t));

    const baseline = wallet.methods.length;
    await page.locator('input:visible').first().fill(wallet.addressOf(1));
    await page.locator('input[inputmode="decimal"]:visible').first().fill('1.25');
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /review payment/i }).first().click();
    await page.waitForTimeout(6000);

    t = await body(page);
    check('Review shows the amount that would be paid', /1\.25 USDC/.test(t));
    check('Review shows the recipient receives line', /Recipient receives/.test(t));
    check('Review shows network fee estimates', /Approval network fee/.test(t) && /Payment network fee/.test(t));
    const current = await page.locator('[aria-current="step"]').first().textContent().catch(() => null);
    check('stage indicator is on Review (aria-current step)', current?.trim() === 'Review', String(current));
    check('notice is still visible in Review', /Preview mode — payment review available/.test(t));

    const live = await page.getByRole('button', { name: /^(approve \d|send payment|create escrow)/i }).count();
    check('no live Approve / Send payment button is offered', live === 0, `found ${live}`);
    const disabled = page.getByRole('button', { name: 'Signing disabled in Preview' });
    check('the action says why it is unavailable', (await disabled.count()) === 1);
    check('and it is actually disabled', await disabled.first().isDisabled().catch(() => false) === true);

    await disabled.first().click({ force: true, timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const after = wallet.methods.slice(baseline);
    check('a forced click reaches no wallet signing or send method',
      !after.some((m) => /sign|send|switchEthereumChain|addEthereumChain/i.test(m)), after.join(','));
    t = await body(page);
    check('no error screen appears (the handler was never reached)', !/Mainnet Settlement signing is disabled in Preview and local builds/.test(t));

    check('the wallet signed only the identity sign-in', wallet.prompts.length === 1, `prompts=${wallet.prompts.length}`);
    check('wallet was never asked to send a transaction', wallet.forbidden.length === 0, JSON.stringify(wallet.forbidden));
    check('wallet was never asked to switch chains', wallet.switches.length === 0, JSON.stringify(wallet.switches));
    check('no Testnet wording', !/testnet/i.test(t));
    check('no horizontal overflow', (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);

    await page.getByRole('button', { name: /back/i }).first().click().catch(() => {});
    await page.waitForTimeout(800);
    t = await body(page);
    check('Back returns to the form and Review remains available', /Review payment/.test(t) && /Recipient/.test(t));
    await page.screenshot({ path: `/tmp/shots/pay-preview-${name}.png`, fullPage: true });
  } finally { await app.browser.close(); }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? `, ${failed.length} FAILED` : ''}`);
process.exit(failed.length ? 1 : 0);
