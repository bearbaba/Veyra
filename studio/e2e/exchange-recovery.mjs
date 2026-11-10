// UNKNOWN / PENDING recovery locks for Swap and Bridge, in a real browser.
//
// A stored operation that has not been proven must lock the screen against a second attempt,
// must never display as verified, and its recheck must never ask the wallet for anything.
// Records are seeded the way the app itself stores them. Read-only; no provider quote is requested.
import { suite, newSession, navTo, bodyText, currentStage, overflow, feeGets, swapPosts, ensureConnected } from './exchange-helpers.mjs';

const { check, finish } = suite();
const SIGNING = /sign|send|addEthereumChain|switchEthereumChain/i;
const H = (pair) => `0x${pair.repeat(32)}`;
const BASE_ARC = { mode: 'bridge', amount: '5', source: 8453, destination: 5042, fromToken: 'USDC', toToken: 'USDC', minimum: '4.98' };
const EURC_USDC = { mode: 'swap', amount: '1', source: 5042, destination: 5042, fromToken: 'EURC', toToken: 'USDC', minimum: '1.10' };

async function scenario(title, { seed, label, raw = null }, run) {
  console.log(`\n  ${title}`);
  const app = await newSession({ width: 390, height: 844, seed: raw ? null : seed, seedRaw: raw });
  const { page } = app;
  try {
    await navTo(page, label);
    await page.waitForTimeout(2500);
    const storedKey = `veyra:mainnet:circle:v1:${(seed ?? raw).mode}:${app.addr}`;
    const stored = async () => JSON.parse((await page.evaluate((k) => localStorage.getItem(k), storedKey)) ?? 'null');
    await run({ app, page, stored });
    check('wallet was never asked to sign, send or switch chain', !app.wallet.methods.some((m) => SIGNING.test(m)), app.wallet.methods.join(','));
    check('no horizontal overflow', (await overflow(page)) <= 0);
  } finally { await app.browser.close(); }
}

const locked = async (page, app, newAttemptButton) => {
  const t = await bodyText(page);
  check('states the original outcome is locked without repeating warnings', /Do not submit again/.test(t) && /Locked/.test(t));
  check('unresolved outcome stays on Track', (await currentStage(page)) === 'Track', await currentStage(page));
  check('no way to start a new attempt', (await page.getByRole('button', { name: newAttemptButton }).count()) === 0
    && (await page.getByRole('button', { name: 'Refresh quote' }).count()) === 0
    && (await page.getByRole('button', { name: 'Confirm in wallet' }).count()) === 0);
  const missingHash=/Source hash unavailable on this device/.test(t);
  check('recheck only appears with the original source hash',
    (await page.getByRole('button', { name: 'Verify destination onchain' }).count()) === (missingHash?0:1));
  check('a real Activity navigation action is available',
    (await page.getByRole('button', { name: 'Open Activity' }).count()) === 1);
  check('the direction control is locked', await page.getByRole('button', { name: /Reverse (bridge direction|swap pair)/ }).first().isDisabled());
  check('no provider quote was requested', feeGets(app, 6, 26).length + feeGets(app, 26, 6).length + swapPosts(app).length === 0);
  check('not shown as verified', !/Destination verified/.test(t));
};

await scenario('Bridge Base -> Arc, PENDING with a burn hash', { label: 'Bridge', seed: { ...BASE_ARC, status: 'PENDING', burnHash: H('ab') } }, async ({ app, page, stored }) => {
  await locked(page, app, /review bridge/i);
  await page.getByRole('button', { name: 'Verify destination onchain' }).click();
  await page.waitForTimeout(7000);
  const t = await bodyText(page);
  const s = await stored();
  check('rechecking an unknown burn does NOT produce "Destination verified"', !/Destination verified/.test(t));
  check('the record is still PENDING with the same burn hash and no mint hash', s?.status === 'PENDING' && s?.burnHash === H('ab') && s?.mintHash === undefined, JSON.stringify(s));
  check('still locked after the recheck', (await page.getByRole('button', { name: /review bridge/i }).count()) === 0);
});

