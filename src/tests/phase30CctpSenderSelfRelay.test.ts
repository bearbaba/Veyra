import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const hook=readFileSync(new URL('../hooks/useBridgeExecution.ts',import.meta.url),'utf8');
const gate=readFileSync(new URL('../../server/services/cctpSelfRelayVerification.ts',import.meta.url),'utf8');

describe('Phase 30 — reviewed sender can relay an existing Circle message',()=>{
  it('permits source owner destination gas, without changing the signed mint recipient',()=>{
    expect(hook).toContain("connected.toLowerCase() !== walletAddress.toLowerCase()");
    expect(hook).toContain("connected.toLowerCase() !== current.walletAddress.toLowerCase()");
    expect(hook).toContain('getAddress(connected),\n          attestation.message');
    expect(hook).toContain('getAddress(connected),\n            current.attestationMessage!');
    expect(gate).toContain('relayer === checkpoint.walletAddress.toLowerCase()');
    expect(gate).toContain('relayer === checkpoint.recipientAddress.toLowerCase()');
  });
  it('does not relax source wallet ownership, replay reservations, exact CCTP message or user signature',()=>{
    expect(hook).toContain('bridgeCheckpointBelongsToWallet(checkpoint, connectedOwner)');
    expect(hook).toContain('await claimSelfRelayDestinationRemote(current.planId)');
    expect(hook).toContain('await claimSelfRelayDestinationRemote(planId)');
    expect(hook).toContain('broadcastReceiveMessage(');
    expect(gate).toContain('decoded.args[0].toLowerCase() !== checkpoint.attestationMessage.toLowerCase()');
    expect(gate).toContain('decoded.args[1].toLowerCase() !== checkpoint.attestationSignature.toLowerCase()');
    expect(gate).toContain('MANIFEST_CONSTANTS.CCTP_V2_MESSAGE_TRANSMITTER.toLowerCase()');
  });
});
