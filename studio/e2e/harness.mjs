// Shared browser harness: official-origin presentation served from the local
// Vite, fake backend for /api, mocked RPC, blocked WebSockets and external hosts.
import { createRequire } from 'node:module';
import { OFFICIAL_ORIGIN } from './fakeIdentityBackend.mjs';

const req = createRequire('/tmp/veyra-browser/package.json');
const viem = createRequire(import.meta.url)('viem');
const { chromium } = req('playwright');
const PREVIEW = process.env.STUDIO_PREVIEW_URL ?? 'http://localhost:5173';

const word = (n) => `0x${BigInt(n).toString(16).padStart(64, '0')}`;
const ARC_MAINNET_RPC = 'https://rpc.mainnet.arc.io';
const ARC_USDC = '0x3600000000000000000000000000000000000000';
// Read-only JSON-RPC may reach the real Arc Mainnet node (it cannot move funds): the app's
// contract-identity checks need the real deployed code. Every other method is refused locally.
const READ_ONLY = new Set([
  'eth_chainId', 'net_version', 'eth_blockNumber', 'eth_getBalance', 'eth_call', 'eth_getCode',
  'eth_getBlockByNumber', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory',
  'eth_estimateGas', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getLogs',
  'eth_getTransactionCount', 'eth_getStorageAt',
]);

/**
 * Answers a JSON-RPC call for the throwaway wallet. With `funded` it holds 25 USDC (ERC-20 view,
 * 6 decimals; native view, 18 decimals) and no allowance. Returns undefined to mean "ask the node".
 */
function overrideFor(call, funded, walletAddress, faults, stats) {
  const me = walletAddress?.toLowerCase();
  const p = call.params?.[0] ?? {};
  const from = String(p.from ?? '').toLowerCase();
  // Deliberate node misbehaviour for the Settlement gate tests.
  if (call.method === 'eth_getTransactionByHash' && faults?.nullTxLookups) {
    if (faults.nullTxLookups === 'always') return null;
    if (stats.nullsServed < faults.nullTxLookups) { stats.nullsServed++; return null; }
  }
  // A genuine mismatch: the node reports no runtime code at the deployed address.
  if (call.method === 'eth_getCode' && faults?.emptyCode) return '0x';
  if (call.method === 'eth_getBalance' && funded && String(call.params?.[0]).toLowerCase() === me) {
    return `0x${(25n * 10n ** 18n).toString(16)}`;
  }
  if (call.method === 'eth_call') {
    const data = String(p.data ?? p.input ?? '').toLowerCase();
    if (funded && String(p.to).toLowerCase() === ARC_USDC && data.startsWith('0x70a08231') && data.endsWith(me?.slice(2) ?? '#')) {
      return word(25_000_000);
    }
    if (from === me) return '0x';                       // simulation of the wallet's own call: succeeds, no state
  }
  if (call.method === 'eth_estimateGas' && from === me) return '0x1d4c0';
  return undefined;
}

const MULTICALL_SELECTOR = '0x82ad56cb';   // multicall3 aggregate3: how the app batches every read
const BALANCE_OF = '0x70a08231';

/**
 * The app batches reads through multicall3, so a balance cannot be overridden by looking at the
 * outer call. Ask the real node, then replace only the throwaway wallet's USDC balanceOf result.
 */
async function patchedMulticall(call, walletAddress) {
  const me = walletAddress.toLowerCase();
  const data = String(call.params[0].data);
  const { args } = viem.decodeFunctionData({ abi: viem.multicall3Abi, data });
  const subcalls = args[0];
  const targets = subcalls.map((c, i) => ({ i, hit: c.target.toLowerCase() === ARC_USDC && c.callData.toLowerCase().startsWith(BALANCE_OF) && c.callData.toLowerCase().endsWith(me.slice(2)) }));
  if (!targets.some((t) => t.hit)) return undefined;
  const r = await fetch(ARC_MAINNET_RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: call.params }) });
  const body = await r.json();
  if (!body.result) return undefined;
  const results = viem.decodeFunctionResult({ abi: viem.multicall3Abi, functionName: 'aggregate3', data: body.result });
  const patched = results.map((x, i) => (targets[i].hit ? { success: true, returnData: word(25_000_000) } : x));
  return viem.encodeFunctionResult({ abi: viem.multicall3Abi, functionName: 'aggregate3', result: patched });
}

async function answerRpc(calls, funded, walletAddress, faults, stats) {
  const results = new Map();
  const forward = [];
  for (const c of calls) {
    if (!READ_ONLY.has(c.method)) { results.set(c.id, { error: { code: -32601, message: `refused by test harness: ${c.method}` } }); continue; }
    stats.calls[c.method] = (stats.calls[c.method] ?? 0) + 1;
    let o = overrideFor(c, funded, walletAddress, faults, stats);
    if (o === undefined && funded && c.method === 'eth_call' && String(c.params?.[0]?.data ?? '').toLowerCase().startsWith(MULTICALL_SELECTOR)) {
      try { o = await patchedMulticall(c, walletAddress); } catch { o = undefined; }
    }
    if (o !== undefined) results.set(c.id, { result: o }); else forward.push(c);
  }
  if (forward.length) {
    try {
      const r = await fetch(ARC_MAINNET_RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(forward) });
      const body = await r.json();
      for (const item of Array.isArray(body) ? body : [body]) results.set(item.id, item.error ? { error: item.error } : { result: item.result });
    } catch {
      for (const c of forward) results.set(c.id, { error: { code: -32000, message: 'node unreachable from sandbox' } });
    }
  }
  return calls.map((c) => ({ jsonrpc: '2.0', id: c.id, ...(results.get(c.id) ?? { error: { code: -32000, message: 'no answer' } }) }));
}

export async function openApp({ backend, wallet, viewport = { width: 1280, height: 900 }, funded = false, faults = null }) {
  const rpcStats = { calls: {}, nullsServed: 0 };
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
    const calls = Array.isArray(body) ? body : [body];
    const answers = await answerRpc(calls, funded, wallet.addressOf?.(0), faults, rpcStats);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(Array.isArray(body) ? answers : answers[0]) });
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
  return { browser, context, page, consoleErrors, external, rpcStats };
}

export const goto = async (page, path = '/') => {
  await page.goto(`${OFFICIAL_ORIGIN}${path}`, { waitUntil: 'load' });
  await page.waitForTimeout(1800);
};

/** Connects the mock wallet and signs in once (the wallet must be registered in the fake backend). */
export async function connectAndSignIn(page) {
  await page.getByRole('button', { name: /connect wallet/i }).first().click();
  await page.getByText('Browser Wallet').click();
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: 'Friends', exact: true }).locator('visible=true').first().click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'Sign in to Veyra ID' }).click();
  await page.waitForTimeout(2000);
}

export async function openPay(page) {
  await page.getByRole('button', { name: 'Pay', exact: true }).locator('visible=true').first().click();
}
