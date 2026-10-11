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

- Arc ERC-20 transfer: enabled according to provider registry policy
- viem simulation: enabled
- Arc portfolio read: enabled
- CCTP V2 bridge: enabled for the reviewed testnet route; authenticated
  production-UI end-to-end acceptance is still **pending**
- CCTP destination retry #2: immutable claim, chain evidence, and second
  settlement finalizer implemented; **new signing/broadcast is disabled**
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

Source confirmation requires exactly one canonical ABI-decoded CCTP
`MessageSent` event, the reviewed source `depositForBurn` proof, and a single
matching Circle attestation. Destination verification requires the exact
USDC mint event to the reviewed recipient plus exact destination balance
delta.

Phase 5 additionally keeps distinct, append-only destination attempts:

- `0008`: first destination submission claim and events
- `0009`: canonical first destination revert resolution (12+ confirmations)
- `0010`: independent attempt #2 claim and immutable history; the attempt
  is never auto-reclaimed if broadcast status is uncertain
- `0011`: chain-verified second receive, unique exact USDC mint and finality
- `0012`: separate immutable settlement hash/block/attempt fields in the
  ActivityReceipt; the original first destination hash remains unchanged

**Important:** this is not yet authorization to submit retry #2. The
second-attempt signing/broadcast pathway remains blocked pending nonce safety
and live testnet acceptance. The app does not silently retry a source burn.

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

Install dependencies, then run the BFF and frontend in **separate
terminals**:

```bash
bun install --frozen-lockfile
# terminal A: set the backend environment and start Express
bun run server
# terminal B: launch the local Vite dev server (with /api → localhost:3001)
bun run dev
```

Authenticated identity, server ActivityReceipt/recovery and CCTP API routes
need a running PostgreSQL instance with current schema migrations. Provision
a disposable local/testnet database, configure `DATABASE_URL` **only in the
backend**, then run migrations through `bun run db:migrate` from a trusted
administrative environment. Validate with `bun run db:verify` and
`GET /api/health/database`. Never use real mainnet funds for preview tests.

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
- `docs/veyra-phase5-production-bridge-flow.md` — Phase 5 CCTP source
  verification, durable relay, retry attempt #2 and verified mint settlement
- `docs/veyra-vercel-preview.md` — static Vite preview vs full-stack testnet,
  BFF/PostgreSQL deployment, required environment and release gates

## Vercel preview deployment

**Frontend deployment configuration is now checked in:** `vercel.json`
sets Vite, the locked Bun install, the forced
`VITE_VEYRA_UI_ONLY=1 bun run build` command and static `dist` output.
In this build, the canonical signing gate rejects money-moving execution;
Pay/Convert/Bridge show interactive read-only flows, and Activity recovery
cannot request wallet signing. This lock is compile-time, not a UI toggle. Vercel can publish this **UI-only preview** independently
of CCTP E2E; no Vercel preview URL is claimed until actually deployed and
verified.

**A frontend-only deployment is not a working full-stack demo.** The local
Vite `/api` development proxy does not run on Vercel. Veyra uses a
separately hosted, authenticated Express BFF plus PostgreSQL and Circle/RPC
integrations; without that backend, Pay/Agent/identity/recovery/Activity
API-dependent features cannot be treated as functional. A preview build must
not expose mainnet signing or be used to send real funds.

For the first Preview build, import `bearbaba/Veyra` in Vercel, select the
Phase 5 branch/PR as a preview target, and set the **non-secret**
`VITE_VEYRA_ENV=testnet` for Preview. Keep the Vercel production branch
unchanged. Do not set `VITE_DEV_TOOLS=true` or put API keys/private keys
in `VITE_*` variables. Validate the static URL and verify
`/api/health` reports offline until a reviewed backend is connected.

For exact instructions, server-only variables, approved HTTPS API routing,
PostgreSQL migrations, test cases and launch/no-launch gates, see
**[Vercel preview deployment runbook](docs/veyra-vercel-preview.md)**.

### Release gates

| Milestone | Current state |
|---|---|
| Vite frontend build + GitHub CI | Working on PR #7 |
| Vercel static preview configuration | Added; actual Vercel URL not verified |
| Integrated HTTPS BFF + PostgreSQL on deployed preview | Not verified |
| Authenticated wallet-signed Arc testnet CCTP E2E | Not verified |
| Reload/cross-device replay prevention in a live browser | Not independently verified |
| Retry #2 signing after canonical nonce/revert recheck | Disabled |
| Mainnet provider/signer activation | Not approved |

## Mainnet

Veyra's rule is:

> Mainnet by design, enabled by evidence.

Production runtime validation rejects unsafe mainnet configuration, including a
raw `RELAY_PRIVATE_KEY`. Mainnet signing requires the KMS/HSM signer boundary
and separately promoted providers.
