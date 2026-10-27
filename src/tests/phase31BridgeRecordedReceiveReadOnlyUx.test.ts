import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read=(p:string)=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');

describe('Phase 31 — destination broadcast is evidence to verify, not permission to send',()=>{
  it('gives the user the exact destination hash and correct destination explorer link',()=>{
    const ui=read('src/components/pages/ActivityPage.tsx');
    expect(ui).toContain("checkpoint.stage === 'DESTINATION_BROADCAST'");
    expect(ui).toContain('Destination transaction recorded — verification pending');
    expect(ui).toContain('Destination receive: {checkpoint.receiveTxHash}');
    expect(ui).toContain('buildTxExplorerUrl(checkpoint.destinationChainId, checkpoint.receiveTxHash)');
    expect(ui).toContain('View recorded destination transaction');
    expect(ui).toContain('First receive tx: {attemptHistory.first.receiveTxHash}');
    expect(ui).toContain('Not attempted · no action required');
  });

  it('replaces ambiguous Resume safely only for the read-only verification stage',()=>{
    const ui=read('src/components/pages/ActivityPage.tsx');
    expect(ui).toContain("verifyingExistingReceive ? 'Verify recorded receive (no signing)' : 'Resume safely'");
    expect(ui).toContain('Read-only reconciliation of the recorded destination hash.');
    expect(ui).toContain('This check never broadcasts');
    expect(ui).toContain('onClick={onResume}');
  });

  it('never calls wallet broadcasting when reconciling DESTINATION_BROADCAST checkpoint',()=>{
    const hook=read('src/hooks/useBridgeExecution.ts');
    const start=hook.indexOf("if (current.stage === 'DESTINATION_BROADCAST') {");
    const end=hook.indexOf('  const resumeProviderCheckpoint = useCallback',start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const destinationOnly=hook.slice(start,end);
    expect(destinationOnly).toContain('destPublicClient.getTransactionReceipt(');
    expect(destinationOnly).toContain('verifyCctpDestinationReceiptEvidence(');
    expect(destinationOnly).not.toContain('broadcastReceiveMessage(');
    expect(destinationOnly).not.toContain('claimSelfRelayDestinationRemote(');
    expect(destinationOnly).not.toContain('walletClient.writeContract(');
    expect(hook).toContain('bridgeCheckpointBelongsToWallet(checkpoint, connectedOwner)');
  });
});
