# Phase 35 — CCTP reverse-route safety milestone

Scope: **read-only validation** for Ethereum Sepolia / Base Sepolia → Arc Testnet, not a product claim of executable reverse bridging.

## Verified protocol facts

- Ethereum Sepolia: chain 11155111, CCTP domain 0, USDC `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`.
- Base Sepolia: chain 84532, CCTP domain 6, USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.
- Arc Testnet destination: chain 5042002, CCTP domain 26, USDC `0x3600000000000000000000000000000000000000`.
- Testnet TokenMessengerV2: `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA`.
- Testnet MessageTransmitterV2: `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`.
- Reference: `https://github.com/circlefin/cctp-go/blob/main/chains.go` and existing pinned Veyra manifest. Contract deployment and exact CCTP route must still be verified live before approval.

## Implemented

- Optional, collapsed **Explore reverse Bridge · read-only checks** under the supported Arc-outbound Bridge header. No duplicate payment CTA.
- Independent Ethereum / Base source selector, USDC amount and Arc recipient; preserve input and invalidate read result on edits. Connected wallet is read for balances, **not automatically switched**.
- Source RPC `eth_chainId` check; contract bytecode for source USDC, TokenMessengerV2, MessageTransmitterV2; real `balanceOf` + `allowance` reads; exact `depositForBurn` eth_call ONLY after sufficient balance and allowance. Hard 20s timeout; no auto retry.
- Honest results: unavailable / insufficient balance / insufficient allowance / source burn simulation succeeded. **None of these mean that a Bridge quote, user transaction or destination settlement is available.**
- No call to `writeContract`, no Approve, no gas estimate fiction, no wallet signature, no source burn, no BFF bridge receipt.

## Deliberately not enabled

A reverse CCTP source transaction cannot be safely enabled in the existing Veyra execution boundary. `server/services/activityReceiptService.ts`, `server/services/cctpBridgeSourceAttestationService.ts`, `src/core/pipeline/bridgePipeline.ts`, `src/core/execution/cctpSourceSimulation.ts`, `src/providers/cctp/cctpBridgeProvider.ts` and signed-chain wallet recovery are pinned to Arc as source and Sepolia/Base as destination. `destinationCaller`, source ownership, authoritative Circle attestation and Arc destination minted USDC proof must be revised together with transaction rollback/replay tests.

Next guarded milestone: chain-aware server receipt creation and canonical source attestations; one-use relay authorization; Arc destination mint receipt + replay protection; full real E2E test from BOTH source chains with two genuine wallets and evidence. Only then add a reverse executable route to provider capabilities/UI. Keep stable Arc outbound and mainnet unchanged.

## Acceptance boundary

CI/lint/build and mocked RPC tests demonstrate deterministic *code-path correctness*, **not** live chain execution or support of reverse funds movement. Anyone testing the read-only panel must understand it cannot send USDC. Never use it as evidence that a reverse Bridge is completed.
