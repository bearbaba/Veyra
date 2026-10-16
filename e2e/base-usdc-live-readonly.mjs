/**
 * Genuine public RPC acceptance in Chromium against the built Veyra web origin.
 * No real wallet, private key, signing or funds. Fail closed on invalid
 * Mainnet/Sepolia chain identity, USDC decimals, contract or CORS.
 * Public Base RPCs are rate-limited: a failure means this feature is not
 * accepted for release until we provide reliable read infrastructure.
 */
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.VEYRA_PLAYWRIGHT_MODULE ||
  'file:///tmp/veyra-browser/node_modules/playwright/index.mjs');
const URL = process.env.VEYRA_SMOKE_URL || 'http://127.0.0.1:4173';
const chains = [
  { name: 'Base Sepolia', rpc: 'https://sepolia.base.org', id: 84532, usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
  { name: 'Base Mainnet', rpc: 'https://mainnet.base.org', id: 8453, usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
];

async function check() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    try {
      await page.goto(URL, { waitUntil: 'domcontentloaded' });
      const result = await page.evaluate(async (entries) => {
        const allowed = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getCode', 'eth_call']);
        const result = [];
        for (const entry of entries) {
          let id = 0;
          async function rpc(method, params) {
            if (!allowed.has(method)) throw new Error('Forbidden method: ' + method);
            const requestId = ++id;
            const response = await fetch(entry.rpc, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
              cache: 'no-store', signal: AbortSignal.timeout(12_000),
            });
            if (!response.ok) throw new Error(entry.name + ' RPC HTTP ' + response.status);
            const body = await response.json();
            if (!body || typeof body !== 'object' || body.jsonrpc !== '2.0' ||
                body.id !== requestId || 'error' in body ||
                typeof body.result !== 'string') throw new Error(entry.name + ' untrusted RPC response');
            return body.result;
          }
          if (BigInt(await rpc('eth_chainId', [])) !== BigInt(entry.id))
            throw new Error(entry.name + ' returned wrong chain');
          const blockNumber = BigInt(await rpc('eth_blockNumber', []));
          if (blockNumber <= 0n) throw new Error(entry.name + ' has no live blocks');
          const code = await rpc('eth_getCode', [entry.usdc, 'latest']);
          if (!/^0x[0-9a-f]+$/i.test(code)) throw new Error(entry.name + ' USDC contract missing');
          const decimals = BigInt(await rpc('eth_call', [{ to: entry.usdc, data: '0x313ce567' }, 'latest']));
          if (decimals !== 6n) throw new Error(entry.name + ' USDC decimals mismatch');
          const balance = await rpc('eth_call', [{
            to: entry.usdc, data: '0x70a08231' + '0'.repeat(64),
          }, 'latest']);
          if (!/^0x[0-9a-f]+$/i.test(balance)) throw new Error(entry.name + ' balanceOf unavailable');
          result.push({ chainId: entry.id, blockNumber: blockNumber.toString(), decimals: 6 });
        }
        return result;
      }, chains);
      assert.deepEqual(result.map(x => x.chainId), [84532, 8453]);
      console.log('[base-live-readonly] PASS: Base Sepolia and Mainnet CORS, pinned Circle USDC, decimals, bytecode, block heights ' +
        result.map(x => x.blockNumber).join(', ') + '; NO WALLET or funds.');
    } finally { await page.close(); }
  } finally { await browser.close(); }
}
check().catch(error => {
  console.error('[base-live-readonly] BLOCKED: ' + (error instanceof Error ? error.message : 'Unknown RPC error'));
  process.exitCode = 1;
});
