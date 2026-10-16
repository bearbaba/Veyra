/**
 * Deterministic *browser* acceptance for the unified Veyra public bundle.
 *
 * Run ONLY against the local built Testnet-first Vite artifact with an injected
 * fake EIP-1193 wallet and intercepted READ-ONLY Arc Mainnet RPC responses.
 *
 * NEVER execute against a funded wallet or assume this is live Mainnet E2E.
 * All wallet-signing and mainnet submission methods are hard-denied by the
 * mock, and their absence is asserted for every user journey.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const BASE_URL = process.env.VEYRA_SMOKE_URL || 'http://127.0.0.1:4173';
const SENDER = '0x1111111111111111111111111111111111111111';
const DESTINATION = '0x2222222222222222222222222222222222222222';

function addFakeWallet(page) {
  return page.addInitScript(({ sender }) => {
    const listeners = new Map();
    const state = { calls: [], chain: '0x13b2', account: sender };
    window.__veyraSmokeWallet = state;
    const provider = {
      on(event, callback) {
        const current = listeners.get(event) || [];
        listeners.set(event, [...current, callback]);
      },
      removeListener(event, callback) {
        listeners.set(event, (listeners.get(event) || []).filter(fn => fn !== callback));
      },
      async request({ method }) {
        state.calls.push(method);
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [state.account];
        if (method === 'eth_chainId') return state.chain;
        // Browser acceptance must NEVER accidentally sign, broadcast, or
        // auto-change a chain, even in the mocked test environment.
        throw new Error('BLOCKED wallet RPC: ' + method);
      },
    };
    window.ethereum = provider;
    window.__veyraSmokeSetChain = (chain) => {
      state.chain = chain;
      (listeners.get('chainChanged') || []).forEach(callback => callback(chain));
    };
  }, { sender: SENDER });
}

async function mockPublicRpc(page) {
  const calls = [];
  await page.route(/https:\/\/rpc\.mainnet\.arc\.io(?:\/|$)/, async route => {
    const packet = route.request().postDataJSON();
    const method = packet?.method;
    calls.push(method);
    let result;
    if (method === 'eth_chainId') result = '0x13b2';
    else if (method === 'eth_estimateGas') result = '0xc350';
    else if (method === 'eth_gasPrice') result = '0x3b9aca00';
    else if (method === 'eth_call') {
      const data = packet?.params?.[0]?.data;
      if (data === '0x313ce567') result = '0x6';
      else if (typeof data === 'string' && data.startsWith('0x70a08231')) result = '0x989680';
      else if (typeof data === 'string' && data.startsWith('0xa9059cbb')) result = '0x1';
      else throw new Error('Unexpected public Mainnet eth_call calldata: ' + data);
    } else {
      throw new Error('Unexpected Mainnet RPC method in read-only preview: ' + method);
    }
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, result }) });
  });
  await page.route(/fonts\.(?:googleapis|gstatic)\.com/, route => route.abort());
  return calls;
}

async function assertNoUnsafeWalletCalls(page, label) {
  const calls = await page.evaluate(() => window.__veyraSmokeWallet?.calls || []);
  const approved = new Set(['eth_accounts', 'eth_requestAccounts', 'eth_chainId']);
  for (const method of calls) {
    assert(approved.has(method), `${label}: wallet attempted forbidden method ${method}`);
  }
}
async function desktop(browser) {
  const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await addFakeWallet(page);
  const rpcCalls = await mockPublicRpc(page);
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.getByText('ARC TESTNET BETA', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Testnet', exact: true }).getAttribute('aria-pressed'), 'true');

    // Wallet connects by explicit request. Merely selecting a context never
    // asks MetaMask to sign or switches its network.
    await page.getByRole('button', { name: /Connect Wallet/ }).click();
    await page.getByRole('button', { name: 'Injected wallet' }).click();
    await page.getByText('0x1111…1111', { exact: false }).first().waitFor();
    await page.getByRole('button', { name: 'Mainnet', exact: true }).click();
    await page.getByText('ARC MAINNET LAB', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Mainnet', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'Send & Pay' }).click();
    await page.getByText('Signing disabled', { exact: true }).first().waitFor();

    await page.getByLabel('Recipient EVM address').fill(DESTINATION);
    await page.getByLabel('Amount (real Arc USDC)').fill('0.25');
    await page.getByRole('button', { name: 'Simulate & review' }).click();
    await page.getByText('Simulation completed', { exact: true }).waitFor();
    assert(rpcCalls.includes('eth_chainId') && rpcCalls.includes('eth_estimateGas') &&
      rpcCalls.includes('eth_gasPrice'), 'Mainnet quote did not validate real-network metadata and gas');
    assert(!rpcCalls.some(method => method.startsWith('eth_send') || method.startsWith('eth_sign')),
      'Public Mainnet RPC unexpectedly attempted money movement');

    // A context switch must unmount the payment form and discard old quotes.
    await page.getByRole('button', { name: 'Testnet', exact: true }).click();
    await page.getByText('ARC TESTNET BETA', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Mainnet', exact: true }).click();
    await page.getByRole('button', { name: 'Send & Pay' }).click();
    assert.equal(await page.getByLabel('Recipient EVM address').inputValue(), '');
    assert.equal(await page.getByLabel('Amount (real Arc USDC)').inputValue(), '');
    assert.equal(await page.getByText('Simulation completed', { exact: true }).count(), 0);

    // Wrong wallet chain: simulated Mainnet Pay must become disabled, and the
    // app must NOT automatically invoke wallet_switchEthereumChain.
    await page.evaluate(() => window.__veyraSmokeSetChain('0x1'));
    assert.equal(await page.getByRole('button', { name: 'Simulate & review' }).isDisabled(), true);

    for (const title of ['Convert', 'Bridge USDC', 'Activity']) {
      await page.getByRole('button', { name: title, exact: true }).click();
      await page.getByText('Safety gate active', { exact: true }).waitFor();
    }
    await assertNoUnsafeWalletCalls(page, 'desktop');
    assert.deepEqual(errors, [], 'Browser JS exception: ' + errors.join(' | '));
    console.log('[browser acceptance] desktop wallet, network switch, read-only Mainnet simulation, form reset and locked routes: PASS');
  } finally {
    await page.close();
  }
}
async function mobile(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true,
    hasTouch: true, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await addFakeWallet(page);
  await mockPublicRpc(page);
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.getByText('ARC TESTNET BETA', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('button', { name: 'Mainnet', exact: true }).click();
    await page.getByText('ARC MAINNET LAB', { exact: true }).waitFor();
    assert.equal(await page.locator('.vp-sidebar-open').count(), 0,
      'Mobile sidebar stayed open and obscured the Mainnet screen');
    assert((await page.locator('.vp-header .vp-network-pill').innerText()).includes('Arc Mainnet'),
      'Mobile financial network label is hidden');
    const widths = await page.evaluate(() => ({
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    assert(widths.scrollWidth <= widths.viewport + 2,
      `Mobile view overflows screen: ${JSON.stringify(widths)}`);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('button', { name: 'Testnet', exact: true }).click();
    await page.getByText('ARC TESTNET BETA', { exact: true }).waitFor();
    assert.equal(await page.locator('.vp-sidebar-open').count(), 0);
    await assertNoUnsafeWalletCalls(page, 'mobile');
    assert.deepEqual(errors, [], 'Mobile JS exception: ' + errors.join(' | '));
    console.log('[browser acceptance] mobile 390px navigation, network visibility and no-horizontal-scroll: PASS');
  } finally { await page.close(); }
}
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    await desktop(browser);
    await mobile(browser);
    console.log('[browser acceptance] PASS — mocked RPC/wallet only, no real funds or signing.');
  } finally { await browser.close(); }
})().catch((error) => {
  console.error('[browser acceptance] FAILED:', error);
  process.exitCode = 1;
});
