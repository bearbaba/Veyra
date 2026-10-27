/**
 * CCTP self-relay PRE-SIGNATURE checkpoint verification.
 *
 * A browser checkpoint (including its attestation) is not authoritative.
 * Before the BFF grants the one-use destination submission claim, it must
 * independently prove that the reviewed Arc burn transaction succeeded and
 * Circle's unique message equals the only canonical source MessageSent.
 */
import {
  createPublicClient,
  decodeFunctionData,
  getAddress,
  http,
  parseAbi,
  type Hash,
  type TransactionReceipt,
} from 'viem';
import { MANIFEST_CONSTANTS } from '../../src/providers/registry/providerManifest.js';
import {
  chainIdToCctpDomain,
  extractUniqueCctpSourceMessage,
  matchesCctpV2AttestedSourceMessage,
  parseUniqueCctpAttestationResponse,
  verifyCctpSourceReceiptEvidence,
} from '../../src/providers/cctp/cctpV2Adapter.js';
import type { BridgeRecoveryInput } from '../db/repositories/bridgeRecoveryRepository.js';
import { BridgeRecoveryConflictError } from '../db/repositories/bridgeRecoveryRepository.js';

const DEPOSIT_ABI = parseAbi([
  'function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)',
]);

const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;
const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

type SourceReceiptEvidence = Pick<TransactionReceipt,
  'status' | 'logs' | 'transactionHash'>;

export interface SourceTransactionEvidence {
  from: string;
  to: string | null;
  input: `0x${string}`;
}

/**
 * Pure chain/Circle proof checker. Rejects multiple source messages and
 * every mismatch between persisted route, source receipt, calldata and Circle.
 */
export function assertCctpSourceCheckpointAttestation(
  checkpoint: BridgeRecoveryInput,
  receipt: SourceReceiptEvidence,
  transaction: SourceTransactionEvidence,
  circleResponse: unknown,
): void {
  if (
    checkpoint.stage !== 'ATTESTATION_READY' ||
    checkpoint.sourceChainId !== MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID ||
    (checkpoint.destinationChainId !== MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID &&
      checkpoint.destinationChainId !== MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID) ||
    checkpoint.tokenAddress.toLowerCase() !== MANIFEST_CONSTANTS.ARC_TESTNET_USDC.toLowerCase() ||
    !TX_HASH_PATTERN.test(checkpoint.burnTxHash) ||
    !checkpoint.attestationMessage ||
    !checkpoint.attestationSignature
  ) {
    throw new BridgeRecoveryConflictError(
      'Self-relay requires an attestation-ready canonical Arc Testnet CCTP route.',
    );
  }

  if (
    receipt.status !== 'success' ||
    receipt.transactionHash.toLowerCase() !== checkpoint.burnTxHash.toLowerCase() ||
    transaction.from.toLowerCase() !== checkpoint.walletAddress.toLowerCase() ||
    transaction.to?.toLowerCase() !==
      MANIFEST_CONSTANTS.CCTP_V2_TOKEN_MESSENGER.toLowerCase()
  ) {
    throw new BridgeRecoveryConflictError(
      'The owned source burn hash, sender, status or TokenMessenger target is unverified.',
    );
  }

  const sourceEvidence = verifyCctpSourceReceiptEvidence(receipt, {
    burnToken: getAddress(checkpoint.tokenAddress),
    amount: BigInt(checkpoint.amount),
    depositor: getAddress(checkpoint.walletAddress),
    mintRecipient: getAddress(checkpoint.recipientAddress),
    destinationChainId: checkpoint.destinationChainId,
  });
  if (!sourceEvidence.verified) {
    throw new BridgeRecoveryConflictError(sourceEvidence.detail);
  }

  let decoded;
  try {
    decoded = decodeFunctionData({
      abi: DEPOSIT_ABI,
      data: transaction.input,
    });
  } catch {
    throw new BridgeRecoveryConflictError(
      'Source transaction did not call the reviewed CCTP depositForBurn method.',
    );
  }

  const [amount, domain, recipient, token, caller, maxFee, finality] = decoded.args;
  const expectedRecipient =
    `0x${'0'.repeat(24)}${getAddress(checkpoint.recipientAddress).slice(2)}`.toLowerCase();

  if (
    decoded.functionName !== 'depositForBurn' ||
    amount !== BigInt(checkpoint.amount) ||
    Number(domain) !== chainIdToCctpDomain(checkpoint.destinationChainId) ||
    recipient.toLowerCase() !== expectedRecipient ||
    token.toLowerCase() !== checkpoint.tokenAddress.toLowerCase() ||
    caller.toLowerCase() !== ZERO_BYTES32 ||
    maxFee !== 0n ||
    Number(finality) !== MANIFEST_CONSTANTS.CCTP_STANDARD_FINALITY
  ) {
    throw new BridgeRecoveryConflictError(
      'Source depositForBurn calldata is not bound to the persisted reviewed route.',
    );
  }

  let circle;
  try {
    circle = parseUniqueCctpAttestationResponse(circleResponse);
  } catch {
    throw new BridgeRecoveryConflictError(
      'Circle returned ambiguous or malformed attestation evidence for the source burn.',
    );
  }

  const sourceMessage = extractUniqueCctpSourceMessage(receipt);
  if (
    circle.status !== 'complete' ||
    !circle.message ||
    !circle.attestation ||
    !sourceMessage ||
    !matchesCctpV2AttestedSourceMessage(sourceMessage, circle.message) ||
    circle.message.toLowerCase() !== checkpoint.attestationMessage.toLowerCase() ||
    circle.attestation.toLowerCase() !== checkpoint.attestationSignature.toLowerCase()
  ) {
    throw new BridgeRecoveryConflictError(
      'Circle CCTP V2 attestation is not bound to the unique reviewed source burn template and finality.',
    );
  }
}

/**
 * Reads fresh evidence BEFORE the first self-relay claim is acquired.
 * A transport/API failure cannot authorize a wallet signature. No signer or
 * private key is needed by this read-only verifier.
 */
export async function verifyCctpSourceCheckpointAttestationFromNetwork(
  checkpoint: BridgeRecoveryInput,
): Promise<void> {
  const rpcUrl = process.env.ARC_TESTNET_RPC_URL ?? 'https://rpc.testnet.arc.io';
  const client = createPublicClient({
    chain: {
      id: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
      name: 'Arc Testnet',
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    },
    transport: http(rpcUrl),
  });

  let receipt: TransactionReceipt;
  let transaction: SourceTransactionEvidence;
  let circleResponse: unknown;
  try {
    const [source, call, apiResponse] = await Promise.all([
      client.getTransactionReceipt({ hash: checkpoint.burnTxHash as Hash }),
      client.getTransaction({ hash: checkpoint.burnTxHash as Hash }),
      fetch(
        `https://iris-api-sandbox.circle.com/v2/messages/${MANIFEST_CONSTANTS.ARC_TESTNET_CCTP_DOMAIN}?transactionHash=${checkpoint.burnTxHash}`,
      ),
    ]);
    if (!apiResponse.ok) {
      throw new Error(`Circle API HTTP ${apiResponse.status}`);
    }
    receipt = source;
    transaction = { from: call.from, to: call.to, input: call.input };
    circleResponse = await apiResponse.json();
  } catch {
    throw new BridgeRecoveryConflictError(
      'Source-chain or Circle attestation verification is temporarily unavailable. Do not sign a destination receive.',
    );
  }

  assertCctpSourceCheckpointAttestation(
    checkpoint, receipt, transaction, circleResponse,
  );
}
