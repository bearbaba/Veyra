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
- `src/identity-beta/protocol.ts`: `ARC_MAINNET_CHAIN_ID=5042`, `ARC_SUPPORTED_CHAIN_IDS`, `LOGIN_PURPOSE` exported. `requireArcWallet` accepts both Arc chains. `verifiedTypedData` validates both chains but enforces `domain.chainId === message.chainId` to block cross-chain tampering. `verifyXAuthorizationUrl` validates structural HTTPS requirements (path must be `/api/auth/x/callback`, no credentials/fragment/port); host-level trust is owned by the server-side `resolveXCallbackUrl` + PKCE.
- `server/services/walletLoginService.ts`: `ARC_MAINNET_LOGIN_CHAIN=5042`, `ARC_SUPPORTED_LOGIN_CHAINS` added. `resolveTrustedLoginOrigin` (testnet) unchanged and still throws `TESTNET_ONLY` for non-testnet env. New `resolveTrustedMainnetLoginOrigin` for mainnet BFF. `resolveTrustedLoginOriginForEnv` dispatches by `VEYRA_ENV`. `beginWalletLogin` / `completeWalletLogin` use `resolveTrustedLoginOriginForEnv` and accept both Arc chain IDs.
- `server/services/identityRegistrationService.ts`: `ARC_MAINNET_CHAIN_ID=5042`, `ARC_SUPPORTED_IDENTITY_CHAINS` added. `assertHostedIdentityChain` added (replaces deprecated `assertHostedTestnetIdentityChain`): testnet backend allows only 5042002, mainnet backend allows only 5042.
- `server/services/xOAuthService.ts`: `resolveXCallbackUrl()` returns `null` on mainnet if `X_REDIRECT_URI` unset (no fallback to testnet callback on mainnet). Validates `X_REDIRECT_URI` as exact HTTPS URL. `beginXOAuthLink` no longer accepts redirectUri from caller — always resolved server-side. `verifyXAuthorizationUrl` validates structural HTTPS requirements; PKCE code_challenge ties grant to DB record.
- `server/bff.ts`: session restore SQL `chain_id IN (5042002, 5042)`, uses `resolveTrustedLoginOriginForEnv`, imports `resolveXCallbackUrl`.
- `src/components/pages/SettlementPage.tsx`: dual-chain (5042002 + 5042). `activeUsdcAddress` selected by chain. Wrong-chain banner shows both Arc switch buttons. "Not yet deployed" state for mainnet until contract is deployed.
- `src/components/pages/HomePage.tsx`: parallel mainnet balance read (`useReadContract` pinned to `ARC_MAINNET_CHAIN_ID`). Unified `balanceFetching`, `balanceLoading`, `balanceUpdatedAt` aliases. Network label and env label dynamic. `isMainnet = VEYRA_ENV === 'mainnet' || connectedChainId === ARC_MAINNET_CHAIN_ID`.

**Session test gate (latest):** 1175/1175 passing. 0 TypeScript errors. 0 lint errors. 60/60 Forge tests passing.

**GitHub branch `arc-studio/mainnet`:** Latest push commit `e2e67b7`. Branch up-to-date with remote. Includes:
- `dff227a` Arc Mainnet identity, wagmi, Settlement, X OAuth hardening
- `6175e6a` fix VeyraSettlement ABI import to use contract-metadata (not out/)
- `c260fa5` surface Gateway balance on Home, simplify navigation
- `b138e69` preserve tracked Settlement ABI import after UX batch
- `6a89b3c` update AGENTS.md and README with X OAuth gate
- `6260fa9` Settlement UI: live feeBps/feeRecipient, complete payment review lifecycle
- `0380f5b` chore: sync workspace state, update AGENTS, fix ABI import path
- `e2e67b7` fix(settlement): P0 financial correctness + secure deploy procedure

**P0 changes in `e2e67b7`:**
- SettlementPage: fail-closed fee read, network fee estimate, pre-sign revalidation, event-based verified state, mainnet escrow gate
- WebPreviewBanner: restore 'Sign-in unavailable on this Preview' string (fixed test regression from c260fa5)
- docs/mainnet-deploy-procedure.md: correct forge build command, hardware-wallet signing, exact artifact params
- docs/arc-microgrants-evidence.md: complete evidence package
- docs/vercel-mainnet-preview-setup.md: branch-specific Preview env vars, no Production auto-promote

**Final P0 corrections — commit 323774c (pushed 2026-11-01):**
- SettlementPage: fixed Arc gas 18-dec→6-dec conversion (GAS_TO_USDC_DIVISOR=10^12, not 6-dec direct format); approve+pay gas estimates shown separately; gas "estimation unavailable" shown when estimate=0n; snapshot freeze includes walletAddress+chainId; 12-check verification (chain, status, target, emitter, payer, recipient, gross, fee, net, ref, USDC in-transfer, USDC out-transfer); verified receipt shows gasUsed; failReasons listed on 'confirmed' step
- docs/mainnet-deploy-procedure.md: fixed bytecode hash to real Keccak-256=0xc70cdb0b5f3b9bdd698e44bfae66f6b76475b3a05686c950be33d7c444aad3d2 (was sha3_256 — different algorithm); verification command updated to `cast keccak`
- docs/vercel-mainnet-preview-setup.md: rewritten — explains why env-var override alone is insufficient (buildCommand hard-codes flags), provides Option A (replace vercel.json on branch), Option B (vercel CLI --local-config); branch-protection warning against merging to main
- vercel.mainnet-preview.json: new file with VITE_VEYRA_ENV=mainnet, VITE_VEYRA_MAINNET_PAY=1 build config (not committed to main; used only for preview branch)
- src/tests/settlementGasAndVerification.test.ts: new — 10 gas denomination tests (including 10^12 regression) + 18 adversarial verification tests

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
