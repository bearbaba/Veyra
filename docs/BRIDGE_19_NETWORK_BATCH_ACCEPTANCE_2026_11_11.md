# Veyra Bridge — one-release network acceptance matrix (2026-11-11)

This is the authoritative **release checklist**, not an assertion of 19 live routes. Native USDC references, CCTP contracts, a provider's marketing-supported chains, a successful quote, and a **proven Veyra Mainnet bridge** are different conditions.

## Official sources independently checked
- Circle native USDC contracts: https://developers.circle.com/stablecoins/usdc-contract-addresses
- Circle CCTP V2 chains/domains and Forwarding Service: https://developers.circle.com/cctp/concepts/supported-chains-and-domains
- Circle CCTP V2 deployed EVM contracts: https://developers.circle.com/cctp/references/contract-addresses
- Circle USDC Bridge UI: https://bridge.usdc.com/

**Material discrepancy:** The Circle CCTP documentation currently labels domain 26 as **Arc testnet** and specifically says Arc is testnet-only; the current Circle SDK package advertises Arc mainnet. Veyra has some independent production transaction evidence for Arc/Base, but that does not establish universal Arc Mainnet ↔ all-network Circle provider support. Never turn on new Arc routes based only on domain 26.

## Reference register (19 existing Veyra directory entries)

The exact token addresses are in `src/mainnet/circleBridgeBatchVerification.ts` and are regression-checked against Veyra's reviewed Mainnet catalog.

| Network | Circle CCTP domain | Reference support | Veyra reviewed quote graph | Missing before Mainnet signing acceptance |
|---|---:|---|---|---|
| Arc | 26 | Public docs **testnet only**, SDK Mainnet discrepancy | Existing integration | Confirm each new provider route on Arc Mainnet |
| Base | 6 | CCTP V2 Mainnet | Existing integration | Destination-specific end-to-end evidence |
| Arbitrum One | 3 | CCTP V2 Mainnet | Not integrated | Wallet/quote/receipt, two-way signed acceptance |
| OP Mainnet | 2 | CCTP V2 Mainnet | Not integrated | Wallet/quote/receipt, two-way signed acceptance |
| Polygon PoS | 7 | CCTP V2 Mainnet | Not integrated | Wallet/quote/receipt, two-way signed acceptance |
| Ethereum | 0 | CCTP V2 Mainnet | Existing quote candidate | Route-specific signed acceptance |
| Avalanche C-Chain | 1 | CCTP V2 Mainnet | Not integrated | Wallet/quote/receipt, two-way signed acceptance |
| Unichain | 10 | CCTP V2 Mainnet | Not integrated | Wallet/quote/receipt, two-way signed acceptance |
| Linea | 11 | CCTP V2 Mainnet | Not integrated | Wallet/quote/receipt, two-way signed acceptance |
| Sonic | 13 | CCTP V2 Mainnet | Not integrated | Wallet/quote/receipt, two-way signed acceptance |
| Monad | 15 | CCTP V2 Mainnet | Not integrated | Wallet/quote/receipt, two-way signed acceptance |
| Sei | 16 | CCTP V2 Mainnet | Not integrated | Wallet/quote/receipt, two-way signed acceptance |
| Ink | 21 | CCTP V2 Mainnet | Not integrated | Wallet/quote/receipt, two-way signed acceptance |
| World Chain | 14 | CCTP V2 Mainnet | Not integrated | Wallet/quote/receipt, two-way signed acceptance |
| HyperEVM | 19 | CCTP V2 Mainnet | Not integrated | Wallet/quote/receipt, two-way signed acceptance |
| Plume | 22 | CCTP V2 Mainnet | Not integrated | Wallet/quote/receipt, two-way signed acceptance |
| Codex | 12 | CCTP V2 Mainnet | Not integrated | Resolve chain ID/RPC/wallet/quote/receipt first |
| XDC | 18 | CCTP V2 Mainnet | Not integrated | Wallet/quote/receipt, two-way signed acceptance |
| Solana | 5 | CCTP V2 Mainnet | Not integrated | SVM wallet, address/program/SDK adapter, receipt |

## Single-batch activation contract

Do **not** activate every reference entry by adding it to `CIRCLE_CCTP_MAINNET` or setting a global feature flag. Before enabling a route for a user:

1. Confirm that this exact origin/destination pair is returned by the selected pinned Circle SDK at runtime, not merely listed by Circle CCTP.
2. Validate Mainnet chain ID, RPC, source/destination native USDC contract or SVM mint, Circle CCTP domain, TokenMessenger/MessageTransmitter program, connected-wallet chain switching and funding requirements.
3. Obtain a **fresh executable** provider quote with fees, minimum amount received, expiry, forwarding support and maximum source burn fee.
4. Test rejection/failure paths: insufficient balance/gas, wrong chain, fee increase, expired quote, missing burn hash, RPC unavailable, forwarder delay, wallet switch, duplicate click, reconnect, and refund.
5. Use a small **approved, real** transaction in both directions for every intended production pair and verify source burn, signed Circle message, linked destination mint and exact recipient/amount. CI browser tests without wallet signing do **not** replace this.
6. Confirm route-specific rollback and ability to pause a single compromised network without affecting previously accepted routes.
7. Only then merge one release PR enabling the accepted routes together; keep the unaccepted ones **visible but not selectable**. Never claim a route LIVE based solely on a directory or testnet.

Current Veyra network selectors deliberately do not permit new signatures for the 16 unintegrated directory entries. All 19 entries have reference metadata; this is not a claim of 19 completed real-money E2E verifications.

### Validation command
`bunx vitest run src/tests/mainnetCircle19NetworkDirectory.test.ts src/tests/mainnetCircleBridgeBatchVerification.test.ts`

These tests are also part of the Mainnet Activity release workflow and block release on reference drift or accidental mass enablement.
