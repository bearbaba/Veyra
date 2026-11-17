import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';

/** Guard the cost-sensitive Git deployment policy without ever invoking Vercel.
 * PR and feature branch pushes still pass GitHub full Vitest/Chromium locally.
 * Vercel Git only deploys develop (production) or an explicitly opt-in preview.
 */
const vercel=JSON.parse(readFileSync(new URL('../../vercel.json',import.meta.url),'utf8')) as {
 git?:{deploymentEnabled?:Record<string,boolean>};
 buildCommand?:string;outputDirectory?:string;
 rewrites?:Array<{source:string;destination:string}>;
};

describe('Hobby deployment-budget and Mainnet release contract',()=>{
 it('stops automatic previews for PR and feature branches',()=>{
  const routes=vercel.git?.deploymentEnabled;
  expect(routes).toBeDefined();
  expect(routes?.['**']).toBe(false);
  expect(routes?.['develop']).toBe(true);
  expect(routes?.['release-preview/**']).toBe(true);
  for(const old of ['main','master','feature/mainnet-identity-authority','fix/**','chore/**']){
   expect(routes?.[old]).toBeUndefined();
  }
 });
 it('keeps the production release build and routing unchanged',()=>{
  expect(vercel.buildCommand).toBe('bun run typecheck && bun scripts/build-mainnet-pilot.ts');
  expect(vercel.outputDirectory).toBe('dist');
  expect(vercel.rewrites?.length).toBeGreaterThan(35);
  expect(vercel.rewrites?.some(r=>r.source==='/api/mainnet/settlement/receipts')).toBe(true);
  expect(vercel.rewrites?.some(r=>r.source==='/api/mainnet/pay/journeys/lock')).toBe(true);
  expect(vercel.rewrites?.some(r=>r.destination.startsWith('https://veyra-mainnet-v1-bff.onrender.com/'))).toBe(true);
 });
 it('preserves Mainnet CI across feature-branch pull requests even when Vercel skips them',()=>{
  const release=readFileSync(new URL('../../.github/workflows/mainnet-activity-release.yml',import.meta.url),'utf8');
  const quality=readFileSync(new URL('../../.github/workflows/compact-mainnet-ux-quality.yml',import.meta.url),'utf8');
  expect(release).toContain('pull_request:');
  expect(release).toContain('- develop');
  expect(quality).toContain('Full Vitest');
  expect(quality).toContain('Real Chromium 320px, 390px and desktop');
 });
});
