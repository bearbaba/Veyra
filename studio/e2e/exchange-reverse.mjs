// Swap EURC -> USDC and Bridge Base -> Arc, in a real browser, against Circle's live read-only quote
// services (see exchange-preview.mjs for the forward directions). Every number on screen is compared
// with the provider response captured in the same run; nothing is hard-coded to a market price.
// A case is SKIPPED, never passed, when Circle returns no quote. No signature or transaction is possible.
import { suite, newSession, navTo, bodyText, flat, waitForQuote, quoteRows, currentStage, overflow,
  swapPosts, feeGets, swapFields, units6, micro, EURC, ARC_USDC } from './exchange-helpers.mjs';

const { check, skip, finish } = suite();
const SIGNING = /sign|send|addEthereumChain/i;
let swapBaseline = null;      // Circle swap requests produced by ONE click on "Review swap"
let bridgeBaseline = null;    // CCTP fee lookups produced by ONE click on "Review bridge"

async function walletClean(app, expectedSwitches) {
  const { wallet } = app;
  check('wallet was never asked to sign or send', !wallet.methods.some((m) => SIGNING.test(m)), wallet.methods.join(','));
  check('no identity prompt and no forbidden request', wallet.prompts.length === 0 && wallet.forbidden.length === 0);
  check(`chain switches requested: ${JSON.stringify(expectedSwitches)}`,
    JSON.stringify([...new Set(wallet.switches)]) === JSON.stringify(expectedSwitches), JSON.stringify(wallet.switches));
}

async function previewState(page) {
  const t = await bodyText(page);
  const btn = page.getByRole('button', { name: 'Signing disabled in Preview' });
  check('Preview notice is shown', /Preview mode — quotes available, wallet signing disabled\./.test(t));
  check('the action is disabled and says why', (await btn.count()) === 1 && (await btn.first().isDisabled()));
  check('"Confirm in wallet" is not offered', (await page.getByRole('button', { name: 'Confirm in wallet' }).count()) === 0);
  check('stage indicator is on Review', (await currentStage(page)) === 'Review', await currentStage(page));
}

async function expireAndRefresh(app, baseline, label, countPosts) {
  const { page } = app;
  const start = Date.now();
  while (Date.now() - start < 42000 && !/Quote expired/.test(await bodyText(page))) await page.waitForTimeout(1000);
  let t = await bodyText(page);
  check(`${label}: expires after 30 s with the exact message`, /Quote expired\. Refresh before signing\. No transaction was submitted\./.test(t));
  check('expired quote rows are gone, stage returns to Enter details', (await quoteRows(page)).length === 0 && (await currentStage(page)) === 'Enter details');
  const refresh = page.getByRole('button', { name: 'Refresh quote' });
  check('only "Refresh quote" is offered', (await refresh.count()) === 1);
  const before = countPosts();
  await refresh.first().click();
  const ok = await waitForQuote(page);
  if (!ok) { skip(`${label}: re-quote`, 'Circle returned no quote'); return; }
  await page.waitForTimeout(800);
  check('one click on Refresh quote makes exactly one new provider request set', countPosts() - before === baseline, `delta=${countPosts() - before} baseline=${baseline}`);
  check('a fresh live quote is showing again', (await quoteRows(page)).length > 0 && /\b(2\d|30)s left\b/.test(await bodyText(page)));
  check('stage is back on Review', (await currentStage(page)) === 'Review');
}

