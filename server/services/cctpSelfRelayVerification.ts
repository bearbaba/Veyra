/**
 * Verify a self-relayed CCTP receiveMessage against the immutable,
 * owner-scoped bridge checkpoint. A browser-supplied tx hash is NEVER proof
 * of broadcast: the BFF fetches this call from the actual destination RPC.
 */
import { decodeFunctionData, parseAbi } from 'viem';
import type { BridgeRecoveryInput } from '../db/repositories/bridgeRecoveryRepository.js';
import { MANIFEST_CONSTANTS } from '../../src/providers/registry/providerManifest.js';

const RECEIVE_ABI = parseAbi([
  'function receiveMessage(bytes message, bytes attestation) returns (bool success)',
]);

export interface SelfRelayTransactionCall {
  from: string;
  to: string | null;
  input: `0x${string}`;
}

export function assertSelfRelayTransactionMatchesCheckpoint(
  checkpoint: BridgeRecoveryInput,
  transaction: SelfRelayTransactionCall,
): void {
  if (
    (checkpoint.stage !== 'ATTESTATION_READY' &&
      checkpoint.stage !== 'DESTINATION_BROADCAST') ||
    !checkpoint.attestationMessage ||
    !checkpoint.attestationSignature ||
    transaction.from.toLowerCase() !== checkpoint.recipientAddress.toLowerCase() ||
    !transaction.to ||
    transaction.to.toLowerCase() !==
      MANIFEST_CONSTANTS.CCTP_V2_MESSAGE_TRANSMITTER.toLowerCase()
  ) {
    throw new Error('Self-relay sender, target or attestation checkpoint is invalid.');
  }

  let decoded;
  try {
    decoded = decodeFunctionData({
      abi: RECEIVE_ABI,
      data: transaction.input,
    });
  } catch {
    throw new Error('Self-relay transaction is not valid CCTP receiveMessage calldata.');
  }

  if (
    decoded.functionName !== 'receiveMessage' ||
    decoded.args[0].toLowerCase() !== checkpoint.attestationMessage.toLowerCase() ||
    decoded.args[1].toLowerCase() !== checkpoint.attestationSignature.toLowerCase()
  ) {
    throw new Error('Self-relay transaction does not match the persisted CCTP message and attestation.');
  }
}

/**
 * Bind a browser-supplied lost-response hash to the same chain and actual RPC
 * transaction identity before checking destination CCTP calldata.
 *
 * A JSON-RPC URL can be accidentally pointed at a different network even
 * when viem's client is configured with the expected chain. Never accept the
 * configured chain alone as independent evidence.
 */
export function assertSelfRelayNetworkEvidence(
  checkpoint: BridgeRecoveryInput,
  requestedHash: string,
  rpcChainId: number,
  transaction: SelfRelayTransactionCall & { hash: string },
): void {
  if (
    checkpoint.destinationChainId !== rpcChainId ||
    !Number.isSafeInteger(rpcChainId) ||
    !/^0x[0-9a-fA-F]{64}$/.test(requestedHash) ||
    !/^0x[0-9a-fA-F]{64}$/.test(transaction.hash) ||
    requestedHash.toLowerCase() !== transaction.hash.toLowerCase()
  ) {
    throw new Error(
      'Self-relay transaction hash or independent destination RPC chain ID mismatch.',
    );
  }
  assertSelfRelayTransactionMatchesCheckpoint(checkpoint, transaction);
}