await scenario('Bridge, stored VERIFIED with NO proof hashes is not trusted', { label: 'Bridge', seed: { ...BASE_ARC, status: 'VERIFIED' } }, async ({ app, page, stored }) => {
  await locked(page, app, /review bridge/i);
  check('explains why missing source evidence prevents a recheck', /Source hash unavailable on this device/.test(await bodyText(page)));
  check('the downgrade is written back, so every reader sees it', (await stored())?.status === 'PENDING');
});

await scenario('Bridge, stored VERIFIED with only a burn hash is not trusted either', { label: 'Bridge', seed: { ...BASE_ARC, status: 'VERIFIED', burnHash: H('ab') } }, async ({ app, page, stored }) => {
  await locked(page, app, /review bridge/i);
  check('stored as PENDING', (await stored())?.status === 'PENDING');
});

await scenario('Bridge, VERIFIED with both proof hashes needs FRESH chain proof', { label: 'Bridge', seed: { ...BASE_ARC, status: 'VERIFIED', burnHash: H('ab'), mintHash: H('cd') } }, async ({ app, page, stored }) => {
  await locked(page, app, /review bridge/i);
  const saved = await stored();
  check('a cached hash pair does not make the bridge Verified', saved?.status === 'PENDING' &&
    saved?.downgradedFrom === 'VERIFIED' && saved?.burnHash === H('ab') && saved?.mintHash === H('cd'),
    JSON.stringify(saved));
  check('no Start new review before independent chain proof', (await page.getByRole('button', { name: 'Start new review' }).count()) === 0);
});

await scenario('Swap EURC -> USDC, PENDING with a transaction hash', { label: 'Swap', seed: { ...EURC_USDC, status: 'PENDING', hash: H('ef') } }, async ({ app, page }) => {
  await locked(page, app, /review swap/i);
  check('locked on the EURC -> USDC route that was started', /EURC/.test(await bodyText(page)));
});

await scenario('Swap, UNKNOWN with no transaction hash', { label: 'Swap', seed: { ...EURC_USDC, status: 'UNKNOWN' } }, async ({ app, page }) => {
  await locked(page, app, /review swap/i);
  check('keeps the missing Swap hash locked without offering an unusable recheck', /Source hash unavailable on this device/.test(await bodyText(page)));
});

await scenario('Swap, stored VERIFIED with no hash is not trusted', { label: 'Swap', seed: { ...EURC_USDC, status: 'VERIFIED' } }, async ({ app, page, stored }) => {
  await locked(page, app, /review swap/i);
  check('stored as PENDING', (await stored())?.status === 'PENDING');
});

await scenario('Bridge, unreadable stored record locks instead of opening a second attempt', { label: 'Bridge', raw: { mode: 'bridge', value: '{not json' } }, async ({ page }) => {
  const t = await bodyText(page);
  check('no way to start a new attempt', (await page.getByRole('button', { name: /review bridge/i }).count()) === 0);
  check('shows a concise locked recovery card', /Recovery needs attention/.test(t) && /Saved operation cannot be read/.test(t), t.slice(0, 200));
  check('unresolved outcome stays on Track', (await currentStage(page)) === 'Track');
});

// ---- The correction must be safe across reloads and wallet changes -------------------------------
const keyFor = (mode, addr) => `veyra:mainnet:circle:v1:${mode}:${addr.toLowerCase()}`;
const readStored = (page, mode, addr) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), keyFor(mode, addr));

