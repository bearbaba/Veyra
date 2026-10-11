/**
 * Authenticate evidence for a previously-broadcast SECOND destination CCTP
 * receive, without signing, claiming, resubmitting or modifying first attempt.
 *
 * The sender may be a relayer, NOT necessarily the recipient: this is safe
 * only when the exact original attested CCTP V2 message explicitly permits
 * any caller (destinationCaller=bytes32(0)).
 */
import { decodeFunctionData, parseAbi } from 'viem';
import type { BridgeRecoveryInput } from '../db/repositories/bridgeRecoveryRepository.js';
import { BridgeRecoveryConflictError } from '../db/repositories/bridgeRecoveryRepository.js';
import { parseReviewedCctpV2Nonce } from './cctpDestinationNonceInspectionService.js';
import { MANIFEST_CONSTANTS } from '../../src/providers/registry/providerManifest.js';

const RECEIVE_ABI = parseAbi([
  'function receiveMessage(bytes message, bytes attestation) returns (bool success)',
]);
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export interface SecondReceiveIndexedTransaction {
  hash: string;
  from: string;
  to: string | null;
  input: `0x${string}`;
}

export function assertSecondReceiveTransactionMatchesCheckpoint(
  checkpoint: BridgeRecoveryInput,
  requestedTxHash: string,
  actualRpcChainId: number,
  indexed: SecondReceiveIndexedTransaction,
): void {
  // Exact canonical MessageV2 header also proves any-caller eligibility.
  // It must be the source-authenticated message supplied by the server, not
  // a browser-supplied nonce or transaction calldata.
  parseReviewedCctpV2Nonce(checkpoint);

  if (
    checkpoint.stage !== 'DESTINATION_BROADCAST' ||
    !HASH_RE.test(checkpoint.receiveTxHash ?? '') ||
    !HASH_RE.test(requestedTxHash) ||
    !HASH_RE.test(indexed.hash) ||
    requestedTxHash.toLowerCase() !== indexed.hash.toLowerCase() ||
    requestedTxHash.toLowerCase() === checkpoint.receiveTxHash?.toLowerCase() ||
    !Number.isSafeInteger(actualRpcChainId) ||
    actualRpcChainId !== checkpoint.destinationChainId ||
    !ADDRESS_RE.test(indexed.from) ||
    !indexed.to ||
    indexed.to.toLowerCase() !== MANIFEST_CONSTANTS.CCTP_V2_MESSAGE_TRANSMITTER.toLowerCase()
  ) {
    throw new BridgeRecoveryConflictError(
      'Second receive must have a distinct indexed hash, correct RPC chain, valid sender and canonical CCTP transmitter.',
    );
  }

  let decoded;
  try {
    decoded = decodeFunctionData({ abi: RECEIVE_ABI, data: indexed.input });
  } catch {
    throw new BridgeRecoveryConflictError(
      'Second receive transaction is not canonical CCTP receiveMessage calldata.',
    );
  }

  if (
    decoded.functionName !== 'receiveMessage' ||
    decoded.args[0].toLowerCase() !== checkpoint.attestationMessage?.toLowerCase() ||
    decoded.args[1].toLowerCase() !== checkpoint.attestationSignature?.toLowerCase()
  ) {
    throw new BridgeRecoveryConflictError(
      'Second receive calldata does not match the original source-attested Circle message and signature.',
    );
  }
}
