// Wallet and Veyra ID session-consistency scenarios, run in a real browser against
// the real Mainnet frontend (served by the local Preview). The wallet is a
// throwaway key that holds nothing; the backend is a fake inside this process;
// nothing leaves the sandbox. Exit code 1 on any failed assertion.
//
//   node studio/e2e/identity-session.mjs
import { createWalletKit } from './mockWallet.mjs';
import { createFakeBackend } from './fakeIdentityBackend.mjs';
import { goto, openApp } from './harness.mjs';

const READ_ONLY_HOSTS = new Set([
  'fonts.googleapis.com', 'fonts.gstatic.com', 'ethereum.reth.rs', 'mainnet.base.org',
  'gateway-api.circle.com', 'api.circle.com', 'cdn.prod.website-files.com',
]);
const results = [];
const check = (scenario, name, ok, detail = '') => {
  results.push({ scenario, name, ok: Boolean(ok), detail });
};
const body = (page) => page.locator('body').innerText();
const nav = async (page, label) => {
  await page.getByRole('button', { name: label, exact: true }).first().click();
  await page.waitForTimeout(900);
};
const connect = async (page) => {
  await page.getByRole('button', { name: /connect wallet/i }).first().click();
  await page.getByText('Browser Wallet').click();
  await page.waitForTimeout(2200);
};
const signIn = async (page) => {
  await nav(page, 'Friends');
  await page.getByRole('button', { name: 'Sign in to Veyra ID' }).click();
  await page.waitForTimeout(2200);
};

async function scenario(name, run, { registered = [0], viewport } = {}) {
  const wallet = createWalletKit(2);
  const backend = createFakeBackend({
    registered: Object.fromEntries(registered.map((i, n) => [wallet.addressOf(i), n === 0 ? 'alice' : 'bob'])),
  });
  const app = await openApp({ backend, wallet, viewport });
  try {
    await goto(app.page);
    await run({ ...app, wallet, backend, check: (n, ok, d) => check(name, n, ok, d) });
    const c = (n, ok, d) => check(name, n, ok, d);
    c('wallet was never asked to send a transaction', wallet.forbidden.length === 0, wallet.forbidden.join(','));
    // Every non-local request is aborted by the harness, so none reaches a network. This asserts that
    // the app only ever *tried* known read-only hosts (fonts, public chain RPC, Circle balance reads).
    const unexpected = [...new Set(app.external)].filter((h) => !READ_ONLY_HOSTS.has(h));
    c('all external requests were blocked and only target known read-only hosts', unexpected.length === 0, unexpected.join(','));
    c('backend never rejected a signature', backend.rejectedSignatures.length === 0);
    c('no Testnet text anywhere', !/testnet/i.test(await body(app.page)));
  } catch (error) {
    check(name, 'scenario completed', false, String(error.message).split('\n')[0]);
  } finally {
    await app.browser.close();
  }
}

await scenario('1. Connect, sign in once, same identity on every page', async ({ page, wallet, backend, check }) => {
  await connect(page);
  check('connecting asks for no signature', wallet.prompts.length === 0);
  check('exactly one session-restore attempt on connect', backend.callCount('POST /api/auth/session/restore') === 1);
  const home = await body(page);
  check('Home does not claim "Not set up" for a wallet that may have an ID', !/not set up/i.test(home));
  check('Home says signed out', /signed out/i.test(home));

  await signIn(page);
  check('sign-in asked the wallet exactly once', wallet.prompts.length === 1, String(wallet.prompts.length));
  check('one challenge, one completion', backend.callCount('POST /api/auth/wallet-login/challenge') === 1 &&
    backend.callCount('POST /api/auth/wallet-login/complete') === 1);

  for (const label of ['Home', 'Pay', 'Friends', 'Activity', 'Swap', 'Bridge', 'Settings']) {
    await nav(page, label);
    check(`${label}: still exactly one wallet prompt`, wallet.prompts.length === 1);
  }
  await nav(page, 'Home');
  check('Home shows @alice.veyra', /@alice\.veyra/.test(await body(page)));
  await nav(page, 'Friends');
  check('Friends shows the signed-in identity, not a login form',
    !/sign in to veyra id/i.test(await body(page)));
  await nav(page, 'Settings');
  check('Settings shows alice', /alice/i.test(await body(page)));
  check('no further restore attempts while navigating', backend.callCount('POST /api/auth/session/restore') === 1,
    String(backend.callCount('POST /api/auth/session/restore')));
});

