import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const page=readFileSync(new URL('../components/pages/BridgePage.tsx',import.meta.url),'utf8');

describe('Phase 27 — failed Bridge review must be recoverable',()=>{
  it('shows the same editable route form on BLOCKED and FAILED states',()=>{
    expect(page).toContain("bridgeState.phase === 'BLOCKED' || bridgeState.phase === 'FAILED'");
    expect(page).toContain("onChange={(e) => { setAmount(e.target.value); setBridgeState({ phase: 'INPUT' }); }}");
    expect(page).toContain("setDestChainId(Number(e.target.value)); setBridgeState({ phase:'INPUT' });");
    expect(page).toContain("setRecipientAddress(e.target.value); setBridgeState({ phase:'INPUT' });");
    expect(page).toContain('Your amount, destination network and wallet address are preserved.');
    expect(page).toContain('Check again');
  });
  it('never tells a user a source burn completed before transaction evidence exists',()=>{
    expect(page).not.toContain('Source burn tx confirmed on Arc Testnet — awaits Circle attestation');
    expect(page).toContain('After your wallet signs a source burn');
    expect(page).toContain('no USDC has moved just by opening this page');
  });
  it('does not bypass the CCTP live RPC simulation or signing gates',()=>{
    expect(page).toContain('simulateCctpSourceBurn(sourcePublicClient, action)');
    expect(page).toContain('simulateCctpSourceBurn(sourcePublicClient, executionAction)');
    expect(page).toContain('evaluateBridgeAction(executionAction, simulation.proof)');
    expect(page).toContain("social.identityOrigin !== 'ready'");
    expect(page).toContain('approveTokenMessenger(');
    expect(page).not.toContain('simulationCompleted: true');
  });
});
