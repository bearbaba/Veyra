import { describe, expect, it } from 'vitest';
import { loadRepositoryTrust, validateRepositoryTrust, type TrustEvidence } from '../../scripts/check-repository-trust';

const files = loadRepositoryTrust();

function modified(path: keyof TrustEvidence, transform: (value: string) => string): TrustEvidence {
  return { ...files, [path]: transform(files[path]) };
}

describe('Veyra repository safety / README provenance contract', () => {
  it('keeps all claims aligned with current code and original GitHub contribution sources', () => {
    expect(validateRepositoryTrust(files)).toEqual([]);
  });
  it('fails if the marketing homepage stops warning about disabled real-money Mainnet signing', () => {
    const broken = modified('README.md', value =>
      value.replace('Mainnet financial execution is not enabled',
        'Mainnet financial execution is enabled'));
    expect(validateRepositoryTrust(broken)).toContain(
      'README must disclose disabled Mainnet financial execution.');
  });
  it('fails if Mainnet financial providers are enabled without release review', () => {
    const broken = modified('src/providers/registry/mainnetProviderManifest.ts', value =>
      value.replace('enabled: false', 'enabled: true'));
    expect(validateRepositoryTrust(broken)).toContain(
      'An executable Mainnet provider must not be promoted by this documentation PR.');
  });
  it('fails if the Testnet spending cap or environment default changes without documented review', () => {
    const uncapped = modified('src/preview/arcTestnetPay.ts', value =>
      value.replace('MAX_TESTNET_PAYMENT_UNITS = 1_000_000n',
        'MAX_TESTNET_PAYMENT_UNITS = 100_000_000n'));
    expect(validateRepositoryTrust(uncapped)).toContain(
      'The public Testnet payment cap changed; re-review README and policy.');
    const mainnetDefault = modified('src/preview/PreviewApp.tsx', value =>
      value.replace("useState<PreviewNetwork>('testnet')", "useState<PreviewNetwork>('mainnet')"));
    expect(validateRepositoryTrust(mainnetDefault)).toContain(
      'The public Veyra UI must continue defaulting to Testnet.');
  });
  it('fails if Vercel starts forwarding to an unreviewed financial backend', () => {
    const rewrite = modified('vercel.json', value => value.replace(
      '"framework": "vite"', '"framework": "vite", "rewrites": []'));
    expect(validateRepositoryTrust(rewrite)).toContain(
      'An unexpected backend rewrite needs a separate reviewed security release.');
  });
  it('fails if a source-linked milestone or the open Production PR status is concealed', () => {
    const erased = modified('docs/DEVELOPMENT_HISTORY.md', value =>
      value.split('https://github.com/bearbaba/Veyra/pull/19').join('https://example.com/fictional-pr'));
    expect(validateRepositoryTrust(erased)).toContain(
      'Missing verifiable original GitHub PR #19 in development history.');
    const relabelled = modified('docs/DEVELOPMENT_HISTORY.md', value =>
      value.replace('**OPEN** → `develop`', '**MERGED** → `develop`'));
    expect(validateRepositoryTrust(relabelled)).toContain(
      'History must disclose that Production promotion PR #7 remains open.');
  });
  it('fails if private vulnerability reporting guidance or CI wiring disappears', () => {
    const removed = modified('SECURITY.md', value => value.split('Private vulnerability reporting').join('Public exploits only'));
    expect(validateRepositoryTrust(removed)).toContain(
      'SECURITY.md must explain a private disclosure route.');
    const ciMissing = modified('.github/workflows/ci.yml', value =>
      value.split('check:repository-trust').join('check:repo-temporarily-disabled'));
    expect(validateRepositoryTrust(ciMissing)).toContain(
      'GitHub Actions must actually run the repository documentation/safety trust gate.');
  });
});
