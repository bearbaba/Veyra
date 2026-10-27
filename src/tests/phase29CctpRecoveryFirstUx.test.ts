import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const bridge=readFileSync(new URL('../components/pages/BridgePage.tsx',import.meta.url),'utf8');
describe('Phase 29: a confirmed source burn must never be offered as a new payment',()=>{
  it('keeps original hash visible and directs failed relay to recovery',()=>{
    expect(bridge).toContain('Source burn: {state.burnTxHash}');
    expect(bridge).toContain('View existing burn recovery');
    expect(bridge).toContain('Your source burn was submitted. Do not bridge again.');
    expect(bridge).toContain('Resume its destination receive below; do not start another burn.');
  });
  it('disables new Review while an owned unresolved checkpoint exists',()=>{
    expect(bridge).toContain("checkpoint.stage !== 'VERIFIED'");
    expect(bridge).toContain("!bridgeIdentityReady || hasUnfinishedBurn || bridgeState.phase === 'EVALUATING'");
    expect(bridge).toContain('Resume your existing burn above');
    expect(bridge).toContain('bridgeExecution.loadRecoveryCandidates()');
    expect(bridge).toContain('<BridgeRecoveryCard');
  });
  it('keeps wallet-signature, simulation and immutable checkpoint protections',()=>{
    expect(bridge).toContain('simulateCctpSourceBurn(sourcePublicClient, action)');
    expect(bridge).toContain('social.identityOrigin !== \'ready\'');
    expect(bridge).toContain('handleResumeBridge(recoveryCandidates[0])');
    expect(bridge).not.toContain('simulationCompleted: true');
  });
});
