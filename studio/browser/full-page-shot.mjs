import { chromium } from '/tmp/veyra-browser/node_modules/playwright/index.mjs';
const [,, w, h, name, label] = process.argv;
const b = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
await p.goto('http://localhost:5173/', { waitUntil: 'load', timeout: 90000 });
await p.waitForTimeout(3500);
if (label && label !== 'Home') { await p.getByRole('button', { name: new RegExp('^\\s*' + label + '\\s*$', 'i') }).first().click(); await p.waitForTimeout(1500); }
await p.screenshot({ path: `/tmp/shots/${name}.png`, fullPage: true });
await b.close();
