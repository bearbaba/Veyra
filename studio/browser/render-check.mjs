import { chromium } from '/tmp/veyra-browser/node_modules/playwright/index.mjs';
const URL = 'http://localhost:5173/';
const VIEWPORTS = [{ name: 'desktop', width: 1280, height: 800 }, { name: 'm390', width: 390, height: 844 }, { name: 'm320', width: 320, height: 640 }];
const PAGES = ['Home', 'Pay', 'Friends', 'Activity', 'Swap', 'Bridge', 'Settings'];
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
const report = [];
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  const errors = [], failed = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
  page.on('pageerror', e => errors.push('PAGEERROR ' + String(e).slice(0, 160)));
  page.on('requestfailed', r => failed.push(r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 80) + ' ' + (r.failure()?.errorText ?? '')));
  page.on('response', r => { if (r.status() >= 400) failed.push(r.status() + ' ' + r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 80)); });
  await page.goto(URL, { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(3500);
  for (const name of PAGES) {
    let nav = 'ok';
    if (name !== 'Home') {
      const rx = new RegExp('^\\s*' + name + '\\s*$', 'i');
      let target = page.getByRole('button', { name: rx }).first();
      if (!(await target.isVisible().catch(() => false))) target = page.getByRole('link', { name: rx }).first();
      if (!(await target.isVisible().catch(() => false))) {
        const more = page.getByRole('button', { name: /more/i }).first();
        if (await more.isVisible().catch(() => false)) { await more.click(); await page.waitForTimeout(300); }
        target = page.getByRole('button', { name: rx }).first();
      }
      if (await target.isVisible().catch(() => false)) { await target.click(); await page.waitForTimeout(1200); } else nav = 'NAV-NOT-FOUND';
    }
    const m = await page.evaluate(() => {
      const t = document.body.innerText;
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        h1: (document.querySelector('h1')?.textContent ?? '').trim().slice(0, 50),
        blank: t.trim().length < 40,
        testnet: /testnet/i.test(t), mainnet: /mainnet/i.test(t),
        overlay: !!document.querySelector('vite-error-overlay'),
        height: document.documentElement.scrollHeight,
      };
    });
    await page.screenshot({ path: `/tmp/shots/${vp.name}-${name}.png`, fullPage: false });
    report.push({ vp: vp.name, page: name, nav, ...m });
  }
  report.push({ vp: vp.name, page: '(session)', consoleErrors: [...new Set(errors)].slice(0, 6), failed: [...new Set(failed)].slice(0, 8) });
  await ctx.close();
}
await browser.close();
for (const r of report) console.log(JSON.stringify(r));
