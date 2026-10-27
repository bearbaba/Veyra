/**
 * Read-only Agent -> Bridge handoff policy for the already-reviewed CCTP V2
 * Arc Testnet -> Ethereum Sepolia / Base Sepolia routes.
 *
 * These are *potential* routes, not permission to burn or a quote. The Bridge
 * page performs its own fresh route selection, CCTP preflight and wallet review.
 */
import { parseUnits, isAddress } from 'viem';
import type { IntentCandidate } from '../intent/intentSchema';
import { findManifestEntry, MANIFEST_CONSTANTS } from '../../providers/registry/providerManifest';
import { VEYRA_ENV } from '../../lib/env';

export type AgentBridgeDraftResult =
  | { ok: true; amount: string; destinationChainId: number; recipientAddress: `0x${string}` }
  | { ok: false; reason: string };

const ARC_SOURCE = /^(?:arc(?:[ -]testnet)?|5042002)$/i;

export function validateAgentBridgeDraft(candidate: IntentCandidate): AgentBridgeDraftResult {
  if (candidate.actionType !== 'BRIDGE')
    return { ok: false, reason: 'This is not a bridge draft.' };
  if (VEYRA_ENV === 'mainnet')
    return { ok: false, reason: 'Testnet bridges are disabled in Mainnet mode.' };
  if (candidate.tokenRaw?.raw.trim().toUpperCase() !== 'USDC')
    return { ok: false, reason: 'Only USDC is currently supported by this CCTP route.' };

  const source = candidate.sourceChainRaw?.raw.trim() ?? '';
  if (!ARC_SOURCE.test(source))
    return { ok: false, reason: 'Only Arc Testnet is currently enabled as a CCTP source. Your requested source will not be changed.' };

  const destination = candidate.destinationChainRaw?.raw.trim() ?? '';
  if (/^sepolia$/i.test(destination))
    return { ok: false, reason: 'Choose Ethereum Sepolia or Base Sepolia before reviewing.' };

  const chainId = /^(?:ethereum[ -]sepolia|eth[ -]sepolia|11155111)$/i.test(destination)
    ? MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID
    : /^(?:base[ -]sepolia|84532)$/i.test(destination)
      ? MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID : null;
  if (!chainId)
    return { ok: false, reason: 'No enabled CCTP V2 route to this network. Veyra will not substitute Arc or another destination.' };

  const enabled = findManifestEntry('cctp-v2-bridge');
  if (enabled?.enabled !== true || enabled.lifecycleStage !== 'ENABLED'
    || !enabled.supportedChainIds.includes(MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID)
    || !enabled.supportedChainIds.includes(chainId))
    return { ok: false, reason: 'CCTP V2 is not enabled for the requested network pair.' };

  const amountRaw = candidate.amountRaw?.raw.trim() ?? '';
  const amountMatch = amountRaw.match(/^(\d{1,18}(?:\.\d{1,6})?)(?:\s+USDC)?$/i);
  if (!amountMatch)
    return { ok: false, reason: 'Enter a positive USDC amount with at most six decimals.' };
  const amount = amountMatch[1];
  try {
    if (parseUnits(amount, 6) <= 0n)
      return { ok: false, reason: 'USDC amount must be greater than zero.' };
  } catch {
    return { ok: false, reason: 'USDC amount could not be verified.' };
  }

  const recipient = candidate.recipientRaw?.raw.trim() ?? '';
  if (!isAddress(recipient))
    return { ok: false, reason: 'Enter the exact destination wallet address. Veyra ID cross-chain wallet resolution is not yet enabled.' };
  return { ok: true, amount, destinationChainId: chainId, recipientAddress: recipient };
}
