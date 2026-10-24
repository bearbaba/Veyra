/**
 * Separate proof for an explicit identity pilot. Never change existing
 * Vercel financial-preview isolation checks to allow new signing methods.
 *
 * Run only after VITE_VEYRA_IDENTITY_BETA=1 bun run build.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');
const html = readFileSync(join(dist, 'index.html'), 'utf8');
function scan(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? scan(path) : entry.isFile() && path.endsWith('.js') ? [path] : [];
  });
}
const files = scan(dist);
const all = files.map(path => readFileSync(path,'utf8')).join('\n');
if (files.length === 0 || !html.includes('Veyra — Identity & Friends Beta')) {
  throw new Error('[identity beta] no isolated identity entry compiled');
}
for(const marker of [
  'eth_signTypedData_v4', '/api/auth/wallet-login/challenge',
  '/api/identity/register/challenge', '/api/social/friends',
  'No payments or transfers',
]) {
  if (!all.includes(marker)) throw new Error('[identity beta] missing: '+marker);
}
for(const [label,pattern] of [
  ['mainnet network RPC', /wallet_(?:switch|add)EthereumChain/],
  ['financial transaction', /eth_sendTransaction|eth_signTransaction/],
  ['personal signature fallback', /personal_sign|eth_sign"/],
  ['wallet token approval', /0x095ea7b3|approve\(/],
  ['bridge/CCTP execution', /depositForBurn|receiveMessage|eth_sendRawTransaction/],
  ['private key signer', /privateKeyToAccount|RELAY_PRIVATE_KEY/],
  ['financial BFF endpoint', /\/api\/(?:payments?|bridge|cctp|activity|agent|identity\/prepare-payment|identity\/verify-payment)/],
] as const) {
  if (pattern.test(all)) throw new Error('[identity beta] forbidden '+label);
}
if (/src\/main\.tsx|src\/preview\/main\.tsx|src\/mainnet\//.test(html)) {
  throw new Error('[identity beta] mixed entrypoint');
}
// No tokens persisted by this pilot; after reload owner must re-sign.
const source = readFileSync('src/identity-beta/IdentityBetaApp.tsx','utf8');
if (/localStorage|sessionStorage/.test(source) || /localStorage|sessionStorage/.test(readFileSync('src/identity-beta/api.ts','utf8'))) {
  throw new Error('[identity beta] persisted bearer token is prohibited');
}
console.log('[identity beta] isolated browser build verified. Only EIP-712 identity/login signatures.');
