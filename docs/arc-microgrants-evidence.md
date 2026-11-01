# Veyra — Arc Microgrants Evidence Package

**Submission date:** 2026-11-01
**Project:** Veyra — The Intelligent Money Layer on Arc
**Tagline:** Tell your money what to do.
**Builder:** github.com/bearbaba
**Arc Studio project URL:** https://ibb9vwyygkkct5eupl9ay.preview.studio.arc.io
**Production app:** https://veyra-seven-beta.vercel.app/
**Testnet app:** https://veyra-unified-testnet-v2.vercel.app/
**GitHub branch:** https://github.com/bearbaba/Veyra/tree/arc-studio/mainnet

---

> **IMPORTANT — Accuracy statement**
>
> This document does not claim security audit completion without an independent audit.
> It does not declare Mainnet READY before verified contract deployment and successful
> real-USDC canary payment evidence. Items marked NOT YET are honest gaps.

---

## 1. Summary

Veyra is a production-grade Arc-native application that integrates Circle's USDC payment
infrastructure, onchain settlement, CCTP V2 cross-chain bridging, and agent-driven payment
automation. It is deployed on Arc Testnet and structurally ready for Arc Mainnet.

The application is built entirely with Arc Studio (Circle) and demonstrates end-to-end
capability across the Arc product surface:

- **Arc-native USDC wallet identity** — wallet login, HMAC session tokens, Arc chain support
- **USDC settlement contract** — VeyraSettlement deployed on Arc Testnet with full UI
- **CCTP V2 cross-chain bridging** — verified E2E Arc Testnet → Ethereum Sepolia
- **Agent payment automation** — provider-based execution engine with safety rails
- **Dual-network architecture** — testnet and mainnet paths cleanly separated

---

## 2. On-chain evidence

### VeyraSettlement — Arc Testnet (verified)

| Field | Value |
|-------|-------|
| Contract address | `0x39ceae4c1363780dbef8a02487d71914e0c9382a` |
| Explorer | https://explorer.testnet.arc.io/address/0x39ceae4c1363780dbef8a02487d71914e0c9382a |
| Deploy tx | `0xc7c6baa1056de503f793b5b8e9b31278b754852cee1bfa6984ab840e6ed41316` |
| Chain ID | 5042002 (Arc Testnet) |
| Deployed at | 2026-10-31T09:51:39.322Z |
| Owner | `0x5B12Ce46C7194aD57d143bC22847224047b1Ef42` (Arc Studio deployer) |
| USDC | `0x3600000000000000000000000000000000000000` |
| feeBps | 0 (verified live via read_contract) |

Live-verified fields (read_contract confirmed at time of writing):
- `feeBps()` → `0`
- `usdc()` → `0x3600000000000000000000000000000000000000`
- `owner()` → `0x5B12Ce46C7194aD57d143bC22847224047b1Ef42`

### CCTP V2 — Arc Testnet → Ethereum Sepolia (verified E2E)

| Field | Value |
|-------|-------|
| Burn tx (Arc Testnet) | `0xec4930ae7c9ac9e85c13c088d187a8a0403b2a4f17369cfdcfec1dd4702c3b92` |
| receiveMessage tx (Sepolia) | `0x586024ec593593a98c998ec00ea1c4ccf2ed685b81cd55f34107ff89e74542de` |
| TokenMessengerV2 (Arc Testnet) | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| MessageTransmitterV2 | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |

### VeyraSettlement — Arc Mainnet

**NOT YET DEPLOYED.** Mainnet deployment requires:
1. Owner wallet authorization (you must run forge from your own hardware wallet)
2. Completion of steps in `docs/mainnet-deploy-procedure.md`
3. Explicit broadcast authorization

### Canary payment — Arc Mainnet

**NOT YET EXECUTED.** Requires mainnet deployment first.

---

## 3. Test results

### Vitest (TypeScript unit tests)

```
Test Files  176 passed (176)
     Tests  1204 passed (1204)
   Duration  ~30s
```

Run command: `bun run test`
Last confirmed passing: 2026-11-01

Key test files relevant to Arc Mainnet integration:
- `src/tests/phase40XOAuthMainnetCallbackGate.test.ts` — 8 tests, X OAuth mainnet null gate
- `src/tests/phase3MainnetReadiness.test.ts` — 4 tests, mainnet config
- `src/tests/phase3MainnetCatalog.test.ts` — 4 tests, mainnet provider catalog
- `src/tests/phase8fHostedIdentityChain.test.ts` — 10 tests, chain identity gating
- `src/tests/phase9jTrustedWalletLoginOrigin.test.ts` — 6 tests, wallet login origins

### Foundry (Solidity unit + fuzz + invariant tests)

```
Ran 3 test suites: 60 tests passed, 0 failed, 0 skipped
  VeyraSettlement.Unit.t.sol  — unit tests
  VeyraSettlement.Fuzz.t.sol  — fuzz tests
  VeyraSettlement.Invariant.t.sol — invariant tests
```