async function swapReverse({ name, width, height, expiry = false, dbl = false }) {
  console.log(`\n  Swap EURC -> USDC @ ${width}px (${name})${dbl ? ' + double-click' : ''}${expiry ? ' + expiry/re-quote' : ''}`);
  const app = await newSession({ width, height });
  const { page } = app;
  try {
    await navTo(page, 'Swap');
    await page.getByRole('button', { name: 'Reverse swap pair' }).click();
    await page.waitForTimeout(2500);
    let t = flat(await bodyText(page));
    check('Reverse makes EURC the asset you pay', /YOU PAY · TOKEN \| Reverse \| EURC \| Euro Coin/.test(t), t.slice(0, 260));
    check('and USDC the asset you receive', /YOU RECEIVE · TOKEN \| USDC \| USD Coin/.test(t));
    check('EURC balance is read with 6 decimals', /Wallet · 25 EURC/.test(t));
    check('stage starts at Enter details', (await currentStage(page)) === 'Enter details');

    await page.locator('input[inputmode="decimal"]:visible').first().fill('1');
    const before = swapPosts(app).length;
    const reviewButton = page.getByRole('button', { name: /review swap/i }).first();
    if (dbl) await reviewButton.dblclick(); else await reviewButton.click();
    if (!(await waitForQuote(page))) { skip('live EURC -> USDC quote', 'Circle returned no quote'); return; }
    await page.waitForTimeout(800);
    const posts = swapPosts(app);
    const delta = posts.length - before;
    if (!dbl && swapBaseline === null) swapBaseline = delta;
    if (dbl) check('a double-click makes the same number of provider requests as a single click', delta === swapBaseline, `delta=${delta} single=${swapBaseline}`);

    const last = posts.at(-1);
    const req = JSON.parse(last.requestBody);
    check('request: pays EURC', String(req.tokenInAddress).toLowerCase() === EURC);
    check('request: receives USDC', String(req.tokenOutAddress).toLowerCase() === ARC_USDC);
    check('request: 1 EURC is 1000000 raw units (6 decimals)', req.amount === '1000000', req.amount);
    check('request: Arc to Arc with a 1% slippage limit', req.tokenInChain === 'Arc' && req.tokenOutChain === 'Arc' && req.slippageBps === 100);
    check('request: for the connected wallet', String(req.fromAddress).toLowerCase() === app.addr);

    const f = swapFields(last);
    const rows = await quoteRows(page);
    const row = (label) => rows.find((r) => r.label === label);
    check('Expected received equals the provider quote', row('Expected received')?.value === `${units6(f.expected)} USDC`, `${row('Expected received')?.value} vs ${f.expected}`);
    check('Minimum received equals the provider quote', row('Minimum received')?.value === `${units6(f.minimum)} USDC`, `${row('Minimum received')?.value} vs ${f.minimum}`);
    check('expected is labelled an estimate; minimum a reviewed limit', row('Expected received')?.note === 'Estimate' && /reviewed limit/.test(row('Minimum received')?.note ?? ''));
    check('minimum never exceeds expected', BigInt(f.minimum) <= BigInt(f.expected));
    check('minimum is within the 1% slippage limit (to rounding)', BigInt(f.minimum) * 100n >= BigInt(f.expected) * 98n);
    check('provider fee is shown in the provider\'s own asset', row('Provider fee')?.value === `${units6(f.providerFee)} ${f.providerSymbol}`, `${row('Provider fee')?.value} vs ${f.providerFee} ${f.providerSymbol}`);
    const gas = row('Network gas')?.value ?? '';
    check('network gas is in USDC with at most 6 decimals', /^(≈ )?\d+(\.\d{1,6})? USDC$/.test(gas), gas);

    const gasMicro = micro(gas.replace(/^≈ /, '').replace(' USDC', ''));
    const bps = (gasMicro * 10000n + BigInt(f.expected) + gasMicro - 1n) / (BigInt(f.expected) + gasMicro);
    const warning = /about [\d.]+% of this swap/.test(await bodyText(page));
    check(`proportional warning appears exactly when USDC fees reach 1% of the swap (${Number(bps) / 100}%)`, warning === (bps >= 100n), `warning=${warning} bps=${bps}`);
    if (warning) check('the warning says which fees it measured', /Fees paid in USDC are|Network gas and provider fees are/.test(await bodyText(page)));

    await previewState(page);
    check('no horizontal overflow', (await overflow(page)) <= 0);
    await page.screenshot({ path: `/tmp/shots/reverse-swap-${name}.png`, fullPage: true });
    if (expiry) await expireAndRefresh(app, swapBaseline, 'Swap', () => swapPosts(app).length);
    await walletClean(app, []);
  } finally { await app.browser.close(); }
}

