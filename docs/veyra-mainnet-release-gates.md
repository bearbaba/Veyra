# Veyra — Arc Mainnet release gates (operator checklist)

**Status: BLOCKED.** This document describes acceptance requirements, **not**
authorization to execute with real money. The current Vercel project uses a
testnet-only UI build and the mainnet providers remain `VERIFIED` /
`enabled: false`.

## Architecture & scope

- Home network: **Arc Mainnet, chain ID 5042**.
- Arc native gas asset: **USDC**. Native gas/RPC values use **18 decimals**.
  Arc's USDC ERC-20 interface is **0x3600000000000000000000000000000000000000**
  and uses **6 decimals**. These interfaces share a balance; never display them
  as two independent assets or mix base units.
- Arc CCTP domain: **26**, distinct from EVM chain ID.
- The Veyra mainnet catalog is **metadata only**. Adding Arc to the catalog or
  deploying a Vite frontend must not activate real-money execution.
- The six existing EVM mainnet networks remain metadata candidates. Live
  cross-chain execution is a *separate* approval.
- AI may explain an action in the user's language but may not authorize
  transactions, select trusted onchain values or sign on behalf of users.

## Gate 0 — no unreviewed production rollout

- Keep `mainnet-usdc-transfer` and `cctp-v2-mainnet` disabled.
- Keep `VITE_VEYRA_ENV=testnet` for the current preview deployment.
- Preserve existing production aliases; do not point them at a preview build.
- Retain a separate immutable rollback deployment, and do not merge/publish
  solely because CI or Vercel build succeeds.

## Gate 1 — identity, chain and transaction model

- Confirm `eth_chainId === 0x13b2` (5042), expected USDC address and
  `decimals() === 6` on Arc Mainnet from an independently checked RPC.
- Ensure native 18-decimal gas balances and ERC-20 6-decimal USDC transfers
  use correct conversions and do not double-count balances.
- Reject accidental testnet chain ID 5042002, wrong token/recipient/amount,
  stale review and changed wallet accounts before any wallet signature.
- Validate allowance/contract calldata only for the approved provider route.
- Verify correct Arc transaction lifecycle and finality behavior; do not blindly
  reuse the 12-block confirmation rules from the testnet preview.
- Complete security review and a signed, reversible deployment/rollback plan.

## Gate 2 — production operations

- Deploy authenticated Express BFF with HTTPS, exact allowed origin, rate
  limits, metrics and incident response. A static Vercel deployment is not BFF.
- Provision managed PostgreSQL, apply all migrations and independently verify
  schema, backup/restore and owner-only ActivityReceipt access.
- Configure and health-check *each* RPC used by *each enabled* provider.
  Missing, stale, malformed, mismatched-chain or degraded RPCs must fail closed.
- Provision KMS/HSM signer gateway if using the current mainnet full-stack
  architecture. Do not use `RELAY_PRIVATE_KEY` for production.
- Store credentials only in the server secret store, never in browser `VITE_*`
  variables. No mainnet funding or real keys in test/preview environments.
- `bun run readiness:mainnet` must report `ready: true` against the actual
  production-shaped environment **after** all external probes succeed.
  This is an infrastructure gate, not a transaction acceptance result.

## Gate 3 — small-value canary, with explicit user approval

- Test wallet connection, transaction simulation, review/sign, actual transfer,
  authoritative chain receipt, exact recipient and balance delta on Arc Mainnet.
- Capture transaction hash, immutable reviewed fields, gas amount, wallet
  chain ID and successful explorer receipt as acceptance evidence.
- Test refusal, RPC timeout, lost wallet response, reload, tab/device races,
  reorg/finality edge cases and duplicate-execution prevention.
- Pause the route if a safety invariant fails. A missing receipt or ambiguous
  transaction must never become `VERIFIED` or automatically retry.
- Record operator, date, commit SHA, RPC/protocol versions, reviewer and
  links to *sanitized* evidence. Keep all production secrets private.

## Gate 4 — gradual release and later capabilities

- Release **Arc Mainnet Pay only** to a limited group after security sign-off
  and the canary gate. Enable the exact approved provider, not the whole
  catalog. Keep Bridge, Convert and relayer routes off.
- Monitor failures, gas, RPC, wallets, false-success classifications, pending
  receipts and support reports. Confirm MetaMask/domain security status.
- Activate CCTP only after independent real-value burn/attestation/mint,
  idempotent recovery, destination nonce/retry, ownership and replay tests.
- Convert/StableFX/App Kit integrations need separate provider promotion,
  real settlement receipts and explicit risk review.

## Sources and known limitations

- Arc connection: https://docs.arc.io/arc/references/connect-to-arc
- Arc USDC + CCTP contracts: https://docs.arc.io/arc/references/contract-addresses
- Arc EVM differences: https://docs.arc.io/arc/references/evm-differences
- Circle CCTP contract addresses: https://developers.circle.com/cctp/references/contract-addresses
- Repo release gates: `docs/veyra-testnet-release-gates.md`
- Repo production config: `server/config/runtimeConfig.ts`
- Repo mainnet gate: `server/readiness/mainnetReadiness.ts`

**Release decision:** FAIL until an operator independently verifies every
applicable gate and records evidence. This checklist cannot substitute for an
external security assessment or a production transaction test.
