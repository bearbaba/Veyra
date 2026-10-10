/**
 * Veyra Provider Manifest
 *
 * Every provider Veyra may use is declared here.
 * Providers must be re-verified against current official documentation
 * before their enabled flag is set to true.
 *
 * VERIFICATION RECORD
 * ───────────────────
 * Arc Testnet USDC ERC-20:   0x3600000000000000000000000000000000000000
 * Arc Testnet chain ID:       5042002
 * Arc Testnet CCTP domain:   26
 *
 * CCTP V2 Testnet contracts (same address on all testnet chains):
 *   TokenMessengerV2:        0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA
 *   TokenMessengerWithFees:  0x8745D906D67C346E5eb1aEEED38Eb87F34DF0C0A
 *   MessageTransmitterV2:    0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275
 *   TokenMinterV2:           0xb43db544E2c27092c107639Ad201b3dEfAbcF192
 *   Source: https://developers.circle.com/cctp/evm-smart-contracts.md
 *   Verified: 2026-10-07
 *
 * StableFX API (USDC/EURC Convert):
 *   Sandbox base URL: https://api-sandbox.circle.com
 *   Quote endpoint:   POST /v1/exchange/stablefx/quotes
 *   Trade endpoint:   POST /v1/exchange/stablefx/trades
 *   Fund endpoint:    POST /v1/exchange/stablefx/fund
 *   Status endpoint:  GET  /v1/exchange/stablefx/trades/{id}
 *   Uses Permit2 EIP-712 signed on Arc Testnet
 *   EURC on Arc Testnet: 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a
 *     (from StableFX quote response example in official docs — see notes)
 *   Source: https://developers.circle.com/stablefx/quickstarts/fx-trade-taker
 *   Verified: 2026-10-07
 *
 * Ethereum Sepolia supported as CCTP destination (domain 0):
 *   USDC on Eth Sepolia: 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
 *   Source: https://developers.circle.com/stablecoins/usdc-contract-addresses.md
 *   Verified: 2026-10-07
 *
 * Base Sepolia supported as CCTP destination (domain 6):
 *   USDC on Base Sepolia: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
 *   Source: https://developers.circle.com/stablecoins/usdc-contract-addresses.md
 *   Verified: 2026-10-07
 */

import type { ProviderManifestEntry } from './providerTypes';
import { MAINNET_PROVIDER_MANIFEST } from './mainnetProviderManifest';

// Arc Testnet
const ARC_TESTNET_USDC = '0x3600000000000000000000000000000000000000';
const ARC_TESTNET_CHAIN_ID = 5042002;

// Ethereum Sepolia
const ETH_SEPOLIA_CHAIN_ID = 11155111;
const ETH_SEPOLIA_USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';

// Base Sepolia
const BASE_SEPOLIA_CHAIN_ID = 84532;
const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

// CCTP V2 testnet contracts (uniform across chains — verified 2026-10-07)
const CCTP_V2_TOKEN_MESSENGER = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA';
const CCTP_V2_TOKEN_MESSENGER_WITH_FEES = '0x8745D906D67C346E5eb1aEEED38Eb87F34DF0C0A';
const CCTP_V2_MESSAGE_TRANSMITTER = '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275';
const CCTP_V2_TOKEN_MINTER = '0xb43db544E2c27092c107639Ad201b3dEfAbcF192';

// EURC on Arc Testnet (from StableFX quote response `base` field in official docs)
const ARC_TESTNET_EURC = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a';

const CCTP_V2_VERIFIED_DATE = '2026-10-07';
const STABLEFX_VERIFIED_DATE = '2026-10-07';

