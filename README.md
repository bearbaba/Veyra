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
- **Lost-response first receive recovery:** Activity can accept the
  hash of a destination `receiveMessage` transaction that was ALREADY
  signed and broadcast. The authenticated server requires the pre-existing
  first-attempt claim and independently verifies the RPC chain ID, returned
  transaction hash, recipient signer, canonical transmitter, message and
  Circle attestation before recording it. This never signs or resends.
- **Second receive lost-response recovery:** previously reserved attempt #2
  can now be matched to an *already indexed* destination transaction hash
  using the authenticated `POST /api/bridge/reconcile-second-receive`
  endpoint. The BFF revalidates the original reverted first attempt and
  Arc/Circle source, the actual destination RPC chain, immutable hash and
  exact original any-caller CCTP receive calldata. No claim, signing,
  resubmission or mint-success claim occurs. Activity can display the
  owner-scoped append-only attempt history across devices and show the
  second-hash reconciliation form only for an existing `UNCERTAIN` slot.
- **Read-only CCTP V2 nonce inspection:** authenticated
  `POST /api/bridge/inspect-destination-nonce` independently rechecks the
  first revert and original Arc/Circle source, parses the 32-byte nonce from
  the attested V2 message and reads destination `usedNonces` against one
  block with canonical hash checks. Activity shows `UNUSED_AT_OBSERVED_BLOCK`
  or `ALREADY_CONSUMED`; neither authorizes another transaction.

**Important:** observing an unused nonce is NOT authorization to submit retry
#2. Another relayer can consume it at any moment. The second-attempt
signing/broadcast pathway remains disabled pending an atomic server-authorized
signing boundary, unknown-submission reconciliation and live testnet
acceptance. The app does not silently retry a source burn.

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
`VITE_VEYRA_ENV=testnet VITE_VEYRA_UI_ONLY=1 VITE_VEYRA_TESTNET_PAY=1 bun run build` command and static `dist` output.
In this build, Vite selects the **separate** `src/preview/main.tsx`
React tree. The connected-preview dashboard now supports **real injected
MetaMask/Rabby/Coinbase wallet account connection** via EIP-6963/EIP-1193
(`eth_requestAccounts`), displays the wallet address and reads its
**real Arc Testnet USDC balance** through read-only public RPC calls
(`eth_chainId` + `eth_call`). **Direct Arc Testnet wallet-to-wallet USDC Pay
is executable**, with a **hard 1 testnet USDC per-transaction cap**, explicit
wallet review/signature, independent on-chain receipt and ERC-20 Transfer
log verification, and browser-local pending/unknown-hash recovery. Convert,
Bridge and Veyra ID Pay are NOT live financial services yet.
**The scripted Agent has been deleted.** A real standalone Vercel Function
(`api/agent/chat.ts`) can call OpenAI with server-only API credentials
when `VEYRA_AGENT_ENABLED=1`, `OPENAI_API_KEY`, and an access-control
`VEYRA_AGENT_BETA_TOKEN` (>=24 characters) are configured in Vercel
Preview Settings. It does NOT execute actions or authenticate payments.
If unconfigured, Agent **shows unavailable** rather than fake answers.
Convert/Bridge now expose **no simulated quote or transaction review**.
No server private key, message-signature-based identity, Express BFF,
Circle relay or CCTP transfer code is bundled in browser JavaScript. The full application separately retains its
canonical financial execution-time lock. This is build-time isolation, not
a UI toggle; wallet connect is NOT payment authorization.

CI separately builds the exact Vercel preview and runs
`bun run check:vercel-preview-bundle` against the emitted JavaScript to
allow exactly the capped Arc USDC testnet transfer signer while continuing
to reject all other signing RPCs, CCTP transaction ABI entrypoints and
backend financial paths. The single stateless, token-protected
`/api/agent/chat` Vercel Function is explicitly allowed. Vercel can publish this **connected UI Preview** independently
of CCTP E2E. A user-created Preview deployment has been reported, but public
availability and hosted behavior have not been independently verified.

**A frontend-only deployment is not a working full-stack demo.** The local
Vite `/api` development proxy does not run on Vercel. Veyra uses a
separately hosted, authenticated Express BFF plus PostgreSQL and Circle/RPC
integrations; without that backend, Veyra ID Pay, authenticated agent actions, identity,
CCTP recovery and cross-device Activity API-dependent features cannot be
treated as functional. **Standalone AI chat** can function with its separately
configured Vercel API key and private beta access token, but it cannot
move funds, check private account history or settle a bridge.
Direct testnet USDC payments only are browser-driven; they are not backed
by Veyra IDs or server receipts. Never use mainnet funds, a production wallet or a mainnet chain to test
this capped testnet-only payment beta.

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
