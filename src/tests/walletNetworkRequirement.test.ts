import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { networkName, networkRequirement } from '../mainnet/walletNetworkRequirement';

const circle = readFileSync(new URL('../components/pages/MainnetCirclePage.tsx', import.meta.url), 'utf8');

describe('wallet network requirement (display only)', () => {
  it('names the networks and does not guess unknown ones', () => {
    expect(networkName(5042)).toBe('Arc Mainnet');
    expect(networkName(8453)).toBe('Base Mainnet');
    expect(networkName(1)).toBe('Ethereum Mainnet');
    expect(networkName(137)).toBe('network 137');
  });

  it('says exactly what to do when the wallet is on the wrong network', () => {
    expect(networkRequirement(5042, 8453)).toBe(
      'Your wallet is on Arc Mainnet. Switch it to Base Mainnet in your wallet to request this quote. Veyra does not change your network in Preview.');
    expect(networkRequirement(8453, 5042)).toMatch(/Switch it to Arc Mainnet/);
  });

  it('says nothing when the network already matches or is not known yet', () => {
    expect(networkRequirement(8453, 8453)).toBeNull();
    expect(networkRequirement(undefined, 8453)).toBeNull();
  });
});

describe('Production signing flow is unchanged', () => {
  it('the wallet helper still switches by default and still re-checks address and network afterwards', () => {
    expect(circle).toContain('async function wallet(id:number,allowSwitch=true):Promise<EIP1193Provider>');
    expect(circle).toContain('if(allowSwitch)await switchChainAsync({chainId:id});');
    expect(circle).toContain("throw Error('Wallet address or network changed. Review again.');");
  });

  it('the signing step still calls it with the default (switch allowed)', () => {
    expect(circle).toMatch(/\n\s+await wallet\(selectedSource\);\n/);
  });

  it('only the quote/params path may skip the switch, and only when signing is unavailable', () => {
    expect(circle).toContain('const p=await wallet(selectedSource,signingReady);');
    expect((circle.match(/wallet\(selectedSource,/g) ?? []).length).toBe(1);
    expect(circle).toContain('const signingReady=signingBlock===null;');
  });

  it('the requirement message clears itself once the wallet is on the right network, and only that message', () => {
    expect(circle).toContain("setError(prev=>prev.startsWith('Your wallet is on ')?'':prev)");
    expect(circle).toMatch(/if\(networkRequirement\(walletChainId,selectedSource\)===null\)setError\(/);
  });

  it('the informative error replaces the switch prompt only when the switch was skipped', () => {
    expect(circle).toContain('networkRequirement(');
    expect(circle).toMatch(/if\(!allowSwitch\)\{[\s\S]{0,480}networkRequirement\(/);
  });
});
