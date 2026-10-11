/**
 * Fail CI if the ACTUAL Vercel preview build contains finance/wallet modules,
 * live API clients or known chain transaction selectors. Source text checks
 * alone cannot prove browser bundle isolation.
 *
 * Run after:
 *   VITE_VEYRA_ENV=testnet VITE_VEYRA_UI_ONLY=1 bun run build
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');
const index = readFileSync(join(dist, 'index.html'), 'utf8');

function bundledScripts(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return bundledScripts(full);
    return entry.isFile() && full.endsWith('.js') ? [full] : [];
  });
}

const scripts = bundledScripts(dist);
if (scripts.length === 0 || !index.includes('/assets/')) {
  throw new Error('[preview bundle] no compiled JavaScript asset entry found.');
}

const all = scripts.map((file) => readFileSync(file, 'utf8')).join('\n');

// The preview strings below are deliberately emitted by src/preview.
for (const marker of ['interactive UI preview', 'No payment signatures', 'Ask Veyra']) {
  if (!all.toLowerCase().includes(marker.toLowerCase())) {
    throw new Error(`[preview bundle] expected standalone preview UI not found: ${marker}`);
  }
}

// These can only originate from actual signing/provider modules or BFF API
// clients; the static preview should never package them even as dead routes.
// Keeping this list explicit avoids falsely rejecting explanatory words such
// as "wallet" or "CCTP".
const blocked: Array<[string, RegExp]> = [
  ['Ethereum transaction signing RPC', /eth_sendTransaction/i],
  ['typed-data signing RPC', /eth_signTypedData/i],
  ['personal message signing RPC', /personal_sign/],
  ['wallet credential permission RPC', /wallet_requestPermissions/],
  ['Circle depositForBurn ABI', /depositForBurn/],
  ['CCTP receiveMessage ABI', /receiveMessage/],
  ['wallet client hook', /useWalletClient/],
  ['financial writeContract hook', /useWriteContract/],
  ['financial execution pipeline', /assertExecutionReady/],
  ['private key to signer', /privateKeyToAccount/],
  ['BFF API path', /\/api\/(?:health|bridge|identity|cctp|agent|activity)/],
  ['BFF signed session', /veyra:session/],
];

for (const [label, pattern] of blocked) {
  if (pattern.test(all)) {
    throw new Error(`[preview bundle] forbidden executable content: ${label}`);
  }
}

if (/src\/main\.tsx|src\/App\.tsx/.test(index)) {
  throw new Error('[preview bundle] HTML still contains the live application entry.');
}

console.log(
  `[preview bundle] isolated static Veyra entry verified: ${scripts.length} JS asset(s), ${all.length} bytes; no signing/API paths.`,
);
