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

// Confirm that the built Preview contains its English service-gate copy, not a stale UI.
for (const marker of ['ARC TESTNET BETA', 'Veyra Assistant', 'Live execution is not available on this Preview']) {
  if (!all.toLowerCase().includes(marker.toLowerCase())) {
    throw new Error(`[preview bundle] expected standalone preview UI not found: ${marker}`);
  }
}

// These can only originate from actual signing/provider modules or BFF API
// clients; the static preview should never package them even as dead routes.
// Keeping this list explicit avoids falsely rejecting explanatory words such
// as "wallet" or "CCTP".
const blocked: Array<[string, RegExp]> = [
  ['mainnet switching RPC', /wallet_addEthereumChain/],
  ['wallet unlimited allowance selector', /0x095ea7b3/i],
  ['typed-data signing RPC', /eth_signTypedData/i],
  ['personal message signing RPC', /personal_sign/],
  ['wallet credential permission RPC', /wallet_requestPermissions/],
  ['Circle depositForBurn ABI', /depositForBurn/],
  ['CCTP receiveMessage ABI', /receiveMessage/],
  ['wallet client hook', /useWalletClient/],
  ['financial writeContract hook', /useWriteContract/],
  ['financial execution pipeline', /assertExecutionReady/],
  ['private key to signer', /privateKeyToAccount/],
  ['BFF API path (live AI function is the only permitted same-origin API)', /\/api\/(?:health|bridge|identity|cctp|activity|agent\/(?!chat(?:[\x27\x22?]|$)))/],
  ['BFF signed session', /veyra:session/],
];

// The ONLY permitted financial RPC is the explicitly capped direct Arc
// Testnet USDC.transfer() inside the isolated beta module. Reject missing
// safeguards, duplicate RPC selector bundles, and any other signature path.
const betaSource = readFileSync(join(process.cwd(), 'src/preview/arcTestnetPay.ts'), 'utf8');
const betaPage = readFileSync(join(process.cwd(), 'src/preview/PreviewTestnetPayPage.tsx'), 'utf8');
const envBuild = readFileSync(join(process.cwd(), 'vercel.json'), 'utf8');
if (
  !envBuild.includes('VITE_VEYRA_TESTNET_PAY=1') ||
  !betaSource.includes('export const ARC_TESTNET_CHAIN_ID = 5042002;') ||
  !betaSource.includes('export const MAX_TESTNET_PAYMENT_UNITS = 1_000_000n') ||
  !betaSource.includes("functionName: 'transfer'") ||
  !betaSource.includes("method: 'eth_sendTransaction'") ||
  !betaSource.includes('await assertArcRpcChain()') ||
  !betaSource.includes('await verifyWalletConnected(') && !betaSource.includes("provider.request({ method: 'eth_chainId'") ||
  !betaPage.includes('I checked the chain, token, recipient and amount.') ||
  (all.match(/eth_sendTransaction/g) ?? []).length !== 1
) {
  throw new Error('[preview bundle] capped wallet-approved Arc Testnet payment safety boundary missing.');
}

// One stateless, token-protected Vercel Function IS explicitly allowed for
// genuine AI chat. It must never be confused with the authenticated Express
// BFF or be used as an execution/bridge API.
if (!all.includes('/api/agent/chat')) {
  throw new Error('[preview bundle] genuine Vercel AI endpoint path absent.');
}
const liveAgentSource = readFileSync(join(process.cwd(), 'src/preview/PreviewLiveAgent.tsx'), 'utf8');
const apiSource = readFileSync(join(process.cwd(), 'api/agent/chat.ts'), 'utf8');
if (
  !liveAgentSource.includes("method: 'POST'") ||
  !liveAgentSource.includes("Authorization: `Bearer") ||
  liveAgentSource.includes('local-fallback') ||
  !apiSource.includes("process.env.OPENAI_API_KEY") ||
  !apiSource.includes("VEYRA_AGENT_BETA_TOKEN") ||
  !apiSource.includes("store: false") ||
  !apiSource.includes("max_tokens: 450")
) {
  throw new Error('[preview bundle] live AI auth or non-fallback safety contract missing.');
}

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
