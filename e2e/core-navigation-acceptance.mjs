import assert from 'node:assert/strict';
const { chromium } = await import(process.env.VEYRA_PLAYWRIGHT_MODULE || 'file:///tmp/veyra-browser/node_modules/playwright/index.mjs');
const url = process.env.VEYRA_SMOKE_URL || 'http://127.0.0.1:4173';
assert.match(url, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/);
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // Disconnected layout test only: no live user, backend or wallet signatures.
    await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' }));
    await page.goto(url);
    await page.getByText('Your money.', { exact: false }).waitFor();
    assert.equal(await page.locator('details').getAttribute('open'), null);
    assert.equal(await page.getByText('Connect your wallet', { exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Continue with Veyra ID' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Connect X', exact: true }).count(), 0);
    await page.getByText('Explore network & asset catalog', { exact: true }).click();
    assert.equal(await page.locator('details').getAttribute('open'), '');
    await page.getByRole('button', { name: 'Bridge USDC', exact: false }).click();
    await page.waitForFunction(() => document.body.innerText.includes('Bridge') && !document.body.innerText.includes('Your money.'));
    const home = page.getByRole('button', { name: 'Home', exact: true }).filter({ visible: true });
    await home.click();
    await page.getByText('Your money.', { exact: false }).waitFor();
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Search Veyra' });
    await dialog.waitFor();
    await dialog.getByRole('textbox').fill('pay');
    assert.equal(await dialog.getByText('Veyra ID or wallet', { exact: true }).count(), 1);
    await dialog.getByRole('button', { name: 'Close search' }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (viewport.width < 768) {
      const box = await page.getByRole('navigation', { name: 'Main navigation' }).boundingBox();
      assert.ok(box && box.y + box.height <= viewport.height + 1);
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Full app desktop/mobile navigation acceptance: PASS (no signing)');
} finally { await browser.close(); }
