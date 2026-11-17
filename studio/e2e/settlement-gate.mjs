// Settlement deployment gate under a misbehaving node, in a real browser.
//
// The Pay screen refuses to sign until it has re-read the deployed contract from
// Arc Mainnet and matched every field. These scenarios make the (read-only) node
// misbehave in three ways and assert what a user would see. Requires the Preview
// (bun run dev) and studio/browser/setup.sh. Read-only: no transaction is possible.
import { createWalletKit } from './mockWallet.mjs';
import { createFakeBackend } from './fakeIdentityBackend.mjs';
import { openApp, goto, connectAndSignIn, openPay } from './harness.mjs';

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  [${extra}]`}`); };
const text = (page) => page.locator('body').innerText();

async function scenario(title, faults, run) {
  console.log(`\n${title}`);
  const wallet = createWalletKit(1);
  const backend = createFakeBackend({ registered: { [wallet.addressOf(0)]: 'alice' } });
  const app = await openApp({ backend, wallet, funded: true, faults, viewport: { width: 390, height: 844 } });
  try {
    await goto(app.page);
    await connectAndSignIn(app.page);
    await openPay(app.page);
    await run(app);
    check('wallet was never asked to send a transaction', wallet.forbidden.length === 0, JSON.stringify(wallet.forbidden));
  } finally { await app.browser.close(); }
}

await scenario('1. A transient "transaction not found" clears: the gate retries and then passes', { nullTxLookups: 2 }, async ({ page, rpcStats }) => {
  await page.waitForTimeout(9000);                       // 1.5 s + 3 s of backoff, plus verification
  const t = await text(page);
  check('gate recovered without the user doing anything', /Review payment/.test(t), t.slice(0, 200));
  check('no "signing disabled" message after recovery', !/all signing disabled/i.test(t));
  check('the node was asked again after each miss', (rpcStats.calls.eth_getTransactionByHash ?? 0) >= 3, JSON.stringify(rpcStats.calls));
});

await scenario('2. The node never finds the transaction: bounded retries, then a plain message, signing stays off', { nullTxLookups: 'always' }, async ({ page, rpcStats }) => {
  await page.waitForTimeout(16000);                      // 1.5 + 3 + 6 s of backoff plus attempts
  const t = await text(page);
  check('gives up with the disabled-signing notice', /all signing disabled/i.test(t));
  check('explains it in plain words', /temporary network issue/i.test(t));
  check('raw library text is not shown by default', !/viem@|Raw Call Arguments|Version:/i.test(t.replace(/Technical detail[\s\S]*$/, '')));
  check('no way to start a payment review', !/Review payment/.test(t));
  const attempts = rpcStats.calls.eth_getTransactionByHash ?? 0;
  check('retries were bounded (4 attempts)', attempts === 4, `attempts=${attempts}`);
});

await scenario('3. A genuine mismatch (no runtime code at the address) fails at once and is never retried', { emptyCode: true }, async ({ page, rpcStats }) => {
  await page.waitForTimeout(5000);
  const t = await text(page);
  check('fails closed with the verification message', /all signing disabled/i.test(t) && /failed verification/i.test(t));
  check('no way to start a payment review', !/Review payment/.test(t));
  const attempts = rpcStats.calls.eth_getTransactionByHash ?? 0;
  check('checked exactly once, no retry', attempts === 1, `attempts=${attempts}`);
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? `, ${failed.length} FAILED` : ''}`);
process.exit(failed.length ? 1 : 0);
