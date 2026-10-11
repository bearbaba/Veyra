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


Receipt revisions are strictly contiguous: browser sync may advance only from
revision `N` to `N + 1`. Source/destination transaction hashes, chain IDs and
block numbers become immutable once recorded.

For CCTP, lifecycle evidence is also stage-bound:

- `BROADCAST` and later require the reviewed source burn hash/chain
- `SOURCE_CONFIRMED` and later require an authoritative source block
- `RECEIVE_PENDING` and later require the destination transaction/chain
- `CONFIRMED` and `COMPLETE` require the authoritative destination block
- resume payloads must bind to the exact receipt route ID
- terminal receipts cannot remain resumable

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


The BFF does not trust browser claims for the authoritative confirmation stages.
Before accepting `SOURCE_CONFIRMED`, it independently reads the Arc receipt and
requires the exact reviewed CCTP `DepositForBurn` plus canonical
`MessageSent` evidence. Before accepting `CONFIRMED`, it independently reads
the destination receipt and transaction, requires the exact canonical USDC mint
to the reviewed recipient, decodes the transaction as
`receiveMessage(bytes,bytes)` to the canonical MessageTransmitterV2, and binds
that calldata to Circle's authoritative attestation for the persisted source
burn. It also independently re-reads the source receipt, checks the recorded
source block and reviewed `DepositForBurn`, and requires the *exact attested
message bytes* to appear in the source MessageTransmitterV2 `MessageSent`
event. A transaction-hash lookup alone cannot prove the correct message when
one source transaction emitted multiple messages.

A successful source transaction whose exact CCTP evidence cannot yet be proven
is kept fail-closed and resumable/reconcilable. It is never converted into a
fresh source execution.

**Ambiguous CCTP message guard:** Veyra currently supports exactly one strictly
ABI-decoded `MessageSent(bytes)` event per source transaction and exactly one
Circle `/v2/messages/{domain}?transactionHash=...` response message. A batched
source transfer (or malformed/multiple Circle messages) is rejected rather than
choosing `messages[0]`. Server destination relay additionally requires the
sole Circle message bytes to match the sole canonical source `MessageSent`.
This deliberately limits batch support until per-message log index and
source burn association can be verified independently.

**Terminal safety and unresolved failure:** once the source wallet may have
submitted a transaction (`SIGNED` or later), an unverified browser-side
`FAILED`, `CANCELLED`, or `INVALIDATED` claim cannot terminalize a CCTP
receipt. This includes reverted-source cases: the UI can report the revert,
but the durable receipt and replay lock remain open for authoritative
reconciliation. **Source-revert resolution implemented:** the authenticated
`POST /api/receipts/cctp/resolve-source-revert` accepts only a receipt ID
and never a browser-supplied failure status. The BFF verifies the exact
`depositForBurn` transaction sender, contract, calldata, canonical source
receipt/block hash, and at least **12 source-chain confirmations**. Only an
unreconciled `BROADCAST` receipt without destination execution can be
atomically transitioned to `FAILED` under a PostgreSQL row lock. The
verification decision and source block proof are appended to execution events.
The original source action replay lock is not reopened. Recovery can request
this server resolution when a source revert is observed. Authenticated
terminal receipts are excluded from candidate recovery cards.

**Server destination relay exactly-once gate (migration 0008):** a
`bridge_destination_submission_claims` row is committed under the owned
checkpoint row lock *before* the relay wallet may broadcast
`receiveMessage`. Concurrent relay requests cannot both win. Two append-only
`bridge_destination_attempt_events` records track initial
`SUBMISSION_STARTED` and eventual `BROADCAST_RECORDED`. PostgreSQL rejects
event UPDATE/DELETE, and the first destination tx hash is immutable. Hash,
recovery checkpoint and the broadcast event are committed atomically. If
the process or RPC crashes before the hash can be persisted, the claim stays
`UNCERTAIN`; repeat relay requests return a conflict and must reconcile
rather than sign a second receive. The BFF also now checks exact
`DepositForBurn` source evidence before relay, not only the presence of
`MessageSent`.

**Shared server/self-relay gate:** wallet-signed self-relay now uses the
same owner-scoped PostgreSQL claim as the server relayer. Before requesting
the destination wallet signature, Veyra commits the claim via
`POST /api/bridge/claim-self-receive`. A second browser/device or server
relay cannot bypass that claim. The wallet hash is persisted in local recovery
immediately, then submitted to
`POST /api/bridge/record-self-receive`. This endpoint independently reads
the destination-chain transaction and verifies the sender is the reviewed
recipient wallet, the call target is canonical MessageTransmitterV2, and
the exact `receiveMessage` calldata contains the original persisted message
and Circle attestation. Only then may PostgreSQL commit that hash to the
immutable submission ledger. The repository also reconciles the exact
hash when an asynchronous client checkpoint mirror advanced to
`DESTINATION_BROADCAST` before the chain RPC indexed the transaction.
Recovery retries verification of the *same* tx hash; it never signs again
based on RPC timeouts. Any claim with an unknown hash remains locked.

**Browser checkpoint trust boundary:** `POST /api/bridge/persist` accepts only
pre-destination recovery states. A browser cannot write
`DESTINATION_BROADCAST`, `VERIFIED`, or a destination transaction hash through
the checkpoint mirror; those are exclusively server-verified boundaries. Older
server recovery checkpoints are also filtered out of the Bridge recovery UI
when a matching authenticated ActivityReceipt is already `COMPLETE` or
contains an independently verified reverted-source terminal `FAILED`
resolution. Any other failed or uncertain bridge remains available for
reconciliation.

**Remaining destination retry gate:** this durable claim deliberately permits
only the FIRST submission from either actor. Subsequent distinct receive
transactions after a provably reverted destination transaction need a
separate chain-verified attempt-resolution gate and append-only attempt history;
they cannot overwrite the existing ActivityReceipt or checkpoint receive hash.
The UI must not automatically retry a previously broadcast receive or assume
that a missing hash means no transaction was sent. Automatic retry of such
failures is NOT yet approved.

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
- immutable execution-evidence enforcement
- server-authoritative CCTP source/destination confirmation
- source-attestation-to-destination-calldata binding
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
