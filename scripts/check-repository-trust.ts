/**
 * Fail-closed repository trust gate.
 *
 * Purpose: prevent the project homepage from accidentally claiming working
 * Mainnet signing, deployed full-stack identity, or GitHub Production releases
 * that are NOT in the shipped frontend. This validates declared invariants
 * alongside their actual source-code boundaries; it is not a security audit.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {isExactStagingBffAllowlist} from './stagingBffAllowlist';

export const TRUST_FILES = [
  'README.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'CHANGELOG.md',
  'docs/DEVELOPMENT_HISTORY.md',
  'src/preview/PreviewApp.tsx',
  'src/preview/arcTestnetPay.ts',
  'src/preview/PreviewMainnetSurfaces.tsx',
  'src/preview/PreviewUnified.tsx',
  'src/preview/PreviewBaseUsdcBalance.tsx',
  'src/providers/registry/mainnetProviderManifest.ts',
  'vercel.json',
  '.github/workflows/ci.yml',
] as const;

export type TrustFile = typeof TRUST_FILES[number];
export type TrustEvidence = Record<TrustFile, string>;

export function validateRepositoryTrust(evidence: TrustEvidence): string[] {
  const issues: string[] = [];
  function requireMatch(path: TrustFile, regex: RegExp, message: string) {
    if (!regex.test(evidence[path] ?? '')) issues.push(message);
  }
  function requireAbsent(path: TrustFile, regex: RegExp, message: string) {
    if (regex.test(evidence[path] ?? '')) issues.push(message);
  }

  for (const path of TRUST_FILES) {
    if (!evidence[path]?.trim()) issues.push(`Missing or empty required evidence: ${path}`);
  }

  // Marketing text must say what exists today, not what is planned.
  requireMatch('README.md', /The Intelligent Money Layer on Arc/,
    'README must retain the original Veyra financial application mission.');
  requireMatch('README.md', /Mainnet financial execution is not enabled/i,
    'README must disclose disabled Mainnet financial execution.');
  requireMatch('README.md', /isolated Identity Beta.*(?:unified|financial)/i,
    'README must distinguish the isolated working Identity Beta from unified Production.');
  requireMatch('README.md', /docs\/veyra-single-product-release-contract\.md/,
    'README must link the single-product release gate contract.');
  requireMatch('README.md', /not a promise that every feature is present on the older Production deployment/i,
    'README must distinguish active Phase 5 candidate from older Production.');
  requireMatch('README.md', /Circle Gateway pooled balance/i,
    'README must distinguish observed USDC from Gateway custody.');
  requireMatch('README.md', /1 testnet USDC per transfer/i,
    'README must explicitly disclose the capped browser Testnet payment.');
  requireMatch('README.md', /(?:no claim of an independent security audit|no independent security audit)/i,
    'README must not imply an independent audit.');

  // A source-level financial boundary must agree with those claims.
  requireMatch('src/preview/PreviewApp.tsx', /useState<PreviewNetwork>\('testnet'\)/,
    'The public Veyra UI must continue defaulting to Testnet.');
  requireMatch('src/preview/arcTestnetPay.ts', /MAX_TESTNET_PAYMENT_UNITS\s*=\s*1_000_000n/,
    'The public Testnet payment cap changed; re-review README and policy.');
  requireMatch('src/preview/PreviewMainnetSurfaces.tsx', /Signing disabled/,
    'The Mainnet public view lost its explicit disabled-signing state.');
  requireAbsent('src/preview/PreviewMainnetSurfaces.tsx',
    /eth_sendTransaction|eth_signTypedData|personal_sign|depositForBurn|receiveMessage/,
    'Mainnet public surface contains an unreviewed financial execution method.');
  requireAbsent('src/providers/registry/mainnetProviderManifest.ts', /enabled:\s*true\b/,
    'An executable Mainnet provider must not be promoted by this documentation PR.');
  requireMatch('src/preview/PreviewUnified.tsx', /PreviewBaseUsdcBalance/,
    'Unified read-only Base support is missing from the documented current product.');
  requireMatch('src/preview/PreviewBaseUsdcBalance.tsx', /Unavailable —/,
    'Failed Base RPC reads must explicitly disclose unavailable state.');
  requireMatch('vercel.json',
    /(?:VITE_VEYRA_ENV=testnet VITE_VEYRA_UI_ONLY=1 VITE_VEYRA_TESTNET_PAY=1|VITE_VEYRA_ENV=testnet VITE_VEYRA_UNIFIED_STAGING=1 VITE_VEYRA_UI_ONLY=0 VITE_VEYRA_TESTNET_PAY=1 VITE_VEYRA_MAINNET_MVP=0 VITE_VEYRA_MAINNET_PAY=0 VITE_VEYRA_IDENTITY_BETA=0) bun run build/,
    'Vercel production preview build must remain explicit Testnet-first.');
  // Original finance Production must remain proxy-free. The staging branch
  // permits ONLY the reviewed exact HTTPS BFF route list (not a wildcard).
  const buildString = evidence['vercel.json'];
  const isStaging = buildString.includes('VITE_VEYRA_UNIFIED_STAGING=1');
  if(isStaging){
    let routes:unknown;
    try{routes=(JSON.parse(buildString) as {rewrites?:unknown}).rewrites;}
    catch{routes=undefined;}
    if(!isExactStagingBffAllowlist(routes))
      issues.push('An unexpected backend rewrite needs a separate reviewed security release.');
  } else {
    requireAbsent('vercel.json', /"rewrites"\s*:/,
      'An unexpected backend rewrite needs a separate reviewed security release.');
  }

  // Disclosure and provenance docs must not be empty badges or made-up dates.
  requireMatch('SECURITY.md', /Private vulnerability reporting/,
    'SECURITY.md must explain a private disclosure route.');
  requireMatch('SECURITY.md', /do\s+\*\*not\*\*\s+constitute an independent audit|does not.*independent audit/i,
    'Security policy must not imply source tests are an independent audit.');
  requireMatch('SECURITY.md', /do not recommend disabling phishing checks/i,
    'Security policy must not ask users to bypass wallet phishing warnings.');
  requireMatch('CONTRIBUTING.md', /phase5-production-bridge-flow/,
    'Contributor guidance must identify the active candidate branch.');
  requireMatch('CONTRIBUTING.md', /separate.*operator decision/i,
    'Contributor guidance must treat develop promotion as separately authorized.');
  requireMatch('CHANGELOG.md', /not necessarily deployed|NOT necessarily deployed/i,
    'Changelog must distinguish merged feature code from Production deployment.');
  requireMatch('docs/DEVELOPMENT_HISTORY.md', /PR #7.*OPEN|#7[^\n]*OPEN/i,
    'History must disclose that Production promotion PR #7 remains open.');
  requireMatch('docs/DEVELOPMENT_HISTORY.md', /did NOT merge them into `develop`/i,
    'History must distinguish merge targets from Production.');

  for (let n = 1; n <= 19; n++) {
    if (!evidence['docs/DEVELOPMENT_HISTORY.md'].includes(
      `https://github.com/bearbaba/Veyra/pull/${n}`
    )) issues.push(`Missing verifiable original GitHub PR #${n} in development history.`);
  }
  requireMatch('.github/workflows/ci.yml', /check:repository-trust/,
    'GitHub Actions must actually run the repository documentation/safety trust gate.');

  return issues;
}

export function loadRepositoryTrust(cwd = process.cwd()): TrustEvidence {
  const entries = TRUST_FILES.map(path => [path, readFileSync(join(cwd, path), 'utf8')] as const);
  return Object.fromEntries(entries) as TrustEvidence;
}

if (import.meta.main) {
  const problems = validateRepositoryTrust(loadRepositoryTrust());
  if (problems.length) {
    for (const issue of problems) console.error(`[repository trust] FAIL: ${issue}`);
    process.exitCode = 1;
  } else {
    console.log('[repository trust] PASS: README/release boundary, Mainnet gates, disclosure, PR provenance and CI wiring.');
  }
}
