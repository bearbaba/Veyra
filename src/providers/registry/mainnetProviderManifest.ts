import { CCTP_V2_MAINNET, MAINNET_CATALOG_PROVENANCE, MAINNET_CHAIN_CATALOG } from '../../config/mainnetCatalog';
import type { ProviderManifestEntry } from './providerTypes';

const supportedChainIds = MAINNET_CHAIN_CATALOG.map((c) => c.chainId);
const supportedAssets = MAINNET_CHAIN_CATALOG.map((c) => c.usdc.toLowerCase());

/**
 * Mainnet candidates are deliberately VERIFIED + disabled, never ENABLED.
 * Promotion requires production adapter verification, a real low-value E2E,
 * fresh runtime health, and explicit sign-off.
 */
export const MAINNET_PROVIDER_MANIFEST: ProviderManifestEntry[] = [
  {
    providerId: 'mainnet-usdc-transfer',
    displayName: 'USDC ERC-20 Transfer (Mainnet)',
    capabilities: ['TRANSFER', 'PORTFOLIO_READ', 'SIMULATION'],
    supportedChainIds,
    supportedAssets,
    environment: 'mainnet',
    trustStatus: 'OFFICIAL',
    healthStatus: 'UNKNOWN',
    riskClassification: 'MEDIUM',
    contractAddresses: MAINNET_CHAIN_CATALOG.map((chain) => ({
      chainId: chain.chainId,
      name: `USDC (${chain.name})`,
      address: chain.usdc,
    })),
    packageName: 'viem',
    packageVersion: '2.x',
    lifecycleStage: 'VERIFIED',
    enabled: false,
    provenance: {
      sourceUrl: MAINNET_CATALOG_PROVENANCE.usdcSourceUrl,
      verifiedAt: MAINNET_CATALOG_PROVENANCE.verifiedAt,
      notes:
        'Circle-issued USDC addresses verified from Circle official docs. ' +
        'Candidate remains disabled until production RPC health, adapter preflight, low-value E2E, and sign-off are complete.',
    },
  },
  {
    providerId: 'cctp-v2-mainnet',
    displayName: 'Circle CCTP V2 (Mainnet)',
    capabilities: ['BRIDGE'],
    supportedChainIds,
    supportedAssets,
    environment: 'mainnet',
    trustStatus: 'OFFICIAL',
    healthStatus: 'UNKNOWN',
    riskClassification: 'MEDIUM',
    contractAddresses: MAINNET_CHAIN_CATALOG.flatMap((chain) => [
      { chainId: chain.chainId, name: 'TokenMessengerV2', address: CCTP_V2_MAINNET.tokenMessengerV2 },
      { chainId: chain.chainId, name: 'MessageTransmitterV2', address: CCTP_V2_MAINNET.messageTransmitterV2 },
      { chainId: chain.chainId, name: 'TokenMinterV2', address: CCTP_V2_MAINNET.tokenMinterV2 },
      { chainId: chain.chainId, name: `USDC (${chain.name})`, address: chain.usdc },
    ]),
    packageName: 'native-http',
    packageVersion: 'cctp-v2',
    lifecycleStage: 'VERIFIED',
    enabled: false,
    provenance: {
      sourceUrl: CCTP_V2_MAINNET.sourceUrl,
      verifiedAt: CCTP_V2_MAINNET.verifiedAt,
      notes:
        'CCTP V2 mainnet contracts/domains verified from Circle official docs. ' +
        'Not executable until production RPCs, attestation path, low-value E2E, receipt reconciliation, and explicit sign-off are complete.',
    },
  },
];
