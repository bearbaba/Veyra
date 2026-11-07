import { readFileSync } from 'node:fs';
import {
  verifyProductionMainnetRouting,
  type VercelRoutingConfig,
} from '../../../server/services/mainnetReleaseRouting';

export const MAINNET_BFF = 'https://veyra-mainnet-v1-bff.onrender.com';
export type BuildMode = 'mainnet' | 'staging' | 'preview';
const read = (p: string) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');

/** What vercel.json actually deploys: the Mainnet pilot profile, the Testnet BFF staging build, or the static Preview. */
export function productionBuildMode(): BuildMode {
  const cmd = (JSON.parse(read('vercel.json')) as { buildCommand?: string }).buildCommand ?? '';
  if (cmd.includes('scripts/build-mainnet-pilot.ts')) {
    const profile = read('scripts/build-mainnet-pilot.ts');
    if (!profile.includes("VITE_VEYRA_ENV:'mainnet'") || !profile.includes("VITE_VEYRA_MAINNET_PAY:'1'")) {
      throw new Error('build-mainnet-pilot.ts does not define the Mainnet profile');
    }
    return 'mainnet';
  }
  if (cmd.includes('VITE_VEYRA_UNIFIED_STAGING=1')) return 'staging';
  return 'preview';
}
export function mainnetRoutingIssues(): string[] {
  const config = JSON.parse(read('vercel.json')) as VercelRoutingConfig;
  return verifyProductionMainnetRouting(config, MAINNET_BFF).issues;
}
