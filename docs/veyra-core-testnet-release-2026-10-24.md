# Veyra Core — protected unified Testnet release candidate

**Dedicated deploy-only branch:** `phase9q-unified-core-testnet-release`

**Reviewed financial baseline:** P0 PRs #62–#66 at `a6650dc65a1dd3fd9e1362d42a2f393d11a1b444`, plus wallet-scoped Activity/Bridge safety PR #69 merged as `cf56cc676523681e3a30db5b3a7bd31efc043dd5`. Its financial CI passed **928/928 tests, 118 test files**. The staging branch copies the exact reviewed files rather than merging deploy configuration into the finance branch.

**Allowed target:** existing `veyra-unified-testnet` Vercel project only.
**Do NOT merge this branch into `phase5-production-bridge-flow` or `develop`, or deploy it to `veyra` or a Mainnet project.**

This branch combines the latest wallet-bound Veyra ID, Friends, Pay and Activity with the *reviewed* Testnet-only full-app build and exact HTTPS BFF route allowlist originally prepared on the isolated `phase9h-unified-testnet-host` branch.

## Readiness

1. Gate `scripts/check-unified-testnet-staging.ts` must PASS, along with typecheck, lint, tests and guarded Mainnet builds.
2. Deploy a protected **Preview** of this branch to `veyra-unified-testnet`, inspect exact commit SHA, content, runtime headers and API response types. Existing stable domain must remain unchanged until operator acceptance.
3. The **only** approved backend origin is `https://veyra-testnet-acceptance-bff.onrender.com`; exact rewrites are defined in `scripts/stagingBffAllowlist.ts`. There is no wildcard proxy or X OAuth route.
4. Check the existing trusted Render origin `https://veyra-unified-testnet.vercel.app` and service readiness with the selected operator workspace; do not change environment variables or secrets without explicit authorization. X linking stays visibly disabled until its own acceptance.
5. Test with two real wallets and small *testnet* USDC: ID registration or sign-in, Friends request/accept, reviewed Pay by ID, single wallet signature, 12 canonical confirmations, same-transaction ERC-20 Transfer proof, Activity persistence, reload and A/B isolation.
6. Test negative cases: wallet cancel, insufficient gas/USDC, network mismatch, substituted recipient, RPC offline, chain reorg, local IndexedDB denial, duplicate action and cross-tab race. No resubmission after unknown outcome.
7. Only after the above and a deliberate deployment approval may this candidate replace the protected `veyra-unified-testnet` target. Never automatically promote to Mainnet.

**Not a live acceptance claim:** a green build or Vercel READY is static evidence only, not proof of funded acceptance or live backend readiness.

## Current deployment and acceptance blocker (24 October 2026)

A protected **Preview** creation targeting Vercel project `veyra-unified-testnet` was attempted and blocked at HTTP **402** `api-deployments-free-per-day` (more than 100 deploys/day, retry-after 86400 seconds). A new URL/production alias was **not** created; previous publicly routed Testnet project still points to old commit `498f75da5b54475a7809220cc327e5268bd0160a`. Do not confuse a successful GitHub Actions build with a deployed and signed-wallet-accepted Testnet release.

As soon as the operator resolves the daily build allowance, deploy **this branch's newest passing commit** to a protected preview of the existing `veyra-unified-testnet` project; verify Git SHA and HTTPS route health before requesting any live user-funded action. Do not replay unknown-outcome transfers and do not promote `develop`, `veyra`, `veyra-unified-testnet-v2`, or Mainnet from this deploy-only branch.

## Phase 9U — integrated controlled Testnet acceptance candidate

The audited BFF allowlist now includes **35 exact paths**, adding Agent chat/status (review only), fixed-domain Circle sandbox attestation, signed wallet-owner CCTP recovery and destination-submission reconciliation. No wildcard proxies or OAuth callbacks.

**Not yet enabled:** StableFX trade/Convert, Circle App Kit Swap/Gateway/Earn, X OAuth and any Mainnet money movement. Their adapters remain behind the existing lifecycle gates until separate verified real Testnet E2E and production approval. Agent never signs on behalf of a user; it may prepare a reviewed wallet action.

Deployment remains blocked by the recorded Vercel daily limit. CI can verify code shape but does not prove live Render readiness or a funded two-wallet acceptance. Never call this a completed launch.