await scenario('2. Refresh restores the session without another prompt', async ({ page, wallet, backend, check }) => {
  await connect(page);
  await signIn(page);
  check('signed in with one prompt', wallet.prompts.length === 1);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(3000);
  check('reload caused no new wallet prompt', wallet.prompts.length === 1, String(wallet.prompts.length));
  await nav(page, 'Home');
  const home = await body(page);
  check('Home shows @alice.veyra again after reload', /@alice\.veyra/.test(home));
  check('Home never says signed out or not set up after a valid restore', !/signed out|not set up/i.test(home));
  check('exactly one more restore (per page load)', backend.callCount('POST /api/auth/session/restore') === 2,
    String(backend.callCount('POST /api/auth/session/restore')));
  check('no second login challenge', backend.callCount('POST /api/auth/wallet-login/challenge') === 1);
});

await scenario('3. Double-click on sign in prompts once', async ({ page, wallet, backend, check }) => {
  await connect(page);
  await nav(page, 'Friends');
  await page.getByRole('button', { name: 'Sign in to Veyra ID' }).dblclick();
  await page.waitForTimeout(2800);
  check('one wallet prompt', wallet.prompts.length === 1, String(wallet.prompts.length));
  check('one challenge issued', backend.callCount('POST /api/auth/wallet-login/challenge') === 1,
    String(backend.callCount('POST /api/auth/wallet-login/challenge')));
});

await scenario('4. Wallet account switch never leaks the previous identity', async ({ page, wallet, backend, check }) => {
  await connect(page);
  await signIn(page);
  check('alice signed in', wallet.prompts.length === 1);
  await wallet.switchAccount(page, 1);                       // unregistered second account
  await page.waitForTimeout(2500);
  await nav(page, 'Home');
  const home = await body(page);
  check('previous identity is gone from Home', !/@alice\.veyra/.test(home));
  check('Home is signed out for the new wallet', /signed out/i.test(home));
  await nav(page, 'Friends');
  check('Friends offers sign in, not alice', !/alice/i.test(await body(page)) && /sign in to veyra id/i.test(await body(page)));
  check('switching wallets asked for no signature', wallet.prompts.length === 1, String(wallet.prompts.length));
  await wallet.switchAccount(page, 0);                       // back to the registered wallet
  await page.waitForTimeout(2800);
  await nav(page, 'Home');
  check('switching back restores alice without a prompt', /@alice\.veyra/.test(await body(page)) && wallet.prompts.length === 1,
    `prompts=${wallet.prompts.length}`);
  check('restore was attempted per wallet, never repeated in a loop',
    backend.callCount('POST /api/auth/session/restore') <= 4, String(backend.callCount('POST /api/auth/session/restore')));
}, { registered: [0] });

await scenario('5. 390px phone: same identity and no overflow after sign-in', async ({ page, wallet, check }) => {
  await connect(page);
  await nav(page, 'Friends');
  await page.getByRole('button', { name: 'Sign in to Veyra ID' }).click();
  await page.waitForTimeout(2200);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('no horizontal overflow on Friends', overflow <= 0, String(overflow));
  check('one wallet prompt', wallet.prompts.length === 1);
}, { viewport: { width: 390, height: 844 } });

const failed = results.filter((r) => !r.ok);
const width = Math.max(...results.map((r) => r.scenario.length));
let last = '';
for (const r of results) {
  if (r.scenario !== last) { console.log(`\n${r.scenario}`); last = r.scenario; }
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : `  [${r.detail}]`}`);
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? `, ${failed.length} FAILED` : ''}`);
void width;
process.exit(failed.length ? 1 : 0);
