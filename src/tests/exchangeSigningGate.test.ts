import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exchangeSigningBlock, PREVIEW_HEADLINE, signingNotice, type ExchangeMode } from '../mainnet/exchangeSigningGate';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

/** The release-gate expression exactly as it was before the reason was added. */
const originalReady = (releaseEnv: string, emergency: boolean, beta: boolean, bridgeWrite: boolean, mode: ExchangeMode) =>
  releaseEnv === 'production' && !emergency && beta && (mode === 'swap' || bridgeWrite);

describe('Swap/Bridge signing gate keeps the original semantics', () => {
  it('is ready exactly when the original expression is, for every input combination', () => {
    let checked = 0;
    for (const releaseEnv of ['production', 'preview', 'local', 'development', '']) {
      for (const emergency of [false, true]) {
        for (const beta of [false, true]) {
          for (const bridgeWrite of [false, true]) {
            for (const mode of ['swap', 'bridge'] as const) {
              const block = exchangeSigningBlock({ releaseEnv, emergencyReadOnly: emergency, publicBeta: beta, bridgeWriteEnabled: bridgeWrite, mode });
              expect(block === null, `${releaseEnv}/${emergency}/${beta}/${bridgeWrite}/${mode}`)
                .toBe(originalReady(releaseEnv, emergency, beta, bridgeWrite, mode));
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBe(80);
  });

  it('never enables signing outside the Production release, whatever else is set', () => {
    for (const releaseEnv of ['preview', 'local', 'development', '', 'PRODUCTION', 'production ']) {
      for (const mode of ['swap', 'bridge'] as const) {
        expect(exchangeSigningBlock({ releaseEnv, emergencyReadOnly: false, publicBeta: true, bridgeWriteEnabled: true, mode })).toBe('preview');
      }
    }
  });

  it('an emergency stop wins over every other flag in Production', () => {
    for (const mode of ['swap', 'bridge'] as const) {
      expect(exchangeSigningBlock({ releaseEnv: 'production', emergencyReadOnly: true, publicBeta: true, bridgeWriteEnabled: true, mode })).toBe('emergency');
    }
  });

  it('reports why: beta off, and Bridge-only switch', () => {
    const base = { releaseEnv: 'production', emergencyReadOnly: false, publicBeta: true, bridgeWriteEnabled: false } as const;
    expect(exchangeSigningBlock({ ...base, publicBeta: false, mode: 'swap' })).toBe('beta-off');
    expect(exchangeSigningBlock({ ...base, mode: 'bridge' })).toBe('bridge-off');
    expect(exchangeSigningBlock({ ...base, mode: 'swap' })).toBeNull();
  });
});

describe('Production signing configuration (read from the build profile, not assumed)', () => {
  const profile = read('scripts/build-mainnet-pilot.ts');
  const flag = (name: string) => new RegExp(`${name}:\\s*'([^']*)'`).exec(profile)?.[1];

  it('the profile enables public beta, leaves the emergency stop off, and enables the Bridge beta switch', () => {
    expect(flag('VITE_VEYRA_PUBLIC_BETA')).toBe('1');
    expect(flag('VITE_VEYRA_EMERGENCY_READ_ONLY')).toBe('0');
    expect(flag('VITE_VEYRA_MAINNET_BRIDGE_BETA_ENABLED')).toBe('1');
  });

  it('therefore the Production release is configured for Swap and Bridge signing, and the Preview never is', () => {
    const publicBeta = flag('VITE_VEYRA_PUBLIC_BETA') === '1';
    const emergencyReadOnly = flag('VITE_VEYRA_EMERGENCY_READ_ONLY') === '1';
    const bridgeBeta = flag('VITE_VEYRA_MAINNET_BRIDGE_BETA_ENABLED') === '1';
    for (const mode of ['swap', 'bridge'] as const) {
      const bridgeWriteEnabled = publicBeta && bridgeBeta;   // as computed in MainnetCirclePage (release env checked separately)
      expect(exchangeSigningBlock({ releaseEnv: 'production', emergencyReadOnly, publicBeta, bridgeWriteEnabled, mode })).toBeNull();
      expect(exchangeSigningBlock({ releaseEnv: 'local', emergencyReadOnly, publicBeta, bridgeWriteEnabled, mode })).toBe('preview');
    }
  });
});

describe('Notices', () => {
  it('the Preview notice says exactly what is true', () => {
    const notice = signingNotice('preview');
    expect(notice.headline).toBe('Preview mode — quotes available, wallet signing disabled.');
    expect(PREVIEW_HEADLINE).toBe(notice.headline);
    expect(notice.body).toMatch(/only through the authorized Production release/);
    expect(notice.body).toMatch(/subject to all existing safety checks/);
    expect(notice.buttonLabel).toBe('Signing disabled in Preview');
  });

  it('does not call a Preview a pause, and keeps the pause wording for a real pause', () => {
    expect(JSON.stringify(signingNotice('preview'))).not.toMatch(/paused/i);
    expect(signingNotice('emergency').headline).toBe('Quotes only · Transfers temporarily paused');
  });

  it('every reason has a button label that is not "Confirm in wallet"', () => {
    for (const block of ['preview', 'emergency', 'beta-off', 'bridge-off'] as const) {
      expect(signingNotice(block).buttonLabel).not.toMatch(/confirm/i);
    }
  });
});

describe('Exchange pages use the shared gate', () => {
  const circle = read('src/components/pages/MainnetCirclePage.tsx');
  const exchange = read('src/components/pages/MainnetExchangePage.tsx');

  it('the signing decision comes from exchangeSigningBlock, with no second copy of the rule', () => {
    expect(circle).toContain('exchangeSigningBlock(');
    expect(circle).toMatch(/export function isCircleSigningReady\(mode:Mode\):boolean\{\s*return circleSigningBlock\(mode\)===null;/);
    expect(circle).not.toContain("__VEYRA_RELEASE_ENV__==='production'&&!MAINNET_EMERGENCY_READ_ONLY");
  });

  it('the Exchange banner shows the reason-specific headline', () => {
    expect(exchange).toContain('signingNotice(');
  });

  it('a disabled signing button never says "Confirm in wallet"', () => {
    expect(circle).toContain('notice?.buttonLabel');
    expect(circle).toMatch(/signingReady\?'Confirm in wallet'/);
  });
});
