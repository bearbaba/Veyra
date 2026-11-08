// Shared browser harness: official-origin presentation served from the local
// Vite, fake backend for /api, mocked RPC, blocked WebSockets and external hosts.
import { createRequire } from 'node:module';
import { OFFICIAL_ORIGIN } from './fakeIdentityBackend.mjs';

const req = createRequire('/tmp/veyra-browser/package.json');
const { chromium } = req('playwright');
const PREVIEW = process.env.STUDIO_PREVIEW_URL ?? 'http://localhost:5173';

const rpcResult = (method) => {
  switch (method) {
    case 'eth_chainId': return '0x13b2';
    case 'eth_blockNumber': return '0x100';
    case 'eth_getBalance': return '0x0';
    case 'eth_gasPrice': return '0x3b9aca00';
    case 'eth_call': return `0x${'0'.repeat(64)}`;
    case 'eth_estimateGas': return '0x5208';
    default: return '0x0';
  }
};

export async function openApp({ backend, wallet, viewport = { width: 1280, height: 900 } }) {
  const browser = await chromium.launch({
    env: { ...process.env, LD_LIBRARY_PATH: '/tmp/chromelibs/usr/lib/x86_64-linux-gnu', FONTCONFIG_FILE: '/tmp/fonts.conf' },
  });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const consoleErrors = [];
  const external = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e.message).slice(0, 200)}`));

  // Nothing may leave the sandbox except the mocked RPC: abort everything else, record it.
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost') return route.continue();
    external.push(url.hostname);
    return route.abort();
  });
  await context.route(/rpc\.mainnet\.arc\.io/, async (route) => {
    const body = route.request().postDataJSON();
    const answer = (c) => ({ jsonrpc: '2.0', id: c.id, result: rpcResult(c.method) });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(Array.isArray(body) ? body.map(answer) : answer(body)) });
  });
  // The official origin is presented by the browser, but every byte comes from the local Vite or the fake.
  await context.route(`${OFFICIAL_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) return backend.handle(route, url);
    const response = await fetch(`${PREVIEW}${url.pathname}${url.search}`, { headers: { accept: route.request().headers().accept ?? '*/*' } });
    const headers = { 'content-type': response.headers.get('content-type') ?? 'text/plain', 'cache-control': 'no-store' };
    return route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) });
  });
  await page.routeWebSocket(/.*/, (ws) => ws.close());      // Vite HMR must not reach the real site
  await wallet.install(context, page);
  return { browser, context, page, consoleErrors, external };
}

export const goto = async (page, path = '/') => {
  await page.goto(`${OFFICIAL_ORIGIN}${path}`, { waitUntil: 'load' });
  await page.waitForTimeout(1800);
};