async function bridgeReverse({ name, width, height, expiry = false }) {
  console.log(`\n  Bridge Base -> Arc @ ${width}px (${name})${expiry ? ' + expiry/re-quote' : ''}`);
  const app = await newSession({ width, height });
  const { page } = app;
  try {
    await navTo(page, 'Bridge');
    let t = flat(await bodyText(page));
    check('default route is Arc -> Base', /FROM \| Arc \| USDC(?: · Mainnet)? \| TO \| Base \| USDC(?: · Mainnet)?/.test(t), t.slice(0, 200));
    await page.getByRole('button', { name: 'Reverse bridge direction' }).click();
    await page.waitForTimeout(2500);
    t = flat(await bodyText(page));
    check('Reverse makes it Base -> Arc, USDC on both sides', /FROM \| Base \| USDC(?: · Mainnet)? \| TO \| Arc \| USDC(?: · Mainnet)?/.test(t), t.slice(0, 260));
    check('USDC balance is read from Base with 6 decimals', /Wallet · 25 USDC/.test(t));
    check('receive heading names the destination network', /YOU RECEIVE · USDC · Arc Mainnet/.test(t));
    check('stage starts at Enter details', (await currentStage(page)) === 'Enter details');

    await page.locator('input[inputmode="decimal"]:visible').first().fill('5');

    // The wallet is on Arc and the route starts on Base. In Preview the app must explain, not prompt.
    const need = 'Your wallet is on Arc Mainnet. Switch it to Base Mainnet in your wallet to request this quote. Veyra does not change your network in Preview.';
    t = await bodyText(page);
    check('before any click, the network requirement is shown', t.includes(need), t.slice(0, 160));
    await page.getByRole('button', { name: /review bridge/i }).first().click();
    await page.waitForTimeout(3500);
    t = await bodyText(page);
    check('requesting the quote shows the requirement instead of opening a wallet prompt', t.includes(need) && !/Live quote/.test(t));
    check('the app did not ask the wallet to switch networks', app.wallet.switches.length === 0, JSON.stringify(app.wallet.switches));
    check('no provider quote was requested while the network was wrong', feeGets(app, 6, 26).length === 0);

    // The USER switches inside their own wallet; the requirement clears and the quote proceeds.
    await app.wallet.userSwitchesChain(page, 8453);
    await page.waitForTimeout(2500);
    check('after the user switches, the requirement disappears', !(await bodyText(page)).includes('Your wallet is on'));
    const before = feeGets(app, 6, 26).length;
    await page.getByRole('button', { name: /review bridge/i }).first().click();
    if (!(await waitForQuote(page))) { skip('live Base -> Arc CCTP quote', 'Circle returned no quote'); return; }
    await page.waitForTimeout(800);
    const lookups = feeGets(app, 6, 26);
    if (bridgeBaseline === null) bridgeBaseline = lookups.length - before;
    check('CCTP fee lookup is Base domain 6 -> Arc domain 26', lookups.length - before >= 1);
    check('and never the opposite direction (Arc 26 -> Base 6)', feeGets(app, 26, 6).length === 0);

    const tiers = new Set(JSON.parse(lookups.at(-1).responseBody).flatMap((x) => Object.values(x.forwardFee).map((n) => units6(n))));
    const rows = await quoteRows(page);
    const row = (label) => rows.find((r) => r.label === label);
    const fee = row('Forwarding fee')?.value ?? '';
    check('forwarding fee is one of the provider\'s quoted tiers', tiers.has(fee.replace(' USDC', '')), `${fee} not in ${[...tiers]}`);
    check('expected is an estimate; minimum a reviewed, fee-capped limit', row('Expected received')?.note === 'Estimate' && /fee capped/.test(row('Minimum received')?.note ?? ''));
    check('network gas is honestly left to the wallet', row('Network gas')?.value === 'In your wallet');

    await page.getByText('Fee & route details').first().click();
    const details = await page.locator('details').filter({ hasText: 'Fee & route details' }).first().innerText();
    const cap = /CCTP onchain fee cap: ([\d.]+) USDC/.exec(details)?.[1];
    check('details show Base Mainnet -> Arc Mainnet', /Base Mainnet → Arc Mainnet/.test(details), details.slice(0, 200));
    check('details show the maximum authorized fee and independent destination verification', !!cap && /destination independently verified/.test(details), details.slice(0, 260));
    const minimum = row('Minimum received')?.value.replace(' USDC', '') ?? '0';
    check('minimum received = amount - the authorized fee cap, exactly', micro('5') - micro(cap ?? '0') === micro(minimum), `5 - ${cap} vs ${minimum}`);
    check('the cap covers the displayed forwarding fee', micro(cap ?? '0') >= micro(fee.replace(' USDC', '')));
    const capBps = (micro(cap ?? '0') * 10000n + micro('5') - 1n) / micro('5');
    const warned = /Fees are about [\d.]+% of this transfer/.test(await bodyText(page));
    check(`warning appears exactly when the fee cap reaches 1% of the transfer (${Number(capBps) / 100}%)`, warned === (capBps >= 100n), `warned=${warned}`);

    await previewState(page);
    check('no horizontal overflow', (await overflow(page)) <= 0);
    await page.screenshot({ path: `/tmp/shots/reverse-bridge-${name}.png`, fullPage: true });
    if (expiry) await expireAndRefresh(app, bridgeBaseline, 'Bridge', () => feeGets(app, 6, 26).length);
    check('the app never asked the wallet to change network, at any point in Preview', app.wallet.switches.length === 0, JSON.stringify(app.wallet.switches));
    await walletClean(app, []);
  } finally { await app.browser.close(); }
}

async function disconnectedBridge() {
  console.log('\n  Bridge without a connected wallet @ 390px');
  const app = await newSession({ width: 390, height: 844, connect: false });
  const { page } = app;
  try {
    await navTo(page, 'Bridge');
    await page.getByRole('button', { name: 'Reverse bridge direction' }).click().catch(() => {});
    await page.waitForTimeout(800);
    const t = await bodyText(page);
    check('asks the user to connect first', /Connect your wallet to check the balance and request a live quote/.test(t));
    check('offers no quote action', (await page.getByRole('button', { name: /review bridge/i }).count()) === 0);
    check('contacts no provider and asks the wallet for nothing', app.circleCalls.length === 0 && !app.wallet.methods.some((m) => SIGNING.test(m) || /switch/.test(m)), app.circleCalls.length);
  } finally { await app.browser.close(); }
}

await swapReverse({ name: 'phone320', width: 320, height: 700 });                 // baseline: one click
await swapReverse({ name: 'phone390', width: 390, height: 844, expiry: true });
await swapReverse({ name: 'desktop', width: 1280, height: 900, dbl: true });
await bridgeReverse({ name: 'phone390', width: 390, height: 844, expiry: true });
await bridgeReverse({ name: 'desktop', width: 1280, height: 900 });
await disconnectedBridge();
finish();
