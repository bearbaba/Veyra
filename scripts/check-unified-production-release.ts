/**
 * Phase 6 production-promotion guard: checks the public SINGLE-domain web
 * candidate, not an onchain mainnet release. Fail closed if build flags,
 * preview imports, network defaults, or money-moving provider lifecycle drift.
 *
 * Does not call a wallet, RPC or external service, and never changes deploys.
 * The signed Testnet Pay capability remains exactly as currently approved.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function load(path: string): string { return readFileSync(join(process.cwd(), path), 'utf8'); }
function must(ok: boolean, why: string): void {
  if (!ok) throw new Error(`[release gate] ${why}`);
}
const config = JSON.parse(load('vercel.json')) as {
  framework?: string; buildCommand?: string; outputDirectory?: string;
  rewrites?: unknown[]; env?: Record<string, string>;
  headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
};
must(config.framework === 'vite', 'Unexpected web framework');
must(config.outputDirectory === 'dist', 'Unexpected public artifact directory');
must(config.buildCommand ===
  'VITE_VEYRA_ENV=testnet VITE_VEYRA_UI_ONLY=1 VITE_VEYRA_TESTNET_PAY=1 bun run build',
  'Public domain must compile the safe unified Testnet-first Vite entry');
must(!config.rewrites?.length, 'Unreviewed backend/API rewrites must not be published');
must(!config.env || !Object.keys(config.env).some((name) =>
  /KEY|SECRET|TOKEN|DATABASE|RELAY|MAINNET|RPC/i.test(name)),
  'Production web config contains unexpected financial/runtime environment keys');
const security = config.headers?.find((h) => h.source === '/(.*)');
const exposed = new Map(security?.headers.map((h) => [h.key.toLowerCase(), h.value]) ?? []);
must(exposed.get('x-content-type-options') === 'nosniff', 'Missing nosniff protection');
must(exposed.get('x-frame-options') === 'DENY', 'Missing anti-clickjacking protection');
must(exposed.get('referrer-policy') === 'no-referrer', 'Referrer must not disclose wallet context');
must(exposed.get('permissions-policy')?.includes('camera=()') === true,
  'Unexpected sensitive browser permissions');

const app = load('src/preview/PreviewApp.tsx');
const readOnly = load('src/preview/arcMainnetReadOnly.ts');
const mainnet = load('src/preview/PreviewMainnetSurfaces.tsx');
const testnetPay = load('src/preview/PreviewTestnetPayPage.tsx');
const agent = load('src/preview/PreviewLiveAgent.tsx');
const vite = load('vite.config.ts');
const html = load('preview.html');
const signing = load('src/mainnet/arcMainnetPay.ts');
const registry = load('src/providers/registry/mainnetProviderManifest.ts');

must(html.includes('src="/src/preview/main.tsx"') && !html.includes('src="/src/mainnet/main.tsx"'),
  'Production web must use its reviewed shared Preview entry, never separate Mainnet signer');
must(vite.includes('rollupOptions: { input: previewHtml }'),
  'The stable public entry has been detached from build isolation');
must(app.includes("useState<PreviewNetwork>('testnet')"),
  'Network switch must always default to Testnet');
must(app.includes("onNetworkChange('testnet')") && app.includes("onNetworkChange('mainnet')"),
  'Both environment choices must be visible');
must(app.includes('<PreviewMainnetPay/>') && app.includes('<PreviewTestnetPayPage />'),
  'Unified menu is missing its separated payment screens');
must(mainnet.includes('simulateReadOnlyMainnetIntent') && mainnet.includes('Signing disabled'),
  'Mainnet payment must be read-only');
must(readOnly.includes('PREVIEW_ARC_MAINNET_CHAIN_ID = 5042') &&
  readOnly.includes('PREVIEW_MAINNET_CANARY_MAX = 1_000_000n'),
  'Unverified Mainnet chain or canary limit');
must(signing.includes("import.meta.env.VITE_VEYRA_MAINNET_PAY !== '1'"),
  'Separate mainnet signer lacks its explicit release gate');
must(agent.includes('network === \'testnet\' ? EXAMPLES : MAINNET_EXAMPLES'),
  'Agent suggestions must track the chosen environment');
must(testnetPay.includes('MAX_TESTNET_PAYMENT_UNITS') || testnetPay.includes('submitArcTestnetPay'),
  'Existing capped Testnet Pay flow missing');
must(!/enabled:\s*true/.test(registry), 'Mainnet provider activated before independent approval');

function walk(path: string): string[] {
  return readdirSync(join(process.cwd(), path), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(path, entry.name))
      : /\.tsx?$/.test(entry.name) ? [join(path, entry.name)] : []);
}
for (const path of walk('src/preview')) {
  const source = load(path);
  must(!/from\s*['"][^'"]*(?:\/mainnet\/arcMainnetPay|\/mainnet\/MainnetApp)['"]/.test(source),
    `Mainnet signer imported into public Preview: ${path}`);
}
for (const source of [readOnly, mainnet]) {
  must(!/eth_sendTransaction|eth_signTypedData|personal_sign|depositForBurn|receiveMessage|wallet_addEthereumChain/.test(source),
    'Public Mainnet observation contains signing, network manipulation or bridge calls');
}
console.log('[release gate] PASS: unified Testnet-first web, no Mainnet signer, disabled providers and hardened web response headers.');
