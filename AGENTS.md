# Veyra project memory

Veyra is **The Intelligent Money Layer on Arc**.

Tagline: **Tell your money what to do.**

## Product model

```text
Identity → Intent → Route → Safety → Sign → Receipt
```

Arc is the home network, not the product boundary.

Primary product navigation is Home / Pay / Agent / Activity. Convert and Bridge
are advanced execution surfaces over the same core pipeline.

## Non-negotiable execution invariants

- LLM never signs and never supplies trusted financial execution data.
- Direct UI and Agent use the same deterministic action/provider/policy path.
- Unknown or ambiguous execution state blocks.
- Only registered and lifecycle-enabled providers may execute.
- Provider lifecycle is DISCOVERED → VERIFIED → IMPLEMENTED → TESTED → ENABLED.
- Every money action must be understandable before it is signable.
- Veyra-added wallet signatures must remain zero.
- Provider success is not receipt truth; authoritative chain/provider state is.
- Quote/action replay protection must remain fail-closed.
- A bridge with a submitted source movement must never be started again as a
  fresh bridge. Recovery resumes the exact in-flight execution.
- Testnet evidence never activates mainnet.

## Persistence

PostgreSQL is the approved system of record. IndexedDB is local cache/recovery.

Execution/audit events in Postgres are append-only. Browser recovery state must
be treated as untrusted input and reconciled against chain/provider state.

## Provider and environment rules

CCTP V2 is the currently enabled testnet bridge route.

Circle App Kit Bridge, Swap, Earn, and Unified Balance are implemented but
disabled until real testnet E2E evidence and explicit promotion. Raw Unified
deposit is intentionally fail-closed.

StableFX is implemented but disabled pending real testnet E2E.

Mainnet uses a separate activation path. Production startup forbids
`RELAY_PRIVATE_KEY` and requires the KMS/HSM signer boundary.

## CCTP recovery

Persist source and destination transaction hashes immediately after broadcast
and before receipt waits.

Recovery stages:

```text
SOURCE_BROADCAST
SOURCE_CONFIRMED
ATTESTATION_READY
DESTINATION_BROADCAST
VERIFIED
```

There is no re-burn transition.

## DEV tooling

Production source must not import `src/components/dev/**`.

The standalone developer entry is `dev.html` / `src/dev.tsx` and requires
`VITE_DEV_TOOLS=true`. CI checks both source imports and the production bundle
for DEV leakage.

## Validation

Do not ask the user to manually run routine gates when GitHub Actions can do it.

The CI gate is `.github/workflows/ci.yml` and must pass:

- typecheck
- DEV source isolation
- lint
- tests
- production build
- production bundle DEV isolation

Never fabricate E2E evidence, live provider health, DB availability, production
signer readiness, or mainnet readiness.

## Arc Mainnet integration notes (Arc Studio authored — current session)

- `src/config.ts`: Arc Mainnet (`arc`, chainId 5042) added to wagmi chain list alongside testnet. RPC: `https://rpc.mainnet.arc.io`.
- `src/identity-beta/protocol.ts`: `ARC_MAINNET_CHAIN_ID=5042`, `ARC_SUPPORTED_CHAIN_IDS`, `LOGIN_PURPOSE` exported. `requireArcWallet` accepts both Arc chains. `verifiedTypedData` validates both chains but enforces `domain.chainId === message.chainId` to block cross-chain tampering. `verifyXAuthorizationUrl` accepts onrender.com and vercel.app callbacks.
- `server/services/walletLoginService.ts`: `ARC_MAINNET_LOGIN_CHAIN=5042`, `ARC_SUPPORTED_LOGIN_CHAINS` added. `resolveTrustedLoginOrigin` (testnet) unchanged and still throws `TESTNET_ONLY` for non-testnet env. New `resolveTrustedMainnetLoginOrigin` for mainnet BFF. `resolveTrustedLoginOriginForEnv` dispatches by `VEYRA_ENV`. `beginWalletLogin` / `completeWalletLogin` use `resolveTrustedLoginOriginForEnv` and accept both Arc chain IDs.
- `server/services/identityRegistrationService.ts`: `ARC_MAINNET_CHAIN_ID=5042`, `ARC_SUPPORTED_IDENTITY_CHAINS` added. `assertHostedIdentityChain` added (replaces deprecated `assertHostedTestnetIdentityChain`): testnet backend allows only 5042002, mainnet backend allows only 5042.
- `server/services/xOAuthService.ts`: `resolveXCallbackUrl()` reads `X_REDIRECT_URI` env var for mainnet BFF, falls back to canonical Render testnet URL. `beginXOAuthLink` no longer accepts redirectUri from caller — always resolved server-side.
- `server/bff.ts`: session restore SQL `chain_id IN (5042002, 5042)`, uses `resolveTrustedLoginOriginForEnv`, imports `resolveXCallbackUrl`.

## VeyraSettlement contract (Arc Studio authored)

Deployed by Arc Studio on 2026-10-31.

| Network | Address | Explorer |
|---|---|---|
| Arc Testnet | `0x39ceae4c1363780dbef8a02487d71914e0c9382a` | https://explorer.testnet.arc.io/address/0x39ceae4c1363780dbef8a02487d71914e0c9382a |
| Arc Mainnet | TBD — requires owner approval | — |

Deploy tx (Arc Testnet): `0xc7c6baa1056de503f793b5b8e9b31278b754852cee1bfa6984ab840e6ed41316`

Source: `contracts/VeyraSettlement.sol`
Artifact: `contracts/out/VeyraSettlement.sol/VeyraSettlement.json`
Metadata: `contracts/contract-metadata/VeyraSettlement.json`

Constructor args: USDC=`0x3600...0000`, owner=platform deployer, feeRecipient=platform deployer, feeBps=0.
Mainnet deploy requires Mode 2 (self-deploy via Compass engine) with user's own wallet as owner.

## Git workflow

- base branch: `develop`
- never develop directly on `develop`
- make focused branch commits
- inspect CI and fix failures autonomously
- open PR into `develop` only when the branch is green
- do not enable a provider just because tests pass