Run command: `forge test` (from project root)
Last confirmed passing: 2026-11-01

### TypeScript / lint

```
tsc --noEmit: 0 errors
oxlint: 0 errors (warnings only, acceptable)
```

---

## 4. Security review

### Internal review scope

An internal review of `contracts/VeyraSettlement.sol` was performed covering:

**Findings (all addressed):**

| Finding | Severity | Status |
|---------|----------|--------|
| Hardcoded fee display in review UI | High (financial) | Fixed: live feeBps read |
| Silent zero-fee fallback on read error | High (financial) | Fixed: fail-closed gate |
| No network fee shown separately | Medium (UX) | Fixed: useEstimateGas |
| No pre-sign revalidation | Medium (financial) | Fixed: publicClient re-read |
| No event-based verified state | Medium (financial) | Fixed: decodeEventLog |
| Mainnet escrow not gated in UI | Medium | Fixed: application-level gate |
| Deploy procedure used `--private-key` | Critical (security) | Fixed: hardware-wallet procedure |
| `forge build --root contracts` wrong | High (build) | Fixed: project-root build |
| Payment ref generated at execution time | Low | Fixed: generated at review entry |

**No bugs found in contract logic:**
- Reentrancy: `ReentrancyGuard` on every state-mutating function, pull-before-push ordering
- Fee accounting: `accruedFees` accumulates correctly, `withdrawFees` zeroes before transfer
- Escrow authorization: payer-or-recipient release, payer-only refund after timeout
- Payment ID: nonce prevents collisions even within same block
- Ownership: `renounceOwnership` disabled, owner required for pause/fee management

**NOT an independent audit.** This is Arc Studio's internal review only. For a production
financial contract holding real user funds, an independent third-party security audit is
strongly recommended before broad adoption.

---

## 5. Architecture summary

```
Identity → Intent → Route → Safety → Sign → Receipt
```

### Key technical decisions

- **Arc-native gas:** USDC is the native gas token on Arc. The application handles
  the single-pool dual-view (native vs ERC-20) correctly using `@/onchain-money` helpers.
- **Dual-chain identity:** Arc Testnet (5042002) and Arc Mainnet (5042) are cleanly
  separated at the BFF, identity, and registration layers.
- **X OAuth:** `resolveXCallbackUrl()` returns null on mainnet when `X_REDIRECT_URI`
  is unset — no silent fallback to testnet callback.
- **VeyraSettlement:** Deployed on Arc Testnet, pending mainnet. Owner controls
  pause/fee; escrow participants control their own funds.
- **CCTP V2:** Verified E2E Arc Testnet → Ethereum Sepolia with MessageTransmitterV2.

### Provider lifecycle

| Provider | Status |
|----------|--------|
| arc-erc20-transfer | ENABLED |
| viem-simulation | ENABLED |
| arc-portfolio-read | ENABLED |
| cctp-v2-bridge | ENABLED (testnet E2E verified) |
| circle-stablefx | IMPLEMENTED/disabled (access issue) |
| circle-appkit-unified-balance | IMPLEMENTED/disabled |
| circle-appkit-bridge | IMPLEMENTED/disabled |
| circle-appkit-swap | IMPLEMENTED/disabled |
| circle-appkit-earn | IMPLEMENTED/disabled |
| mainnet-usdc-transfer | VERIFIED/disabled (pending mainnet deploy) |
| cctp-v2-mainnet | VERIFIED/disabled |

---

## 6. What remains before Mainnet READY declaration

| Step | Status | Blocker |
|------|--------|---------|
| VeyraSettlement Arc Mainnet deploy | NOT YET | Owner wallet authorization |
| Canary payment (0.01 USDC) | NOT YET | Mainnet deploy first |
| PaymentSettled event verification | NOT YET | Canary payment first |
| `src/config/veyraSettlement.ts` mainnet slot | NOT YET | Deploy address needed |
| Vercel Production promotion | NOT YET | Canary payment evidence |
| Independent security audit | NOT YET | Owner decision |
| `X_REDIRECT_URI` on Render mainnet BFF | NOT YET | Owner configuration |

---

## 7. Video plan

A walkthrough video is planned to demonstrate:
1. Wallet connection on Arc Testnet
2. USDC balance display
3. Settlement page — Direct Pay flow (form → review → approve → sign → verified)
4. Settlement page — CCTP V2 bridge (Arc Testnet → Sepolia)
5. Identity — wallet-linked Veyra ID

Video will be recorded after mainnet canary payment is verified.

---

## 8. Builder profile

- GitHub: github.com/bearbaba
- Built entirely with Arc Studio (Circle)
- Arc Studio project: https://ibb9vwyygkkct5eupl9ay.preview.studio.arc.io
- Arc Studio branch: arc-studio/mainnet at commit `e2e67b7` (final P0 corrections pending push)
