# Veyra Phase 5 — Production Bridge Flow

Status: implementation complete pending the final live production-UI CCTP E2E
acceptance run.

Phase 5 moves the already-proven CCTP testnet route out of the DEV validation
surface and into the production routing, receipt, recovery, and Activity
architecture.

## Production flow

The production bridge path is now:

```text
Input
→ RouteEngine
→ lifecycle/registry eligibility
→ provider quote
→ provider preflight
→ deterministic policy/risk evaluation
→ Review
→ route freshness refresh
→ authenticated ActivityReceipt creation
→ ProviderAdapter.execute()
→ canonical CCTP execution runtime
→ chain verification
→ ActivityReceipt completion
```

The reviewed route receives a deterministic `routeId` derived from:

- server-issued/client intent UUID
- sender
- recipient snapshot/direct recipient key
- amount
- source token + chain
- destination token + chain
- provider
- provider version

The route ID becomes the `BridgeAction.actionId`. Refreshing an otherwise
identical short-lived CCTP quote therefore does not create a second replay
identity.

## RouteEngine

`src/core/router/routeEngine.ts`:

- considers only lifecycle `ENABLED` providers
- reuses the canonical Provider Registry eligibility check
- filters exact source/destination/token capability coverage
- enforces provider quote timeout
- rejects expired/future/structurally invalid route data
- rejects unsupported multi-hop routes
- enforces a generic minimum-output safety ratio
- ranks output, time, then confidence
- returns a bounded number of route choices

CCTP V2 supplies the first production `BridgeProviderAdapter`.

## CCTP provider capability adapter

`src/providers/cctp/cctpBridgeProvider.ts` owns:

- CCTP provider identity/version
- supported direct testnet routes
- static standard-transfer route quote
- provider capability matrix
- destination CCTP contract-code preflight
- attestation-service health preflight
- direct-only execution gate
- ProviderAdapter `execute()` / `resume()` boundary

Browser wallet/RPC mechanics remain in the canonical bridge execution runtime.
The provider adapter validates route/runtime binding before delegating to that
environment-specific runtime. Product pages no longer invoke the provider
execution runtime directly.

## Route freshness at signing

Static routes use a short fallback TTL. A user may spend longer than that
reading Review.

Immediately before execution Veyra therefore re-quotes and requires:

- same deterministic routeId
- same provider
- same amount
- same destination
- successful fresh provider HARD BLOCK preflight
- successful deterministic policy/risk evaluation

Only freshness metadata may change. If reviewed money-moving terms change,
execution stops and a new Review is required.

## PostgreSQL ActivityReceipt

Migration:

`server/db/migrations/0007_phase5_activity_receipt_lifecycle.sql`

adds production lifecycle/audit metadata including:

- provider version
- surface/action
- route option snapshot
- policy result
- preflight results
- resume payload
- resumable flag
- last writer / last write time
- confirmed / cancelled timestamps
- route/status and resumable indexes

Direct-address bridge recipients are supported without fabricating an identity
snapshot foreign key.

CI now starts PostgreSQL, so migration-from-zero tests are no longer silently
skipped in the canonical GitHub gate.

## Receipt lifecycle

Canonical direct CCTP lifecycle:

```text
INTENT_CAPTURED
→ PREFLIGHT_PASSED
→ SIGNED
→ BROADCAST
→ SOURCE_CONFIRMED
→ ATTESTATION_PENDING
→ RECEIVE_PENDING
→ CONFIRMED
→ COMPLETE
```

Destination retry may transition:

```text
RECEIVE_PENDING
↔ RECEIVE_FAILED_RETRYABLE
```

Terminal statuses never reopen.

The repository enforces transitions under a row lock and writes every status
change to append-only `execution_events` in the same transaction.

Browser reconciliation is revision-aware. A stale browser never overwrites a
newer server record and immutable money-moving receipt fields are not accepted
from receipt sync requests.

## Server-bound receipt creation

Before the wallet execution boundary, the authenticated BFF:

- verifies the sender belongs to the signed-in Veyra user
- verifies the optional recipient identity snapshot
- validates exact Arc Testnet USDC / supported destination scope
- reconstructs and checks the deterministic routeId
- reconstructs route/action metadata server-side
- runs deterministic server policy/risk/preflight evaluation
- creates the durable receipt
- advances it to `PREFLIGHT_PASSED`

Repeated creation of the same reviewed route is idempotent and returns the
existing receipt rather than creating a duplicate.

Client-reported policy/preflight fields are not used as authoritative receipt
truth.

## Bridge execution receipt sync

The production execution runtime advances the server receipt only at real
execution boundaries:

- source submission boundary
- source broadcast hash
- verified source CCTP receipt
- attestation wait
- destination receive broadcast
- verified destination receipt/state
- confirmed/completed

Once the source may have been submitted, a temporary Activity API failure does
not cause a second burn. The persistent action replay lock and bridge recovery
checkpoint remain the safety authority; receipt reconciliation catches up later.

Recovery also reconciles matching ActivityReceipts from the authenticated
server mirror.

## Activity

Activity now shows both:

- local VeyraReceipt cache
- authenticated durable ActivityReceipt lifecycle

In-flight server receipts expose provider, revision, route, source/destination
transaction hashes and resumability.

A `SIGNED` receipt with no source transaction hash is shown as an uncertain
submission and is never replayed automatically.

Bridge recovery cards still use the persisted checkpoint state and now invoke
the provider adapter `resume()` boundary.

## Production / DEV separation

Production bridge execution imports no DEV E2E page or DEV component.

GitHub CI checks:

- TypeScript
- DEV source isolation
- lint
- tests
- PostgreSQL migration-from-zero
- production build
- production bundle DEV isolation

## Acceptance status

Implemented and CI-testable:

- production RouteEngine
- CCTP CapabilityMatrix / ProviderAdapter
- lifecycle gates
- short-TTL re-quote at execution boundary
- provider HARD BLOCK preflight
- authenticated system-of-record receipt creation
- full ActivityReceipt transition model
- revision conflict protection
- production Activity states
- reload/recovery reconciliation
- ProviderAdapter execute/resume boundaries
- production DEV exclusion

External acceptance still required:

- one real Arc Testnet → Sepolia/Base CCTP V2 execution initiated from the
  production Bridge page with an authenticated Veyra identity and wallet

That test must produce reviewable source burn, Circle attestation, destination
receive/mint, exact final-state verification, ActivityReceipt completion, and
must survive/recover from a reload test.

No live execution result is fabricated by this phase.
