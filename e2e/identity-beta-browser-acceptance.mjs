/**
 * Deterministic isolated Identity Beta Chromium acceptance. Both wallets are
 * mock EIP-1193/EIP-6963 providers. No signature, OAuth, funded wallet,
 * transaction, or Mainnet execution is permitted or claimed by this test.
 */
import assert from 'node:assert/strict';

const { chromium } = await import(
  process.env.VEYRA_PLAYWRIGHT_MODULE ||
  'file:///tmp/veyra-browser/node_modules/playwright/index.mjs'
);
const base = process.env.VEYRA_SMOKE_URL ?? 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const apiRequests = [];
  page.on('request', request => {
    if (/\/api\/(identity|auth|social)/.test(request.url())) apiRequests.push(request.url());
  });
  await page.addInitScript(() => {
    const addresses = {
      MetaMask: '0x1111111111111111111111111111111111111111',
      Rabby: '0x2222222222222222222222222222222222222222',
    };
    const calls = [];
    window.__veyraEip6963Calls = calls;
    const providers = Object.fromEntries(Object.entries(addresses).map(([name, account]) => [
      name,
      {
        on() {},
        removeListener() {},
        request({method}) {
          calls.push({name, method});
          if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
            return Promise.resolve([account]);
          }
          if (method === 'eth_chainId') return Promise.resolve('0x4cef52');
          throw new Error('Forbidden wallet RPC: ' + method);
        },
      },
    ]));
    // Simulate a contested legacy global pointing at the *other* wallet.
    window.ethereum = providers.Rabby;
    window.addEventListener('eip6963:requestProvider', () => {
      for (const [name, provider] of Object.entries(providers)) {
        window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
          detail: {
            info: {
              name,
              uuid: name === 'MetaMask'
                ? '11223344-1122-4111-a111-112233445566'
                : '55667788-1122-4222-b222-556677889900',
              rdns: name === 'MetaMask' ? 'io.metamask' : 'io.rabby',
              icon: '',
            },
            provider,
          },
        }));
      }
    });
  });

  await page.goto(base, { waitUntil: 'networkidle' });
  assert.match(await page.locator('body').innerText(), /IDENTITY · FRIENDS · TRUST/i);
  assert.match(await page.locator('body').innerText(), /Link your X account/i);
  assert.match(await page.locator('body').innerText(), /No payments or transfers/i);
  await page.getByRole('button', {name:/MetaMask/}).waitFor({state:'visible'});
  await page.getByRole('button', {name:/Rabby/}).waitFor({state:'visible'});

  await page.getByRole('button', {name:/MetaMask/}).click();
  await page.getByText('Correct network · Ready for identity signing').waitFor();
  assert.match(await page.locator('.vi-network strong').innerText(), /^0x1111.*1111$/i);
  await page.getByRole('button', {name:/Disconnect/}).click();
  await page.getByRole('button', {name:/Rabby/}).click();
  await page.getByText('Correct network · Ready for identity signing').waitFor();
  assert.match(await page.locator('.vi-network strong').innerText(), /^0x2222.*2222$/i);

  assert.equal(apiRequests.length, 0, 'wallet selection must not trigger identity or X network requests');
  const calls = await page.evaluate(() => window.__veyraEip6963Calls);
  assert.ok(calls.some(call => call.name === 'MetaMask' && call.method === 'eth_requestAccounts'));
  assert.ok(calls.some(call => call.name === 'Rabby' && call.method === 'eth_requestAccounts'));
  assert.ok(calls.every(call => ['eth_requestAccounts','eth_chainId'].includes(call.method)));
  console.log('[identity-beta-browser] PASS: two explicit EIP-6963 wallets, no RPC signing or API mutations');
} finally {
  await browser.close();
}
