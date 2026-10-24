# Veyra Core — protected unified Testnet release candidate

**Dedicated deploy-only branch:** `phase9q-unified-core-testnet-release`

**Source base:** `a6650dc65a1dd3fd9e1362d42a2f393d11a1b444`, including merged P0 financial PRs #62–#66 and 919 passing CI tests.

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
