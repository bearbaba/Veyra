# Veyra

**The Intelligent Money Layer on Arc**

> Tell your money what to do.

Veyra turns human intent into deterministic, reviewable financial actions. Arc is
the home network, not the product boundary.

The core execution model is:

```text
Identity → Intent → Route → Safety → Sign → Receipt
```

The Agent may help interpret intent, but it never signs, chooses authoritative
financial values, or bypasses the deterministic execution pipeline.

## Current product surfaces

Primary navigation:

- Home
- Pay
- Agent
- Activity

Advanced execution surfaces such as Convert and Bridge are reached through the
same deterministic action, provider, policy, risk, review, and receipt layers.

## Safety model

Veyra follows these invariants:

- the LLM never signs transactions
- the LLM is not trusted for balances, prices, APY, decimals, contract
  addresses, calldata, provider state, risk, or transaction success
- every money-moving provider is registered and lifecycle-gated
- unknown or ambiguous execution state fails closed
- wallet signatures happen only after deterministic review
- provider SDK success alone is not a VERIFIED Veyra receipt
- chain/provider state is authoritative for final verification
- duplicate action/quote execution is blocked
- in-flight bridge recovery never creates a second source burn
- mainnet is enabled by separate production evidence, never by a testnet flag

## Provider lifecycle

Every provider moves through:

```text
DISCOVERED → VERIFIED → IMPLEMENTED → TESTED → ENABLED
```

An adapter existing in the repository does **not** make that provider
execution-ready. Real E2E evidence and explicit promotion are required.

At the current testnet baseline:

- Arc ERC-20 transfer: enabled
- viem simulation: enabled
- Arc portfolio read: enabled
- CCTP V2 bridge: enabled testnet route
- Circle StableFX: implemented, disabled pending real E2E
- Circle App Kit Bridge / Swap / Earn / Unified Balance: implemented, disabled
  pending real E2E and promotion evidence
- mainnet providers: separate production activation path

## Persistence

The approved architecture uses PostgreSQL as the system of record.

Browser IndexedDB stores local cache/recovery state, including:

- receipts
- quote replay state
- action execution replay locks
- bridge recovery checkpoints

Authenticated bridge recovery also has an advancement-only PostgreSQL mirror.
Chain/provider state remains the execution source of truth.

## Crash-safe bridge execution

CCTP V2 execution persists transaction hashes immediately after broadcast and
**before** receipt waits. The source action is locked before the irreversible
burn request.

Recovery stages are:

```text
SOURCE_BROADCAST
→ SOURCE_CONFIRMED
→ ATTESTATION_READY
→ DESTINATION_BROADCAST
→ VERIFIED
```

Recovery never contains a re-burn transition.

Source confirmation requires canonical CCTP `MessageSent` evidence.
Destination verification requires the exact USDC mint event to the reviewed
recipient plus exact destination balance delta.

## App Kit execution boundary

Circle App Kit money-moving wrappers are bound to canonical Veyra actions before
provider execution. The raw App Kit instance is not exported.

Phase 4E includes:

- Bridge review/action binding and recovery gate
- Swap amount/asset/slippage and Veyra fee/Treasury binding
- Earn deposit/withdrawal explainability and action binding
- Unified forwarded-spend action binding
- persistent `actionId` replay protection
- authoritative receipt verification

Raw Unified Balance deposits remain intentionally blocked until Veyra has an
unambiguous canonical action for that flow.

## Development

Requirements:

- Bun version from `.bun-version`
- a browser wallet for wallet flows
- PostgreSQL for DB-backed integration tests/routes
- environment-specific credentials only for the integrations being exercised

Install and run:

```bash
bun install --frozen-lockfile
bun run dev
```

The production app does not import DEV E2E tooling. CCTP developer tooling uses
the separate `dev.html` entry and requires:

```text
VITE_DEV_TOOLS=true
```

## Validation

GitHub CI is the canonical repository gate. It runs on phase branches, PRs to
`develop`, and `develop` pushes.

The gate runs:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run check:dev-isolation
bunx oxlint --type-aware --quiet src scripts
bunx oxlint --quiet .
bun run test -- --run
bun run build
bun run check:prod-bundle
```

PostgreSQL integration tests skip when no database is available; production DB
readiness is checked separately.

## Important docs

- `docs/veyra-architecture-v2.md` — approved architecture
- `docs/veyra-phase4d-provider-activation.md` — activation evidence/promotion
- `docs/veyra-phase4e-appkit-execution-safety.md` — App Kit execution safety
- `docs/veyra-phase4f-crash-safe-cctp-recovery.md` — CCTP crash/recovery hardening

## Mainnet

Veyra's rule is:

> Mainnet by design, enabled by evidence.

Production runtime validation rejects unsafe mainnet configuration, including a
raw `RELAY_PRIVATE_KEY`. Mainnet signing requires the KMS/HSM signer boundary
and separately promoted providers.