const TESTNET_PROVIDER_MANIFEST: ProviderManifestEntry[] = [
  // ── Arc ERC-20 Payment / Transfer ────────────────────────────────────────
  {
    providerId: 'arc-erc20-transfer',
    displayName: 'Arc ERC-20 Transfer',
    capabilities: ['TRANSFER'],
    supportedChainIds: [ARC_TESTNET_CHAIN_ID],
    supportedAssets: [ARC_TESTNET_USDC],
    environment: 'testnet',
    trustStatus: 'OFFICIAL',
    healthStatus: 'OK',
    riskClassification: 'LOW',
    contractAddresses: [
      { chainId: ARC_TESTNET_CHAIN_ID, name: 'USDC ERC-20', address: ARC_TESTNET_USDC },
    ],
    packageName: 'viem',
    packageVersion: '2.x',
    lifecycleStage: 'ENABLED',
    enabled: true,
    provenance: {
      sourceUrl: 'https://developers.circle.com/stablecoins/usdc-contract-addresses.md',
      verifiedAt: '2026-10-07',
      notes:
        'Arc Testnet USDC ERC-20 at 0x3600...0000 confirmed from Circle official USDC contract ' +
        'address table and Arc Studio onchain-facts registry. viem writeContract ERC-20 transfer. ' +
        'No protocol contract; only the token contract is needed. ' +
        'ENABLED: real testnet TRANSFER execution verified in Phase B.',
    },
  },

  // ── viem Simulation ──────────────────────────────────────────────────────
  {
    providerId: 'viem-simulation',
    displayName: 'viem eth_call Simulation',
    capabilities: ['SIMULATION'],
    supportedChainIds: [ARC_TESTNET_CHAIN_ID, ETH_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID],
    supportedAssets: [],
    environment: 'testnet',
    trustStatus: 'TRUSTED',
    healthStatus: 'OK',
    riskClassification: 'LOW',
    contractAddresses: [],
    packageName: 'viem',
    packageVersion: '2.x',
    lifecycleStage: 'ENABLED',
    enabled: true,
    provenance: {
      sourceUrl: 'https://viem.sh/docs/contract/simulateContract',
      verifiedAt: '2026-10-07',
      notes:
        'viem simulateContract / call for preflight simulation. ' +
        'No external contracts; uses chain RPC directly via viem public client. ' +
        'ENABLED: simulation used in every Phase B transfer preflight.',
    },
  },

  // ── Arc Portfolio Read ───────────────────────────────────────────────────
  {
    providerId: 'arc-portfolio-read',
    displayName: 'Arc Onchain Portfolio Reader',
    capabilities: ['PORTFOLIO_READ'],
    supportedChainIds: [ARC_TESTNET_CHAIN_ID],
    supportedAssets: [ARC_TESTNET_USDC],
    environment: 'testnet',
    trustStatus: 'OFFICIAL',
    healthStatus: 'OK',
    riskClassification: 'LOW',
    contractAddresses: [
      { chainId: ARC_TESTNET_CHAIN_ID, name: 'USDC ERC-20', address: ARC_TESTNET_USDC },
    ],
    packageName: 'viem',
    packageVersion: '2.x',
    lifecycleStage: 'ENABLED',
    enabled: true,
    provenance: {
      sourceUrl: 'https://developers.circle.com/stablecoins/usdc-contract-addresses.md',
      verifiedAt: '2026-10-07',
      notes:
        'Reads ERC-20 balanceOf and native balance via viem public client on Arc Testnet RPC. ' +
        'No protocol contracts required beyond the USDC ERC-20. ' +
        'ENABLED: portfolio read used in Phase B HomePage.',
    },
  },

  // ── Circle StableFX (USDC ↔ EURC Convert) ───────────────────────────────
  // VERIFIED 2026-10-07 against https://developers.circle.com/stablefx/quickstarts/fx-trade-taker
  // LIFECYCLE: IMPLEMENTED — docs verified, adapter written, unit tests pass.
  // NOT ENABLED: real testnet E2E execution (quote → sign → trade → balance delta → receipt)
  // has not yet been completed. Promote to TESTED after first verified testnet execution,
  // then to ENABLED after sign-off.
  {
    providerId: 'circle-stablefx',
    displayName: 'Circle StableFX (USDC ↔ EURC)',
    capabilities: ['CONVERT'],
    supportedChainIds: [ARC_TESTNET_CHAIN_ID],
    supportedAssets: [ARC_TESTNET_USDC, ARC_TESTNET_EURC],
    environment: 'testnet',
    trustStatus: 'OFFICIAL',
    healthStatus: 'UNKNOWN',
    riskClassification: 'MEDIUM',
    contractAddresses: [
      { chainId: ARC_TESTNET_CHAIN_ID, name: 'USDC (Arc Testnet)', address: ARC_TESTNET_USDC },
      { chainId: ARC_TESTNET_CHAIN_ID, name: 'EURC (Arc Testnet)', address: ARC_TESTNET_EURC },
    ],
    packageName: 'native-http',
    packageVersion: 'circle-api-sandbox',
    lifecycleStage: 'IMPLEMENTED',
    enabled: false,
    provenance: {
      sourceUrl: 'https://developers.circle.com/stablefx/quickstarts/fx-trade-taker',
      verifiedAt: STABLEFX_VERIFIED_DATE,
      notes:
        'Circle StableFX API. Sandbox base URL: https://api-sandbox.circle.com. ' +
        'Quote: POST /v1/exchange/stablefx/quotes. Trade: POST /v1/exchange/stablefx/trades. ' +
        'Fund: POST /v1/exchange/stablefx/fund. Status: GET /v1/exchange/stablefx/trades/{id}. ' +
        'Uses Permit2 EIP-712 on Arc Testnet. Requires Circle API key (server-side only). ' +
        'EURC address 0x89B5...D72a from StableFX quote response example in official docs. ' +
        'NOTE: EURC address from official docs example — re-verify on chain before mainnet. ' +
        'No Circle Mint account required for StableFX taker flow. ' +
        'LIFECYCLE GATE: Adapter implemented. Awaiting real testnet E2E execution to promote to TESTED.',
    },
  },

  // ── CCTP V2 Bridge (Arc Testnet → Ethereum Sepolia / Base Sepolia) ───────
  // VERIFIED 2026-10-07 against https://developers.circle.com/cctp/evm-smart-contracts.md
  // LIFECYCLE: ENABLED — real testnet E2E completed 2026-10-08.
  // E2E evidence:
  //   Approve tx:   0x9953207f3730964c6b0e5e12b6de7eb363e426797e22a7bb11933f0fba9fa06e (Arc Testnet)
  //   Burn tx:      0xec4930ae7c9ac9e85c13c088d187a8a0403b2a4f17369cfdcfec1dd4702c3b92 (Arc Testnet block 0x3f0d2cb)
  //   Attestation:  status=complete, nonce=0xcc34815a...
  //   Receive tx:   0x586024ec593593a98c998ec00ea1c4ccf2ed685b81cd55f34107ff89e74542de (ETH Sepolia)
  //   Balance delta: +1.000000 USDC (118.270433 → 119.270433 on Sepolia)
  //   Wallet:       0x4C7cb73aC8F8999af21cfc9fF4cF2333a9508Dcb
  {
    providerId: 'cctp-v2-bridge',
    displayName: 'Circle CCTP V2 Bridge',
    capabilities: ['BRIDGE'],
    supportedChainIds: [ARC_TESTNET_CHAIN_ID, ETH_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID],
    supportedAssets: [ARC_TESTNET_USDC, ETH_SEPOLIA_USDC, BASE_SEPOLIA_USDC],
    environment: 'testnet',
    trustStatus: 'OFFICIAL',
    healthStatus: 'OK',
    riskClassification: 'MEDIUM',
    contractAddresses: [
      // Source chain (Arc Testnet, domain 26)
      { chainId: ARC_TESTNET_CHAIN_ID, name: 'TokenMessengerV2', address: CCTP_V2_TOKEN_MESSENGER },
      { chainId: ARC_TESTNET_CHAIN_ID, name: 'TokenMessengerWithFees', address: CCTP_V2_TOKEN_MESSENGER_WITH_FEES },
      { chainId: ARC_TESTNET_CHAIN_ID, name: 'MessageTransmitterV2', address: CCTP_V2_MESSAGE_TRANSMITTER },
      { chainId: ARC_TESTNET_CHAIN_ID, name: 'TokenMinterV2', address: CCTP_V2_TOKEN_MINTER },
      { chainId: ARC_TESTNET_CHAIN_ID, name: 'USDC (Arc Testnet)', address: ARC_TESTNET_USDC },
      // Destination chain: Ethereum Sepolia (domain 0) — same contract addresses as testnet
      { chainId: ETH_SEPOLIA_CHAIN_ID, name: 'TokenMessengerV2', address: CCTP_V2_TOKEN_MESSENGER },
      { chainId: ETH_SEPOLIA_CHAIN_ID, name: 'MessageTransmitterV2', address: CCTP_V2_MESSAGE_TRANSMITTER },
      { chainId: ETH_SEPOLIA_CHAIN_ID, name: 'USDC (Ethereum Sepolia)', address: ETH_SEPOLIA_USDC },
      // Destination chain: Base Sepolia (domain 6)
      { chainId: BASE_SEPOLIA_CHAIN_ID, name: 'TokenMessengerV2', address: CCTP_V2_TOKEN_MESSENGER },
      { chainId: BASE_SEPOLIA_CHAIN_ID, name: 'MessageTransmitterV2', address: CCTP_V2_MESSAGE_TRANSMITTER },
      { chainId: BASE_SEPOLIA_CHAIN_ID, name: 'USDC (Base Sepolia)', address: BASE_SEPOLIA_USDC },
    ],
    packageName: 'viem + native-http',
    packageVersion: 'cctp-v2-api',
    lifecycleStage: 'ENABLED',
    enabled: true,
    provenance: {
      sourceUrl: 'https://developers.circle.com/cctp/evm-smart-contracts.md',
      verifiedAt: CCTP_V2_VERIFIED_DATE,
      notes:
        'CCTP V2 (not V1) testnet contracts. All testnet chains share the same contract addresses. ' +
        `TokenMessengerV2: ${CCTP_V2_TOKEN_MESSENGER}. ` +
        `MessageTransmitterV2: ${CCTP_V2_MESSAGE_TRANSMITTER}. ` +
        `TokenMinterV2: ${CCTP_V2_TOKEN_MINTER}. ` +
        'Arc Testnet domain: 26. Eth Sepolia domain: 0. Base Sepolia domain: 6. ' +
        'Attestation API: GET /v2/messages/{sourceDomain}?transactionHash={hash} on iris-api-sandbox.circle.com. ' +
        'depositForBurn() requires destinationCaller, maxFee, minFinalityThreshold parameters. ' +
        'Standard transfer: minFinalityThreshold=2000. Fast transfer: minFinalityThreshold=1000. ' +
        'destinationCaller=0x00...00 means any caller can relay receiveMessage (BFF relay supported). ' +
        'LIFECYCLE PROMOTED TO ENABLED 2026-10-08: Real testnet E2E verified. ' +
        'Burn: 0xec4930ae... Arc Testnet. Receive: 0x586024ec... ETH Sepolia. Delta: +1 USDC.',
    },
  },

  // ── Circle App Kit — Unified Balance ──────────────────────────────────────
  {
    providerId: 'circle-appkit-unified-balance',
    displayName: 'Circle App Kit Unified Balance',
    capabilities: ['UNIFIED_BALANCE'],
    supportedChainIds: [ARC_TESTNET_CHAIN_ID, ETH_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID],
    supportedNetworkIds: [
      'arc-testnet',
      'ethereum-sepolia',
      'base-sepolia',
    ],
    supportedAssets: [ARC_TESTNET_USDC, ETH_SEPOLIA_USDC, BASE_SEPOLIA_USDC],
    environment: 'testnet',
    trustStatus: 'OFFICIAL',
    healthStatus: 'UNKNOWN',
    riskClassification: 'MEDIUM',
    contractAddresses: [],
    packageName: '@circle-fin/app-kit',
    packageVersion: '1.15.2',
    lifecycleStage: 'IMPLEMENTED',
    enabled: false,
    provenance: {
      sourceUrl: 'https://github.com/circlefin/docs-examples/tree/master/app-kit-unified-balance',
      verifiedAt: '2026-10-10',
      notes:
        'Official Circle App Kit example verified for unifiedBalance.deposit(), spend(), and getBalances(). ' +
        'Forwarding Service can complete the destination mint without a destination wallet switch. ' +
        'Browser adapters currently use @circle-fin/adapter-viem-v2 for Arc/Ethereum/Base testnets only. ' +
        'Circle supports additional networks including Solana, but Veyra keeps them non-executable until their matching adapter path is implemented and tested. ' +
        'LIFECYCLE GATE: IMPLEMENTED in Phase 4B but disabled until Veyra completes real testnet E2E and receipt verification.',
    },
  },

  // ── Circle App Kit — Bridge orchestration ─────────────────────────────────
  {
    providerId: 'circle-appkit-bridge',
    displayName: 'Circle App Kit Bridge',
    capabilities: ['BRIDGE'],
    supportedChainIds: [ARC_TESTNET_CHAIN_ID, ETH_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID],
    supportedNetworkIds: ['arc-testnet', 'ethereum-sepolia', 'base-sepolia'],
    supportedAssets: [ARC_TESTNET_USDC, ETH_SEPOLIA_USDC, BASE_SEPOLIA_USDC],
    environment: 'testnet',
    trustStatus: 'OFFICIAL',
    healthStatus: 'UNKNOWN',
    riskClassification: 'MEDIUM',
    contractAddresses: [],
    packageName: '@circle-fin/app-kit',
    packageVersion: '1.15.2',
    lifecycleStage: 'IMPLEMENTED',
    enabled: false,
    provenance: {
      sourceUrl: 'https://github.com/circlefin/docs-examples/tree/master/app-kit-bridge-evm',
      verifiedAt: '2026-10-10',
      notes:
        'Official Circle App Kit bridge() and retryBridge() flow verified. ' +
        'Veyra defaults browser-wallet bridge reviews to Forwarding Service where supported to avoid destination-chain switching. ' +
        'Current Veyra source-adapter scope is Arc/Ethereum/Base testnets; Solana remains recognized but non-executable until a Solana adapter path is implemented and tested. ' +
        'LIFECYCLE GATE: the existing cctp-v2-bridge remains the ENABLED testnet route until this adapter completes its own E2E.',
    },
  },

  // ── Circle App Kit — Swap ─────────────────────────────────────────────────
  {
    providerId: 'circle-appkit-swap',
    displayName: 'Circle App Kit Swap',
    capabilities: ['SWAP'],
    supportedChainIds: [ARC_TESTNET_CHAIN_ID],
    supportedNetworkIds: ['arc-testnet'],
    supportedAssets: [ARC_TESTNET_USDC, ARC_TESTNET_EURC],
    environment: 'testnet',
    trustStatus: 'OFFICIAL',
    healthStatus: 'UNKNOWN',
    riskClassification: 'MEDIUM',
    contractAddresses: [],
    packageName: '@circle-fin/app-kit',
    packageVersion: '1.15.2',
    lifecycleStage: 'IMPLEMENTED',
    enabled: false,
    provenance: {
      sourceUrl: 'https://github.com/circlefin/docs-examples/tree/master/app-kit-swap',
      verifiedAt: '2026-10-10',
      notes:
        'Official Circle App Kit swap() example verified for Arc Testnet. ' +
        'Veyra implements estimate-before-execute and never exposes a browser kit key. ' +
        'LIFECYCLE GATE: disabled until real testnet E2E validates quote, execution, amount delta, and receipt.',
    },
  },

  // ── Circle App Kit — Earn ─────────────────────────────────────────────────
  {
    providerId: 'circle-appkit-earn',
    displayName: 'Circle App Kit Earn',
    capabilities: ['EARN_DISCOVER', 'EARN_DEPOSIT', 'EARN_WITHDRAW', 'EARN_POSITION'],
    supportedChainIds: [ARC_TESTNET_CHAIN_ID],
    supportedNetworkIds: ['arc-testnet'],
    supportedAssets: [ARC_TESTNET_USDC],
    environment: 'testnet',
    trustStatus: 'OFFICIAL',
    healthStatus: 'UNKNOWN',
    riskClassification: 'MEDIUM',
    contractAddresses: [],
    packageName: '@circle-fin/app-kit',
    packageVersion: '1.15.2',
    lifecycleStage: 'IMPLEMENTED',
    enabled: false,
    provenance: {
      sourceUrl: 'https://github.com/circlefin/docs-examples/tree/master/app-kit-earn',
      verifiedAt: '2026-10-10',
      notes:
        'Official Circle App Kit Earn example verified for exploreVaults(), deposit quote, deposit, position, withdrawal quote, and withdraw on Arc Testnet. ' +
        'Veyra must surface vault provenance, APY timestamp/source, fees, liquidity, withdrawal terms, and risk before enabling deposit. ' +
        'LIFECYCLE GATE: disabled until real testnet E2E and explainability requirements are satisfied.',
    },
  },
];

