/**
 * The configured viem Chain is only a local expectation. An external RPC URL
 * must independently return its real eth_chainId before Veyra accepts
 * destination receipt, canonical block or CCTP nonce evidence.
 */
import { MANIFEST_CONSTANTS } from '../../src/providers/registry/providerManifest.js';
import { BridgeRecoveryConflictError } from '../db/repositories/bridgeRecoveryRepository.js';

export function assertCctpDestinationRpcIdentity(
  expectedDestinationChainId: number,
  actualRpcChainId: number,
): void {
  if (
    (expectedDestinationChainId !== MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID &&
      expectedDestinationChainId !== MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID) ||
    !Number.isSafeInteger(actualRpcChainId) ||
    actualRpcChainId !== expectedDestinationChainId
  ) {
    throw new BridgeRecoveryConflictError(
      'CCTP destination RPC identity does not match the independently reviewed Sepolia chain.',
    );
  }
}
