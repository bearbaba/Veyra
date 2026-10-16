/**
 * External live Arc Mainnet READ-ONLY acceptance.
 *
 * Runs against the publicly built Veyra Vite preview in Chromium, not a mock.
 * Uses no real wallet, account, private key or eth_sendTransaction. It
 * verifies CORS, chain identity, the Arc USDC predeploy and decimals.
 *
 * Run after a local Vite preview is started on VEYRA_SMOKE_URL.
 * A pass proves access from this runner at this moment, NOT financial E2E.
 */
import assert from 'node:assert/strict';

const { chromium } = await import(
  process.env.VEYRA_PLAYWRIGHT_MODULE ||
  'file:///tmp/veyra-browser/node_modules/playwright/index.mjs'
);

const BASE_URL = process.env.VEYRA_SMOKE_URL || 'http://127.0.0.1:4173';
const RPC = 'https://rpc.mainnet.arc.io';
const USDC = '0x3600000000000000000000000000000000000000';

async function verify() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1250, height: 820 } });
    try {
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      // Deliberately no provider injection and no wallet connection.
      const result = await page.evaluate(async ({ rpc, token }) => {
        const permitted = new Set(['eth_chainId', 'eth_blockNumber', 'eth_call', 'eth_getCode']);
        let serial = 0;
        async function call(method, params) {
          if (!permitted.has(method)) throw new Error('Forbidden live RPC call: ' + method);
          const id = ++serial;
          const response = await fetch(rpc, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
            signal: AbortSignal.timeout(12_000),
            cache: 'no-store',
          });
          if (!response.ok) throw new Error('Live Arc RPC HTTP ' + response.status);
          const body = await response.json();
          if (!body || typeof body !== 'object' || Array.isArray(body) ||
              body.jsonrpc !== '2.0' || body.id !== id ||
              Object.prototype.hasOwnProperty.call(body, 'error') ||
              typeof body.result !== 'string' || !/^0x[0-9a-fA-F]+$/.test(body.result)) {
            throw new Error('Invalid live Arc JSON-RPC response: ' + method);
          }
          return body.result;
        }
        const chainHex = await call('eth_chainId', []);
        if (BigInt(chainHex) !== 5042n) throw new Error('Expected chain 5042; got a mismatched RPC');
        const height = BigInt(await call('eth_blockNumber', []));
        if (height <= 0n) throw new Error('Arc RPC returned no real block height');
        const decimals = BigInt(await call('eth_call', [{ to: token, data: '0x313ce567' }, 'latest']));
        if (decimals !== 6n) throw new Error('Expected Arc USDC ERC-20 decimals=6');
        const code = await call('eth_getCode', [token, 'latest']);
        if (code === '0x') throw new Error('Arc USDC ERC-20 interface returned no bytecode');
        const balanceSelector = '0x70a08231' + '0'.repeat(64);
        // No real wallet/account; only the public zero address is queried.
        const balance = BigInt(await call('eth_call', [{ to: token, data: balanceSelector }, 'latest']));
        if (balance < 0n) throw new Error('Invalid Arc USDC balance response');
        return { chainId: Number(BigInt(chainHex)), height: height.toString(),
          decimals: Number(decimals), codePresent: true, corsFromBrowser: true };
      }, { rpc: RPC, token: USDC });
      assert.equal(result.chainId, 5042);
      assert.equal(result.decimals, 6);
      assert.equal(result.codePresent, true);
      assert.equal(result.corsFromBrowser, true);
      console.log('[arc-live-readonly] PASS: chain 5042, USDC facade 6dp, bytecode, block ' +
        result.height + ', CORS from Veyra browser origin; NO wallet signature or funds.');
    } finally { await page.close(); }
  } finally { await browser.close(); }
}
verify().catch(error => {
  console.error('[arc-live-readonly] BLOCKED: ' +
    (error instanceof Error ? error.message : 'Unknown read-only RPC failure'));
  process.exitCode = 1;
});
