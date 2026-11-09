// Shared helpers for the Swap/Bridge browser suites.
import { createWalletKit } from './mockWallet.mjs';
import { createFakeBackend } from './fakeIdentityBackend.mjs';
import { openApp, goto } from './harness.mjs';

export const EURC = '0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1';
export const ARC_USDC = '0x3600000000000000000000000000000000000000';

export function suite() {
  const results = [];
  const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  [${String(extra).slice(0, 220)}]`}`); };
  const skip = (name, why) => { results.push({ name, skipped: true }); console.log(`    SKIPPED  ${name}  [${why}]`); };
  const finish = () => {
    const failed = results.filter((r) => r.ok === false);
    const skipped = results.filter((r) => r.skipped);
    const passed = results.filter((r) => r.ok === true).length;
    console.log(`\n${passed}/${results.length - skipped.length} checks passed${skipped.length ? `, ${skipped.length} SKIPPED (provider)` : ''}${failed.length ? `, ${failed.length} FAILED` : ''}`);
    process.exit(failed.length ? 1 : 0);
  };
  return { check, skip, finish, results };
}

/** 1000000 -> "1", 892906 -> "0.892906": the exact decimal text of a 6-decimal amount. */
export function units6(raw) {
  const s = String(raw).padStart(7, '0');
  const frac = s.slice(-6).replace(/0+$/, '');
  return frac ? `${s.slice(0, -6)}.${frac}` : s.slice(0, -6);
}
export const micro = (decimal) => {
  const [i, f = ''] = String(decimal).split('.');
  return BigInt(i) * 1_000_000n + BigInt((f + '000000').slice(0, 6));
};

export async function newSession({ width, height, connect = true, seed = null, seedRaw = null, wallets = 1 }) {
  const wallet = createWalletKit(wallets);
  const addr = wallet.addressOf(0).toLowerCase();
  const app = await openApp({ backend: createFakeBackend({ registered: {} }), wallet, funded: true, circleQuotes: true, viewport: { width, height } });
  const { page, context } = app;
  if (seed) {
    const record = { owner: addr, ...seed };
    await context.addInitScript(([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); },
      [`veyra:mainnet:circle:v1:${record.mode}:${addr}`, JSON.stringify(record)]);
  }
  if (seedRaw) {
    // An unreadable stored value, planted before the app first loads.
    await context.addInitScript(([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); },
      [`veyra:mainnet:circle:v1:${seedRaw.mode}:${addr}`, seedRaw.value]);
  }
  await goto(page);
  if (connect) {
    await page.getByRole('button', { name: /connect wallet/i }).first().click();
    await page.getByText('Browser Wallet').click();
    await page.waitForTimeout(2500);
  }
  return { ...app, wallet, addr };
}

/** After a reload: reconnect only if the wallet did not reconnect by itself (never click Connect while connected). */
export async function ensureConnected(page) {
  await page.waitForTimeout(2500);
  if (await page.getByRole('button', { name: 'Disconnect' }).count()) return;
  await page.getByRole('button', { name: /connect wallet/i }).first().click();
  await page.getByText('Browser Wallet').click();
  await page.waitForTimeout(2500);
}

export async function navTo(page, label) {
  const direct = page.getByRole('button', { name: label, exact: true }).locator('visible=true');
  if (await direct.count()) await direct.first().click();
  else {
    await page.getByRole('button', { name: 'Home', exact: true }).locator('visible=true').first().click();
    await page.waitForTimeout(500);
    await page.locator('button:visible', { hasText: new RegExp(`^\\s*${label}\\s*$`) }).first().click();
  }
  await page.waitForTimeout(2200);
}

export const bodyText = (page) => page.locator('body').innerText();
export const flat = (t) => t.replace(/\s*\n+\s*/g, ' | ');

/** Waits for a live provider quote; returns false (never throws) when the provider gave none. */
export async function waitForQuote(page, ms = 26000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (/Live quote/.test(await bodyText(page))) return true;
    if (/no complete, fee-capped|Circle cannot provide|Insufficient|unavailable/i.test(await bodyText(page))) return false;
    await page.waitForTimeout(700);
  }
  return false;
}

/** The quote breakdown as [{label, note, value}], read from the real DOM. */
export const quoteRows = (page) => page.evaluate(() =>
  [...document.querySelectorAll('dl[aria-label="Quote breakdown"] > dt')].map((dt) => {
    const dd = dt.nextElementSibling;
    const note = dt.querySelector('span')?.textContent?.trim() ?? '';
    const label = [...dt.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    return { label, note, value: dd?.textContent?.trim() ?? '' };
  }));

export const currentStage = (page) => page.locator('[aria-current="step"]').first().textContent().then((t) => t?.trim() ?? null).catch(() => null);

export const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

export const swapPosts = (app) => app.circleCalls.filter((c) => c.path === '/v1/stablecoinKits/swap' && c.status === 200);
export const feeGets = (app, from, to) => app.circleCalls.filter((c) => c.path === `/v2/burn/USDC/fees/${from}/${to}`);

/** Fields of a Circle swap response, read by pattern (the route section can be large). */
export function swapFields(call) {
  const b = call?.responseBody ?? '';
  const provider = /"fees":\{"provider":\[\{[^}]*?"amount":"(\d+)"[^}]*?"symbol":"(\w+)"/.exec(b);
  return {
    expected: /"estimatedAmount":"(\d+)"/.exec(b)?.[1] ?? null,
    minimum: /"stopLimit":"(\d+)"/.exec(b)?.[1] ?? null,
    providerFee: provider?.[1] ?? null,
    providerSymbol: provider?.[2] ?? null,
  };
}