export const PROVIDER_MANIFEST: ProviderManifestEntry[] = [
  ...TESTNET_PROVIDER_MANIFEST,
  ...MAINNET_PROVIDER_MANIFEST,
];

export function findManifestEntry(providerId: string): ProviderManifestEntry | undefined {
  return PROVIDER_MANIFEST.find((e) => e.providerId === providerId);
}

/** Exported constants for use by adapters — imported from the manifest, never typed from memory. */
export const MANIFEST_CONSTANTS = {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_USDC,
  ARC_TESTNET_EURC,
  ETH_SEPOLIA_CHAIN_ID,
  ETH_SEPOLIA_USDC,
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_USDC,
  CCTP_V2_TOKEN_MESSENGER,
  CCTP_V2_TOKEN_MESSENGER_WITH_FEES,
  CCTP_V2_MESSAGE_TRANSMITTER,
  CCTP_V2_TOKEN_MINTER,
  /** CCTP domain for Arc Testnet */
  ARC_TESTNET_CCTP_DOMAIN: 26,
  /** CCTP domain for Ethereum Sepolia */
  ETH_SEPOLIA_CCTP_DOMAIN: 0,
  /** CCTP domain for Base Sepolia */
  BASE_SEPOLIA_CCTP_DOMAIN: 6,
  /** minFinalityThreshold for standard transfer */
  CCTP_STANDARD_FINALITY: 2000,
  /** minFinalityThreshold for fast transfer */
  CCTP_FAST_FINALITY: 1000,
  STABLEFX_SANDBOX_BASE_URL: 'https://api-sandbox.circle.com',
} as const;