console.log('\n  Downgraded record: survives a reload, keeps its evidence, and does not touch another wallet');
{
  const app = await newSession({ width: 390, height: 844, wallets: 2, seed: { ...BASE_ARC, status: 'VERIFIED', burnHash: H('ab') } });
  const { page, wallet } = app;
  const addr1 = wallet.addressOf(1).toLowerCase();
  try {
    await navTo(page, 'Bridge');
    await page.waitForTimeout(2000);
    let stored = await readStored(page, 'bridge', app.addr);
    check('first load: stored as PENDING and marked as downgraded from VERIFIED', stored?.status === 'PENDING' && stored?.downgradedFrom === 'VERIFIED', JSON.stringify(stored));
    check('the original burn hash and every other field are preserved', stored?.burnHash === H('ab') && stored?.amount === '5' && stored?.minimum === '4.98' && stored?.source === 8453 && stored?.destination === 5042, JSON.stringify(stored));
    check('it is NOT recorded as failed or reverted', stored?.status !== 'REVERTED');
    let t = await bodyText(page);
    check('the user is told it was saved as verified but is unresolved, not failed, and nothing was resent',
      /Previously saved as verified/.test(t) && /No funds were resent/.test(t));
    const snapshot = JSON.stringify(stored);

    await page.reload();
    await ensureConnected(page);
    await navTo(page, 'Bridge');
    await page.waitForTimeout(2000);
    t = await bodyText(page);
    stored = await readStored(page, 'bridge', app.addr);
    check('after a reload it is still locked and unresolved', /Do not submit again/.test(t) && !/Destination verified/.test(t) && (await page.getByRole('button', { name: /review bridge/i }).count()) === 0);
    check('after a reload the stored record is exactly what it was (no drift, no loss)', JSON.stringify(stored) === snapshot, JSON.stringify(stored));

    await wallet.switchAccount(page, 1);
    await page.waitForTimeout(2500);
    t = await bodyText(page);
    check('a different wallet is not locked by the first wallet\'s record', /Review bridge/.test(t) && !/Do not submit again/.test(t));
    check('and starts at Review', (await currentStage(page)) === 'Review');
    check('the second wallet has no record created or inherited', (await readStored(page, 'bridge', addr1)) === null);
    check('the first wallet\'s record was not modified by the switch', JSON.stringify(await readStored(page, 'bridge', app.addr)) === snapshot);

    await wallet.switchAccount(page, 0);
    await page.waitForTimeout(2500);
    t = await bodyText(page);
    check('switching back restores the lock for the first wallet', /Do not submit again/.test(t) && (await page.getByRole('button', { name: /review bridge/i }).count()) === 0);
    check('wallet was never asked to sign or send', !app.wallet.methods.some((m) => /sign|send/i.test(m)), app.wallet.methods.join(','));
  } finally { await app.browser.close(); }
}

console.log('\n  A cached VERIFIED with both hashes requires fresh onchain proof even across reloads');
{
  const record = { ...BASE_ARC, status: 'VERIFIED', burnHash: H('ab'), mintHash: H('cd') };
  const app = await newSession({ width: 390, height: 844, wallets: 2, seed: record });
  const { page, wallet } = app;
  try {
    await navTo(page, 'Bridge');
    await page.waitForTimeout(2000);
    const first = await readStored(page, 'bridge', app.addr);
    check('previous VERIFIED is unresolved but its original evidence survives',
      first?.status==='PENDING'&&first?.downgradedFrom==='VERIFIED'&&
      first?.burnHash===H('ab')&&first?.mintHash===H('cd'), JSON.stringify(first));
    check('does not falsely present a verified destination', !/Destination verified/.test(await bodyText(page)));
    const snapshot=JSON.stringify(first);
    await page.reload(); await ensureConnected(page); await navTo(page, 'Bridge'); await page.waitForTimeout(2000);
    check('a reload cannot promote local hashes to completion', !/Destination verified/.test(await bodyText(page)));
    check('original hashes survive reload without drift', JSON.stringify(await readStored(page, 'bridge', app.addr))===snapshot);
    await wallet.switchAccount(page, 1); await page.waitForTimeout(2500);
    check('second wallet cannot inherit another wallet\'s stale result',
      !/Destination verified/.test(await bodyText(page))&&/Review bridge/.test(await bodyText(page)));
    await wallet.switchAccount(page, 0); await page.waitForTimeout(2500);
    check('first wallet remains locked awaiting independent proof', /Do not submit again/.test(await bodyText(page)));
  } finally { await app.browser.close(); }
}

finish();
