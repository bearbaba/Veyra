/**
 * VeyraSettlement contract configuration.
 *
 * Deployed by Arc Studio as part of the Veyra Arc Mainnet release.
 * This is the ONLY file that stores deployment addresses — never hardcode
 * them elsewhere in the application.
 *
 * Arc USDC is the settlement token on both networks.
 * This contract never handles native ETH / Arc native gas directly.
 */

import artifact from '../../contracts/out/VeyraSettlement.sol/VeyraSettlement.json';

/** Arc Testnet chain ID */
export const ARC_TESTNET_CHAIN_ID = 5042002 as const;
/** Arc Mainnet chain ID */
export const ARC_MAINNET_CHAIN_ID = 5042 as const;

/** Arc Testnet USDC (ERC-20, 6 decimals) */
export const ARC_TESTNET_USDC = '0x3600000000000000000000000000000000000000' as const;
/** Arc Mainnet USDC — to be populated after mainnet deploy */
export const ARC_MAINNET_USDC = '0x3600000000000000000000000000000000000000' as const;

export interface VeyraSettlementDeployment {
  address: `0x${string}`;
  deployTxHash: `0x${string}`;
  deployedAt: string;
  explorerUrl: string;
  chainId: number;
  usdcAddress: `0x${string}`;
  feeBps: number;
}

/** All known VeyraSettlement deployments, keyed by environment. */
export const VEYRA_SETTLEMENT_DEPLOYMENTS = {
  testnet: {
    address: '0x39ceae4c1363780dbef8a02487d71914e0c9382a' as const,
    deployTxHash: '0xc7c6baa1056de503f793b5b8e9b31278b754852cee1bfa6984ab840e6ed41316' as const,
    deployedAt: '2026-10-31T09:51:39.322Z',
    explorerUrl: 'https://explorer.testnet.arc.io/address/0x39ceae4c1363780dbef8a02487d71914e0c9382a',
    chainId: ARC_TESTNET_CHAIN_ID,
    usdcAddress: ARC_TESTNET_USDC,
    feeBps: 0,
  } satisfies VeyraSettlementDeployment,
  mainnet: null as VeyraSettlementDeployment | null, // populated after mainnet deploy
} as const;

/** ABI imported directly from the Foundry artifact — never copy-paste ABI manually. */
export const VEYRA_SETTLEMENT_ABI = artifact.abi;

/**
 * Returns the active deployment for the given chain ID, or null if not deployed.
 * This is the single safe lookup — never access VEYRA_SETTLEMENT_DEPLOYMENTS directly
 * in component code.
 */
export function getVeyraSettlementDeployment(chainId: number): VeyraSettlementDeployment | null {
  if (chainId === ARC_TESTNET_CHAIN_ID) return VEYRA_SETTLEMENT_DEPLOYMENTS.testnet;
  if (chainId === ARC_MAINNET_CHAIN_ID) return VEYRA_SETTLEMENT_DEPLOYMENTS.mainnet;
  return null;
}

/**
 * Explorer URL for a specific transaction on the matching Arc network.
 */
export function buildSettlementTxExplorerUrl(chainId: number, txHash: string): string {
  if (chainId === ARC_TESTNET_CHAIN_ID) {
    return `https://explorer.testnet.arc.io/tx/${txHash}`;
  }
  if (chainId === ARC_MAINNET_CHAIN_ID) {
    return `https://explorer.arc.io/tx/${txHash}`;
  }
  return `#tx-${txHash}`;
}
