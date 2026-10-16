/**
 * Protect the isolated Mainnet preview artifact without weakening the older
 * Testnet preview isolation contract or enabling mainnet money movement.
 * Run after: VITE_VEYRA_MAINNET_MVP=1 VITE_VEYRA_MAINNET_PAY=0 bun run build
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const dist = join(root, 'dist');
const html = readFileSync(join(dist, 'index.html'), 'utf8');
if (!html.includes('Veyra — Arc Mainnet Pay') ||
    html.includes('src/main.tsx') || html.includes('src/preview/main.tsx')) {
  throw new Error('[mainnet preview] wrong HTML or shared live/testnet entry.');
}
function scripts(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? scripts(file) : entry.isFile() && file.endsWith('.js') ? [file] : [];
  });
}
const files = scripts(dist);
if (files.length === 0) throw new Error('[mainnet preview] no compiled scripts.');
const all = files.map((file) => readFileSync(file, 'utf8')).join('\n');
for (const required of ['ARC MAINNET', 'Safety preview', 'Signing disabled', 'Receipt', '5042']) {
  if (!all.toLowerCase().includes(required.toLowerCase())) {
    throw new Error(`[mainnet preview] missing expected safe Mainnet UI: ${required}`);
  }
}
for (const forbidden of [
  'ARC TESTNET BETA', 'Send real testnet USDC', 'Veyra Assistant',
  '/api/bridge/', '/api/identity/', 'privateKeyToAccount',
  'depositForBurn', 'receiveMessage',
]) {
  if (all.includes(forbidden)) throw new Error(`[mainnet preview] forbidden Testnet/BFF/module marker: ${forbidden}`);
}
const paySource = readFileSync(join(root, 'src/mainnet/arcMainnetPay.ts'), 'utf8');
const uiSource = readFileSync(join(root, 'src/mainnet/MainnetApp.tsx'), 'utf8');
if (!paySource.includes("import.meta.env.VITE_VEYRA_MAINNET_PAY !== '1'") ||
    !uiSource.includes("import.meta.env.VITE_VEYRA_MAINNET_PAY === '1'") ||
    !paySource.includes('MAX_MAINNET_CANARY_UNITS = 1_000_000n') ||
    !paySource.includes('await mainnetPreflight(wallet, reviewed)') ||
    !uiSource.includes('writeMainnetJournal(initial, storageForMainnet())')) {
  throw new Error('[mainnet preview] canary execution or recovery safety boundary missing.');
}
console.log(`[mainnet preview] isolated safety preview PASS: ${files.length} JS assets, signing gated off.`);
