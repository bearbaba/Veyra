// Connected, signed-in layout check for Home, Swap and Bridge at desktop, 390 px
// and 320 px. Same safe setup as identity-session.mjs (throwaway wallet, fake
// backend, nothing leaves the sandbox). Fails on horizontal overflow, a missing
// primary action, Testnet wording, or any transaction request from the wallet.
// Reports page height and how far the primary action sits below the fold so
// layout changes can be judged with numbers (measured from a fresh, unscrolled page,
// against the full viewport height; a fixed bottom navigation hides a little more).
//
//   node studio/e2e/layout-connected.mjs
import { createWalletKit } from './mockWallet.mjs';
import { createFakeBackend } from './fakeIdentityBackend.mjs';
import { goto, openApp } from './harness.mjs';

const VIEWPORTS = [
  { name: '1280', width: 1280, height: 900 },
  { name: '390', width: 390, height: 844 },
  { name: '320', width: 320, height: 700 },
];
const PRIMARY = { Swap: /review swap/i, Bridge: /review bridge/i };
const rows = [];
let failures = 0;

for (const vp of VIEWPORTS) {
  const wallet = createWalletKit(2);
  const backend = createFakeBackend({ registered: { [wallet.addressOf(0)]: 'alice' } });
  const { browser, page } = await openApp({ backend, wallet, viewport: vp });
  const go = async (label) => {
    const buttons = page.getByRole('button', { name: label, exact: true }).locator('visible=true');
    if (await buttons.count()) await buttons.first().click();
    else {   // phones have no sidebar: Swap and Bridge are reached from Home's Quick actions
      await page.getByRole('button', { name: 'Home', exact: true }).locator('visible=true').first().click();
      await page.waitForTimeout(500);
      await page.locator('button:visible', { hasText: new RegExp(`^\\s*${label}\\s*$`) }).first().click();
    }
    await page.waitForTimeout(1200);
  };
  try {
    await goto(page);
    await page.getByRole('button', { name: /connect wallet/i }).first().click();
    await page.getByText('Browser Wallet').click();
    await page.waitForTimeout(2200);
    await go('Friends');
    await page.getByRole('button', { name: 'Sign in to Veyra ID' }).click();
    await page.waitForTimeout(2200);
    for (const label of ['Home', 'Swap', 'Bridge']) {
      await go(label);
      const m = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        height: document.documentElement.scrollHeight,
        text: document.body.innerText,
      }));
      let belowFold = null;
      // Measure from the top of the page: the scroll left over from clicking a Quick action
      // would otherwise make the primary action look closer than a fresh visit finds it.
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(250);
      if (PRIMARY[label]) {
        const primary = page.getByRole('button', { name: PRIMARY[label] }).locator('visible=true').first();
        const box = await primary.boundingBox();
        belowFold = box ? Math.max(0, Math.round(box.y + box.height - vp.height)) : null;
        if (!box) { failures++; console.log(`FAIL ${vp.name} ${label}: primary action not found`); }
      }
      if (m.overflow > 0) { failures++; console.log(`FAIL ${vp.name} ${label}: horizontal overflow ${m.overflow}px`); }
      if (/testnet/i.test(m.text)) { failures++; console.log(`FAIL ${vp.name} ${label}: Testnet wording`); }
      if (label === 'Home' && !/@alice\.veyra/.test(m.text)) { failures++; console.log(`FAIL ${vp.name} Home: signed-in identity missing`); }
      rows.push({ viewport: vp.name, page: label, height: m.height, overflow: m.overflow, actionBelowFold: belowFold });
    }
    if (wallet.forbidden.length) { failures++; console.log(`FAIL ${vp.name}: wallet asked to ${wallet.forbidden.join(',')}`); }
  } catch (error) {
    failures++;
    console.log(`FAIL ${vp.name}: ${String(error.message).split('\n')[0]}`);
  } finally {
    await browser.close();
  }
}

console.table(rows);
console.log(failures ? `${failures} FAILED` : 'layout checks passed (connected, signed in)');
process.exit(failures ? 1 : 0);
